let isVoiceOffMode = false;
let CONFIG = {
    api_retry: { emotion: "trouble" },
    api_failure: { emotion: "tired" },
    api_ratelimit: { emotion: "disgusted" },
    avatar_set: "ma3ki"
};
const preloadedImages = {};

async function init() {
    try {
        const urlParams = new URLSearchParams(window.location.search);
        const charId = urlParams.get('char') || "";

        const res = await fetch(`config?char=${charId}`);
        CONFIG = await res.json();
        
        document.getElementById("app-title").innerText = CONFIG.app_title;
        document.title = CONFIG.app_title;
        document.getElementById("credit-text").innerText = CONFIG.credit_text;

        const mediaPath = CONFIG.media_dir + "/";
        document.getElementById("avatar").src = `${mediaPath}normal_mouse_close_eye_open.webp`;

        CONFIG.emotion_list.forEach(emo => {
            ["open", "close"].forEach(mouth => {
                ["open", "close"].forEach(eye => {
                    const src = `${mediaPath}${emo}_mouse_${mouth}_eye_${eye}.webp`;
                    const img = new Image(); img.src = src;
                    preloadedImages[src] = img;
                });
            });
        });
        
        const storageKeyPrefix = CONFIG.avatar_set;
        const savedContext = localStorage.getItem(`${storageKeyPrefix}_chat_context`);
        const savedHistory = localStorage.getItem(`${storageKeyPrefix}_history_data`);
        
        if (savedContext) chatContext = JSON.parse(savedContext);
        if (savedHistory) {
            historyData = JSON.parse(savedHistory);
            historyData.forEach((item, index) => {
                if (item.userText) {
                    const container = createMessagePair(item.userText, item.userTime);
                    appendAiResponse(container, item.reply, item.aiTime, index);
                } else {
                    addAiMessageOnly(item.reply, item.aiTime, false);
                }
            });
        }

        const debugInput = document.getElementById("debug-text");
        if (debugInput) {
            debugInput.addEventListener("keypress", (e) => {
                if (e.key === "Enter") sendDebugText();
            });
        }

        checkSpeechSupport();
        console.log(`System Initialized (Character: ${CONFIG.avatar_set})`);
        blinkLoop();
    } catch (e) { console.error("Init Error:", e); }
}
window.onload = init;

function checkSpeechSupport() {
    const talkBtn = document.getElementById("talk-btn");
    const warning = document.getElementById("browser-warning");
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
        warning.style.display = "block";
        talkBtn.innerText = "音声非対応環境です";
        talkBtn.disabled = true;
        document.getElementById("debug-area").style.display = "flex";
    }
}

function clearSession() {
    if (confirm("これまでの会話履歴をすべて消去します。よろしいですか？")) {
        const storageKeyPrefix = CONFIG.avatar_set;
        localStorage.removeItem(`${storageKeyPrefix}_chat_context`);
        localStorage.removeItem(`${storageKeyPrefix}_history_data`);
        window.location.reload();
    }
}

document.getElementById("credit-text").addEventListener('dblclick', () => {
    isVoiceOffMode = !isVoiceOffMode;
    const credit = document.getElementById("credit-text");
    const debugArea = document.getElementById("debug-area");
    if (isVoiceOffMode) {
        credit.style.color = "#007bff";
        debugArea.style.display = "flex";
    } else {
        credit.style.color = "#888";
        debugArea.style.display = "none";
    }
});

function blinkLoop() {
    setTimeout(() => {
        if (currentEmotion === "normal") {
            isBlinking = true; updateAvatar();
            setTimeout(() => { isBlinking = false; updateAvatar(); }, 200);
        }
        blinkLoop();
    }, Math.random() * (15000 - 8000) + 8000);
}

function startVoice() {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) return;
    const recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
    recognition.lang = "ja-JP";
    recognition.onstart = () => {
        const btn = document.getElementById("talk-btn");
        btn.innerText = "聞き取り中..."; btn.disabled = true;
    };
    recognition.onresult = (event) => {
        const userText = event.results[0][0].transcript;
        const userTime = getTimestamp();
        document.getElementById("talk-btn").innerText = "考え中...";
        fetchChat(userText, userTime);
    };
    recognition.onerror = () => resetButtons();
    recognition.start();
}

function sendDebugText() {
    const input = document.getElementById("debug-text");
    if (!input.value) return;
    const userText = input.value;
    const userTime = getTimestamp();
    input.value = "";
    const btn = document.getElementById("talk-btn");
    btn.innerText = "考え中...";
    btn.disabled = true;
    fetchChat(userText, userTime);
}

function resetButtons() {
    const btn = document.getElementById("talk-btn");
    btn.innerText = "話しかける"; btn.disabled = false;
}

function getTimestamp() {
    const now = new Date();
    return now.getFullYear() + '/' + String(now.getMonth() + 1).padStart(2, '0') + '/' + String(now.getDate()).padStart(2, '0') + ' ' + String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0') + ':' + String(now.getSeconds()).padStart(2, '0');
}

function toggleUI() {
    const body = document.body;
    const isMobileWidth = window.innerWidth <= 1024;
    const isCurrentlyPC = body.classList.contains("force-pc-mode") || (!isMobileWidth && !body.classList.contains("force-mobile-mode"));
    if (isCurrentlyPC) {
        body.classList.remove("force-pc-mode"); body.classList.add("force-mobile-mode");
    } else {
        body.classList.remove("force-mobile-mode"); body.classList.add("force-pc-mode");
    }
}

async function reportAudioLog(fileName) {
    try {
        fetch("log_event", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ event: "AudioPlayback", detail: fileName })
        });
    } catch(e) {}
}

function replayMessage(index) {
    if (isSpeaking) return;
    const item = historyData[index];
    document.getElementById("talk-btn").disabled = true;
    
    // エラーメッセージ（ローカル/ブラウザ音声）か通常のAI回答かを判別
    if (item.isLocal) {
        playLocalAudio(item.wav, item.emotion, null, item.reply);
    } else {
        playAudio(item.audio_data, item.emotion, item.reply);
    }
}
