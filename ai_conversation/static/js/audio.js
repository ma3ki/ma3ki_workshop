let currentEmotion = "normal";
let isSpeaking = false;
let isMouthOpen = false;
let isBlinking = false;
let mouthInterval = null;
let resetEmotionTimeout = null;

// iOS Safari対策: 単一のAudioインスタンスを使い回す
const globalAudioInstance = new Audio();

function unlockAudio() {
    // 【重要】無音再生の前に、前回の再生イベントリスナーを解除して口パクのフライングを防ぐ
    globalAudioInstance.onplay = null;
    globalAudioInstance.onended = null;
    globalAudioInstance.src = "data:audio/wav;base64,UklGRigAAABXQVZFRm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAA== ";
    globalAudioInstance.play().catch(() => {});
}

function updateAvatar() {
    const safeEmotion = currentEmotion || "trouble";
    let eyeState = isBlinking ? "close" : "open";
    let mouthState = isSpeaking && isMouthOpen ? "open" : "close";
    if (safeEmotion !== "normal") eyeState = "open";
    
    const mediaPath = CONFIG.media_dir + "/";
    let fileName = `${mediaPath}${safeEmotion}_mouse_${mouthState}_eye_${eyeState}.webp`;
    if (safeEmotion === "shy" && mouthState === "open") fileName = `${mediaPath}shy_mouse_open_eye_open.webp`;
    
    const avatarImg = document.getElementById("avatar");
    if (preloadedImages[fileName]) {
        avatarImg.src = preloadedImages[fileName].src;
    } else {
        avatarImg.src = fileName;
    }
}

function startMouthAnimation() {
    if (resetEmotionTimeout) clearTimeout(resetEmotionTimeout);
    isSpeaking = true;
    
    // 二重起動防止：既存のインターバルがあればクリアする
    if (mouthInterval) clearInterval(mouthInterval);
    
    mouthInterval = setInterval(() => {
        isMouthOpen = !isMouthOpen;
        updateAvatar();
    }, 160);
}

function stopMouthAnimation(shouldResetButtons = true) {
    isSpeaking = false;
    isMouthOpen = false;
    if (mouthInterval) clearInterval(mouthInterval);
    mouthInterval = null;
    updateAvatar();
    if (shouldResetButtons) {
        resetButtons();
    }
    resetEmotionTimeout = setTimeout(() => {
        currentEmotion = "normal";
        updateAvatar();
    }, 5000);
}

document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && isSpeaking) {
        if (CONFIG.use_browser_tts && !window.speechSynthesis.speaking) {
            stopMouthAnimation(true);
        }
    }
});

function playAudio(audioData, emotion, text = null) {
    try {
        currentEmotion = emotion || "normal";
        updateAvatar();
        
        // デバッグモードかつ実機音声が届いていない場合のみ debug.wav を再生
        if (isVoiceOffMode && !audioData) {
            playLocalAudio("debug.wav", currentEmotion);
            return;
        }

        if (CONFIG.use_browser_tts && text) {
            window.speechSynthesis.cancel();
            const uttr = new SpeechSynthesisUtterance(text);
            uttr.lang = "ja-JP";
            uttr.onstart = () => startMouthAnimation();
            uttr.onend = () => stopMouthAnimation(true);
            uttr.onerror = () => stopMouthAnimation(true);
            window.speechSynthesis.speak(uttr);
            return;
        }

        if (!audioData) {
            stopMouthAnimation(true);
            return;
        }
        reportAudioLog("Generated TTS Audio");
        
        const audio = globalAudioInstance;
        audio.pause();
        audio.src = audioData;
        audio.load();
        audio.onplay = () => startMouthAnimation();
        audio.onended = () => stopMouthAnimation(true);
        audio.play().catch(() => stopMouthAnimation(true));
    } catch (e) {
        console.error("playAudio error:", e);
        stopMouthAnimation(true);
    }
}

function playLocalAudio(url, emotion, onEndedCallback = null, text = null) {
    try {
        currentEmotion = emotion || "trouble";
        updateAvatar();
        
        if (CONFIG.use_browser_tts && text) {
            window.speechSynthesis.cancel();
            const uttr = new SpeechSynthesisUtterance(text);
            uttr.lang = "ja-JP";
            uttr.onstart = () => startMouthAnimation();
            uttr.onend = () => {
                stopMouthAnimation(onEndedCallback ? false : true);
                if (onEndedCallback) onEndedCallback();
            };
            uttr.onerror = () => {
                stopMouthAnimation(onEndedCallback ? false : true);
                if (onEndedCallback) onEndedCallback();
            };
            window.speechSynthesis.speak(uttr);
            return;
        }

        const audioPath = `${CONFIG.media_dir}/${url}`;
        reportAudioLog(audioPath);
        
        const audio = globalAudioInstance;
        audio.pause();
        audio.src = audioPath;
        audio.load();
        audio.onplay = () => startMouthAnimation();
        audio.onended = () => { 
            stopMouthAnimation(onEndedCallback ? false : true); 
            if (onEndedCallback) onEndedCallback(); 
        };
        audio.play().catch((e) => {
            console.warn("Local audio play failed:", audioPath, e);
            stopMouthAnimation(onEndedCallback ? false : true);
            if (onEndedCallback) onEndedCallback();
        });
    } catch (e) {
        console.error("playLocalAudio error:", e);
        if (onEndedCallback) onEndedCallback();
    }
}
