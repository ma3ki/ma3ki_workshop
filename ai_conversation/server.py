# uvicorn server:app --host 127.0.0.1 --port 8000
import os
import httpx
import logging
import base64
import re
import json
from pathlib import Path
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

# ロギング設定
logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s', datefmt='%Y-%m-%d %H:%M:%S')
logger = logging.getLogger("ai_reception")

load_dotenv()
app = FastAPI()

# 設定値の読み込み (基本はAPI_KEYのみ)
API_KEY = os.getenv("API_KEY")
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
    character_id: str = DEFAULT_CHARACTER
    history: list = []
    skip_tts: bool = False

class LogEvent(BaseModel):
    event: str
    detail: str

@app.post("/log_event")
async def log_event(item: LogEvent):
    logger.info(f"CLIENT_EVENT: {item.event} - {item.detail}")
    return {"status": "ok"}

@app.get("/config")
async def get_config(char: str = DEFAULT_CHARACTER):
    # IDが空、または存在しない場合はデフォルトを使用
    active_char = char if char in CHARACTERS else DEFAULT_CHARACTER
    char_info = CHARACTERS.get(active_char)
    
    if not char_info:
        raise HTTPException(status_code=404, detail="Character not found")
    
    return {
        "app_title": char_info.get("app_title"),
        "emotion_list": char_info.get("emotion_list"),
        "speaker": char_info.get("speaker"),
        "credit_text": char_info.get("credit_text"),
        "use_browser_tts": char_info.get("use_browser_tts"),
        "max_retry_count": char_info.get("max_retry_count"),
        "max_history_size": char_info.get("max_history_size"),
        "api_retry": char_info.get("api_retry"),
        "api_failure": char_info.get("api_failure"),
        "api_ratelimit": char_info.get("api_ratelimit"),
        "avatar_set": active_char,
        "media_dir": f"media/{active_char}"
    }

@app.post("/chat")
async def chat_endpoint(chat: Chat):
    if not API_KEY:
        logger.error("SYSTEM: API_KEY is missing")
        raise HTTPException(status_code=500, detail="API_KEY is missing")

    active_char = chat.character_id if chat.character_id in CHARACTERS else DEFAULT_CHARACTER
    char_info = CHARACTERS.get(active_char)
    
    system_prompt = char_info.get("system_prompt", "")
    emotion_list = char_info.get("emotion_list", ["normal"])
    speaker_id = char_info.get("speaker", 8)
    use_browser_tts = char_info.get("use_browser_tts", False) # ブラウザTTS設定を取得

    headers = {"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"}
    
    async with httpx.AsyncClient(timeout=60.0) as client:
        try:
            logger.info(f"USER_INPUT ({active_char}): {chat.message}")
            
            messages = [
                {"role": "system", "content": system_prompt},
                *chat.history,
                {"role": "user", "content": chat.message}
            ]

            res_chat = await client.post(
                f"{BASE_URL}/v1/chat/completions",
                headers=headers,
                json={
                    "model": "gpt-oss-120b",
                    "messages": messages
                }
            )
            res_chat.raise_for_status()
            raw_reply = res_chat.json()["choices"][0]["message"]["content"]
            
            emotion, reply = "normal", raw_reply
            match = re.match(r"\[(" + "|".join(emotion_list) + r")\](.*)", raw_reply)
            if match:
                emotion, reply = match.group(1), match.group(2).strip()

            logger.info(f"AI_RESPONSE: [{emotion}] {reply}")

            audio_base64 = ""
            # フロント側でブラウザTTSを使う場合、またはデバッグモード時は生成をスキップ
            if not chat.skip_tts and not use_browser_tts:
                clean_text = reply.replace("\n", " ").strip()
                res_q = await client.post(f"{BASE_URL}/tts/v1/audio_query", headers=headers, params={"text": clean_text, "speaker": speaker_id})
                res_q.raise_for_status()
                
                res_s = await client.post(f"{BASE_URL}/tts/v1/synthesis", headers=headers, params={"speaker": speaker_id}, json=res_q.json())
                res_s.raise_for_status()
                
                audio_base64 = f"data:audio/wav;base64,{base64.b64encode(res_s.content).decode('utf-8')}"
                logger.info(f"TTS_GENERATE: Success (Speaker: {speaker_id})")
            else:
                logger.info(f"TTS_GENERATE: Skipped (Debug:{chat.skip_tts} / BrowserTTS:{use_browser_tts})")

            return {"reply": reply, "emotion": emotion, "audio_data": audio_base64}

        except httpx.HTTPStatusError as e:
            # さくらAPI側のエラーを詳細にログ出力 (デグレ防止)
            if e.response.status_code == 429:
                logger.warning("API_STATUS: Rate limit exceeded (429)")
                raise HTTPException(status_code=429, detail="Rate limit exceeded")
            logger.error(f"API_ERROR: HTTP {e.response.status_code} - {e.response.text}")
            raise HTTPException(status_code=500, detail=str(e))
        except Exception as e:
            logger.error(f"SYSTEM_ERROR: {str(e)}")
            raise HTTPException(status_code=500, detail=str(e))

app.mount("/", StaticFiles(directory="static", html=True), name="static")
