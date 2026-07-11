# Spec: Whisper Local STT Integration

Integration of local `faster-whisper` Speech-to-Text capability in Maximus-Odysseus settings and composer.

---

## 1. Goals & Requirements
*   Add a local Whisper configuration section under **Settings -> Maximus** to allow users to select their preferred model size and transcription language.
*   The language dropdown must place **Auto-detect**, **Español**, and **English** at the top, followed by other common languages.
*   Add a dedicated microphone button (`#maximus-mic-toggle-btn`) in the chat composer bar.
*   Provide clear visual feedback when recording (red glowing/pulsing animation) and transcribing (loading spinner).
*   Process audio locally: record on click, stop and transcribe on click, insert text, and clean up audio resources without memory leaks.
*   Ensure zero conflicts with the upstream repository by isolating the frontend changes inside `static/js/maximus-odysseus.js` and integrating with existing backend STT structures.

---

## 2. Technical Design

### A. Settings Data Structure
The settings file `data/maximus_odysseus_settings.json` will be extended with:
```json
{
  "kokoro_dir": "/home/maximo/Código/maximus-odysseus/kokoro-v1.0",
  "voice": "em_alex",
  "whisper_model": "base",
  "whisper_language": ""
}
```
*   `whisper_model` values: `tiny`, `tiny.en`, `base`, `base.en`, `small`, `small.en`, `medium`, `medium.en`, `large-v1`, `large-v2`, `large-v3`, `large`.
*   `whisper_language` values: `""` (auto-detect), `"es"` (Spanish), `"en"` (English), `"fr"`, `"de"`, `"it"`, `"pt"`, `"ja"`, `"zh"`, etc.

### B. Backend Service Override (`stt_service.py`)
*   The `STTService._load_settings()` method will dynamically merge settings from `get_maximus_odysseus_settings()`.
*   When transcription runs locally, it will read `whisper_model` and `whisper_language` from these settings.
*   When saving settings, we will check if `whisper_model` has changed. If so, we will invalidate the cached `WhisperModel` instance inside `STTService` by setting `self._whisper_model = None` to ensure the new model is loaded on the next call.

### C. Frontend Controls & Lifecycle
*   **Mic Button injection**: Injected in the chat composer input bar next to the Kokoro TTS button.
*   **Recording flow**:
    1.  User clicks the mic button.
    2.  Check `window.isSecureContext` and prompt microphone permission.
    3.  Begin recording audio chunks using `MediaRecorder` at `audio/webm`.
    4.  Apply class `.maximus-recording` to the button (pulsing red animation).
    5.  User clicks the mic button again.
    6.  Stop `MediaRecorder`, stop tracks, and combine chunks into a `Blob`.
    7.  Apply class `.maximus-loading` to the button and render a spinner.
    8.  Send the Blob as a multipart form data file to `/api/stt/transcribe`.
    9.  On response, insert the returned text at the composer cursor position and trigger input events (auto-resize).
    10. Remove classes `.maximus-recording` and `.maximus-loading`, and reset the button icon.

---

## 3. UI and Styling Specs

We inject these additional CSS rules:
```css
.input-icon-btn.maximus-recording {
    color: #ef4444 !important;
    background: rgba(239, 68, 68, 0.1) !important;
    border-color: rgba(239, 68, 68, 0.2) !important;
    animation: maximus-pulse 1.5s infinite;
}
@keyframes maximus-pulse {
    0% { opacity: 1; }
    50% { opacity: 0.5; }
    100% { opacity: 1; }
}
.maximus-loading-spinner {
    animation: maximus-spin 1s linear infinite;
}
@keyframes maximus-spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
}
```

---

## 4. Verification Plan
*   **Settings validation**: Verify model and language select elements are loaded and rendered correctly under Settings -> Maximus. Save new settings and verify they are saved to `maximus_odysseus_settings.json`.
*   **Microphone recording**: Verify microphone initialization, recording, and stopping correctly releases audio devices.
*   **Local transcription**: Verify that FastAPI correctly transcribes WebM audio to text using the selected Whisper model size and language settings.
