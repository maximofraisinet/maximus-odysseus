# Design Spec: Local Kokoro-v1.0 ONNX TTS Integration

## Context & Requirements
This design spec outlines the integration of the local **Kokoro-v1.0 ONNX** text-to-speech engine into the Maximus-Odysseus application. 

Key Requirements:
1. **Isolated Files**: Implement the feature in new, separate files as much as possible to ensure simple git merges with the parent repository.
2. **Text Cleaning**: Clean input text by removing emojis, markdown tags (`*`, `#`, `_`, etc.), links, code blocks, blockquotes, and reasoning blocks (`<think>/<thinking>`) before passing to the TTS engine to ensure natural pronunciation.
3. **Active Toggle**: Add an auto-play toggle button in the chat input toolbar.
4. **Custom Config Section**: Add a dedicated "Maximus Odysseus" tab under Settings to:
   * Specify the absolute directory path of `kokoro-v1.0` (containing `kokoro-v1.0.onnx` and `voices-v1.0.bin`).
   * Select a voice from a dropdown menu that displays the language/accent and gender of the voice.

---

## Architectural Details

```
+-------------------------------------------------------------+
|                          FRONTEND                           |
|  +------------------------+  +---------------------------+  |
|  | Settings: Tab & Panel  |  | Chat Input Toggle Btn     |  |
|  +-----------+------------+  +--------------+------------+  |
|              |                              |               |
|              v                              v               |
|  +-------------------------------------------------------+  |
|  | window.aiTTSManager.synthesize (wrapped / patched)    |  |
|  | window.aiTTSManager.available & _provider (patched)   |  |
|  | window.aiTTSManager.useBrowserTTS (patched)           |  |
|  +--------------------------+----------------------------+  |
+-----------------------------|-------------------------------+
                              | (HTTP API)
                              v
+-------------------------------------------------------------+
|                          BACKEND                            |
|  +-------------------------------------------------------+  |
|  | routes/maximus_odysseus_routes.py                     |  |
|  |  - GET/POST /api/maximus-odysseus/settings            |  |
|  |  - GET /api/maximus-odysseus/voices?path=...          |  |
|  |  - POST /api/maximus-odysseus/synthesize              |  |
|  +--------------------------+----------------------------+  |
|                             |                               |
|                             v                               |
|  +-------------------------------------------------------+  |
|  | services/maximus_odysseus_tts.py                      |  |
|  |  - load_settings() & save_settings()                  |  |
|  |  - clean_text_for_tts()                               |  |
|  |  - get_kokoro_voices()                                |  |
|  |  - Kokoro ONNX Inference (singleton model cache)      |  |
|  +--------------------------+----------------------------+  |
|                             |                               |
|                             v                               |
|  +-------------------------------------------------------+  |
|  | data/maximus_odysseus_settings.json                   |  |
|  | kokoro-v1.0/ (onnx & voices.bin)                      |  |
|  +-------------------------------------------------------+  |
+-------------------------------------------------------------+
```

### Backend Components

#### 1. Configuration Storage (`maximus_odysseus_settings.json`)
Saves configuration keys separate from the global settings file. The path is dynamically resolved using `src.constants.DATA_DIR` (i.e. `os.path.join(DATA_DIR, "maximus_odysseus_settings.json")`) to ensure correctness in custom data environments.
```json
{
  "kokoro_dir": "/home/maximo/Código/maximus-odysseus/kokoro-v1.0",
  "voice": "em_alex"
}
```

#### 2. TTS Service (`services/maximus_odysseus_tts.py`)
Provides methods to:
* **Load/Save** configuration dynamically using `src.constants.DATA_DIR`.
* **Resolve Voice Languages**: Map voice keys inside `voices-v1.0.bin` (using NumPy keys) to readable labels.
* **Clean Text**: Perform regex substitutions to strip reasoning blocks (`<think>...</think>`, `<thinking>...</thinking>`), HTML tags, markdown images, markdown links (extracting link text), code blocks, inline backticks, headers (`#`), formatting (`*`, `_`), list bullet points, blockquotes, emojis, and extra whitespace.
* **Synthesize Audio**: Load the ONNX model lazily using the `kokoro-onnx` pip library and convert inference output samples into a WAV stream using `soundfile`.
* **Model Weight Caching (Singleton)**: Cache the loaded `Kokoro` pipeline instance in memory globally after the first initialization. This avoids reloading the heavy ONNX weights from disk on subsequent synthesis calls.
* **Cache Invalidation**: If settings are saved via `POST /api/maximus-odysseus/settings` and the `kokoro_dir` has changed, the cached model pipeline instance is automatically cleared to force loading the new model path on the next call.

