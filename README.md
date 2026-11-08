# Lingua Live — Free MVP (Indonesia ↔ English)

A responsive browser-based live speech translator starter intended for Vercel. This version does **not** use OpenAI, does not require an API key, and does not require a credit card.

## Important: what is free, and what are the limits?

- **Speech recognition:** uses the browser's Web Speech API (`SpeechRecognition`). Chrome/Edge are recommended. Browser speech recognition may rely on the browser vendor's online recognition service; it is not guaranteed to work offline and browser support varies.
- **Translation:** uses the public MyMemory translation endpoint directly from the browser. Its published anonymous limit is 5,000 characters/day. MyMemory says adding a valid contact email via the `de` parameter can raise the limit to 50,000 characters/day. The email is optional and is sent with translation requests if entered in Settings.
- **No API key:** no `OPENAI_API_KEY`, LibreTranslate key, or other secret is needed.
- **Availability:** MyMemory is a public third-party service. It may rate-limit, change its policy, or be temporarily unavailable. This is a free test build, not a guaranteed production SLA.
- **Automatic speech-language detection:** Auto mode starts Indonesian and English browser recognition engines in parallel and uses simple phrase heuristics to choose the displayed source language. This is experimental; browser implementations may not support simultaneous recognition engines reliably. If it behaves inconsistently, choose Indonesian or English manually from Speech Mode.
- **Translation timing:** interim speech is shown in the listening preview. Paired chat bubbles are created when the browser finalizes a phrase; the translation appears after the MyMemory request completes. This is near-real-time, not word-by-word simultaneous interpretation.

## Run locally

Requirements: Node.js 18+.

```bash
npm install
npm run dev
```

Open the local URL printed by Vite, preferably in Google Chrome. `localhost` is treated as a secure context by modern browsers, so microphone permission can be granted.

## Deploy to Vercel

1. Extract this ZIP.
2. Open the `live-translator` folder and push the files inside it (not the parent folder) to the root of a GitHub repository. `index.html`, `app.js`, `styles.css`, and `package.json` must be at the repository root.
3. In Vercel, import that repository. Set the Root Directory to `./` (repository root).
4. Framework preset: **Vite**. Build command: `npm run build`. Output directory: `dist`. Install command: `npm install`.
5. Deploy. **Do not add any API key environment variables.**
6. Open the deployed HTTPS URL in Chrome/Edge, click the microphone button, and grant microphone permission.

Important: this release loads `app.js` as a Vite-processed ES module. Do not deploy the raw source folder as a static directory without running the Vite production build.

## How to test

1. Start with Speech Mode = Auto detect (experimental).
2. Say a short Indonesian sentence, e.g. “Halo, nama saya Zaky. Apa kabar?”
3. Wait for the blue Indonesian bubble and red English translation.
4. Say a short English sentence, e.g. “Hello, nice to meet you. How are you?”
5. If Auto mode chooses the wrong source language, change Speech Mode to Bahasa Indonesia or English and repeat.
6. Try Pause, Resume, End, Clear, and a mobile viewport.

## Privacy and microphone behavior

The microphone starts only after the user clicks Start and grants browser permission; a website cannot silently turn on a microphone on page load. Audio recognition is handled by the browser's speech-recognition implementation. The app sends recognized text (not raw audio) to MyMemory for translation. Do not use this public test build for confidential conversations.

## Project structure

- `index.html` — app shell and UI
- `styles.css` — responsive dark UI
- `app.js` — speech recognition, chat bubbles, translation requests
- `vercel.json` — static deployment headers

## Notes

This is an MVP intended for testing the overall interaction and UI. It is not guaranteed to provide uninterrupted transcription, perfect automatic language detection, or unlimited free translation. For stable high-volume use, a self-hosted speech/translation stack or a paid provider would be needed.
