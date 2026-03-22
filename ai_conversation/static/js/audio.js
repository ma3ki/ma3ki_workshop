let currentEmotion = "normal";
let isSpeaking = false;
let isMouthOpen = false;
let isBlinking = false;
let mouthInterval = null;
let resetEmotionTimeout = null;

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
    mouthInterval = setInterval(() => {
        isMouthOpen = !isMouthOpen;
        updateAvatar();
    }, 160);
}

function stopMouthAnimation(shouldResetButtons = true) {
    isSpeaking = false;
    isMouthOpen = false;
    if (mouthInterval) clearInterval(mouthInterval);
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
        if (isVoiceOffMode) {
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
        const audio = new Audio(audioData);
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
        
        const audio = new Audio(audioPath);
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