#### 3. API Endpoints (`routes/maximus_odysseus_routes.py`)
* `GET /api/maximus-odysseus/settings`: Retrieves configurations.
* `POST /api/maximus-odysseus/settings`: Updates configurations, triggering ONNX cache invalidation if the directory changes.
* `GET /api/maximus-odysseus/voices`: Returns the list of voices with language mapping. Accepts an optional `path` query parameter to list voices for a directory before it is saved.
* `POST /api/maximus-odysseus/synthesize`: Synthesizes clean text to WAV bytes.

#### 4. FastAPI Registration (`app.py` Integration)
We will register our custom router in `/home/maximo/Código/maximus-odysseus/app.py` right alongside other TTS route setups:
```python
# app.py (around line 608)
# Maximus-Odysseus custom routes
from routes.maximus_odysseus_routes import setup_maximus_odysseus_routes
app.include_router(setup_maximus_odysseus_routes())
```

#### 5. Dependency Management
We will document the dependencies `kokoro-onnx` and `soundfile` which are required to run this feature. (They are already present in the user environment, but we will ensure they are mentioned in any installation specs).

---

### Frontend Components

#### 1. Script Tag Insertion (`static/index.html`)
To ensure the script runs, a new script tag will be added to the bottom of `/home/maximo/Código/maximus-odysseus/static/index.html` just before the main initialization scripts:
```html
<!-- static/index.html (around line 2323) -->
<script type="module" src="/static/js/maximus-odysseus.js"></script>
```

#### 2. Dynamic Settings Tab & Panel Injection (`static/js/maximus-odysseus.js`)
On page load, dynamically inserts:
* A navigation tab: `<button class="settings-nav-item" data-settings-tab="maximus-odysseus">Maximus Odysseus</button>`.
* A panel containing configuration input fields: Folder directory, Voice selector dropdown, a "Cargar Voces" button, and a "Guardar" button.
* On tab transition, retrieves and displays settings.

#### 3. Auto-Play Toolbar Toggle Button
* Injects a speaker/mute toggle button next to the shell toggle button (`#bash-toggle-btn`) in `.chat-input-left`.
* Connects click handler to toggle `localStorage.setItem('maximus_odysseus_read_aloud', 'true'/'false')`.
* Directly updates `window.aiTTSManager.autoPlay = true/false` to align with the core autoplay dispatcher in `chat.js`.

#### 4. Speech Synthesis & Availability Hijack (Monkeypatching)
* **Contract Matching for Synthesis**: Intercepts `window.aiTTSManager.synthesize(text, onProgress)`. Fetches the raw audio bytes from `/api/maximus-odysseus/synthesize`, converts them into a `Blob`, and returns a local `URL.createObjectURL(blob)` string, complying with the exact contract expected by `AITTSManager.play()` and `AITTSManager.enqueue()`.
* **Dynamic Availability Patching**:
  We wrap the availability checking logic to override TTS configurations and bypass browser synthesis:
  ```javascript
  const originalCheckAvailability = window.aiTTSManager.checkAvailability;
  window.aiTTSManager.checkAvailability = async function() {
    await originalCheckAvailability.call(this);
    if (localStorage.getItem('maximus_odysseus_read_aloud') === 'true') {
      this.available = true;
      this._provider = 'local'; // Using 'local' ensures core AITTSManager sets playbackRate based on user playbackSpeed configuration
      this.useBrowserTTS = false; // Disable browser speech synthesis fallback
    }
  };
  ```
  Additionally, whenever the toggle button is clicked, we immediately force-set:
  ```javascript
  if (isActive) {
    window.aiTTSManager.available = true;
    window.aiTTSManager._provider = 'local';
    window.aiTTSManager.useBrowserTTS = false;
    window.aiTTSManager.autoPlay = true;
  } else {
    window.aiTTSManager.autoPlay = false;
    // Re-check original availability
    window.aiTTSManager.checkAvailability();
  }
  ```
  This guarantees that even if default TTS is disabled, our custom TTS triggers correctly in `chat.js`, other UI elements, and honors user-selected playback speeds.

---

## Verification Plan
1. **Unit Verification**:
   * Test the text cleaning function with various edge cases (complex markdown, reasoning tags, multiple emojis, nested code blocks).
   * Verify that `kokoro-onnx` loads the local model and style file successfully and runs inference.
2. **Integration Verification**:
   * Open the Settings panel, navigate to the "Maximus Odysseus" tab.
   * Input a correct directory path, load the voices list, verify English/Spanish/etc. language labels.
   * Change voice, click save. Confirm that settings are written to the resolved `maximus_odysseus_settings.json` path.
   * Toggle the auto-read speaker icon in the chat toolbar. Send a message and confirm it plays the voice cleaned of emojis/markdown.
