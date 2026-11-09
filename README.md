# Translive v1.8 — Hybrid Recognition

Live Indonesian ↔ English conversation translator.

- **Microphone:** uses the browser's native Speech Recognition engine, restoring the v1.5 approach for the selected language (`id-ID` or `en-US`).
- **Desktop audio:** captures a shared browser tab/window/screen and transcribes it locally with Whisper Tiny. A lightweight voice-activity gate filters quiet audio and some sustained high-frequency background noise before transcription.
- **Both sources:** microphone and desktop audio are processed separately to avoid mixing and unnecessary duplicate recognition.
- **Language selection:** choose Bahasa Indonesia or English. Auto Detect has been removed.
- **Translation:** MyMemory free translation API.
- **Fullscreen conversation workspace.**

## Run locally

```bash
npm install
npm run dev
```

Open the HTTPS deployment or local Vite address in Chrome or Edge.

## Deploy to Vercel

- Framework preset: Vite
- Build command: `npm run build`
- Output directory: `dist`
- No API key or environment variable is required.

## Desktop audio instructions

1. Choose **Desktop audio** or **Both sources**.
2. Click Start.
3. In the browser sharing dialog, select the tab, window, or screen containing the sound.
4. Enable **Share tab audio** or **Share system audio**, if offered.
5. Choose the correct language (Indonesian or English), then play the audio.

Browser and operating-system support controls which desktop audio can be shared. Sharing a browser tab is generally the most reliable. The app cannot capture protected/DRM audio or audio that the browser/OS does not expose.

## Recognition behavior and noise filtering

The microphone uses the browser's speech engine and does not require a Whisper download. Desktop audio uses Whisper Tiny locally in the browser; the first use downloads and caches the model. Desktop audio is divided into short segments and passed through a lightweight voice-activity heuristic based on signal energy and zero-crossing rate. This helps ignore silence, quiet noise, and some cricket-like high-frequency sounds. It is not professional noise cancellation, and some bird calls or other speech-like sounds may still trigger recognition. Clear speech and a reasonable audio level give the best results.

## Privacy and translation

Speech recognition runs in the browser (native browser service for microphone; local Whisper for desktop audio). Recognized text is sent to MyMemory's public translation service to obtain the translated side of each message. MyMemory may impose rate limits.
