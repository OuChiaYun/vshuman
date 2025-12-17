// app.js
import { TalkingHead } from 'TalkingHead';

/* =========================
   State management
========================= */
const state = {
  head: null,
  websocket: null,
  mediaRecorder: null,
  isRecording: false,
  apiKey: null,      // Gemini API key - fetched from backend
  ttsApiKey: null,   // Google Cloud TTS API key - fetched from backend
  audioContext: null,
  currentStatus: 'idle',
  llmProvider: 'vllm', // 'gemini' or 'vllm'
  vllmConfig: {
    serverUrl: 'http://140.112.90.146:8000',
    model: 'openai/gpt-oss-20b'
  },
  recognition: null // for SpeechRecognition
};

// DOM elements (initialized after DOM ready)
let elements = {};

// Avatar ready gate
let avatarReadyResolve, avatarReadyReject;
const avatarReady = new Promise((resolve, reject) => {
  avatarReadyResolve = resolve;
  avatarReadyReject = reject;
});

/* =========================
   Helpers: DOM + logging
========================= */
function initElements() {
  elements = {
    startBtn: document.getElementById('startBtn'),
    voiceBtn: document.getElementById('voiceBtn'),
    stopBtn: document.getElementById('stopBtn'),
    statusDot: document.getElementById('statusDot'),
    statusText: document.getElementById('statusText'),
    transcript: document.getElementById('transcript'),
    debugMessages: document.getElementById('debugMessages'),
    textInput: document.getElementById('textInput'),
    sendBtn: document.getElementById('sendBtn'),
  };
}

function logDebug(message, type = 'info') {
  const timestamp = new Date().toLocaleTimeString();
  const line = `[${timestamp}] ${message}`;

  console.log(`[${type.toUpperCase()}] ${line}`);

  if (!elements.debugMessages) return;
  const div = document.createElement('div');
  div.className = `debug-message ${type}`;
  div.textContent = line;
  elements.debugMessages.appendChild(div);

  const parent = elements.debugMessages.parentElement;
  if (parent) parent.scrollTop = parent.scrollHeight;
}

function updateStatus(status, text) {
  state.currentStatus = status;
  if (elements.statusDot) elements.statusDot.className = `status-dot ${status}`;
  if (elements.statusText) elements.statusText.textContent = text;
}

