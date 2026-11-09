import { pipeline, env } from '@huggingface/transformers';

(() => {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const $ = (id) => document.getElementById(id);
  const els = {
    mic: $('micButton'), pause: $('pauseBtn'), stop: $('stopBtn'), clear: $('clearBtn'),
    mode: $('speechMode'), source: $('audioSource'), chat: $('chatArea'), messages: $('messages'), welcome: $('welcomeState'),
    preview: $('listeningPreview'), previewText: $('previewText'), status: $('micStatus'),
    title: $('micTitle'), description: $('micDescription'), label: $('sessionLabel'),
    liveDot: $('liveDot'), timer: $('sessionTime'), toast: $('toast'), settings: $('settingsDialog'),
    settingsBtn: $('settingsBtn'), email: $('contactEmail'), saveSettings: $('saveSettings'),
    translatorCard: $('translatorCard'), maximize: $('maximizeBtn'), support: $('supportNote')
  };

  let active = false, paused = false, sessionStarted = 0, timerId = null, elapsedBeforePause = 0;
  let toastTimer = null, lastFinal = '', lastFinalAt = 0, recognizer = null;
  let transcriber = null, modelPromise = null, audioContext = null, displayStream = null, micStream = null;
  let processor = null, silentGain = null, desktopSource = null, sampleQueue = [], queuedSamples = 0;
  let processing = false, sessionSource = 'microphone';
  const CONTACT_KEY = 'translive-contact-email';
  els.email.value = localStorage.getItem(CONTACT_KEY) || '';
  env.allowLocalModels = true;
  env.allowRemoteModels = true;

  function toast(message) {
    els.toast.textContent = message; els.toast.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => els.toast.classList.remove('show'), 4200);
  }
  function setStatus(on, text) {
    els.status.classList.toggle('on', on); els.status.lastChild.textContent = text;
    els.liveDot.classList.toggle('active', on);
  }
  function timeString(seconds) {
    return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
  }
  function startClock() {
    clearInterval(timerId); sessionStarted = Date.now();
    timerId = setInterval(() => {
      els.timer.textContent = timeString(elapsedBeforePause + (paused ? 0 : Math.floor((Date.now() - sessionStarted) / 1000)));
    }, 500);
  }
  function stopClock() {
    clearInterval(timerId); timerId = null;
    els.timer.textContent = timeString(elapsedBeforePause + (paused ? 0 : Math.floor((Date.now() - sessionStarted) / 1000)));
  }
  function scrollBottom() { requestAnimationFrame(() => { els.chat.scrollTop = els.chat.scrollHeight; }); }
  function nowTime() { return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(new Date()); }
  function cleanText(value) { return (value || '').replace(/\s+/g, ' ').trim(); }

  function makePair(sourceText, sourceLang, pending = false) {
    const pair = document.createElement('div'); pair.className = 'message-pair';
    const idBubble = document.createElement('div'); idBubble.className = `bubble indonesian${pending ? ' pending' : ''}`;
    const enBubble = document.createElement('div'); enBubble.className = `bubble english${pending ? ' pending' : ''}`;
    const idMeta = document.createElement('div'); idMeta.className = 'bubble-meta'; idMeta.textContent = '🇮🇩 INDONESIA';
    const enMeta = document.createElement('div'); enMeta.className = 'bubble-meta'; enMeta.textContent = '🇬🇧 ENGLISH';
    const idText = document.createElement('p'); const enText = document.createElement('p');
    const idTime = document.createElement('div'); idTime.className = 'bubble-time';
    const enTime = document.createElement('div'); enTime.className = 'bubble-time';
    if (sourceLang === 'id') { idText.textContent = sourceText; enText.textContent = pending ? 'Translating…' : ''; }
    else { enText.textContent = sourceText; idText.textContent = pending ? 'Menerjemahkan…' : ''; }
    idTime.textContent = enTime.textContent = nowTime();
    idBubble.append(idMeta, idText, idTime); enBubble.append(enMeta, enText, enTime);
    pair.append(idBubble, enBubble); els.messages.append(pair); els.welcome.hidden = true; scrollBottom();
    return { idText, enText, idBubble, enBubble };
  }
  async function translateText(text, sourceLang) {
    const target = sourceLang === 'id' ? 'en' : 'id';
    const params = new URLSearchParams({ q: text, langpair: `${sourceLang}|${target}` });
    const email = els.email.value.trim(); if (email) params.set('de', email);
    const response = await fetch(`https://api.mymemory.translated.net/get?${params}`, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Translation service returned ${response.status}`);
    const data = await response.json();
    if (data.responseStatus !== 200 || !data.responseData?.translatedText) throw new Error(data.responseDetails || 'Translation unavailable.');
    return data.responseData.translatedText;
  }
  async function commitPhrase(rawText, sourceLang) {
    const text = cleanText(rawText);
    if (text.length < 2 || !/[a-zà-ÿ]{2}/i.test(text)) return;
    const stamp = Date.now();
    if (text.toLowerCase() === lastFinal.toLowerCase() && stamp - lastFinalAt < 2200) return;
    lastFinal = text; lastFinalAt = stamp;
    const message = makePair(text, sourceLang, true);
    try {
      const translated = await translateText(text, sourceLang);
      if (sourceLang === 'id') message.enText.textContent = translated; else message.idText.textContent = translated;
    } catch (error) {
      const target = sourceLang === 'id' ? message.enText : message.idText;
      target.textContent = 'Translation unavailable. Check your connection or try again.';
      toast(error.message.includes('429') ? 'Free translation limit reached. Try again later.' : 'Could not reach the free translation service.');
    }
    message.idBubble.classList.remove('pending'); message.enBubble.classList.remove('pending'); scrollBottom();
  }

  // v1.5-style native browser speech recognition for microphone input.
  function startMicrophoneRecognition() {
    if (!SpeechRecognition || !['microphone', 'both'].includes(sessionSource)) return;
    stopMicrophoneRecognition();
    const rec = new SpeechRecognition();
    rec.lang = els.mode.value === 'id' ? 'id-ID' : 'en-US';
    rec.continuous = true; rec.interimResults = true; rec.maxAlternatives = 1;
    rec.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = cleanText(result[0]?.transcript || '');
        if (!transcript) continue;
        if (result.isFinal) { void commitPhrase(transcript, els.mode.value); }
        else interim += `${transcript} `;
      }
      if (interim.trim()) {
        els.preview.hidden = false;
        els.previewText.textContent = `Microphone: ${interim.trim()}`;
      }
    };
    rec.onerror = (event) => {
      if (['no-speech', 'aborted'].includes(event.error)) return;
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        toast('Microphone speech recognition permission was denied. Check browser permissions.');
      } else toast(`Microphone recognition issue: ${event.error}`);
    };
    rec.onend = () => {
      if (active && !paused && recognizer === rec) {
        setTimeout(() => { if (active && !paused && recognizer === rec) { try { rec.start(); } catch (_) {} } }, 350);
      }
    };
    recognizer = rec;
    try { rec.start(); } catch (error) { console.warn('SpeechRecognition start failed:', error); toast('Could not start microphone recognition. Try restarting the session.'); }
  }
  function stopMicrophoneRecognition() {
    if (!recognizer) return;
    const old = recognizer; recognizer = null;
    old.onend = null; try { old.stop(); } catch (_) {}
  }

  async function loadTranscriber() {
    if (transcriber) return transcriber;
    if (modelPromise) return modelPromise;
    modelPromise = (async () => {
      els.title.textContent = 'Loading desktop speech model…';
      els.description.textContent = 'First desktop-audio use downloads Whisper Tiny; the browser caches it for next time.';
      els.preview.hidden = false; els.previewText.textContent = 'Preparing desktop speech recognition…';
      const model = 'onnx-community/whisper-tiny';
      try {
        if (navigator.gpu) {
          try { transcriber = await pipeline('automatic-speech-recognition', model, { device: 'webgpu' }); }
          catch (gpuError) { console.warn('WebGPU unavailable; falling back to WASM:', gpuError); }
        }
        if (!transcriber) transcriber = await pipeline('automatic-speech-recognition', model);
        return transcriber;
      } catch (error) {
        modelPromise = null;
        throw new Error(`Could not load the desktop speech model: ${error.message || error}`);
      }
    })();
    return modelPromise;
  }
  function downsampleTo16k(samples, inputRate) {
    if (inputRate === 16000) return Float32Array.from(samples);
    const ratio = inputRate / 16000; const outputLength = Math.floor(samples.length / ratio);
    const output = new Float32Array(outputLength);
    for (let i = 0; i < outputLength; i++) {
      const position = i * ratio, left = Math.floor(position), right = Math.min(left + 1, samples.length - 1);
      const weight = position - left; output[i] = samples[left] * (1 - weight) + samples[right] * weight;
    }
    return output;
  }

  // Lightweight voice-activity gate. It rejects quiet noise and sustained
  // high-frequency chirps before Whisper sees a segment. This is a heuristic,
  // not studio-grade noise cancellation; clear speech still works best.
  function hasSpeechLikeActivity(samples, sampleRate) {
    const frameSize = Math.max(1, Math.floor(sampleRate * 0.02)); // 20 ms
    let activeFrames = 0, totalFrames = 0;
    for (let start = 0; start + frameSize <= samples.length; start += frameSize) {
      let energy = 0, crossings = 0, previous = samples[start];
      for (let i = 0; i < frameSize; i++) {
        const value = samples[start + i]; energy += value * value;
        if ((value >= 0 && previous < 0) || (value < 0 && previous >= 0)) crossings++;
        previous = value;
      }
      const rms = Math.sqrt(energy / frameSize);
      const zcr = crossings / frameSize;
      totalFrames++;
      if (rms > 0.010 && zcr > 0.008 && zcr < 0.24) activeFrames++;
    }
    const ratio = activeFrames / Math.max(1, totalFrames);
    return activeFrames >= 18 && ratio >= 0.055;
  }
  async function transcribeSamples(samples) {
    if (!samples.length || !active || paused || !audioContext) return;
    const audio = downsampleTo16k(samples, audioContext.sampleRate);
    if (!hasSpeechLikeActivity(audio, 16000)) return;
    try {
      els.preview.hidden = false; els.previewText.textContent = 'Recognizing desktop speech…';
      const options = { task: 'transcribe', language: els.mode.value === 'id' ? 'indonesian' : 'english' };
      const result = await transcriber(audio, options);
      const text = cleanText(result?.text || '');
      if (text && active && !paused) await commitPhrase(text, els.mode.value);
    } catch (error) {
      console.error('Desktop transcription error:', error); toast('Desktop audio transcription failed. Try restarting the session.');
    } finally {
      if (active && !paused) els.previewText.textContent = 'Listening for speech…';
    }
  }
  function takeQueuedSamples(count) {
    const output = new Float32Array(count); let written = 0;
    while (written < count && sampleQueue.length) {
      const first = sampleQueue[0], take = Math.min(first.length, count - written);
      output.set(first.subarray(0, take), written); written += take;
      if (take === first.length) sampleQueue.shift(); else sampleQueue[0] = first.subarray(take);
    }
    queuedSamples -= written; return written === count ? output : output.subarray(0, written);
  }
  async function processQueuedAudio() {
    const target = Math.floor((audioContext?.sampleRate || 48000) * 4);
    if (processing || !active || paused || queuedSamples < target) return;
    processing = true;
    try { await transcribeSamples(takeQueuedSamples(target)); }
    finally { processing = false; if (active && !paused && queuedSamples >= target) void processQueuedAudio(); }
  }
  function setupDesktopProcessor(stream) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    audioContext = new AudioCtx();
    const audioOnly = new MediaStream(stream.getAudioTracks());
    desktopSource = audioContext.createMediaStreamSource(audioOnly);
    processor = audioContext.createScriptProcessor(4096, 1, 1);
    silentGain = audioContext.createGain(); silentGain.gain.value = 0;
    processor.onaudioprocess = (event) => {
      if (!active || paused) return;
      const data = event.inputBuffer.getChannelData(0);
      sampleQueue.push(new Float32Array(data)); queuedSamples += data.length;
      void processQueuedAudio();
    };
    desktopSource.connect(processor); processor.connect(silentGain); silentGain.connect(audioContext.destination);
    if (audioContext.state === 'suspended') void audioContext.resume();
  }
  async function acquireAudio() {
    const source = els.source.value;
    // Start getDisplayMedia immediately from the button click; browsers require user activation.
    const displayRequest = (source === 'desktop' || source === 'both')
      ? navigator.mediaDevices.getDisplayMedia({ video: true, audio: true }) : null;
    if (displayRequest) {
      displayStream = await displayRequest;
      if (!displayStream.getAudioTracks().length) {
        displayStream.getTracks().forEach(track => track.stop()); displayStream = null;
        throw new Error('No desktop audio was shared. Select a tab/window/screen and enable “Share tab audio” or “Share system audio”.');
      }
      displayStream.getVideoTracks().forEach(track => { track.enabled = false; });
      displayStream.getAudioTracks().forEach(track => track.addEventListener('ended', () => { if (active) endSession(false); }));
    }
    if (source === 'microphone' || source === 'both') {
      if (!SpeechRecognition) throw new Error('Microphone speech recognition requires Google Chrome or Microsoft Edge.');
      micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    }
  }
  function stopAudio() {
    if (processor) { processor.onaudioprocess = null; try { processor.disconnect(); } catch (_) {} processor = null; }
    if (silentGain) { try { silentGain.disconnect(); } catch (_) {} silentGain = null; }
    if (desktopSource) { try { desktopSource.disconnect(); } catch (_) {} desktopSource = null; }
    [micStream, displayStream].forEach(stream => stream?.getTracks().forEach(track => track.stop()));
    micStream = null; displayStream = null;
    if (audioContext) { void audioContext.close().catch(() => {}); audioContext = null; }
    sampleQueue = []; queuedSamples = 0; processing = false;
  }

  async function beginSession() {
    const source = els.source.value;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || ((source === 'desktop' || source === 'both') && !navigator.mediaDevices?.getDisplayMedia)) {
      toast('This audio source requires HTTPS and a modern desktop browser such as Chrome or Edge.'); return;
    }
    try {
      sessionSource = source; els.mic.disabled = true;
      els.title.textContent = 'Requesting audio access…';
      await acquireAudio();
      active = true; paused = false; elapsedBeforePause = 0;
      if (source === 'desktop' || source === 'both') {
        await loadTranscriber();
        setupDesktopProcessor(displayStream);
      }
      if (source === 'microphone' || source === 'both') startMicrophoneRecognition();
      startClock();
      const sourceLabel = source === 'desktop' ? 'Desktop audio listening' : source === 'both' ? 'Microphone + desktop audio' : 'Microphone listening';
      setStatus(true, sourceLabel); els.mic.classList.add('listening'); els.mic.setAttribute('aria-label', 'Listening');
      els.title.textContent = 'Listening continuously';
      els.description.textContent = 'Choose Indonesian or English to match the spoken language.';
      els.label.textContent = 'Session is live'; els.pause.disabled = false; els.stop.disabled = false;
      els.pause.innerHTML = 'Ⅱ <span>Pause</span>'; els.preview.hidden = false; els.previewText.textContent = 'Listening for speech…';
      els.support.textContent = 'Microphone uses the browser speech engine. Desktop audio uses local Whisper with voice-activity filtering. First desktop use may download the model.';
    } catch (error) {
      active = false; stopMicrophoneRecognition(); stopAudio();
      els.title.textContent = 'Start listening'; els.description.textContent = 'Choose an audio source and try again.';
      toast(error.message || 'Could not start audio capture.');
    } finally { els.mic.disabled = false; }
  }
  function pauseSession() {
    if (!active || paused) return;
    elapsedBeforePause += Math.floor((Date.now() - sessionStarted) / 1000); paused = true; stopClock();
    stopMicrophoneRecognition();
    if (audioContext?.state === 'running') void audioContext.suspend();
    setStatus(false, 'Paused'); els.mic.classList.remove('listening');
    els.title.textContent = 'Conversation paused'; els.description.textContent = 'Resume when you are ready.';
    els.pause.innerHTML = '▶ <span>Resume</span>'; els.preview.hidden = true;
  }
  async function resumeSession() {
    if (!active || !paused) return;
    paused = false;
    try { if (audioContext?.state === 'suspended') await audioContext.resume(); }
    catch (_) { toast('Could not resume desktop audio. Please restart the session.'); paused = true; return; }
    if (sessionSource === 'microphone' || sessionSource === 'both') startMicrophoneRecognition();
    sessionStarted = Date.now(); startClock();
    const sourceLabel = sessionSource === 'desktop' ? 'Desktop audio listening' : sessionSource === 'both' ? 'Microphone + desktop audio' : 'Microphone listening';
    setStatus(true, sourceLabel); els.mic.classList.add('listening');
    els.title.textContent = 'Listening continuously'; els.description.textContent = 'Speech recognition is active.';
    els.pause.innerHTML = 'Ⅱ <span>Pause</span>'; els.preview.hidden = false; els.previewText.textContent = 'Listening for speech…';
  }
  function endSession(showToast = true) {
    if (!active) return;
    if (!paused) elapsedBeforePause += Math.floor((Date.now() - sessionStarted) / 1000);
    active = false; paused = false; stopMicrophoneRecognition(); stopAudio(); stopClock();
    setStatus(false, 'Audio off'); els.mic.classList.remove('listening');
    els.title.textContent = 'Start listening'; els.description.textContent = 'Choose microphone or desktop audio, then start.';
    els.label.textContent = 'Session ended'; els.pause.disabled = true; els.stop.disabled = true;
    els.pause.innerHTML = 'Ⅱ <span>Pause</span>'; els.preview.hidden = true;
    if (showToast) toast('Conversation ended. Your messages remain on screen.');
  }

  els.mic.addEventListener('click', () => { if (!active) void beginSession(); else if (paused) void resumeSession(); });
  els.pause.addEventListener('click', () => paused ? void resumeSession() : pauseSession());
  els.stop.addEventListener('click', () => endSession());
  els.clear.addEventListener('click', () => {
    els.messages.replaceChildren(); els.welcome.hidden = false; els.timer.textContent = '00:00';
    elapsedBeforePause = 0; if (active && !paused) sessionStarted = Date.now(); toast('Conversation cleared.');
  });
  els.mode.addEventListener('change', () => {
    if (active && !paused && (sessionSource === 'microphone' || sessionSource === 'both')) startMicrophoneRecognition();
    toast('Speech language preference updated.');
  });
  els.source.addEventListener('change', () => {
    if (active) { toast('End the current session before changing the audio source.'); els.source.value = sessionSource; }
  });
  async function toggleFullscreen() {
    const card = els.translatorCard;
    try { if (document.fullscreenElement === card) await document.exitFullscreen(); else if (card.requestFullscreen) await card.requestFullscreen(); else card.classList.toggle('fullscreen-fallback'); }
    catch (_) { card.classList.toggle('fullscreen-fallback'); toast('Using expanded conversation view.'); }
    updateFullscreenButton();
  }
  function updateFullscreenButton() {
    const expanded = document.fullscreenElement === els.translatorCard || els.translatorCard.classList.contains('fullscreen-fallback');
    els.maximize.textContent = expanded ? '⤢' : '⛶'; els.maximize.title = expanded ? 'Exit fullscreen' : 'Enter fullscreen';
    els.maximize.setAttribute('aria-label', expanded ? 'Exit fullscreen' : 'Enter fullscreen');
  }
  els.maximize.addEventListener('click', toggleFullscreen); document.addEventListener('fullscreenchange', updateFullscreenButton);
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && els.translatorCard.classList.contains('fullscreen-fallback')) { els.translatorCard.classList.remove('fullscreen-fallback'); updateFullscreenButton(); } });
  els.settingsBtn.addEventListener('click', () => els.settings.showModal());
  els.saveSettings.addEventListener('click', event => {
    event.preventDefault(); const value = els.email.value.trim();
    if (value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) { toast('Please enter a valid email address.'); return; }
    localStorage.setItem(CONTACT_KEY, value); els.settings.close(); toast('Settings saved.');
  });
  window.addEventListener('beforeunload', () => { active = false; stopMicrophoneRecognition(); stopAudio(); });

  if (!SpeechRecognition) {
    els.support.textContent = 'Microphone mode requires Chrome or Edge. Desktop audio mode uses local Whisper and can still work without browser SpeechRecognition.';
  }
})();
