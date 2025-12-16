import { TalkingHead } from 'TalkingHead';

// State management
const state = {
    head: null,
    websocket: null,
    mediaRecorder: null,
    isRecording: false,
    apiKey: null, // Gemini API key - fetched from backend
    ttsApiKey: null, // Google Cloud TTS API key - fetched from backend
    audioContext: null,
    currentStatus: 'idle',
    llmProvider: 'gemini', // 'gemini' or 'vllm'
    vllmConfig: {
        serverUrl: 'http://140.112.90.146:8000',
        model: 'openai/gpt-oss-20b'
    },
    recognition: null // for SpeechRecognition
};

// DOM elements
const elements = {
    startBtn: document.getElementById('startBtn'),
    voiceBtn: document.getElementById('voiceBtn'),
    stopBtn: document.getElementById('stopBtn'),
    statusDot: document.getElementById('statusDot'),
    statusText: document.getElementById('statusText'),
    transcript: document.getElementById('transcript'),
    debugMessages: document.getElementById('debugMessages'),
    textInput: document.getElementById('textInput'),
    sendBtn: document.getElementById('sendBtn'),
    switchLLMBtn: document.getElementById('switchLLMBtn')
};

// Debug logger
function logDebug(message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    const div = document.createElement('div');
    div.className = `debug-message ${type}`;
    div.textContent = `[${timestamp}] ${message}`;
    elements.debugMessages.appendChild(div);
    elements.debugMessages.parentElement.scrollTop = elements.debugMessages.parentElement.scrollHeight;

    // Also log to console
    console.log(`[${type.toUpperCase()}] ${message}`);
}

// Initialize the avatar
async function initAvatar() {
    try {
        logDebug('Initializing avatar...', 'info');
        updateStatus('thinking', 'Loading avatar...');

        // Fetch API keys first
        await fetchApiKeys();

        // Get the DOM container element
        const container = document.getElementById('avatar');
        logDebug('Container element found', 'success');

        // Create TalkingHead with DOM element and TTS API key
        const head = new TalkingHead(container, {
            ttsEndpoint: "https://texttospeech.googleapis.com/v1beta1/text:synthesize",
            ttsApikey: state.ttsApiKey,
            lipsyncModules: ["en","fi"]
        });
        logDebug('TalkingHead instance created with TTS API key', 'success');

        // Load avatar (using TalkingHead's default avatar)
        logDebug('Loading 3D avatar model...', 'info');
        // await head.showAvatar({
        //     url: 'https://models.readyplayer.me/64bfa15f0e72c63d7c3934a6.glb',
        //     body: 'F',
        //     avatarMood: 'neutral',
        //     ttsLang: "en-GB",
        //     ttsVoice: "en-GB-Standard-A",
        //     lipsyncLang: 'en'

            await head.showAvatar({
            url: 'https://models.readyplayer.me/64bfa15f0e72c63d7c3934a6.glb'
            + '?morphTargets=ARKit,Oculus+Visemes,'
            + 'mouthOpen,mouthSmile,eyesClosed,eyesLookUp,eyesLookDown'
            + '&textureSizeLimit=1024'
            + '&textureFormat=png',
            body: 'F',
            avatarMood: 'neutral',
            ttsLang: "en-GB",
            ttsVoice: "en-GB-Standard-A",
            lipsyncLang: 'en'
        });
        // });
        

        state.head = head;

        // Debug: Find the actual mesh with morph targets
        console.log('🔍 TalkingHead object:', head);
        console.log('🔍 TalkingHead.scene:', head.scene);
        console.log('🔍 TalkingHead.morphs:', head.morphs);
        console.log('🔍 TalkingHead.nodeAvatar:', head.nodeAvatar);

        // Try to find the mesh in the scene
        if (head.scene && head.scene.traverse) {
            head.scene.traverse((node) => {
                if (node.morphTargetDictionary && node.morphTargetInfluences) {
                    console.log('✅ Found mesh with morph targets:', node);
                    console.log('✅ Morph dictionary:', node.morphTargetDictionary);
                    console.log('✅ Morph influences length:', node.morphTargetInfluences.length);
                }
            });
        }

        // Also check head.morphs array
        if (head.morphs && head.morphs.length > 0) {
            console.log('✅ TalkingHead.morphs array:', head.morphs);
        }

        logDebug('Avatar loaded successfully!', 'success');
        updateStatus('idle', 'Avatar ready! Click Start to begin');

        // Add mouse scroll zoom functionality
        setupZoomControls(head, container);

        // Initialize SpeechRecognition
        if ('webkitSpeechRecognition' in window) {
            state.recognition = new webkitSpeechRecognition();
            state.recognition.continuous = false;
            state.recognition.interimResults = false;
            state.recognition.lang = 'en-US';

            state.recognition.onresult = (event) => {
                const transcript = event.results[0][0].transcript;
                logDebug(`Speech recognized: "${transcript}"`, 'info');
                addTranscript('user', transcript);
                sendTextMessage(transcript);
            };

            state.recognition.onerror = (event) => {
                logDebug(`Speech recognition error: ${event.error}`, 'error');
                updateStatus('error', 'Speech recognition error');
            };
        } else {
            logDebug('Speech recognition not supported in this browser.', 'warning');
        }


    } catch (error) {
        console.error('Failed to load avatar:', error);
        logDebug(`Avatar load failed: ${error.message}`, 'error');
        updateStatus('error', 'Failed to load avatar. Check console for details.');
    }
}

