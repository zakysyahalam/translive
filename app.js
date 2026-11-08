(() => {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const $ = (id) => document.getElementById(id);
  const els = {
    mic: $('micButton'), pause: $('pauseBtn'), stop: $('stopBtn'), clear: $('clearBtn'),
    mode: $('speechMode'), chat: $('chatArea'), messages: $('messages'), welcome: $('welcomeState'),
    preview: $('listeningPreview'), previewText: $('previewText'), status: $('micStatus'),
    title: $('micTitle'), description: $('micDescription'), label: $('sessionLabel'),
    liveDot: $('liveDot'), timer: $('sessionTime'), toast: $('toast'), settings: $('settingsDialog'),
    settingsBtn: $('settingsBtn'), email: $('contactEmail'), saveSettings: $('saveSettings')
  };
  let recognizers = [], active = false, paused = false, sessionStarted = 0, timerId = null;
  let elapsedBeforePause = 0, lastToast = 0, lastFinal = '', lastFinalAt = 0, pendingTranslation = 0;
  let interimNodes = new Map();
  const CONTACT_KEY = 'lingua-contact-email';
  els.email.value = localStorage.getItem(CONTACT_KEY) || '';

  function toast(message) {
    els.toast.textContent = message;
    els.toast.classList.add('show');
    clearTimeout(lastToast);
    lastToast = setTimeout(() => els.toast.classList.remove('show'), 3200);
  }
  function setStatus(on, text) {
    els.status.classList.toggle('on', on);
    els.status.lastChild.textContent = text;
    els.liveDot.classList.toggle('active', on);
  }
  function timeString(seconds) {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = Math.floor(seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }
  function startClock() {
    clearInterval(timerId);
    sessionStarted = Date.now();
    timerId = setInterval(() => {
      const total = elapsedBeforePause + (paused ? 0 : Math.floor((Date.now() - sessionStarted) / 1000));
      els.timer.textContent = timeString(total);
    }, 500);
  }
  function stopClock() {
    clearInterval(timerId); timerId = null;
    const total = elapsedBeforePause + (paused ? 0 : Math.floor((Date.now() - sessionStarted) / 1000));
    els.timer.textContent = timeString(total);
  }
  function scrollBottom() { requestAnimationFrame(() => { els.chat.scrollTop = els.chat.scrollHeight; }); }
  function nowTime() { return new Intl.DateTimeFormat(undefined, {hour:'2-digit', minute:'2-digit'}).format(new Date()); }
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
    return { pair, idText, enText, idBubble, enBubble, sourceText, sourceLang };
  }

  async function translateText(text, sourceLang) {
    const target = sourceLang === 'id' ? 'en' : 'id';
    const params = new URLSearchParams({ q: text, langpair: `${sourceLang}|${target}` });
    const email = els.email.value.trim();
    if (email) params.set('de', email);
    const response = await fetch(`https://api.mymemory.translated.net/get?${params.toString()}`, { headers: {Accept:'application/json'} });
    if (!response.ok) throw new Error(`Translation service returned ${response.status}`);
    const data = await response.json();
    if (data.responseStatus !== 200 || !data.responseData?.translatedText) {
      throw new Error(data.responseDetails || 'Translation is temporarily unavailable.');
    }
    return data.responseData.translatedText;
  }

  async function commitPhrase(text, lang) {
    text = cleanText(text);
    if (!text || text.length < 2) return;
    const stamp = Date.now();
    if (text.toLowerCase() === lastFinal.toLowerCase() && stamp - lastFinalAt < 1800) return;
    lastFinal = text; lastFinalAt = stamp;
    const message = makePair(text, lang, true);
    try {
      const translated = await translateText(text, lang);
      if (lang === 'id') message.enText.textContent = translated;
      else message.idText.textContent = translated;
      message.idBubble.classList.remove('pending'); message.enBubble.classList.remove('pending');
    } catch (error) {
      const target = lang === 'id' ? message.enText : message.idText;
      target.textContent = 'Translation unavailable. Check your connection or try again.';
      message.idBubble.classList.remove('pending'); message.enBubble.classList.remove('pending');
      toast(error.message.includes('429') ? 'Free translation limit reached. Try again later.' : 'Could not reach the free translation service.');
    }
    scrollBottom();
  }

  function languageScore(text, lang) {
    const t = ` ${text.toLowerCase().replace(/[^a-zà-ÿ\s]/g, ' ')} `;
    const words = lang === 'id'
      ? [' saya ',' kamu ',' yang ',' dan ',' tidak ',' apa ',' ini ',' itu ',' dengan ',' untuk ',' kalau ',' sudah ',' bisa ',' ingin ',' dari ',' banget ',' bagaimana ',' karena ',' sedang ']
      : [' the ',' you ',' is ',' are ',' and ',' what ',' how ',' this ',' that ',' with ',' for ',' have ',' would ',' could ',' hello ',' please ',' thank ',' today ',' want ',' can '];
    return words.reduce((score, word) => score + (t.includes(word) ? 1 : 0), 0);
  }
  function detectFromText(text, recognizerLang, confidence) {
    if (els.mode.value === 'id') return 'id';
    if (els.mode.value === 'en') return 'en';
    const idScore = languageScore(text, 'id'), enScore = languageScore(text, 'en');
    if (idScore > enScore) return 'id';
    if (enScore > idScore) return 'en';
    // In auto mode, the recognizer language is used as a fallback hint.
    return recognizerLang.startsWith('id') ? 'id' : 'en';
  }

  function createRecognizer(lang) {
    const rec = new SpeechRecognition();
    rec.lang = lang; rec.continuous = true; rec.interimResults = true; rec.maxAlternatives = 3;
    rec.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = cleanText(result[0]?.transcript || '');
        if (!transcript) continue;
        if (result.isFinal) {
          const detected = detectFromText(transcript, lang, result[0]?.confidence || 0);
          commitPhrase(transcript, detected);
          els.preview.hidden = true;
        } else interim += `${transcript} `;
      }
      if (interim.trim()) {
        els.preview.hidden = false;
        els.previewText.textContent = interim.trim();
        scrollBottom();
      }
    };
    rec.onerror = (event) => {
      if (['no-speech','aborted'].includes(event.error)) return;
      const message = event.error === 'not-allowed' ? 'Microphone permission was denied. Allow it in your browser settings.'
        : event.error === 'audio-capture' ? 'No microphone was detected.'
        : `Speech recognition error: ${event.error}`;
      toast(message);
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') endSession(false);
    };
    rec.onend = () => {
      if (active && !paused) {
        // Chrome may end recognition after silence; restart it while the session is active.
        setTimeout(() => { if (active && !paused) { try { rec.start(); } catch (_) {} } }, 250);
      }
    };
    return rec;
  }

  function startRecognition() {
    if (!SpeechRecognition) {
      toast('Speech recognition is not supported in this browser. Please use Google Chrome.');
      return false;
    }
    const mode = els.mode.value;
    const langs = mode === 'id' ? ['id-ID'] : mode === 'en' ? ['en-US'] : ['id-ID','en-US'];
    recognizers = langs.map(createRecognizer);
    let started = 0;
    recognizers.forEach((rec) => { try { rec.start(); started++; } catch (e) { console.warn('Could not start recognition:', e); } });
    if (!started) { toast('Could not start speech recognition. Reload the page and try again.'); return false; }
    if (mode === 'auto' && started === 1) toast('Only one speech engine started. Auto detection may be less accurate.');
    return true;
  }
  function stopRecognizers() {
    recognizers.forEach((rec) => { try { rec.onend = null; rec.stop(); } catch (_) {} });
    recognizers = [];
  }
  function beginSession() {
    if (!SpeechRecognition) { toast('Please open this website in Google Chrome or Microsoft Edge.'); return; }
    active = true; paused = false; elapsedBeforePause = 0;
    if (!startRecognition()) { active = false; return; }
    startClock(); setStatus(true, 'Microphone listening');
    els.mic.classList.add('listening'); els.mic.setAttribute('aria-label','Microphone listening');
    els.title.textContent = 'Listening continuously'; els.description.textContent = 'Speak naturally. Your words will appear below.';
    els.label.textContent = 'Session is live'; els.pause.disabled = false; els.stop.disabled = false;
    els.pause.innerHTML = 'Ⅱ <span>Pause</span>'; els.preview.hidden = false; els.previewText.textContent = 'Listening for speech…';
  }
  function pauseSession() {
    if (!active || paused) return;
    elapsedBeforePause += Math.floor((Date.now() - sessionStarted) / 1000);
    paused = true; stopRecognizers(); stopClock();
    setStatus(false, 'Paused'); els.mic.classList.remove('listening');
    els.title.textContent = 'Conversation paused'; els.description.textContent = 'Resume when you are ready to continue.';
    els.pause.innerHTML = '▶ <span>Resume</span>'; els.preview.hidden = true;
  }
  function resumeSession() {
    if (!active || !paused) return;
    paused = false;
    if (!startRecognition()) { paused = true; return; }
    sessionStarted = Date.now(); startClock(); setStatus(true, 'Microphone listening');
    els.mic.classList.add('listening'); els.title.textContent = 'Listening continuously';
    els.description.textContent = 'Speak naturally. Your words will appear below.';
    els.pause.innerHTML = 'Ⅱ <span>Pause</span>'; els.preview.hidden = false;
  }
  function endSession(showToast = true) {
    if (!active) return;
    if (!paused) elapsedBeforePause += Math.floor((Date.now() - sessionStarted) / 1000);
    active = false; paused = false; stopRecognizers(); stopClock();
    setStatus(false, 'Microphone off'); els.mic.classList.remove('listening');
    els.title.textContent = 'Start listening'; els.description.textContent = 'Your browser will ask for microphone permission.';
    els.label.textContent = 'Session ended'; els.pause.disabled = true; els.stop.disabled = true;
    els.pause.innerHTML = 'Ⅱ <span>Pause</span>'; els.preview.hidden = true;
    if (showToast) toast('Conversation ended. Your messages remain on screen.');
  }

  els.mic.addEventListener('click', () => {
    if (!active) beginSession();
    else if (paused) resumeSession();
  });
  els.pause.addEventListener('click', () => paused ? resumeSession() : pauseSession());
  els.stop.addEventListener('click', () => endSession());
  els.clear.addEventListener('click', () => {
    els.messages.replaceChildren(); els.welcome.hidden = false; els.timer.textContent = '00:00';
    elapsedBeforePause = 0; if (active && !paused) { sessionStarted = Date.now(); }
    toast('Conversation cleared.');
  });
  els.mode.addEventListener('change', () => {
    if (active) {
      const wasPaused = paused;
      stopRecognizers();
      if (!wasPaused) startRecognition();
      toast('Speech mode updated.');
    }
  });
  els.settingsBtn.addEventListener('click', () => els.settings.showModal());
  els.saveSettings.addEventListener('click', (event) => {
    event.preventDefault();
    const value = els.email.value.trim();
    if (value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) { toast('Please enter a valid email address.'); return; }
    localStorage.setItem(CONTACT_KEY, value); els.settings.close(); toast('Settings saved.');
  });
  window.addEventListener('beforeunload', () => { active = false; stopRecognizers(); });

  if (!SpeechRecognition) {
    els.supportNote.textContent = 'Speech recognition is not available in this browser. Open this site in Google Chrome or Microsoft Edge.';
    els.mic.disabled = true; els.mic.style.opacity = '.45';
  }
})();
