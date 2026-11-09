import { pipeline, env } from '@huggingface/transformers';

(() => {
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
  let active = false, paused = false, sessionStarted = 0, timerId = null;
  let elapsedBeforePause = 0, toastTimer = null, lastFinal = '', lastFinalAt = 0;
  let transcriber = null, modelPromise = null, audioContext = null, displayStream = null, micStream = null;
  let processor = null, silentGain = null, audioSources = [], sampleQueue = [], queuedSamples = 0;
  let processing = false, processTimer = null, sessionSource = 'microphone';
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
  function languageScore(text, lang) {
    const t = ` ${text.toLowerCase().replace(/[^a-zà-ÿ\s]/g, ' ')} `;
    const words = lang === 'id'
      ? [' saya ',' aku ',' kamu ',' anda ',' yang ',' dan ',' tidak ',' apa ',' ini ',' itu ',' dengan ',' untuk ',' kalau ',' sudah ',' bisa ',' ingin ',' dari ',' banget ',' bagaimana ',' karena ',' sedang ',' adalah ',' akan ',' belum ',' mereka ',' kita ',' tetapi ',' atau ',' dimana ',' kapan ',' siapa ',' mengapa ',' tolong ',' terima kasih ',' selamat ',' nggak ',' enggak ',' punya ',' jadi ',' pada ',' dalam ',' lebih ',' juga ',' cuma ',' masih ',' sudah ',' belum ',' tadi ',' nanti ',' sekarang ']
      : [' the ',' you ',' is ',' are ',' and ',' what ',' how ',' this ',' that ',' with ',' for ',' have ',' would ',' could ',' hello ',' please ',' thank ',' today ',' want ',' can ',' i ',' we ',' they ',' he ',' she ',' it ',' my ',' your ',' our ',' me ',' do ',' does ',' did ',' not ',' yes ',' no ',' good ',' morning ',' name ',' because ',' but ',' or ',' where ',' when ',' who ',' why ',' welcome ',' nice ',' meet ',' like ',' need ',' going ',' will ',' was ',' were ',' have ',' has ',' had ',' there ',' here ',' from ',' about ',' just ',' really ',' right ',' okay ',' sure '];
    return words.reduce((score, word) => score + (t.includes(word) ? 1 : 0), 0);
  }
  function detectLanguage(text) {
    if (els.mode.value === 'id') return 'id';
    if (els.mode.value === 'en') return 'en';
    const id = languageScore(text, 'id'), en = languageScore(text, 'en');
    if (id > en) return 'id'; if (en > id) return 'en';
    // Indonesian and English share many short words; use Indonesian-specific morphology as a tie-breaker.
    if (/\b(ber\w+|me\w+|meng\w+|men\w+|ter\w+|di\w+|ke\w+|nya|kan|lah)\b/i.test(text)) return 'id';
    return 'en';
  }
  async function commitPhrase(rawText) {
    const text = cleanText(rawText);
    if (text.length < 3 || !/[a-zà-ÿ]{2}/i.test(text)) return;
    const stamp = Date.now();
    if (text.toLowerCase() === lastFinal.toLowerCase() && stamp - lastFinalAt < 2500) return;
    lastFinal = text; lastFinalAt = stamp;
    const lang = detectLanguage(text); const message = makePair(text, lang, true);
    try {
      const translated = await translateText(text, lang);
      if (lang === 'id') message.enText.textContent = translated; else message.idText.textContent = translated;
    } catch (error) {
      const target = lang === 'id' ? message.enText : message.idText;
      target.textContent = 'Translation unavailable. Check your connection or try again.';
      toast(error.message.includes('429') ? 'Free translation limit reached. Try again later.' : 'Could not reach the free translation service.');
    }
    message.idBubble.classList.remove('pending'); message.enBubble.classList.remove('pending'); scrollBottom();
  }

  async function loadTranscriber() {
    if (transcriber) return transcriber;
    if (modelPromise) return modelPromise;
    modelPromise = (async () => {
      els.title.textContent = 'Loading speech model…';
      els.description.textContent = 'First use downloads a multilingual model (tens of MB). Your browser caches it for next time.';
      els.preview.hidden = false; els.previewText.textContent = 'Preparing on-device speech recognition…';
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
        throw new Error(`Could not load the speech model: ${error.message || error}`);
      }
    })();
    return modelPromise;
  }
  function downsampleTo16k(samples, inputRate) {
    if (inputRate === 16000) return Float32Array.from(samples);
    const ratio = inputRate / 16000; const outputLength = Math.floor(samples.length / ratio);
    const output = new Float32Array(outputLength);
    for (let i = 0; i < outputLength; i++) {
      const position = i * ratio; const left = Math.floor(position); const right = Math.min(left + 1, samples.length - 1);
      const weight = position - left; output[i] = samples[left] * (1 - weight) + samples[right] * weight;
    }
    return output;
  }
  async function transcribeSamples(samples) {
    if (!samples.length || !active || paused) return;
    const audio = downsampleTo16k(samples, audioContext.sampleRate);
    let energy = 0; for (let i = 0; i < audio.length; i += 20) energy += audio[i] * audio[i];
    if (Math.sqrt(energy / Math.max(1, Math.ceil(audio.length / 20))) < 0.008) return;
    try {
      els.preview.hidden = false; els.previewText.textContent = 'Recognizing speech…';
      const options = { task: 'transcribe' };
      if (els.mode.value === 'id') options.language = 'indonesian';
      if (els.mode.value === 'en') options.language = 'english';
      const result = await transcriber(audio, options);
      const text = cleanText(result?.text || '');
      if (text && active && !paused) await commitPhrase(text);
    } catch (error) {
      console.error('Transcription error:', error); toast('Audio transcription failed. Try restarting the session.');
    } finally {
      if (active && !paused) els.previewText.textContent = 'Listening to audio…';
    }
  }
  function takeQueuedSamples(count) {
    const output = new Float32Array(count); let written = 0;
    while (written < count && sampleQueue.length) {
      const first = sampleQueue[0]; const take = Math.min(first.length, count - written);
      output.set(first.subarray(0, take), written); written += take;
      if (take === first.length) sampleQueue.shift(); else sampleQueue[0] = first.subarray(take);
    }
    queuedSamples -= written; return written === count ? output : output.subarray(0, written);
  }
  async function processQueuedAudio() {
    const target = Math.floor((audioContext?.sampleRate || 48000) * 6);
    if (processing || !active || paused || queuedSamples < target) return;
    processing = true;
    try { await transcribeSamples(takeQueuedSamples(target)); }
    finally { processing = false; if (active && !paused && queuedSamples >= target) void processQueuedAudio(); }
  }
  function setupAudioProcessor(streams) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    audioContext = new AudioCtx();
    const mixed = audioContext.createMediaStreamDestination();
    streams.forEach(stream => {
      const audioOnly = new MediaStream(stream.getAudioTracks());
      if (audioOnly.getAudioTracks().length) {
        const source = audioContext.createMediaStreamSource(audioOnly); source.connect(mixed); audioSources.push(source);
      }
    });
    const mixedSource = audioContext.createMediaStreamSource(mixed.stream);
    processor = audioContext.createScriptProcessor(4096, 1, 1);
    silentGain = audioContext.createGain(); silentGain.gain.value = 0;
    processor.onaudioprocess = (event) => {
      if (!active || paused) return;
      const data = event.inputBuffer.getChannelData(0);
      sampleQueue.push(new Float32Array(data)); queuedSamples += data.length;
      void processQueuedAudio();
    };
    mixedSource.connect(processor); processor.connect(silentGain); silentGain.connect(audioContext.destination);
    if (audioContext.state === 'suspended') void audioContext.resume();
  }
  async function acquireAudio() {
    const source = els.source.value;
    const streams = [];
    // Invoke the screen/tab picker directly from the Start click, before any await,
    // because browsers require transient user activation for getDisplayMedia().
    const displayRequest = (source === 'desktop' || source === 'both')
      ? navigator.mediaDevices.getDisplayMedia({ video: true, audio: true }) : null;
    if (displayRequest) {
      displayStream = await displayRequest;
      const tracks = displayStream.getAudioTracks();
      if (!tracks.length) {
        displayStream.getTracks().forEach(track => track.stop()); displayStream = null;
        throw new Error('No desktop audio was shared. In the share dialog, choose a tab/window/screen and enable “Share tab audio” or “Share system audio”.');
      }
      displayStream.getVideoTracks().forEach(track => { track.enabled = false; });
      displayStream.getAudioTracks().forEach(track => track.addEventListener('ended', () => { if (active) endSession(false); }));
      streams.push(displayStream);
    }
    if (source === 'microphone' || source === 'both') {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      streams.push(micStream);
    }
    return streams;
  }
  function stopAudio() {
    clearInterval(processTimer); processTimer = null;
    if (processor) { processor.onaudioprocess = null; try { processor.disconnect(); } catch (_) {} processor = null; }
    if (silentGain) { try { silentGain.disconnect(); } catch (_) {} silentGain = null; }
    audioSources.forEach(source => { try { source.disconnect(); } catch (_) {} }); audioSources = [];
    [micStream, displayStream].forEach(stream => stream?.getTracks().forEach(track => track.stop()));
    micStream = null; displayStream = null;
    if (audioContext) { void audioContext.close().catch(() => {}); audioContext = null; }
    sampleQueue = []; queuedSamples = 0;
  }
  async function beginSession() {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || ((els.source.value === 'desktop' || els.source.value === 'both') && !navigator.mediaDevices?.getDisplayMedia)) {
      toast('This audio source requires HTTPS and a modern desktop browser such as Chrome or Edge.'); return;
    }
    try {
      sessionSource = els.source.value; els.mic.disabled = true;
      els.title.textContent = 'Requesting audio access…';
      const streams = await acquireAudio();
      active = true; paused = false; elapsedBeforePause = 0;
      await loadTranscriber();
      setupAudioProcessor(streams);
      startClock();
      const sourceLabel = els.source.value === 'desktop' ? 'Desktop audio listening' : els.source.value === 'both' ? 'Microphone + desktop audio' : 'Microphone listening';
      setStatus(true, sourceLabel); els.mic.classList.add('listening'); els.mic.setAttribute('aria-label', 'Listening');
      els.title.textContent = 'Listening continuously';
      els.description.textContent = 'Speech is transcribed on this device. Speak Indonesian or English.';
      els.label.textContent = 'Session is live'; els.pause.disabled = false; els.stop.disabled = false;
      els.pause.innerHTML = 'Ⅱ <span>Pause</span>'; els.preview.hidden = false; els.previewText.textContent = 'Listening to audio…';
      els.support.textContent = 'Audio is processed locally in your browser. Keep this tab open; first model download may take a few minutes.';
    } catch (error) {
      active = false; stopAudio();
      els.title.textContent = 'Start listening';
      els.description.textContent = 'Choose an audio source and try again.';
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
    catch (_) { toast('Could not resume audio. Please restart the session.'); paused = true; return; }
    sessionStarted = Date.now(); startClock();
    const sourceLabel = els.source.value === 'desktop' ? 'Desktop audio listening' : els.source.value === 'both' ? 'Microphone + desktop audio' : 'Microphone listening';
    setStatus(true, sourceLabel); els.mic.classList.add('listening');
    els.title.textContent = 'Listening continuously'; els.description.textContent = 'Speech is transcribed on this device.';
    els.pause.innerHTML = 'Ⅱ <span>Pause</span>'; els.preview.hidden = false; els.previewText.textContent = 'Listening to audio…';
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
  els.mode.addEventListener('change', () => toast('Speech language preference updated.'));
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
  window.addEventListener('beforeunload', () => { active = false; stopAudio(); });
})();
