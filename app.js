import { pipeline, env } from '@huggingface/transformers';

(() => {
  const $ = (id) => document.getElementById(id);
  const els = {
    mic: $('micButton'), pause: $('pauseBtn'), stop: $('stopBtn'), clear: $('clearBtn'),
    mode: $('speechMode'), source: $('audioSource'), chat: $('chatArea'), messages: $('messages'), welcome: $('welcomeState'),
    preview: $('listeningPreview'), previewText: $('previewText'), status: $('micStatus'),
    title: $('micTitle'), description: $('micDescription'), label: $('sessionLabel'),
    liveDot: $('liveDot'), timer: $('sessionTime'), toast: $('toast'), settings: $('settingsDialog'),
    settingsBtn: $('settingsBtn'),
    translatorCard: $('translatorCard'), maximize: $('maximizeBtn'), support: $('supportNote')
  };

  let active = false, paused = false, sessionStarted = 0, timerId = null, elapsedBeforePause = 0;
  let toastTimer = null, lastFinal = '', lastFinalAt = 0;
  let transcriber = null, modelPromise = null, audioContext = null, displayStream = null, micStream = null;
  let audioPipelines = [], inferenceQueue = [], inferenceRunning = false, sessionSource = 'microphone';
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

  // All speech recognition runs locally through Whisper Tiny in the browser.
  // No browser-hosted SpeechRecognition service is used for microphone audio.
  async function loadTranscriber() {
    if (transcriber) return transcriber;
    if (modelPromise) return modelPromise;
    modelPromise = (async () => {
      els.title.textContent = 'Loading local speech model…';
      els.description.textContent = 'First use downloads Whisper Tiny for local microphone and desktop transcription; the browser may cache it for next time.';
      els.preview.hidden = false; els.previewText.textContent = 'Preparing local speech recognition…';
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
  async function transcribeSamples(samples, sourceLabel) {
    if (!samples.length || !active || paused || !audioContext || !transcriber) return;
    const audio = downsampleTo16k(samples, audioContext.sampleRate);
    if (!hasSpeechLikeActivity(audio, 16000)) return;
    try {
      els.preview.hidden = false;
      els.previewText.textContent = `Recognizing ${sourceLabel} speech locally…`;
      const options = { task: 'transcribe', language: els.mode.value === 'id' ? 'indonesian' : 'english' };
      const result = await transcriber(audio, options);
      const text = cleanText(result?.text || '');
      if (text && active && !paused) await commitPhrase(text, els.mode.value);
    } catch (error) {
      console.error(`${sourceLabel} transcription error:`, error);
      toast(`${sourceLabel} speech transcription failed. Try restarting the session.`);
    }
  }
  function takeQueuedSamples(pipeline, count) {
    const output = new Float32Array(count); let written = 0;
    while (written < count && pipeline.queue.length) {
      const first = pipeline.queue[0], take = Math.min(first.length, count - written);
      output.set(first.subarray(0, take), written); written += take;
      if (take === first.length) pipeline.queue.shift(); else pipeline.queue[0] = first.subarray(take);
    }
    pipeline.queuedSamples -= written;
    return written === count ? output : output.subarray(0, written);
  }
  function drainInferenceQueue() {
    if (inferenceRunning || !active || paused) return;
    inferenceRunning = true;
    (async () => {
      try {
        while (inferenceQueue.length && active && !paused) {
          const item = inferenceQueue.shift();
          await transcribeSamples(item.samples, item.label);
          item.pipeline.processing = false;
          schedulePipelineChunk(item.pipeline);
        }
      } finally {
        inferenceRunning = false;
        if (inferenceQueue.length && active && !paused) drainInferenceQueue();
      }
    })();
  }
  function schedulePipelineChunk(pipeline) {
    const target = Math.floor((audioContext?.sampleRate || 48000) * 4);
    if (!active || paused || pipeline.processing || pipeline.queuedSamples < target) return;
    pipeline.processing = true;
    inferenceQueue.push({ pipeline, samples: takeQueuedSamples(pipeline, target), label: pipeline.label });
    drainInferenceQueue();
  }
  function createAudioPipeline(stream, label) {
    const audioOnly = new MediaStream(stream.getAudioTracks());
    const source = audioContext.createMediaStreamSource(audioOnly);
    const processor = audioContext.createScriptProcessor(4096, 1, 1);
    const silentGain = audioContext.createGain(); silentGain.gain.value = 0;
    const pipeline = { source, processor, silentGain, queue: [], queuedSamples: 0, processing: false, label };
    processor.onaudioprocess = (event) => {
      if (!active || paused) return;
      const data = event.inputBuffer.getChannelData(0);
      pipeline.queue.push(new Float32Array(data)); pipeline.queuedSamples += data.length;
      // Bound memory if inference falls behind real-time audio.
      const maxQueued = Math.floor(audioContext.sampleRate * 12);
      while (pipeline.queuedSamples > maxQueued && pipeline.queue.length) {
        const excess = pipeline.queuedSamples - maxQueued;
        const first = pipeline.queue[0];
        if (first.length <= excess) { pipeline.queue.shift(); pipeline.queuedSamples -= first.length; }
        else { pipeline.queue[0] = first.subarray(excess); pipeline.queuedSamples -= excess; }
      }
      schedulePipelineChunk(pipeline);
    };
    source.connect(processor); processor.connect(silentGain); silentGain.connect(audioContext.destination);
    audioPipelines.push(pipeline);
  }
  function setupAudioProcessing() {
    if (!audioContext) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      audioContext = new AudioCtx();
    }
    audioPipelines = []; inferenceQueue = []; inferenceRunning = false;
    if (displayStream?.getAudioTracks().length) createAudioPipeline(displayStream, 'desktop');
    if (micStream?.getAudioTracks().length) createAudioPipeline(micStream, 'microphone');
    if (audioContext.state === 'suspended') void audioContext.resume();
  }
  async function acquireAudio() {
    const source = els.source.value;
    // getDisplayMedia must be invoked directly from the user's Start click.
    const displayRequest = (source === 'desktop' || source === 'both')
      ? navigator.mediaDevices.getDisplayMedia({ video: true, audio: true }) : null;
    if (displayRequest) {
      displayStream = await displayRequest;
      const audioTracks = displayStream.getAudioTracks();
      if (!audioTracks.length) {
        displayStream.getTracks().forEach(track => track.stop()); displayStream = null;
        throw new Error('No desktop audio was shared. Select a tab/window/screen and enable “Share tab audio” or “Share system audio”.');
      }
      // The browser API requires a video track for display capture, but Translive
      // never reads it. Stop it immediately and retain only the audio track.
      displayStream.getVideoTracks().forEach(track => {
        track.onended = null;
        track.stop();
      });
      audioTracks.forEach(track => track.addEventListener('ended', () => { if (active) endSession(false); }, { once: true }));
    }
    if (source === 'microphone' || source === 'both') {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
    }
  }
  function stopAudio() {
    audioPipelines.forEach(pipeline => {
      if (pipeline.processor) { pipeline.processor.onaudioprocess = null; try { pipeline.processor.disconnect(); } catch (_) {} }
      try { pipeline.source.disconnect(); } catch (_) {}
      try { pipeline.silentGain.disconnect(); } catch (_) {}
    });
    audioPipelines = []; inferenceQueue = []; inferenceRunning = false;
    [micStream, displayStream].forEach(stream => stream?.getTracks().forEach(track => track.stop()));
    micStream = null; displayStream = null;
    if (audioContext) { void audioContext.close().catch(() => {}); audioContext = null; }
  }

  async function beginSession() {
    const source = els.source.value;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || ((source === 'desktop' || source === 'both') && !navigator.mediaDevices?.getDisplayMedia)) {
      toast('This audio source requires HTTPS and a modern desktop browser such as Chrome or Edge.'); return;
    }
    try {
      sessionSource = source; els.mic.disabled = true;
      // Create/resume the audio context directly from the Start click so browser
      // autoplay policies are less likely to suspend local audio processing.
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      audioContext = new AudioCtx();
      void audioContext.resume().catch(() => {});
      els.title.textContent = 'Requesting audio access…';
      await acquireAudio();
      els.title.textContent = 'Preparing local speech model…';
      await loadTranscriber();
      active = true; paused = false; elapsedBeforePause = 0;
      setupAudioProcessing();
      startClock();
      const sourceLabel = source === 'desktop' ? 'Desktop audio listening' : source === 'both' ? 'Microphone + desktop audio' : 'Microphone listening';
      setStatus(true, sourceLabel); els.mic.classList.add('listening'); els.mic.setAttribute('aria-label', 'Listening');
      els.title.textContent = 'Listening continuously';
      els.description.textContent = 'Choose Indonesian or English to match the spoken language.';
      els.label.textContent = 'Session is live'; els.pause.disabled = false; els.stop.disabled = false;
      els.pause.innerHTML = 'Ⅱ <span>Pause</span>'; els.preview.hidden = false; els.previewText.textContent = 'Listening for speech…';
      els.support.textContent = 'Microphone and desktop audio are transcribed locally with Whisper. Translated text is sent to MyMemory; raw audio is not uploaded by Translive.';
    } catch (error) {
      active = false; stopAudio();
      els.title.textContent = 'Start listening'; els.description.textContent = 'Choose an audio source and try again.';
      toast(error.message || 'Could not start audio capture.');
    } finally { els.mic.disabled = false; }
  }
  function pauseSession() {
    if (!active || paused) return;
    elapsedBeforePause += Math.floor((Date.now() - sessionStarted) / 1000); paused = true; stopClock();
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
    drainInferenceQueue();
    audioPipelines.forEach(schedulePipelineChunk);
    sessionStarted = Date.now(); startClock();
    const sourceLabel = sessionSource === 'desktop' ? 'Desktop audio listening' : sessionSource === 'both' ? 'Microphone + desktop audio' : 'Microphone listening';
    setStatus(true, sourceLabel); els.mic.classList.add('listening');
    els.title.textContent = 'Listening continuously'; els.description.textContent = 'Local speech recognition is active.';
    els.pause.innerHTML = 'Ⅱ <span>Pause</span>'; els.preview.hidden = false; els.previewText.textContent = 'Listening for speech…';
  }
  function endSession(showToast = true) {
    if (!active) return;
    if (!paused) elapsedBeforePause += Math.floor((Date.now() - sessionStarted) / 1000);
    active = false; paused = false; stopAudio(); stopClock();
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
    toast('Speech language preference updated. New audio segments will use this language.');
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
  window.addEventListener('beforeunload', () => { active = false; stopAudio(); });
})();