let slotState  = window.__SLOTS_STATE__ ?? null;

if (slotState ) {
  console.log("[app.js] initial:", slotState );
}

window.addEventListener("slots:state", (e) => {
  slotState  = e.detail; // { list: [...], active: idx, reason: ... }
  console.log("[app.js] updated:", slotState );
});


// Setup zoom controls with mouse wheel
function setupZoomControls(head, container) {
    // Access the camera from TalkingHead
    const camera = head.camera;

    if (!camera) {
        console.warn('Camera not found, zoom controls disabled');
        return;
    }

    // Zoom settings
    const minZoom = 0.5;  // Maximum zoom out
    const maxZoom = 3.0;  // Maximum zoom in
    const zoomSpeed = 0.001;

    // Current zoom level (1.0 = default)
    let currentZoom = 1.0;

    // Add wheel event listener to the avatar container
    container.addEventListener('wheel', (event) => {
        event.preventDefault();

        // Calculate zoom change
        const delta = -event.deltaY * zoomSpeed;
        currentZoom += delta;

        // Clamp zoom level
        currentZoom = Math.max(minZoom, Math.min(maxZoom, currentZoom));

        // Apply zoom by adjusting camera position
        // TalkingHead typically uses a perspective camera
        if (camera.position) {
            // Store original Z position if not already stored
            if (!camera.userData.originalZ) {
                camera.userData.originalZ = camera.position.z;
            }

            // Adjust camera Z position based on zoom
            // Smaller zoom value = camera further away
            camera.position.z = camera.userData.originalZ / currentZoom;

            logDebug(`Zoom: ${(currentZoom * 100).toFixed(0)}%`, 'info');
        }
    }, { passive: false });

    logDebug('Mouse scroll zoom enabled (scroll to zoom in/out)', 'success');
}

// Update status display
function updateStatus(status, text) {
    state.currentStatus = status;
    elements.statusDot.className = `status-dot ${status}`;
    elements.statusText.textContent = text;
}

// Add message to transcript
function addTranscript(type, message) {
    const p = document.createElement('p');
    p.className = type === 'user' ? 'user-message' : 'ai-message';
    p.textContent = `${type === 'user' ? 'You' : 'Avatar'}: ${message}`;
    elements.transcript.appendChild(p);
    elements.transcript.scrollTop = elements.transcript.scrollHeight;
}