function addTranscript(type, message) {
  if (!elements.transcript) return;
  const p = document.createElement('p');
  p.className = type === 'user' ? 'user-message' : 'ai-message';
  p.textContent = `${type === 'user' ? 'You' : 'Avatar'}: ${message}`;
  elements.transcript.appendChild(p);
  elements.transcript.scrollTop = elements.transcript.scrollHeight;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* =========================
   TTS Queue (single-voice, no browser TTS)
========================= */

// queue execution chain
let speakQueue = Promise.resolve();
let speakQueueGen = 0;    // clears queued tasks
let speakAbortGen = 0;    // abort in-flight speak waits

// queue UI/state
let ttsActive = false;        // 我們自己判斷：正在念（TalkingHead）
let speakQueuePending = 0;    // 排隊中任務數
const ttsQueueItems = [];     // 目前列隊有哪些（給另一邊看）

function emitTtsQueueState(extra = {}) {
  const snapshot = {
    active: ttsActive,
    pending: speakQueuePending,
    items: ttsQueueItems.slice(),
    ...extra,
    ts: Date.now(),
  };
  window.__TTS_QUEUE_STATE__ = snapshot;
  window.dispatchEvent(new CustomEvent('tts:queue', { detail: snapshot }));
}

function isTtsIdle() {
  // 保守一點：status 也納入（避免某些情況 ttsActive 沒跟上）
  return !ttsActive && speakQueuePending === 0 && state.currentStatus !== 'speaking';
}

function enqueueSpeak(task, meta = {}) {
  const myGen = speakQueueGen;

  const item = {
    id: (crypto?.randomUUID?.() ?? String(Date.now() + Math.random())),
    type: meta.type ?? 'unknown',
    note: meta.note ?? '',
    createdAt: Date.now(),
    meta,
  };

  ttsQueueItems.push(item);
  speakQueuePending++;
  emitTtsQueueState({ reason: 'enqueue' });

  speakQueue = speakQueue
    .then(async () => {
      try {
        if (myGen !== speakQueueGen) return; // queue cleared
        await task();
      } finally {
        const idx = ttsQueueItems.findIndex((x) => x.id === item.id);
        if (idx >= 0) ttsQueueItems.splice(idx, 1);
        speakQueuePending = Math.max(0, speakQueuePending - 1);
        emitTtsQueueState({ reason: 'dequeue' });
      }
    })
    .catch((err) => {
      console.error(err);
      logDebug(`Queue error: ${err?.message ?? String(err)}`, 'error');
    });

  return speakQueue;
}

function clearSpeakQueue() {
  speakQueueGen++;
  speakQueue = Promise.resolve();
  speakQueuePending = 0;
  ttsQueueItems.length = 0;
  emitTtsQueueState({ reason: 'clear' });
}

function abortSpeechNow() {
  speakAbortGen++;
  try { state.head?.stopSpeaking?.(); } catch {}
  // 保險：若你專案其他地方仍有 browser TTS，就順便停掉
  try { window.speechSynthesis?.cancel?.(); } catch {}
  ttsActive = false;
  emitTtsQueueState({ reason: 'abort' });
}

function createAbortWatcher(myAbortGen) {
  let timerId = null;
  const promise = new Promise((resolve) => {
    timerId = setInterval(() => {
      if (speakAbortGen !== myAbortGen) {
        clearInterval(timerId);
        timerId = null;
        resolve('aborted');
      }
    }, 50);
  });
  return {
    promise,
    cancel: () => {
      if (timerId) clearInterval(timerId);
      timerId = null;
    }
  };
}

/* =========================
   Backend config
========================= */
async function fetchApiKeys() {
  const response = await fetch('/api/config');
  if (!response.ok) throw new Error('Failed to fetch API keys from server');
  const data = await response.json();
  state.apiKey = data.apiKey;
  state.ttsApiKey = data.ttsApiKey;
  logDebug('API keys loaded successfully', 'success');
}

/* =========================
   Avatar init
========================= */
async function initAvatar() {
  try {
    logDebug('Initializing avatar...', 'info');
    updateStatus('thinking', 'Loading avatar...');

    await fetchApiKeys();

    const container = document.getElementById('avatar');
    if (!container) throw new Error('Avatar container (#avatar) not found');
    logDebug('Container element found', 'success');

    const head = new TalkingHead(container, {
      ttsEndpoint: 'https://texttospeech.googleapis.com/v1beta1/text:synthesize',
      ttsApikey: state.ttsApiKey,
      lipsyncModules: ['en', 'fi']
    });
    logDebug('TalkingHead instance created with TTS API key', 'success');

    logDebug('Loading 3D avatar model...', 'info');
    await head.showAvatar({
      url:
        'https://models.readyplayer.me/64bfa15f0e72c63d7c3934a6.glb' +
        '?morphTargets=ARKit,Oculus+Visemes,' +
        'mouthOpen,mouthSmile,eyesClosed,eyesLookUp,eyesLookDown' +
        '&textureSizeLimit=1024' +
        '&textureFormat=png',
      body: 'F',
      avatarMood: 'neutral',
      ttsLang: 'en-GB',
      ttsVoice: 'en-GB-Standard-A',
      lipsyncLang: 'en'
    });

    state.head = head;

    logDebug('Avatar loaded successfully!', 'success');
    updateStatus('idle', 'Avatar ready! Click Start to begin');

    setupZoomControls(head, container);
    setupSpeechRecognition();

    avatarReadyResolve(true);
  } catch (error) {
    console.error('Failed to load avatar:', error);
    logDebug(`Avatar load failed: ${error.message}`, 'error');
    updateStatus('error', 'Failed to load avatar. Check console for details.');
    avatarReadyReject(error);
  }
}

function setupSpeechRecognition() {
  if (!('webkitSpeechRecognition' in window)) {
    logDebug('Speech recognition not supported in this browser.', 'warning');
    return;
  }

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
}

function setupZoomControls(head, container) {
  const camera = head.camera;
  if (!camera) {
    console.warn('Camera not found, zoom controls disabled');
    return;
  }

  const minZoom = 0.5;
  const maxZoom = 3.0;
  const zoomSpeed = 0.001;
  let currentZoom = 1.0;

  container.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      const delta = -event.deltaY * zoomSpeed;
      currentZoom += delta;
      currentZoom = Math.max(minZoom, Math.min(maxZoom, currentZoom));

      if (!camera.userData.originalZ) camera.userData.originalZ = camera.position.z;
      camera.position.z = camera.userData.originalZ / currentZoom;

      logDebug(`Zoom: ${(currentZoom * 100).toFixed(0)}%`, 'info');
    },
    { passive: false }
  );

  logDebug('Mouse scroll zoom enabled (scroll to zoom in/out)', 'success');
}

