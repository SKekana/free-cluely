# Gemini integration: research and implementation

The upstream merge at `caab1bb` preserved the fork's changes and incorporated `Prat011/free-cluely/master`. Its net change was README-only. The implementation below replaces the integration audited in that revision.

## Implemented behavior

Regular Gemini requests use `gemini-3.5-flash-lite`; Live uses `gemini-3.8-live`. Both IDs are configurable through `GEMINI_MODEL` and `GEMINI_LIVE_MODEL`. The key is loaded in the main process from the existing `.env`, or supplied through Models for the current application session. The app can start without credentials. No key or `.env` is bundled in application artifacts or returned to the renderer.

The active SDK is `@google/genai@2.29.1`. Its Node requirement is compatible with the current Electron runtime; CI uses Node 24. The legacy SDK and retired hardcoded model IDs have been removed. Gemini's [current library guidance](https://ai.google.dev/gemini-api/docs/libraries) recommends this SDK, and [Flash-Lite](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite) supports the text, image, audio, and structured-output operations used here.

Chat streams into a draft response and retains the latest 20 completed turns in the main process. Recent image/audio analysis contributes context. Reset and provider switching clear that context, abort requests, and reject stale responses. Image requests for the same screenshot share a result to avoid duplicate submissions. Configuration and successful connection verification are shown separately.

All modalities respect the selected provider. Ollama is text-only in this version; image, audio, structured results, and Live explicitly require Gemini. Unsupported operations do not fall back to a cloud request.

Screenshot analysis retains the existing PNG workflow. JSON solution/debug requests now use a shared schema matching the fields displayed by the UI: `code`, `thoughts`, `time_complexity`, and `space_complexity`, plus problem/context/suggestion fields. Results are validated before being emitted.

Recorded voice clips are explicit actions, limited to two minutes or 10 MB. MIME handling recognizes WAV bytes and normalizes MP3/WebM types. Recorder tracks and timers are released on stop, cancellation, reset, errors, and shutdown. The automatic five-second recording tied to the Solutions mount cycle has been removed. Clip recording and Live are mutually exclusive.

## Silent Live assistance

Start Live captures the selected microphone, system output, and screen/window. Each input can be disabled before starting. Capture remains active when switching between Queue and Solutions or hiding the overlay; Stop Live, reset, provider changes, and shutdown release all resources.

Windows uses Electron display capture with audio loopback. Linux uses `pactl` to discover output monitors and `parec` to stream mono PCM through PulseAudio or PipeWire's PulseAudio compatibility server. Linux requires `pulseaudio-utils` and a working output device. The capability panel shows missing inputs rather than silently omitting them. [Electron's loopback interface](https://github.com/electron/electron/blob/v33.4.11/docs/api/session.md#sessetdisplaymediarequesthandlerhandler-opts) documents the Windows path.

Browser audio passes through an AudioWorklet, is normalized to 16 kHz PCM16, and is mixed with system audio in bounded main-process queues. Screen capture sends the latest JPEG frame at no more than one frame per second, with a maximum edge of 1280 pixels. Full-display captures mask the overlay. Continuous capture does not hide/show the overlay or create screenshot files.

The Live session provides captions and concise observations, proposed answers, and next steps as conversation context develops. Output audio is discarded; assistance comes from output transcripts. The model still generates audio and accounts for that usage. Setup uses `AUDIO` responses, input/output transcription, compression, and session resumption, without obsolete affective-dialog or thinking-level settings. [Model-specific configuration](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-live#migrating)

`goAway` and transient disconnects reconnect with a resumption handle and bounded retries. Disconnected audio/frame queues are dropped rather than replayed. Expired handles allow a fresh session. Authorization and quota failures stop retrying. Late callbacks cannot update or close a replacement session. [Session management](https://ai.google.dev/gemini-api/docs/live-api/session-management)

Captions, suggestions, handles, and recent conversation context are kept in memory. The UI retains the latest 30 caption/suggestion rows and shows elapsed time and usage when the server supplies it. No model tools, Search grounding, spoken playback, or dedicated transcription model are enabled.

## Use and verification

1. Run `npm ci`, then `npm start`, with the existing key in `.env`.
2. Open Models to view the configured regular/Live IDs or test the regular connection.
3. In Capture settings, choose a screen/window and the microphone/system output. Disable an input only if you intend to omit it.
4. Use Test Live connection to verify the setup handshake; use Start Live to begin capture. Show captions expands the input transcript.
5. Stop Live before Record Clip. Reset also stops capture and clears conversation state.

Developer checks:

```bash
npm run typecheck
npm test
npm run build
npm run test:gemini
GEMINI_SOAK_SECONDS=720 npm run test:gemini -- -t "across server connection rotation"
```

Authenticated tests use the two requested models and a public Google speech fixture, generated red image, and optional locally synthesized speech. They require network access and `ffmpeg` for MP3/WebM conversion. Normal CI tests use mocked transports and do not need a key. Do not substitute model IDs when an access/quota error occurs.

Verified during implementation: type checking; production build; 24 unit tests for provider isolation, history, cancellation, media formats, schema validation, PCM buffering/resampling, cleanup, frame throttling, restart races, and resumption; authenticated Flash-Lite text/history/image/schema/WAV/MP3/WebM checks; authenticated Live input/output transcripts, automatic assistance, and successful conversation resumption after an induced socket disconnect; production Electron startup with and without a key, plus microphone-worklet/screen start-stop under Xvfb; Linux and Windows unpacked application builds; artifact checks excluding `.env` and the configured key.

The authenticated 12-minute mixed-input soak passed with zero errors and an active connection throughout. The server did not rotate the connection during that run; GoAway behavior is covered by unit tests. The last reported usage snapshot was 5,462 tokens. Local Windows directory packaging disables executable editing because this Linux host lacks Wine; normal Windows CI retains executable editing.

## Remaining platform checks

This environment has a virtual display and a dummy audio output, rather than physical microphone/meeting devices. Real Linux meeting-audio capture, Windows loopback with real devices, permission dialogs, and device unplug/replug still require desktop acceptance testing. macOS system-audio support is deferred. No application deployment or publishing is included.