// Fetch API keys from backend
async function fetchApiKeys() {
    try {
        const response = await fetch('/api/config');
        if (!response.ok) {
            throw new Error('Failed to fetch API keys from server');
        }
        const data = await response.json();
        state.apiKey = data.apiKey;
        state.ttsApiKey = data.ttsApiKey;
        logDebug('API keys loaded successfully', 'success');
    } catch (error) {
        console.error('Error fetching API keys:', error);
        updateStatus('error', 'Failed to load API keys from server');
        throw error;
    }
}

// Initialize Gemini API (REST)
async function connectGemini() {
    // API keys are already loaded in initAvatar()
    if (!state.apiKey || !state.ttsApiKey) {
        logDebug('API keys not loaded', 'error');
        alert('Failed to load API keys from server. Check .env file.');
        return false;
    }

    updateStatus('idle', 'Ready! Use voice or text to chat');
    logDebug('Gemini API ready', 'success');
    return true;
}

// Initialize vLLM
async function connectVLLM() {
    logDebug(`vLLM provider selected. Server: ${state.vllmConfig.serverUrl}`, 'info');
    updateStatus('idle', 'Ready! Use voice or text to chat with vLLM');
    return true;
}


// Start recording audio
async function startRecording() {
    if (state.llmProvider === 'vllm') {
        if (state.recognition) {
            logDebug('Starting speech recognition...', 'info');
            state.recognition.start();
            state.isRecording = true;
            updateStatus('listening', 'Listening... Speak now!');
        } else {
            logDebug('Speech recognition not available.', 'error');
            updateStatus('error', 'Speech recognition not supported');
        }
        return;
    }

    try {
        logDebug('Requesting microphone access...', 'info');
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                channelCount: 1,
                sampleRate: 16000
            }
        });
        logDebug('Microphone access granted', 'success');

        // Create audio context for processing
        state.audioContext = new AudioContext({ sampleRate: 16000 });
        const source = state.audioContext.createMediaStreamSource(stream);
        const processor = state.audioContext.createScriptProcessor(4096, 1, 1);
        logDebug('Audio processing pipeline created (16kHz, mono)', 'success');

        source.connect(processor);
        processor.connect(state.audioContext.destination);

        // Collect audio chunks
        const audioChunks = [];
        processor.onaudioprocess = (e) => {
            const audioData = e.inputBuffer.getChannelData(0);

            // Convert Float32Array to Int16Array (PCM16)
            const pcm16 = new Int16Array(audioData.length);
            for (let i = 0; i < audioData.length; i++) {
                const s = Math.max(-1, Math.min(1, audioData[i]));
                pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
            }

            audioChunks.push(pcm16);
        };

        state.mediaRecorder = { stream, processor, source, audioChunks };
        state.isRecording = true;
        logDebug('Recording started successfully', 'success');

    } catch (error) {
        console.error('Failed to access microphone:', error);
        logDebug(`Microphone error: ${error.message}`, 'error');
        updateStatus('error', 'Microphone access denied');
    }
}

// Stop recording and send to Gemini
async function stopRecording() {
    if (state.llmProvider === 'vllm') {
        if (state.recognition && state.isRecording) {
            logDebug('Stopping speech recognition...', 'info');
            state.recognition.stop();
            state.isRecording = false;
            updateStatus('thinking', 'Processing speech...');
        }
        return;
    }

    logDebug('Stopping recording...', 'info');

    if (!state.mediaRecorder || !state.isRecording) return;

    // Get recorded audio chunks
    const audioChunks = state.mediaRecorder.audioChunks || [];

    // Stop the recording
    if (state.mediaRecorder.stream) {
        state.mediaRecorder.stream.getTracks().forEach(track => track.stop());
    }
    if (state.mediaRecorder.processor) {
        state.mediaRecorder.processor.disconnect();
    }
    if (state.mediaRecorder.source) {
        state.mediaRecorder.source.disconnect();
    }
    if (state.audioContext) {
        state.audioContext.close();
    }

    state.isRecording = false;
    logDebug('Recording stopped', 'success');

    // Send audio to Gemini if we have data
    if (audioChunks.length > 0) {
        await sendAudioMessage(audioChunks);
    }
}