/* =========================
   TalkingHead "real end" detection (fix插隊)
========================= */
function readSpeakingFlag(head) {
  // 常見命名嘗試：不同版本 TalkingHead 可能不一樣
  const candidates = [
    head?.isSpeaking,
    head?.speaking,
    head?.tts?.isSpeaking,
    head?.tts?.speaking,
  ];
  for (const v of candidates) {
    if (typeof v === 'boolean') return v;
  }
  // 有些會是 function
  const fns = [head?.isSpeaking, head?.speaking];
  for (const fn of fns) {
    if (typeof fn === 'function') {
      try {
        const r = fn.call(head);
        if (typeof r === 'boolean') return r;
      } catch {}
    }
  }
  return null;
}

function findAudioElementDeep(root, maxNodes = 250, maxDepth = 4) {
  if (!root || typeof root !== 'object') return null;

  const seen = new Set();
  const q = [{ v: root, d: 0 }];
  let nodes = 0;

  while (q.length && nodes < maxNodes) {
    const { v, d } = q.shift();
    if (!v || typeof v !== 'object') continue;
    if (seen.has(v)) continue;
    seen.add(v);
    nodes++;

    // HTMLAudioElement or <audio>
    try {
      if (typeof HTMLAudioElement !== 'undefined' && v instanceof HTMLAudioElement) return v;
      if (v?.tagName === 'AUDIO') return v;
    } catch {}

    if (d >= maxDepth) continue;

    // enqueue children
    for (const k of Object.keys(v)) {
      const child = v[k];
      if (child && typeof child === 'object') q.push({ v: child, d: d + 1 });
    }
  }
  return null;
}

async function waitForAudioEnded(audioEl, myAbortGen, timeoutMs = 60000) {
  if (!audioEl) return;

  // already ended
  try {
    if (audioEl.ended || audioEl.paused) return;
  } catch {}

  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (speakAbortGen !== myAbortGen) return;
    try {
      if (audioEl.ended || audioEl.paused) return;
    } catch {}
    await sleep(50);
  }
}

async function waitForTalkingHeadReallyDone(head, myAbortGen, timeoutMs = 60000) {
  const start = Date.now();

  // 先嘗試找 audio element（有些版本會藏在 head 物件內）
  let audioEl = null;

  while (Date.now() - start < timeoutMs) {
    if (speakAbortGen !== myAbortGen) return;

    // 1) speaking flag
    const flag = readSpeakingFlag(head);
    if (flag === false) return; // 明確說沒在講

    // 2) audio element ended
    if (!audioEl) audioEl = findAudioElementDeep(head);
    if (audioEl) {
      // 等到 audio 真正停
      await waitForAudioEnded(audioEl, myAbortGen, 2000);
      // 如果已經停了，直接回
      try {
        if (audioEl.ended || audioEl.paused) return;
      } catch {}
    }

    // 如果 flag 不存在，且 audioEl 也找不到，就繼續短輪詢
    await sleep(50);
  }
}

