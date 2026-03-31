import os
import httpx
import logging
import base64
import re
import json
import edge_tts
from pathlib import Path
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import Optional, List, Dict, Any

# ロギング設定
logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s', datefmt='%Y-%m-%d %H:%M:%S')
logger = logging.getLogger("ai_reception")

load_dotenv()
app = FastAPI()

# 設定値の読み込み
SAKURA_API_KEY = os.getenv("SAKURA_API_KEY")
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
DEFAULT_CHARACTER = os.getenv("DEFAULT_CHARACTER", "ma3ki") 
BASE_URL = "https://api.ai.sakura.ad.jp"
CHARACTERS_CONFIG_PATH = Path("config/characters.json")

# キャラクター設定のロード
def load_characters():
    if not CHARACTERS_CONFIG_PATH.exists():
        logger.error("SYSTEM: characters.json not found")
        return {}
    with open(CHARACTERS_CONFIG_PATH, "r", encoding="utf-8") as f:
        return json.load(f)

CHARACTERS = load_characters()

class Chat(BaseModel):
    message: str
    character_id: Optional[str] = DEFAULT_CHARACTER
    history: Optional[List[Dict[str, Any]]] = []
    skip_tts: Optional[bool] = False
    # デバッグ用オーバーライド設定 (422エラーを完全に封じ込めるため Optional に統一)
    debug_llm_provider: Optional[str] = None
    debug_llm_model: Optional[str] = None
    debug_tts_provider: Optional[str] = None
    debug_sakura_speaker_id: Optional[int] = None
    debug_edge_voice: Optional[str] = None
    debug_edge_pitch: Optional[str] = None
    debug_edge_rate: Optional[str] = None

class LogEvent(BaseModel):
    event: str
    detail: str

@app.post("/log_event")
async def log_event(item: LogEvent):
    logger.info(f"CLIENT_EVENT: {item.event} - {item.detail}")
    return {"status": "ok"}

@app.get("/config")
async def get_config(char: str = DEFAULT_CHARACTER):
    active_char = char if char in CHARACTERS else DEFAULT_CHARACTER
    char_info = CHARACTERS.get(active_char)
    
    if not char_info:
        raise HTTPException(status_code=404, detail="Character not found")
    
    # 階層構造からの読み取り
    llm_conf = char_info.get("llm", {})
    tts_conf = char_info.get("tts", {})
    fixed_audio = char_info.get("fixed_audio", {})
    
    return {
        "app_title": char_info.get("app_title"),
        "emotion_list": char_info.get("emotion_list"),
        "speaker": tts_conf.get("primary_speaker_id"),
        "credit_text": char_info.get("credit_text"),
        "use_browser_tts": char_info.get("use_browser_tts"),
        "max_retry_count": llm_conf.get("max_retry_count", 1),
        "max_history_size": char_info.get("max_history_size"),
        "api_retry": fixed_audio.get("retry"),
        "api_failure": fixed_audio.get("failure"),
        "api_ratelimit": fixed_audio.get("ratelimit"),
        "debug_menu": char_info.get("debug_menu"),
        "avatar_set": active_char,
        "media_dir": f"media/{active_char}"
    }

async def call_llm(provider, model, messages):
    """各プロバイダーのAPIを呼び出すヘルパー関数"""
    async with httpx.AsyncClient(timeout=60.0) as client:
        if provider == "sakura":
            if not SAKURA_API_KEY: return None
            headers = {"Authorization": f"Bearer {SAKURA_API_KEY}", "Content-Type": "application/json"}
            res = await client.post(f"{BASE_URL}/v1/chat/completions", headers=headers, json={"model": model or "gpt-oss-120b", "messages": messages})
        elif provider == "groq":
            if not GROQ_API_KEY: return None
            headers = {"Authorization": f"Bearer {GROQ_API_KEY}", "Content-Type": "application/json"}
            res = await client.post("https://api.groq.com/openai/v1/chat/completions", headers=headers, json={"model": model or "llama-3.1-70b-versatile", "messages": messages})
        elif provider == "gemini":
            if not GEMINI_API_KEY: return None
            # OpenAI互換エンドポイント用の最新認証
            headers = {"Authorization": f"Bearer {GEMINI_API_KEY}", "Content-Type": "application/json"}
            url = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
            payload = {"model": model or "gemini-2.5-flash", "messages": messages}
            res = await client.post(url, headers=headers, json=payload)
            if res.status_code != 200:
                logger.error(f"GEMINI_API_ERROR ({res.status_code}): {res.text}")
        else:
            return None
        
        res.raise_for_status()
        return res.json()["choices"][0]["message"]["content"]