// Convert PCM16 to WAV format
function pcmToWav(pcmData, sampleRate = 16000) {
    const numChannels = 1;
    const bitsPerSample = 16;
    const byteRate = sampleRate * numChannels * bitsPerSample / 8;
    const blockAlign = numChannels * bitsPerSample / 8;
    const dataSize = pcmData.length * 2; // 2 bytes per sample (16-bit)

    // WAV file header (44 bytes)
    const header = new ArrayBuffer(44);
    const view = new DataView(header);

    // "RIFF" chunk descriptor
    view.setUint32(0, 0x52494646, false); // "RIFF"
    view.setUint32(4, 36 + dataSize, true); // File size - 8
    view.setUint32(8, 0x57415645, false); // "WAVE"

    // "fmt " sub-chunk
    view.setUint32(12, 0x666d7420, false); // "fmt "
    view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
    view.setUint16(20, 1, true); // AudioFormat (1 for PCM)
    view.setUint16(22, numChannels, true); // NumChannels
    view.setUint32(24, sampleRate, true); // SampleRate
    view.setUint32(28, byteRate, true); // ByteRate
    view.setUint16(32, blockAlign, true); // BlockAlign
    view.setUint16(34, bitsPerSample, true); // BitsPerSample

    // "data" sub-chunk
    view.setUint32(36, 0x64617461, false); // "data"
    view.setUint32(40, dataSize, true); // Subchunk2Size

    // Combine header and PCM data
    const wavBuffer = new Uint8Array(44 + dataSize);
    wavBuffer.set(new Uint8Array(header), 0);
    wavBuffer.set(new Uint8Array(pcmData.buffer), 44);

    return wavBuffer;
}

// Send audio message to Gemini REST API
async function sendAudioMessage(audioChunks) {
    logDebug('Processing audio message...', 'info');
    updateStatus('thinking', 'Processing audio...');

    try {
        // Concatenate all audio chunks
        let totalLength = 0;
        for (const chunk of audioChunks) {
            totalLength += chunk.length;
        }

        const combinedPCM = new Int16Array(totalLength);
        let offset = 0;
        for (const chunk of audioChunks) {
            combinedPCM.set(chunk, offset);
            offset += chunk.length;
        }

        logDebug(`Collected ${totalLength} audio samples (${(totalLength / 16000).toFixed(2)}s)`, 'info');

        // Convert PCM to WAV format
        const wavData = pcmToWav(combinedPCM, 16000);

        // Convert to base64
        const base64Audio = btoa(String.fromCharCode(...wavData));

        logDebug(`Sending ${wavData.length} bytes to Gemini...`, 'info');

        // Send to Gemini
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${state.apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{
                        parts: [
                            { text: "Transcribe and respond to this audio:" },
                            {
                                inlineData: {
                                    mimeType: "audio/wav",
                                    data: base64Audio
                                }
                            }
                        ]
                    }]
                })
            }
        );

        const data = await response.json();

        if (data.error) {
            throw new Error(data.error.message || 'API error');
        }

        if (data.candidates && data.candidates[0]?.content?.parts) {
            const aiText = data.candidates[0].content.parts
                .map(part => part.text)
                .join('');

            logDebug(`AI response: "${aiText.substring(0, 100)}${aiText.length > 100 ? '...' : ''}"`, 'success');
            // addTranscript('ai', aiText);

            // Speak the response using browser TTS
            await speakText(aiText);
        } else {
            logDebug('No response from Gemini', 'error');
        }

        updateStatus('idle', 'Ready! Use voice or text to chat');

    } catch (error) {
        console.error('Error sending audio message:', error);
        logDebug(`Error: ${error.message}`, 'error');
        updateStatus('error', 'Failed to process audio');
    }
}