/* =========================
   TTS speak (TalkingHead only, await completes)
========================= */
async function speakTextInternal(text, source = 'unknown') {
  // Wait for avatar (but don’t hang forever)
  if (!state.head) {
    try {
      await Promise.race([
        avatarReady,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Avatar not ready (timeout)')), 8000)
        )
      ]);
    } catch (e) {
      logDebug(`Avatar not ready: ${e.message}`, 'warning');
      return;
    }
  }

  if (!state.head) return;

  const myAbortGen = speakAbortGen;
  const watcher = createAbortWatcher(myAbortGen);

  try {
    ttsActive = true;
    emitTtsQueueState({ reason: 'speak-start', source });

    updateStatus('speaking', 'Avatar speaking...');
    logDebug(`Speak start (${source})`, 'info');

    // ⚠️ 不要每次都 stopSpeaking：那會造成「看起來插隊」的打斷感
    // 只在 abortSpeechNow() 才 stopSpeaking

    const speakPromise = (async () => {
      // 1) 等 speakText promise
      await state.head.speakText(text);
      // 2) 再等「實際播放」真的結束（修插隊）
      await waitForTalkingHeadReallyDone(state.head, myAbortGen, 60000);
    })();

    const result = await Promise.race([
      speakPromise.then(() => 'done'),
      watcher.promise
    ]);

    if (result === 'aborted') return;

    logDebug('Speech completed', 'success');
  } catch (error) {
    console.error('Error speaking text:', error);
    logDebug(`Speech error: ${error.message}`, 'error');
  } finally {
    watcher.cancel();
    try { state.head?.setMood?.('neutral'); } catch {}
    updateStatus('idle', 'Ready! Use voice or text to chat');
    ttsActive = false;
    emitTtsQueueState({ reason: 'speak-end', source });
  }
}

// Public speak API (ALWAYS queued)
function say(text, meta = {}) {
  const clean = (text ?? '').toString().trim();
  if (!clean) return Promise.resolve();

  return enqueueSpeak(
    async () => {
      await speakTextInternal(clean, meta.type ?? 'say');
    },
    meta
  );
}

/* =========================
   slots:state -> product-click
========================= */
async function fetchTextFile(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`fetch text failed: ${res.status} (${url})`);
  return await res.text();
}

