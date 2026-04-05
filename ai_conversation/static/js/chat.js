let chatContext = [];
let historyData = [];
let currentRetryCount = 0;

function saveSession() {
    const storageKeyPrefix = CONFIG.avatar_set;
    
    // 容量制限対策: localStorage に保存するデータから重い audio_data を除外する
    const historyToSave = historyData.map(item => {
        const { audio_data, ...rest } = item;
        return rest;
    });

    localStorage.setItem(`${storageKeyPrefix}_chat_context`, JSON.stringify(chatContext));
    localStorage.setItem(`${storageKeyPrefix}_history_data`, JSON.stringify(historyToSave));
}

function addAiMessageOnly(aiReply, aiTime, shouldSave = true, emotion = "tired", audioData = null) {
    const div = document.createElement("div");
    div.className = "message-pair";
    div.innerHTML = `
        <div class="ai-response-area">
            <div class="timestamp">${aiTime}</div>
            <div class="ai-msg">${CONFIG.app_title}: ${aiReply}</div>
        </div>
    `;
    const chatHistoryDiv = document.getElementById("chat-history");
    const scrollArea = document.getElementById("scroll-area");
    chatHistoryDiv.appendChild(div);
    scrollArea.scrollTop = scrollArea.scrollHeight;

    if (shouldSave) {
        historyData.push({ reply: aiReply, aiTime: aiTime, userText: null, emotion: emotion, audio_data: audioData });
        saveSession();
    }
}

function createMessagePair(userText, userTime) {
    const div = document.createElement("div");
    div.className = "message-pair";
    div.innerHTML = `
        <div class="timestamp">${userTime}</div>
        <div class="user-msg">あなた: ${userText}</div>
        <div class="ai-response-area"></div>
    `;
    const chatHistoryDiv = document.getElementById("chat-history");
    const scrollArea = document.getElementById("scroll-area");
    chatHistoryDiv.appendChild(div);
    scrollArea.scrollTop = scrollArea.scrollHeight;
    return div;
}

function appendAiResponse(container, aiReply, aiTime, index) {
    const responseArea = container.querySelector(".ai-response-area");
    let replayBtn = '';
    if (index !== -1) {
        replayBtn = `<span class=\"replay-link\" onclick=\"replayMessage(${index})\">▶ もう一度聞く</span>`;
    }

    const msgBlock = document.createElement("div");
    msgBlock.innerHTML = `
        <div class="timestamp">${aiTime}</div>
        <div class="ai-msg">
            ${CONFIG.app_title}: ${aiReply}
            ${replayBtn}
        </div>
    `;
    responseArea.appendChild(msgBlock);
    const scrollArea = document.getElementById("scroll-area");
    scrollArea.scrollTop = scrollArea.scrollHeight;
}

function toggleErrorBanner(show) {
    const banner = document.getElementById("api-error-banner");
    if (banner) {
        banner.style.display = show ? "block" : "none";
        // 5秒後に自動的に非表示にする
        if (show) {
            if (window.errorBannerTimer) clearTimeout(window.errorBannerTimer);
            window.errorBannerTimer = setTimeout(() => {
                banner.style.display = "none";
                window.errorBannerTimer = null;
            }, 5000);
        }
    }
}