// Speak text using TalkingHead's built-in TTS with automatic lip sync
async function speakText(text) {
    if (!state.head) {
        console.warn('Avatar not loaded, cannot speak');
        return;
    }

    try {
        updateStatus('speaking', 'Avatar speaking...');

        // Try to use TalkingHead's Google Cloud TTS first
        if (state.ttsApiKey && state.ttsApiKey.startsWith('AIza')) {
            logDebug('Using Google Cloud TTS with lip sync', 'info');
            try {
                await state.head.speakText(text);
                updateStatus('idle', 'Ready! Use voice or text to chat');
                logDebug('Speech completed', 'success');
                return;
            } catch (ttsError) {
                console.warn('Google TTS failed, falling back to browser TTS:', ttsError);
                logDebug('Google TTS failed, using browser TTS fallback', 'warning');
            }
        } else {
            logDebug('Invalid TTS API key format, using browser TTS', 'warning');
        }

        // Fallback to browser TTS with simple lip sync using TalkingHead's mood system
        logDebug('Using browser TTS with basic lip sync', 'info');

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 1.0;
        utterance.pitch = 1.0;
        utterance.volume = 1.0;

        // Simple lip animation by alternating moods
        let animationFrameId;
        let isTalking = true;
        const animateJaw = () => {
            if (state.head && isTalking) {
                // Alternate between slightly open and closed mouth using mood changes
                const time = Date.now() / 200; // Slower animation
                const moodValue = Math.abs(Math.sin(time));

                // Use TalkingHead's setMood method if available
                if (state.head.setMood) {
                    state.head.setMood(moodValue > 0.5 ? 'happy' : 'neutral');
                }
            }
            if (isTalking) {
                animationFrameId = requestAnimationFrame(animateJaw);
            }
        };

        animateJaw();

        utterance.onend = () => {
            isTalking = false;
            cancelAnimationFrame(animationFrameId);
            // Reset to neutral
            if (state.head && state.head.setMood) {
                state.head.setMood('neutral');
            }
            updateStatus('idle', 'Ready! Use voice or text to chat');
            logDebug('Speech completed (browser TTS)', 'success');
        };

        utterance.onerror = (error) => {
            console.error('Speech error:', error);
            isTalking = false;
            cancelAnimationFrame(animationFrameId);
            if (state.head && state.head.setMood) {
                state.head.setMood('neutral');
            }
            updateStatus('idle', 'Ready! Use voice or text to chat');
        };

        window.speechSynthesis.speak(utterance);

    } catch (error) {
        console.error('Error speaking text:', error);
        logDebug(`Speech error: ${error.message}`, 'error');
        updateStatus('idle', 'Ready! Use voice or text to chat');
    }
}


// Send text message to Gemini REST API
async function sendTextMessage(text) {
    if (!text || !text.trim()) return;

    if (state.llmProvider === 'vllm') {
        sendTextMessageToVLLM(text);
        return;
    }

    text = text.trim();
    logDebug(`Sending text message to Gemini: "${text}"`, 'info');
    //addTranscript('user', text);
    updateStatus('thinking', 'AI is thinking...');

    try {
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${state.apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{
                        parts: [{ text: text }]
                    }]
                })
            }
        );

        const data = await response.json();

        if (data.candidates && data.candidates[0]?.content?.parts) {
            const aiText = data.candidates[0].content.parts
                .map(part => part.text)
                .join('');

            logDebug(`AI response: "${aiText.substring(0, 100)}${aiText.length > 100 ? '...' : ''}"`, 'success');
            // addTranscript('ai', aiText);

            // Speak the response using browser TTS
            await speakText(aiText);
        }

        updateStatus('idle', 'Ready! Use voice or text to chat');

    } catch (error) {
        console.error('Error sending text message:', error);
        logDebug(`Error: ${error.message}`, 'error');
        updateStatus('error', 'Failed to get response');
    }
}

