# Translive v1.6

Live Indonesian ↔ English conversation translator with:

- Multilingual Whisper speech recognition running in the browser (Auto Detect; no browser SpeechRecognition API).
- Microphone, desktop/tab audio, or both audio sources.
- Local audio transcription after the first model download; the model is cached by the browser.
- MyMemory free translation API for the translated side of each message.
- Fullscreen conversation workspace.

## Run locally

```bash
npm install
npm run dev
```

Open the HTTPS deployment or the local Vite address in a modern desktop browser. Vite's localhost development server is treated as a secure context by browsers.

## Deploy to Vercel

- Framework preset: Vite
- Build command: `npm run build`
- Output directory: `dist`
- No API key or environment variable is required.

## Desktop audio instructions

1. Choose **Desktop audio** (or **Both sources** to capture the microphone too).
2. Click the microphone/start button.
3. In the browser sharing dialog, select the browser tab, window, or entire screen that contains the sound.
4. Turn on **Share tab audio** or **Share system audio** when the browser offers that option, then click Share.
5. Play the video, meeting, or other audio. Keep this Translive tab open.

Desktop/system audio capture is controlled by the browser and operating system. Chrome/Edge on desktop are recommended. Capturing a browser tab's audio is generally the most reliable. Capturing sound from separate desktop applications (such as the Teams or Zoom desktop apps) depends on whether the browser/OS exposes system audio in the screen-sharing picker. If no audio track is offered, share the meeting/browser tab instead, or use the microphone option with speakers/headphones arranged to avoid echo.

## First run and performance

The first start downloads a multilingual Whisper Tiny model from Hugging Face. This can take a while depending on the connection; the browser caches model files for later sessions. Speech is processed in short audio segments, so this is near-live rather than zero-latency streaming. A device with a supported GPU/WebGPU can be faster; otherwise the app falls back to CPU/WASM and may be slower. Keep the browser tab open while listening.

Speech transcription runs locally in the browser. Text is sent to MyMemory's public translation service to obtain the Indonesian/English translation; that service may impose rate limits or temporary availability limits.

## Notes

- Use the **Auto Detect** language setting for mixed Indonesian/English conversations. Fixed language settings are available if the source language is known.
- Use HTTPS in production. Browser screen/tab sharing requires an explicit user action and cannot start silently.
- The app cannot capture protected/DRM audio or system audio when the browser/OS does not expose it to screen sharing.


## Auto Detect language scope (v1.7)

Auto Detect is intentionally limited to Indonesian and English. The multilingual Whisper model may produce text in other languages, but the app validates each transcript against Indonesian/English vocabulary and Indonesian morphology before displaying or translating it. Segments that do not contain enough evidence for either supported language are ignored. For best results, use complete phrases rather than isolated words. Manual Bahasa Indonesia and English modes remain available.