function pickRandomSlotWithTextUrl(list) {
  const candidates = (Array.isArray(list) ? list : []).filter(
    (x) => x && typeof x.text_url === 'string' && x.text_url.trim() !== ''
  );
  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

let slotState = window.__SLOTS_STATE__ ?? null;
var picked = null

function initSlotsBridge() {
  if (slotState) console.log('[app.js] initial slots:', slotState);

  window.addEventListener('slots:state', (e) => {
    slotState = e.detail; // { list: [...], active: idx, reason: ... }
    console.log('[app.js] slots updated:', slotState);

    if (slotState?.reason !== 'product-click') return;

    // ✅ 不管忙不忙：都先把 queue state 更新出去（給另一邊看）
    emitTtsQueueState({ reason: 'product-click-received' });

    // ✅ 只有「完全閒置」才 enqueue
    // if (!isTtsIdle()) {
    //   logDebug('product-click: TTS busy → only update queue state (no enqueue)', 'info');
    //   return;
    // }

    picked = pickRandomSlotWithTextUrl(slotState?.list);
    if (!picked) {
      logDebug('product-click: No slot has text_url. Nothing to speak.', 'warning');
      return;
    }

    console.log("picked: ", picked)
    // 讀檔 + 排隊念
    enqueueSpeak(
      async () => {
        let text = (picked.text ?? '').trim();
        if (!text) {
          try {
            text = (await fetchTextFile(picked.text_url)).trim();
          } catch (err) {
            logDebug(`product-click: Load text failed: ${err.message}`, 'error');
            return;
          }
        }
        if (!text) {
          logDebug('product-click: Text empty, skip speaking.', 'warning');
          return;
        }
        await speakTextInternal(text, 'product-click');
      },
      {
        type: 'product-click',
        note: `${picked.name ?? '(unnamed)'} -> ${picked.text_url}`,
        picked: { name: picked.name ?? '', text_url: picked.text_url }
      }
    );
  });
}

/* =========================
   Providers
========================= */
async function connectGemini() {
  if (!state.apiKey || !state.ttsApiKey) {
    logDebug('API keys not loaded', 'error');
    alert('Failed to load API keys from server. Check .env file.');
    return false;
  }
  updateStatus('idle', 'Ready! Use voice or text to chat');
  logDebug('Gemini API ready', 'success');
  return true;
}

async function connectVLLM() {
  logDebug(`vLLM provider selected. Server: ${state.vllmConfig.serverUrl}`, 'info');
  updateStatus('idle', 'Ready! Use voice or text to chat with vLLM');
  return true;
}

/* =========================
   Recording (Gemini/vLLM)
========================= */
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
      audio: { channelCount: 1, sampleRate: 16000 }
    });
    logDebug('Microphone access granted', 'success');

    state.audioContext = new AudioContext({ sampleRate: 16000 });
    const source = state.audioContext.createMediaStreamSource(stream);
    const processor = state.audioContext.createScriptProcessor(4096, 1, 1);
    logDebug('Audio processing pipeline created (16kHz, mono)', 'success');

    source.connect(processor);
    processor.connect(state.audioContext.destination);

    const audioChunks = [];
    processor.onaudioprocess = (e) => {
      const audioData = e.inputBuffer.getChannelData(0);
      const pcm16 = new Int16Array(audioData.length);
      for (let i = 0; i < audioData.length; i++) {
        const s = Math.max(-1, Math.min(1, audioData[i]));
        pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
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

  const audioChunks = state.mediaRecorder.audioChunks || [];

  if (state.mediaRecorder.stream) {
    state.mediaRecorder.stream.getTracks().forEach((track) => track.stop());
  }
  if (state.mediaRecorder.processor) state.mediaRecorder.processor.disconnect();
  if (state.mediaRecorder.source) state.mediaRecorder.source.disconnect();
  if (state.audioContext) state.audioContext.close();

  state.isRecording = false;
  logDebug('Recording stopped', 'success');

  if (audioChunks.length > 0) await sendAudioMessage(audioChunks);
}

/* =========================
   Audio utils (Gemini)
========================= */
function pcmToWav(pcmData, sampleRate = 16000) {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = pcmData.length * 2;

  const header = new ArrayBuffer(44);
  const view = new DataView(header);

  view.setUint32(0, 0x52494646, false);
  view.setUint32(4, 36 + dataSize, true);
  view.setUint32(8, 0x57415645, false);

  view.setUint32(12, 0x666d7420, false);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  view.setUint32(36, 0x64617461, false);
  view.setUint32(40, dataSize, true);

  const wavBuffer = new Uint8Array(44 + dataSize);
  wavBuffer.set(new Uint8Array(header), 0);
  wavBuffer.set(new Uint8Array(pcmData.buffer), 44);
  return wavBuffer;
}

async function sendAudioMessage(audioChunks) {
  logDebug('Processing audio message...', 'info');
  updateStatus('thinking', 'Processing audio...');

  try {
    let totalLength = 0;
    for (const chunk of audioChunks) totalLength += chunk.length;

    const combinedPCM = new Int16Array(totalLength);
    let offset = 0;
    for (const chunk of audioChunks) {
      combinedPCM.set(chunk, offset);
      offset += chunk.length;
    }

    logDebug(
      `Collected ${totalLength} audio samples (${(totalLength / 16000).toFixed(2)}s)`,
      'info'
    );

    const wavData = pcmToWav(combinedPCM, 16000);
    const base64Audio = btoa(String.fromCharCode(...wavData));

    logDebug(`Sending ${wavData.length} bytes to Gemini...`, 'info');

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${state.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: 'Transcribe and respond to this audio:' },
                { inlineData: { mimeType: 'audio/wav', data: base64Audio } }
              ]
            }
          ]
        })
      }
    );

    const data = await response.json();
    if (data.error) throw new Error(data.error.message || 'API error');

    if (data.candidates && data.candidates[0]?.content?.parts) {
      const aiText = data.candidates[0].content.parts.map((p) => p.text).join('');
      logDebug(
        `AI response: "${aiText.substring(0, 100)}${aiText.length > 100 ? '...' : ''}"`,
        'success'
      );

      await say(aiText, { type: 'ai-response', note: 'Gemini audio response' });
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

/* =========================
   Text -> Gemini / vLLM
========================= */

async function sendTextMessageFromUser(text, picked) {
  text += JSON.stringify(picked);
  return sendTextMessage(text);
}

async function sendTextMessage(text) {
  if (!text || !text.trim()) return;

  if (state.llmProvider === 'vllm') {
    sendTextMessageToVLLM(text);
    return;
  }

  text = text.trim();
  logDebug(`Sending text message to Gemini: "${text}"`, 'info');
  updateStatus('thinking', 'AI is thinking...');

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${state.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text }] }]
        })
      }
    );

    const data = await response.json();

    if (data.candidates && data.candidates[0]?.content?.parts) {
      const aiText = data.candidates[0].content.parts.map((p) => p.text).join('');
      logDebug(
        `AI response: "${aiText.substring(0, 100)}${aiText.length > 100 ? '...' : ''}"`,
        'success'
      );

      await say(aiText, { type: 'ai-response', note: 'Gemini text response' });
    }

    updateStatus('idle', 'Ready! Use voice or text to chat');
  } catch (error) {
    console.error('Error sending text message:', error);
    logDebug(`Error: ${error.message}`, 'error');
    updateStatus('error', 'Failed to get response');
  }
}