@app.post("/chat")
async def chat_endpoint(chat: Chat):
    active_char = chat.character_id if chat.character_id in CHARACTERS else DEFAULT_CHARACTER
    char_info = CHARACTERS.get(active_char)
    
    system_prompt = char_info.get("system_prompt", "")
    emotion_list = char_info.get("emotion_list", ["normal"])
    
    llm_conf = char_info.get("llm", {})
    tts_conf = char_info.get("tts", {})
    use_browser_tts = char_info.get("use_browser_tts", False)
    
    providers = []
    if chat.debug_llm_provider:
        providers.append({"p": chat.debug_llm_provider, "m": chat.debug_llm_model})
    else:
        if llm_conf.get("primary_provider"):
            providers.append({"p": llm_conf["primary_provider"], "m": llm_conf.get("primary_model")})
        if llm_conf.get("fallback_provider"):
            providers.append({"p": llm_conf["fallback_provider"], "m": llm_conf.get("fallback_model")})

    max_retries = llm_conf.get("max_retry_count", 1)
    raw_reply = None
    last_error = None
    messages = [{"role": "system", "content": system_prompt}, *chat.history, {"role": "user", "content": chat.message}]

    for p_info in providers:
        provider, model = p_info["p"], p_info["m"]
        for attempt in range(max_retries + 1):
            try:
                logger.info(f"LLM_REQUEST ({provider} - {model}) Attempt {attempt + 1}: {chat.message}")
                raw_reply = await call_llm(provider, model, messages)
                if raw_reply: break
            except Exception as e:
                logger.warning(f"LLM_ERROR ({provider} - Attempt {attempt + 1}): {str(e)}")
                last_error = e
                continue
        if raw_reply: break

    if not raw_reply:
        raise HTTPException(status_code=500, detail="All LLM providers failed")

    emotion, reply = "normal", raw_reply
    match = re.match(r"\[(" + "|".join(emotion_list) + r")\](.*)", raw_reply)
    if match: emotion, reply = match.group(1), match.group(2).strip()

    audio_base64 = ""
    if not chat.skip_tts and not use_browser_tts:
        clean_text = reply.replace("\n", " ").strip()
        tts_attempts = []
        if chat.debug_tts_provider:
            tts_attempts.append({"p": chat.debug_tts_provider, "s": chat.debug_sakura_speaker_id, "v": chat.debug_edge_voice, "pitch": chat.debug_edge_pitch, "rate": chat.debug_edge_rate})
        else:
            tts_attempts.append({"p": tts_conf.get("primary_provider", "sakura"), "s": tts_conf.get("primary_speaker_id", 8), "v": tts_conf.get("edge_tts_voice"), "pitch": tts_conf.get("edge_tts_pitch"), "rate": tts_conf.get("edge_tts_rate")})
            if tts_conf.get("fallback_provider"): tts_attempts.append({"p": tts_conf["fallback_provider"]})

        for tts_step in tts_attempts:
            try:
                if tts_step["p"] == "edge-tts":
                    edge_voice = tts_step.get("v") or tts_conf.get("edge_tts_voice", "ja-JP-NanamiNeural")
                    edge_pitch = tts_step.get("pitch") or tts_conf.get("edge_tts_pitch", "+0Hz")
                    edge_rate = tts_step.get("rate") or tts_conf.get("edge_tts_rate", "+0%")
                    communicate = edge_tts.Communicate(clean_text, edge_voice, pitch=edge_pitch, rate=edge_rate)
                    audio_data = b""
                    async for chunk in communicate.stream():
                        if chunk["type"] == "audio": audio_data += chunk["data"]
                    audio_base64 = f"data:audio/wav;base64,{base64.b64encode(audio_data).decode('utf-8')}"
                    break
                elif tts_step["p"] == "sakura":
                    if not SAKURA_API_KEY: continue
                    speaker_id = tts_step.get("s") or tts_conf.get("primary_speaker_id", 8)
                    headers = {"Authorization": f"Bearer {SAKURA_API_KEY}", "Content-Type": "application/json"}
                    async with httpx.AsyncClient(timeout=60.0) as client:
                        res_q = await client.post(f"{BASE_URL}/tts/v1/audio_query", headers=headers, params={"text": clean_text, "speaker": speaker_id})
                        res_q.raise_for_status()
                        res_s = await client.post(f"{BASE_URL}/tts/v1/synthesis", headers=headers, params={"speaker": speaker_id}, json=res_q.json())
                        res_s.raise_for_status()
                        audio_base64 = f"data:audio/wav;base64,{base64.b64encode(res_s.content).decode('utf-8')}"
                    break
            except Exception as e:
                logger.warning(f"TTS_STEP_ERROR ({tts_step['p']}): {str(e)}")
                continue

    return {"reply": reply, "emotion": emotion, "audio_data": audio_base64}

app.mount("/", StaticFiles(directory="static", html=True), name="static")