async function fetchChat(userText, userTime, container = null) {
    if (!container) container = createMessagePair(userText, userTime);
    
    // ブラウザの音声再生制限を解除するためにアンロック関数を呼び出す
    unlockAudio();
    
    // 実機音声を使用するかどうかの判定
    const useRealVoice = document.getElementById("debug-use-real-voice")?.checked;
    
    const debugBody = {
        message: userText, 
        character_id: CONFIG.avatar_set,
        history: chatContext,
        skip_tts: isVoiceOffMode && !useRealVoice 
    };

    if (isVoiceOffMode) {
        debugBody.debug_llm_provider = document.getElementById("debug-llm-provider")?.value || null;
        debugBody.debug_llm_model = document.getElementById("debug-llm-model")?.value || null;
        debugBody.debug_tts_provider = document.getElementById("debug-tts-provider")?.value || null;
        
        // 422エラー対策: 数値変換を行い、無効な場合はnullをセット
        const speakerId = parseInt(document.getElementById("debug-sakura-speaker")?.value);
        debugBody.debug_sakura_speaker_id = isNaN(speakerId) ? null : speakerId;

        debugBody.debug_edge_voice = document.getElementById("debug-edge-voice")?.value || null;
        
        // Edge-TTS用の符号付きパラメータ生成 (0% -> +0% の修正)
        const pitchVal = document.getElementById("debug-edge-pitch")?.value || 0;
        debugBody.debug_edge_pitch = (pitchVal >= 0 ? "+" : "") + pitchVal + "Hz";
        const rateVal = document.getElementById("debug-edge-rate")?.value || 0;
        debugBody.debug_edge_rate = (rateVal >= 0 ? "+" : "") + rateVal + "%";
    }

    let isSuccess = false;
    try {
        const response = await fetch("chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(debugBody)
        });
        
        if (!response.ok) {
            if (response.status === 429) {
                const aiTime = getTimestamp();
                const index = historyData.length;
                historyData.push({ 
                    reply: CONFIG.api_ratelimit.msg, 
                    aiTime: aiTime, 
                    userText: userText, 
                    userTime: userTime, 
                    emotion: CONFIG.api_ratelimit.emotion, 
                    isLocal: true, 
                    wav: CONFIG.api_ratelimit.wav 
                });
                saveSession();
                appendAiResponse(container, CONFIG.api_ratelimit.msg, aiTime, index);
                playLocalAudio(CONFIG.api_ratelimit.wav, CONFIG.api_ratelimit.emotion || "disgusted", null, CONFIG.api_ratelimit.msg); 
                return; 
            }
            if (response.status === 500) {
                toggleErrorBanner(true);
            }
            throw new Error(`Server Error: ${response.status}`);
        }
        
        toggleErrorBanner(false);
        const data = await response.json();
        isSuccess = true;
        currentRetryCount = 0;
        
        const aiTime = getTimestamp();
        const index = historyData.length;
        data.userText = userText;
        data.userTime = userTime;
        data.aiTime = aiTime;
        
        historyData.push(data);
        appendAiResponse(container, data.reply, aiTime, index);
        
        chatContext.push({ role: "user", content: userText });
        chatContext.push({ role: "assistant", content: `[${data.emotion}]${data.reply}` });
        if (chatContext.length > (CONFIG.max_history_size * 2)) chatContext.splice(0, 2);
        
        saveSession();
        playAudio(data.audio_data, data.emotion, data.reply);
        
    } catch (error) {
        console.error("Chat fetch error:", error);
        if (isSuccess) return;

        const aiTime = getTimestamp();
        if (currentRetryCount < CONFIG.max_retry_count) {
            currentRetryCount++;
            const index = historyData.length;
            historyData.push({ 
                reply: CONFIG.api_retry.msg, 
                aiTime: aiTime, 
                userText: userText, 
                userTime: userTime, 
                emotion: CONFIG.api_retry.emotion || "trouble", 
                isLocal: true, 
                wav: CONFIG.api_retry.wav 
            });
            saveSession();
            appendAiResponse(container, CONFIG.api_retry.msg, aiTime, index);
            playLocalAudio(CONFIG.api_retry.wav, CONFIG.api_retry.emotion || "trouble", () => fetchChat(userText, userTime, container), CONFIG.api_retry.msg);
        } else {
            currentRetryCount = 0;
            const index = historyData.length;
            historyData.push({ 
                reply: CONFIG.api_failure.msg, 
                aiTime: aiTime, 
                userText: userText, 
                userTime: userTime, 
                emotion: CONFIG.api_failure.emotion || "tired", 
                isLocal: true, 
                wav: CONFIG.api_failure.wav 
            });
            saveSession();
            appendAiResponse(container, CONFIG.api_failure.msg, aiTime, index);
            playLocalAudio(CONFIG.api_failure.wav, CONFIG.api_failure.emotion || "tired", null, CONFIG.api_failure.msg);
        }
    }
}