// Send text message to vLLM server
async function sendTextMessageToVLLM(text) {
    if (!text || !text.trim()) return;

    text = text.trim();
    logDebug(`Sending text message to vLLM: "${text}"`, 'info');
    // The transcript is already added by the speech recognition result or text input handler
    // addTranscript('user', text); 
    updateStatus('thinking', 'AI is thinking...');

    try {
        const response = await fetch(
            `${state.vllmConfig.serverUrl}/v1/chat/completions`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model: state.vllmConfig.model,
                    messages: [
                        { role: 'user', content: text }
                    ]
                })
            }
        );

        const data = await response.json();

        if (data.choices && data.choices[0]?.message?.content) {
            const aiText = data.choices[0].message.content;

            logDebug(`AI response: "${aiText.substring(0, 100)}${aiText.length > 100 ? '...' : ''}"`, 'success');
            addTranscript('ai', aiText);

            await speakText(aiText);
        } else {
            logDebug('No response from vLLM', 'error');
        }

        updateStatus('idle', 'Ready! Use voice or text to chat');

    } catch (error) {
        console.error('Error sending text message to vLLM:', error);
        logDebug(`vLLM Error: ${error.message}`, 'error');
        updateStatus('error', 'Failed to get response from vLLM');
    }
}


// Event listeners
elements.startBtn.addEventListener('click', async () => {
    logDebug('Start button clicked', 'info');
    let connected = false;
    if (state.llmProvider === 'gemini') {
        connected = await connectGemini();
    } else {
        connected = await connectVLLM();
    }

    if (connected) {
        elements.startBtn.disabled = true;
        elements.voiceBtn.disabled = false;
        elements.stopBtn.disabled = false;
        elements.textInput.disabled = false;
        elements.sendBtn.disabled = false;
        elements.switchLLMBtn.disabled = true; // Disable switching during a session
        logDebug('Chat session started', 'success');
    }
});

// Voice button handler
elements.voiceBtn.addEventListener('click', async () => {
    if (!state.isRecording) {
        logDebug('Voice button clicked - starting microphone', 'info');
        await startRecording();
        if (state.isRecording) {
            // elements.voiceBtn.textContent = '🔴 Stop Voice';

            updateStatus('listening', 'Listening... Speak now!');
        }
    } else {
        logDebug('Voice button clicked - stopping microphone', 'info');
        // elements.voiceBtn.textContent = '🎤 Start Voice';

        await stopRecording(); // This will send audio to Gemini
    }
});

elements.stopBtn.addEventListener('click', () => {
    logDebug('Stop button clicked', 'info');
    stopRecording();

    // Stop avatar speech if it's currently speaking
    if (state.head) {
        state.head.stopSpeaking();

    }
    // Also stop browser TTS if it's running
    window.speechSynthesis.cancel();

    // Reset mood to neutral
    if (state.head && state.head.setMood) {
        state.head.setMood('neutral');
    }

    elements.startBtn.disabled = false;
    elements.voiceBtn.disabled = true;
    // elements.voiceBtn.textContent = '🎤 Start Voice';
    elements.stopBtn.disabled = true;
    elements.textInput.disabled = true;
    elements.sendBtn.disabled = true;
    elements.textInput.value = '';
    elements.switchLLMBtn.disabled = false; // Re-enable switching
    elements.voiceBtn.disabled=true;

    updateStatus('idle', 'Chat stopped. Click Start to begin again.');
    logDebug('Chat session ended', 'success');
});

// Send button click handler
elements.sendBtn.addEventListener('click', () => {
    const text = elements.textInput.value;
    if (text.trim()) {
        addTranscript('user', text);
        sendTextMessage(text);
        elements.textInput.value = '';
        elements.textInput.focus();
    }
});

// Enter key handler for text input
elements.textInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        const text = elements.textInput.value;
        if (text.trim()) {
            addTranscript('user', text);
            sendTextMessage(text);
            elements.textInput.value = '';
        }
    }
});

// Initialize avatar on page load
initAvatar();
