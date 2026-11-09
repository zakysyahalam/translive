# Translive v1.9 — Privacy-First Local Recognition

Live Indonesian ↔ English conversation translator.

## What is new in v1.9

- **Microphone:** speech recognition now runs locally in the browser with Whisper Tiny. It no longer uses the browser's cloud-backed `SpeechRecognition` service.
- **Desktop audio:** continues to use local Whisper Tiny with a lightweight voice-activity gate.
- **Both sources:** microphone and desktop audio are captured and transcribed as separate streams, with duplicate phrase suppression.
- **Video privacy:** browser display capture requires a video track, but Translive stops that track immediately after permission is granted and never reads video frames. Only the shared audio track is passed to the audio processor.
- **No raw audio upload or recording:** the app contains no MediaRecorder, WebSocket, or audio/video upload endpoint.
- **No external web fonts:** the interface uses system fonts.
- **Translation:** recognized text is sent to the MyMemory public translation API. MyMemory is an external service and may process or retain submitted text under its own policies.
- **No contact email field:** translation requests do not include a user email address.

## Privacy boundaries

Speech recognition happens locally after Whisper Tiny has been downloaded and loaded in the browser. The model files are fetched from Hugging Face on first use and may be cached by the browser. Audio samples are not sent to Hugging Face, Vercel, or MyMemory by the application. The translated text request is sent to `api.mymemory.translated.net`. Browser/OS permissions and the integrity of the browser and deployed JavaScript remain important security boundaries.

The browser's `getDisplayMedia()` API requires display capture permission and generally requires a video track even when an app only needs audio. Translive immediately calls `stop()` on every returned video track, then processes only the audio track. The browser may still show a sharing indicator or a selection dialog.

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
5. Choose Bahasa Indonesia or English and play the audio.

Browser and operating-system support controls which desktop audio can be shared. Sharing a browser tab is generally the most reliable. The app cannot capture protected/DRM audio or audio that the browser/OS does not expose.

## Recognition and noise filtering

Whisper Tiny runs locally for both microphone and desktop audio. The first use downloads the model; subsequent use may use the browser cache. Audio is processed in four-second chunks. A lightweight voice-activity heuristic based on signal energy and zero-crossing rate filters silence and some background noise before transcription. It is not professional noise cancellation; bird calls, crickets, or other speech-like sounds may still trigger recognition.

## Translation and third-party services

Only recognized text is sent to MyMemory for translation. Do not use Translive with confidential conversations unless you are comfortable sending their recognized text to an external translation provider. Model downloads use Hugging Face hosting. No raw audio/video upload is implemented in the application.
