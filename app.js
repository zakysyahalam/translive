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
  let autoCandidates = [];
  let autoFlushTimer = null;
  const interimByLanguage = new Map();
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
      ? [' saya ',' aku ',' kamu ',' anda ',' yang ',' dan ',' tidak ',' apa ',' ini ',' itu ',' dengan ',' untuk ',' kalau ',' sudah ',' bisa ',' ingin ',' dari ',' banget ',' bagaimana ',' karena ',' sedang ',' adalah ',' akan ',' belum ',' mereka ',' kita ',' tetapi ',' atau ',' dimana ',' kapan ',' siapa ',' mengapa ',' tolong ',' terima kasih ',' selamat ']
      : [' the ',' you ',' is ',' are ',' and ',' what ',' how ',' this ',' that ',' with ',' for ',' have ',' would ',' could ',' hello ',' please ',' thank ',' today ',' want ',' can ',' i ',' we ',' they ',' he ',' she ',' it ',' my ',' your ',' our ',' me ',' do ',' does ',' did ',' not ',' yes ',' no ',' good ',' morning ',' name ',' because ',' but ',' or ',' where ',' when ',' who ',' why ',' welcome ',' nice ',' meet ',' like ',' need ',' going ',' will ',' was ',' were '];
    return words.reduce((score, word) => score + (t.includes(word) ? 1 : 0), 0);
  }
  function detectFromText(text, recognizerLang, confidence = 0) {
    if (els.mode.value === 'id') return 'id';
    if (els.mode.value === 'en') return 'en';
    const idScore = languageScore(text, 'id');
    const enScore = languageScore(text, 'en');
    if (idScore > enScore) return 'id';
    if (enScore > idScore) return 'en';
    // With no clear lexical signal, use the recognizer that produced the
    // strongest result. This is a best-effort fallback, not true language ID.
    return recognizerLang.startsWith('id') ? 'id' : 'en';
  }

  function candidateQuality(candidate) {
    const idScore = languageScore(candidate.text, 'id');
    const enScore = languageScore(candidate.text, 'en');
    const lexicalSignal = Math.abs(idScore - enScore);
    const expectedLang = idScore > enScore ? 'id' : enScore > idScore ? 'en' : null;
    const recognizerLang = candidate.recognizerLang.startsWith('id') ? 'id' : 'en';
    const recognizerMatches = expectedLang && expectedLang === recognizerLang ? 0.3 : 0;
    return (candidate.confidence || 0) + lexicalSignal * 0.45 + recognizerMatches;
  }

  function queueAutoCandidate(text, recognizerLang, confidence) {
    autoCandidates.push({ text, recognizerLang, confidence });
    clearTimeout(autoFlushTimer);
    autoFlushTimer = setTimeout(() => {
      const candidates = autoCandidates.splice(0);
      if (!candidates.length || !active || paused || els.mode.value !== 'auto') return;
      // Collapse exact/near-identical alternatives emitted by both engines.
      const unique = [];
      for (const candidate of candidates) {
        const normalized = candidate.text.toLowerCase().replace(/[^a-z0-9à-ÿ]+/g, ' ').trim();
        const existing = unique.find(item => item.normalized === normalized);
        if (!existing) unique.push({ ...candidate, normalized });
        else if (candidateQuality(candidate) > candidateQuality(existing)) Object.assign(existing, candidate, { normalized });
      }
      unique.sort((a, b) => candidateQuality(b) - candidateQuality(a));
      const best = unique[0];
      const detected = detectFromText(best.text, best.recognizerLang, best.confidence);
      commitPhrase(best.text, detected);
      els.preview.hidden = true;
    }, 650);
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
        const confidence = result[0]?.confidence || 0;
        if (result.isFinal) {
          if (els.mode.value === 'auto') queueAutoCandidate(transcript, lang, confidence);
          else {
            commitPhrase(transcript, lang.startsWith('id') ? 'id' : 'en');
            els.preview.hidden = true;
          }
        } else interim += `${transcript} `;
      }
      if (interim.trim()) {
        interimByLanguage.set(lang, interim.trim());
        const previewText = els.mode.value === 'auto'
          ? [...interimByLanguage.values()].sort((a, b) => b.length - a.length)[0]
          : interim.trim();
        els.preview.hidden = false;
        els.previewText.textContent = previewText || 'Listening…';
      } else if (event.results.length) {
        interimByLanguage.delete(lang);
      }
    };
    rec.onerror = (event) => {
      if (['no-speech','aborted'].includes(event.error)) return;
      const message = event.error === 'not-allowed' ? 'Microphone permission was denied. Allow it in your browser settings.'
        : event.error === 'audio-capture' ? 'No microphone was detected.'
        : `Speech recognition (${lang}) error: ${event.error}`;
      // In Auto mode one engine can fail while the other remains usable.
      toast(message);
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') endSession(false);
    };
    rec.onend = () => {
      if (active && !paused) {
        setTimeout(() => { if (active && !paused && recognizers.includes(rec)) { try { rec.start(); } catch (_) {} } }, 300);
      }
    };
    return rec;
  }

  function startRecognition() {
    if (!SpeechRecognition) {
      toast('Speech recognition is not supported in this browser. Please use Google Chrome.');
      return false;
    }
    clearTimeout(autoFlushTimer);
    autoCandidates = [];
    interimByLanguage.clear();
    const mode = els.mode.value;
    const langs = mode === 'id' ? ['id-ID'] : mode === 'en' ? ['en-US'] : ['id-ID', 'en-US'];
    recognizers = langs.map(createRecognizer);
    let started = 0;
    // Start the two language candidates slightly apart to avoid racing the
    // browser's microphone initialization. Auto mode scores the finalized
    // alternatives and commits one candidate instead of duplicating both.
    recognizers.forEach((rec, index) => {
      const delay = mode === 'auto' ? index * 250 : 0;
      setTimeout(() => {
        if (!active || paused || !recognizers.includes(rec)) return;
        try { rec.start(); started++; }
        catch (error) {
          console.warn(`Could not start ${rec.lang} recognition:`, error);
          if (mode === 'auto' && started === 0 && index === langs.length - 1) {
            toast('Auto Detect could not start either language engine. Try a fixed speech mode.');
          }
        }
      }, delay);
    });
    return true;
  }
  function stopRecognizers() {
    clearTimeout(autoFlushTimer); autoCandidates = []; interimByLanguage.clear();
    recognizers.forEach((rec) => { try { rec.onend = null; rec.stop(); } catch (_) {} });
    recognizers = [];
  }
  async function beginSession() {
    if (!SpeechRecognition) {
      toast('Speech recognition is not supported here. Please use the latest Google Chrome or Microsoft Edge.');
      return;
    }
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      toast('Microphone access requires HTTPS (or localhost) and a browser with microphone support.');
      return;
    }

    // Request microphone permission explicitly from the user's Start click.
    // SpeechRecognition then manages the live recognition session itself.
    let permissionStream;
    try {
      els.title.textContent = 'Requesting microphone access…';
      els.description.textContent = 'Allow microphone access in your browser to begin.';
      permissionStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      els.title.textContent = 'Start listening';
      els.description.textContent = 'Allow microphone access, then try again.';
      const message = error.name === 'NotAllowedError'
        ? 'Microphone permission is blocked. Allow it in Chrome site settings and try again.'
        : error.name === 'NotFoundError'
          ? 'No microphone was found. Connect a microphone and try again.'
          : `Could not access microphone: ${error.message || error.name}`;
      toast(message);
      return;
    } finally {
      // Stop this temporary permission-check stream; SpeechRecognition opens
      // its own microphone capture after permission has been granted.
      if (permissionStream) permissionStream.getTracks().forEach(track => track.stop());
    }

    active = true; paused = false; elapsedBeforePause = 0;
    if (!startRecognition()) {
      active = false;
      els.title.textContent = 'Start listening';
      els.description.textContent = 'Microphone permission granted, but speech recognition could not start.';
      return;
    }
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
    if (!active) void beginSession();
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