async function sendTextMessageToVLLM(text) {
  if (!text || !text.trim()) return;

  text = text.trim();
  logDebug(`Sending text message to vLLM: "${text}"`, 'info');
  updateStatus('thinking', 'AI is thinking...');

  try {
    const response = await fetch(`${state.vllmConfig.serverUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: state.vllmConfig.model,
        messages: [{ role: 'user', content: text }]
      })
    });

    const data = await response.json();

    if (data.choices && data.choices[0]?.message?.content) {
      const aiText = data.choices[0].message.content;
      logDebug(
        `AI response: "${aiText.substring(0, 100)}${aiText.length > 100 ? '...' : ''}"`,
        'success'
      );

      await say(aiText, { type: 'ai-response', note: 'vLLM response' });
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

/* =========================
   Event listeners
========================= */
function initEventListeners() {
  if (elements.startBtn) {
    elements.startBtn.addEventListener('click', async () => {
      logDebug('Start button clicked', 'info');
      let connected = false;
      if (state.llmProvider === 'gemini') connected = await connectGemini();
      else connected = await connectVLLM();

      if (connected) {
        elements.startBtn.disabled = true;
        if (elements.voiceBtn) elements.voiceBtn.disabled = false;
        if (elements.stopBtn) elements.stopBtn.disabled = false;
        if (elements.textInput) elements.textInput.disabled = false;
        if (elements.sendBtn) elements.sendBtn.disabled = false;
        logDebug('Chat session started', 'success');
      }
    });
  }

  if (elements.voiceBtn) {
    elements.voiceBtn.addEventListener('click', async () => {
      if (!state.isRecording) {
        logDebug('Voice button clicked - starting microphone', 'info');
        await startRecording();
        if (state.isRecording) updateStatus('listening', 'Listening... Speak now!');
      } else {
        logDebug('Voice button clicked - stopping microphone', 'info');
        await stopRecording();
      }
    });
  }

  if (elements.stopBtn) {
    elements.stopBtn.addEventListener('click', () => {
      clearSpeakQueue();
      abortSpeechNow();

      logDebug('Stop button clicked', 'info');
      stopRecording();

      if (state.head && state.head.setMood) state.head.setMood('neutral');

      if (elements.startBtn) elements.startBtn.disabled = false;
      if (elements.voiceBtn) elements.voiceBtn.disabled = true;
      if (elements.stopBtn) elements.stopBtn.disabled = true;
      if (elements.textInput) {
        elements.textInput.disabled = true;
        elements.textInput.value = '';
      }
      if (elements.sendBtn) elements.sendBtn.disabled = true;

      updateStatus('idle', 'Chat stopped. Click Start to begin again.');
      logDebug('Chat session ended', 'success');
    });
  }

  if (elements.sendBtn) {
    elements.sendBtn.addEventListener('click', () => {
      const text = elements.textInput?.value ?? '';
      if (text.trim()) {
        addTranscript('user', text);
        picked
        sendTextMessageFromUser(text, picked);
        // sendTextMessage(text);
        if (elements.textInput) {
          elements.textInput.value = '';
          elements.textInput.focus();
        }
      }
    });
  }

  if (elements.textInput) {
    elements.textInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        const text = elements.textInput.value;
        if (text.trim()) {
          addTranscript('user', text);
          // sendTextMessage(text);
          sendTextMessageFromUser(text, picked)
          elements.textInput.value = '';
        }
      }
    });
  }
}

/* =========================
   Boot
========================= */
async function initApp() {
  initElements();
  initEventListeners();
  initSlotsBridge();
  initAvatar(); // no await
  emitTtsQueueState({ reason: 'boot' });
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
