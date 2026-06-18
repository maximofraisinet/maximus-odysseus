// static/js/maximus-odysseus.js
// Maximus-Odysseus custom integration for local Kokoro ONNX Text-to-Speech

(function initMaximusOdysseus() {
    const DEBUG_PREFIX = '[Maximus-Odysseus]';
    
    // ── Style Injection ──
    const style = document.createElement('style');
    style.textContent = `
        .maximus-settings-section {
            padding: 12px 0;
        }
        .maximus-settings-row {
            margin-bottom: 16px;
            display: flex;
            flex-direction: column;
            gap: 6px;
        }
        .maximus-settings-row label {
            font-size: 13px;
            font-weight: 500;
            color: var(--text-light, #9ca3af);
        }
        .maximus-input-group {
            display: flex;
            gap: 8px;
        }
        .maximus-input {
            flex: 1;
            background: var(--bg-dark, #1f2937);
            border: 1px solid var(--border, #374151);
            color: var(--text, #f3f4f6);
            padding: 8px 12px;
            border-radius: 6px;
            font-size: 13px;
            outline: none;
            transition: border-color 0.15s;
        }
        .maximus-input:focus {
            border-color: var(--primary, #3b82f6);
        }
        .maximus-btn {
            background: var(--primary, #3b82f6);
            color: #fff;
            border: none;
            padding: 8px 16px;
            border-radius: 6px;
            font-size: 13px;
            font-weight: 500;
            cursor: pointer;
            transition: background 0.15s;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
        }
        .maximus-btn:hover {
            background: var(--primary-hover, #2563eb);
        }
        .maximus-btn.sec {
            background: var(--bg-dark, #1f2937);
            border: 1px solid var(--border, #374151);
            color: var(--text, #f3f4f6);
        }
        .maximus-btn.sec:hover {
            background: var(--border, #374151);
        }
        .maximus-status {
            font-size: 12px;
            margin-top: 4px;
            display: none;
        }
        .maximus-status.success {
            color: #10b981;
            display: block;
        }
        .maximus-status.error {
            color: #ef4444;
            display: block;
        }
        .input-icon-btn.maximus-active {
            color: #10b981 !important;
            background: rgba(16, 185, 129, 0.1) !important;
            border-color: rgba(16, 185, 129, 0.2) !important;
        }
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
    `;
    document.head.appendChild(style);

    // ── Setup UI elements injection when DOM is ready ──
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setupUI);
    } else {
        setupUI();
    }

    function setupUI() {
        console.log(DEBUG_PREFIX, 'Initializing UI modifications...');
        
        // 1. Inject Settings Tab and Panel
        const settingsModal = document.getElementById('settings-modal');
        if (settingsModal) {
            injectSettingsElements(settingsModal);
        } else {
            // Observe DOM to find settings modal if loaded asynchronously
            const observer = new MutationObserver((mutations, obs) => {
                const modal = document.getElementById('settings-modal');
                if (modal) {
                    injectSettingsElements(modal);
                    obs.disconnect();
                }
            });
            observer.observe(document.body, { childList: true, subtree: true });
        }

        // 2. Inject Composer Auto-Read Toggle Button
        injectComposerToggleButton();

        // 3. Inject Composer Speech-to-Text Microphone Button
        injectComposerMicButton();

        // 4. Patch the AITTSManager
        patchTTSManager();
    }

    function injectSettingsElements(modal) {
        // Check if already injected
        if (modal.querySelector('[data-settings-tab="maximus-odysseus"]')) return;

        // Find settings sidebar tabs container
        const navContainer = modal.querySelector('.settings-sidebar');
        if (!navContainer) {
            console.warn(DEBUG_PREFIX, 'Could not find settings sidebar container.');
            return;
        }

        // Find settings panels container
        const panelsContainer = modal.querySelector('.settings-panels');
        if (!panelsContainer) {
            console.warn(DEBUG_PREFIX, 'Could not find settings panels container.');
            return;
        }

        // Create Nav Button for "Maximus"
        const navBtn = document.createElement('button');
        navBtn.type = 'button';
        navBtn.className = 'settings-nav-item';
        navBtn.dataset.settingsTab = 'maximus-odysseus';
        navBtn.innerHTML = `
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:8px;vertical-align:-2px">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
            </svg>
            <span>Maximus</span>
        `;

        // Inject after Search button in Section 1 (AI plumbing) to keep user settings grouped together
        const searchBtn = navContainer.querySelector('[data-settings-tab="search"]');
        if (searchBtn) {
            searchBtn.parentNode.insertBefore(navBtn, searchBtn.nextSibling);
        } else {
            // Fallback: before admin sections if search is not found
            const refElement = navContainer.querySelector('.admin-only') || navContainer.querySelector('[data-settings-tab="tools"]');
            if (refElement) {
                navContainer.insertBefore(navBtn, refElement);
            } else {
                navContainer.appendChild(navBtn);
            }
        }

        // Create panel
        const panel = document.createElement('div');
        panel.dataset.settingsPanel = 'maximus-odysseus';
        panel.className = 'hidden';
        panel.innerHTML = `
            <div class="admin-card">
                <h2><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:5px;opacity:0.6"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>Maximus</h2>
                <div class="admin-toggle-sub" style="margin-bottom:15px">Configura la ruta de la carpeta Kokoro v1.0, las voces y el modelo local de Whisper para la transcripción.</div>
                
                <h3 style="font-size: 13px; font-weight: 600; margin-bottom: 12px; border-bottom: 1px solid var(--border); padding-bottom: 6px; color: var(--text-light, #9ca3af);">Texto a Voz (Kokoro TTS)</h3>
                <div class="settings-col" style="margin-bottom: 20px;">
                    <div class="settings-row" style="margin-bottom:12px">
                        <label class="settings-label">Directorio de Kokoro v1.0</label>
                        <div style="display:flex; gap:8px; flex:1;">
                            <input type="text" id="maximus-kokoro-dir" class="settings-input" placeholder="/ruta/absoluta/a/kokoro-v1.0" />
                            <button type="button" id="maximus-load-voices-btn" class="settings-fallback-add" style="margin:0; padding:6px 12px; height:28px; display:inline-flex; align-items:center; cursor:pointer;">Cargar Voces</button>
                        </div>
                    </div>
                    
                    <div class="settings-row" style="margin-bottom:12px; display:none;" id="maximus-dir-status-row">
                        <label class="settings-label"></label>
                        <span id="maximus-dir-status" class="maximus-status" style="flex:1;"></span>
                    </div>
                    
                    <div class="settings-row" style="margin-bottom:12px">
                        <label class="settings-label">Voz Predeterminada</label>
                        <select id="maximus-voice-select" class="settings-select" style="flex:1;"></select>
                    </div>
                </div>

                <h3 style="font-size: 13px; font-weight: 600; margin-bottom: 12px; border-bottom: 1px solid var(--border); padding-bottom: 6px; color: var(--text-light, #9ca3af);">Voz a Texto (Whisper STT)</h3>
                <div class="settings-col">
                    <div class="settings-row" style="margin-bottom:12px">
                        <label class="settings-label">Modelo de Whisper</label>
                        <select id="maximus-whisper-model" class="settings-select" style="flex:1;">
                            <option value="tiny">tiny (Muy rápido, ~75MB)</option>
                            <option value="tiny.en">tiny.en (Solo inglés, ~75MB)</option>
                            <option value="base">base (Rápido, ~145MB) [Recomendado]</option>
                            <option value="base.en">base.en (Solo inglés, ~145MB)</option>
                            <option value="small">small (Preciso, ~460MB)</option>
                            <option value="small.en">small.en (Solo inglés, ~460MB)</option>
                            <option value="medium">medium (Muy preciso, ~1.5GB)</option>
                            <option value="medium.en">medium.en (Solo inglés, ~1.5GB)</option>
                            <option value="large-v1">large-v1 (Máxima calidad v1, ~3GB)</option>
                            <option value="large-v2">large-v2 (Máxima calidad v2, ~3GB)</option>
                            <option value="large-v3">large-v3 (Máxima calidad v3, ~3GB)</option>
                            <option value="large">large (Equivalente a large-v3, ~3GB)</option>
                        </select>
                    </div>
                    <div class="settings-row" style="margin-bottom:12px">
                        <label class="settings-label">Idioma</label>
                        <select id="maximus-whisper-lang" class="settings-select" style="flex:1;">
                            <option value="">Auto-detect (Detectar automáticamente)</option>
                            <option value="es">Español (es)</option>
                            <option value="en">English (en)</option>
                            <option value="fr">Français (fr)</option>
                            <option value="de">Deutsch (de)</option>
                            <option value="it">Italiano (it)</option>
                            <option value="pt">Português (pt)</option>
                            <option value="ja">日本語 (ja)</option>
                            <option value="zh">中文 (zh)</option>
                            <option value="ru">Русский (ru)</option>
                            <option value="ko">한국어 (ko)</option>
                            <option value="nl">Nederlands (nl)</option>
                            <option value="pl">Polski (pl)</option>
                                       </select>
                    </div>
                    <div class="settings-row" style="margin-bottom:12px; display:flex; align-items:center;">
                        <label class="settings-label">Aceleración por GPU (CUDA)</label>
                        <div style="flex:1; display:flex; align-items:center;">
                            <label class="admin-switch" title="Usar la GPU para acelerar la transcripción si está disponible">
                                <input type="checkbox" id="maximus-whisper-gpu" checked />
                                <span class="admin-slider"></span>
                            </label>
                        </div>
                    </div>
                    <div class="settings-row" style="margin-bottom:12px; display:flex; align-items:center;">
                        <label class="settings-label">Precargar modelo al inicio</label>
                        <div style="flex:1; display:flex; align-items:center;">
                            <label class="admin-switch" title="Cargar el modelo Whisper en memoria nada más iniciar la aplicación">
                                <input type="checkbox" id="maximus-whisper-preload" />
                                <span class="admin-slider"></span>
                            </label>
                        </div>
                    </div>
                </div>

                <div style="margin-top:20px; border-top:1px solid var(--border); padding-top:15px; display:flex; align-items:center; gap:12px;">
                    <button type="button" id="maximus-save-settings-btn" class="settings-fallback-add" style="margin:0; padding:6px 16px; border-color:var(--primary, #3b82f6); color:var(--primary, #3b82f6); cursor:pointer;">
                        Guardar Configuración
                    </button>
                    <span id="maximus-save-status" class="maximus-status"></span>
                </div>
            </div>
        `;
        panelsContainer.appendChild(panel);

        // Bind events
        navBtn.addEventListener('click', () => {
            modal.querySelectorAll('[data-settings-tab]').forEach(b => b.classList.toggle('active', b === navBtn));
            modal.querySelectorAll('[data-settings-panel]').forEach(p => p.classList.toggle('hidden', p !== panel));
            loadSettings();
        });

        panel.querySelector('#maximus-load-voices-btn').addEventListener('click', () => {
            const dir = panel.querySelector('#maximus-kokoro-dir').value.trim();
            loadVoices(dir);
        });

        panel.querySelector('#maximus-save-settings-btn').addEventListener('click', saveSettings);
    }

    async function loadSettings() {
        try {
            const res = await fetch('/api/maximus-odysseus/settings');
            const data = await res.json();
            
            const dirInput = document.getElementById('maximus-kokoro-dir');
            if (dirInput) {
                dirInput.value = data.kokoro_dir || '';
                if (data.kokoro_dir) {
                    await loadVoices(data.kokoro_dir, data.voice);
                }
            }

            const whisperModelSelect = document.getElementById('maximus-whisper-model');
            if (whisperModelSelect && data.whisper_model) {
                whisperModelSelect.value = data.whisper_model;
            }

            const whisperLangSelect = document.getElementById('maximus-whisper-lang');
            if (whisperLangSelect && data.whisper_language !== undefined) {
                whisperLangSelect.value = data.whisper_language;
            }

            const whisperGpuCheck = document.getElementById('maximus-whisper-gpu');
            if (whisperGpuCheck) {
                whisperGpuCheck.checked = data.whisper_gpu !== false;
            }

            const whisperPreloadCheck = document.getElementById('maximus-whisper-preload');
            if (whisperPreloadCheck) {
                whisperPreloadCheck.checked = !!data.whisper_preload;
            }
        } catch (e) {
            console.error(DEBUG_PREFIX, 'Error loading settings:', e);
        }
    }

    async function loadVoices(dirPath, selectedVoice = null) {
        const statusEl = document.getElementById('maximus-dir-status');
        const selectEl = document.getElementById('maximus-voice-select');
        const statusRow = document.getElementById('maximus-dir-status-row');
        if (!statusEl || !selectEl) return;

        statusEl.className = 'maximus-status';
        statusEl.style.display = 'none';
        if (statusRow) statusRow.style.display = 'none';
        selectEl.innerHTML = '<option value="">Cargando voces...</option>';

        try {
            let url = '/api/maximus-odysseus/voices';
            if (dirPath) {
                url += `?path=${encodeURIComponent(dirPath)}`;
            }
            
            const res = await fetch(url);
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.detail || 'Falta voices-v1.0.bin o ruta incorrecta.');
            }
            
            const voices = await res.json();
            selectEl.innerHTML = '';
            
            if (voices.length === 0) {
                selectEl.innerHTML = '<option value="">No se encontraron voces</option>';
                return;
            }

            voices.forEach(voice => {
                const opt = document.createElement('option');
                opt.value = voice.value;
                opt.textContent = voice.label;
                if (selectedVoice && voice.value === selectedVoice) {
                    opt.selected = true;
                }
                selectEl.appendChild(opt);
            });

            statusEl.textContent = 'Directorio y voces cargadas correctamente.';
            statusEl.className = 'maximus-status success';
            statusEl.style.display = 'block';
            if (statusRow) statusRow.style.display = 'flex';
        } catch (e) {
            console.error(DEBUG_PREFIX, 'Error loading voices:', e);
            selectEl.innerHTML = '<option value="">Fallo al cargar voces</option>';
            statusEl.textContent = e.message;
            statusEl.className = 'maximus-status error';
            statusEl.style.display = 'block';
            if (statusRow) statusRow.style.display = 'flex';
        }
    }

    async function saveSettings() {
        const dirInput = document.getElementById('maximus-kokoro-dir');
        const voiceSelect = document.getElementById('maximus-voice-select');
        const whisperModel = document.getElementById('maximus-whisper-model');
        const whisperLang = document.getElementById('maximus-whisper-lang');
        const whisperGpu = document.getElementById('maximus-whisper-gpu');
        const whisperPreload = document.getElementById('maximus-whisper-preload');
        const statusEl = document.getElementById('maximus-save-status');
        if (!dirInput || !voiceSelect || !whisperModel || !whisperLang || !whisperGpu || !whisperPreload || !statusEl) return;

        statusEl.className = 'maximus-status';
        statusEl.textContent = 'Guardando...';
        statusEl.style.display = 'inline-block';

        try {
            const res = await fetch('/api/maximus-odysseus/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    kokoro_dir: dirInput.value.trim(),
                    voice: voiceSelect.value,
                    whisper_model: whisperModel.value,
                    whisper_language: whisperLang.value,
                    whisper_gpu: whisperGpu.checked,
                    whisper_preload: whisperPreload.checked
                })
            });

            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.detail || 'Fallo al guardar.');
            }

            statusEl.textContent = '¡Guardado con éxito!';
            statusEl.className = 'maximus-status success';
            setTimeout(() => { statusEl.style.display = 'none'; }, 3000);
            
            // Re-eval availability so change is picked up immediately
            if (window.aiTTSManager) {
                window.aiTTSManager.checkAvailability();
            }
        } catch (e) {
            console.error(DEBUG_PREFIX, 'Error saving settings:', e);
            statusEl.textContent = e.message;
            statusEl.className = 'maximus-status error';
        }
    }

    // ── Inject Toggle Button ──
    function injectComposerToggleButton() {
        const chatInputLeft = document.querySelector('.chat-input-left');
        if (!chatInputLeft || document.getElementById('maximus-tts-toggle-btn')) return;

        // Create speaker toggle button
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'input-icon-btn';
        btn.id = 'maximus-tts-toggle-btn';
        btn.title = 'Lectura automática (Kokoro TTS)';
        btn.setAttribute('aria-pressed', 'false');
        btn.setAttribute('data-mode-tool', 'true');
        
        // Default mute/disabled SVG
        const SVG_MUTE = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="1" y1="1" x2="23" y2="23"></line>
                <path d="M9 9v6a3 3 0 0 0 3 3h1.586l4.707 4.707A1 1 0 0 0 20 22V4a1 1 0 0 0-1.707-.707L13.586 8H12a3 3 0 0 0-3 3z"></path>
            </svg>
        `;
        
        const SVG_SPEAKER = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
            </svg>
        `;

        // Load persisted state
        const isReadAloudActive = localStorage.getItem('maximus_odysseus_read_aloud') === 'true';
        btn.innerHTML = isReadAloudActive ? SVG_SPEAKER : SVG_MUTE;
        btn.setAttribute('aria-pressed', isReadAloudActive ? 'true' : 'false');
        if (isReadAloudActive) {
            btn.classList.add('maximus-active');
        }

        // Insert after #bash-toggle-btn or plan-toggle-btn, or at the end
        const refBtn = document.getElementById('bash-toggle-btn') || document.getElementById('plan-toggle-btn');
        if (refBtn && refBtn.nextSibling) {
            chatInputLeft.insertBefore(btn, refBtn.nextSibling);
        } else {
            chatInputLeft.appendChild(btn);
        }

        // Event listener
        btn.addEventListener('click', () => {
            const active = localStorage.getItem('maximus_odysseus_read_aloud') === 'true';
            const nextState = !active;
            localStorage.setItem('maximus_odysseus_read_aloud', nextState ? 'true' : 'false');
            
            btn.innerHTML = nextState ? SVG_SPEAKER : SVG_MUTE;
            btn.setAttribute('aria-pressed', nextState ? 'true' : 'false');
            btn.classList.toggle('maximus-active', nextState);
            
            console.log(DEBUG_PREFIX, 'Autoplay toggled to', nextState);

            if (window.aiTTSManager) {
                if (nextState) {
                    window.aiTTSManager.available = true;
                    window.aiTTSManager._provider = 'local';
                    window.aiTTSManager.useBrowserTTS = false;
                    window.aiTTSManager.autoPlay = true;
                } else {
                    window.aiTTSManager.autoPlay = false;
                    window.aiTTSManager.checkAvailability();
                }
            }
        });
    }

    // ── Intercept TTS Manager ──
    function patchTTSManager() {
        if (!window.aiTTSManager) {
            // If manager not yet loaded, wait and retry
            setTimeout(patchTTSManager, 100);
            return;
        }

        console.log(DEBUG_PREFIX, 'Patching global window.aiTTSManager...');

        // 1. Patch checkAvailability
        const originalCheck = window.aiTTSManager.checkAvailability;
        window.aiTTSManager.checkAvailability = async function() {
            await originalCheck.call(this);
            if (localStorage.getItem('maximus_odysseus_read_aloud') === 'true') {
                this.available = true;
                this._provider = 'local'; // setting to local lets AITTSManager handle playspeed automatically
                this.useBrowserTTS = false;
                this.autoPlay = true;
            }
        };

        // 2. Patch synthesize
        const originalSynthesize = window.aiTTSManager.synthesize;
        window.aiTTSManager.synthesize = async function(text, onProgress) {
            if (localStorage.getItem('maximus_odysseus_read_aloud') === 'true') {
                // Determine voice
                let voice = 'em_alex';
                try {
                    const settingsRes = await fetch('/api/maximus-odysseus/settings');
                    const settings = await settingsRes.json();
                    if (settings.voice) voice = settings.voice;
                } catch (err) {
                    console.warn(DEBUG_PREFIX, 'Failed to fetch voice settings, using default em_alex', err);
                }

                const cacheKey = this.getCacheKey(text);
                if (this.cache.has(cacheKey)) {
                    return this.cache.get(cacheKey);
                }

                try {
                    if (onProgress) onProgress('synthesizing');
                    
                    const response = await fetch('/api/maximus-odysseus/synthesize', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ text, voice })
                    });

                    if (!response.ok) {
                        const err = await response.json();
                        throw new Error(err.detail || 'Fallo la síntesis en el servidor.');
                    }

                    const audioBlob = await response.blob();
                    const audioUrl = URL.createObjectURL(audioBlob);
                    
                    this.cache.set(cacheKey, audioUrl);
                    if (onProgress) onProgress('complete');
                    return audioUrl;
                } catch (e) {
                    console.error(DEBUG_PREFIX, 'Inference failed:', e);
                    if (onProgress) onProgress('error');
                    throw e;
                }
            } else {
                // Delegate to original synthesis
                return originalSynthesize.call(this, text, onProgress);
            }
        };

        // 3. Patch extractPlainText to strip completed and unclosed reasoning blocks
        const originalExtract = window.aiTTSManager.extractPlainText;
        window.aiTTSManager.extractPlainText = function(content) {
            if (!content) return "";
            if (localStorage.getItem('maximus_odysseus_read_aloud') === 'true') {
                // Strip completed think tags
                let cleaned = content.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '');
                // Strip unclosed think tags (meaning it's currently streaming reasoning)
                cleaned = cleaned.replace(/<think(?:ing)?>[\s\S]*$/gi, '');
                
                return originalExtract.call(this, cleaned);
            }
            return originalExtract.call(this, content);
        };

        // 4. Patch _processStreamingSentences to use a lower sentence length threshold (3 instead of 15) for high responsiveness
        const originalProcess = window.aiTTSManager._processStreamingSentences;
        window.aiTTSManager._processStreamingSentences = function(accumulatedText) {
            if (localStorage.getItem('maximus_odysseus_read_aloud') === 'true') {
                if (!this._streamActive) return;

                var text = accumulatedText
                    .replace(/```[\s\S]*?```/g, '')
                    .replace(/```[\s\S]*$/g, '');

                var plainText = this.extractPlainText(text);
                if (!plainText || plainText.length <= this._streamSentencesSent) return;

                var newRegion = plainText.substring(this._streamSentencesSent);

                var sentences = [];
                var current = '';
                for (var i = 0; i < newRegion.length; i++) {
                    current += newRegion[i];
                    var ch = newRegion[i];
                    var next = newRegion[i + 1];
                    if ((ch === '.' || ch === '!' || ch === '?') && next && /\s/.test(next)) {
                        var lastWord = current.trim().split(/\s/).pop() || '';
                        if (/^\d+\.$/.test(lastWord)) continue;
                        if (/^[A-Z][a-z]?\.$/.test(lastWord)) continue;
                        sentences.push(current.trim());
                        current = '';
                    }
                }

                if (sentences.length === 0) return;

                var advancedChars = 0;
                for (var j = 0; j < sentences.length; j++) {
                    var sentence = sentences[j];
                    if (sentence.length < 3) { // Lowered from 15 to 3 for fast response
                        advancedChars += sentence.length + 1;
                        continue;
                    }
                    var btn = this._streamButton || this._createPlaceholderButton();
                    var resetFn = this._streamResetFn || function() {};
                    this.enqueue(sentence, btn, resetFn);
                    advancedChars += sentence.length + 1;
                }

                this._streamSentencesSent += advancedChars;
            } else {
                originalProcess.call(this, accumulatedText);
            }
        };

        // 5. Patch streamingEnd to use a lower threshold (3 instead of 15) so final short sentences are read
        const originalEnd = window.aiTTSManager.streamingEnd;
        window.aiTTSManager.streamingEnd = function(finalText) {
            if (localStorage.getItem('maximus_odysseus_read_aloud') === 'true') {
                if (!this._streamActive) return;
                this._streamActive = false;
                if (this._streamDebounceTimer) {
                    clearTimeout(this._streamDebounceTimer);
                    this._streamDebounceTimer = null;
                }

                var text = finalText
                    .replace(/```[\s\S]*?```/g, '')
                    .replace(/```[\s\S]*$/g, '');

                var plainText = this.extractPlainText(text);
                if (!plainText) return;

                var remaining = plainText.substring(this._streamSentencesSent).trim();
                if (remaining.length >= 3) { // Lowered from 15 to 3 for final short sentence reading
                    var btn = this._streamButton || this._createPlaceholderButton();
                    var resetFn = this._streamResetFn || function() {};
                    this.enqueue(remaining, btn, resetFn);
                }
                this._streamSentencesSent = 0;
            } else {
                originalEnd.call(this, finalText);
            }
        };

        // 6. Patch enqueue to trigger pre-synthesis in the background immediately
        const originalEnqueue = window.aiTTSManager.enqueue;
        window.aiTTSManager.enqueue = function(text, button, resetFn) {
            if (localStorage.getItem('maximus_odysseus_read_aloud') === 'true') {
                const item = { text, button, resetFn, audioUrlPromise: null };
                
                // Pre-fetch/pre-synthesize the sentence in the background
                item.audioUrlPromise = this.synthesize(text).catch(err => {
                    console.error(DEBUG_PREFIX, 'Pre-synthesis failed for:', text, err);
                    return null;
                });
                
                this._queue.push(item);
                if (!this._processing) {
                    this._processQueue();
                }
            } else {
                originalEnqueue.call(this, text, button, resetFn);
            }
        };

        // 7. Patch _playQueueItem to await the pre-synthesized audio URL
        const originalPlayQueueItem = window.aiTTSManager._playQueueItem;
        window.aiTTSManager._playQueueItem = async function(item) {
            if (localStorage.getItem('maximus_odysseus_read_aloud') === 'true' && item.audioUrlPromise) {
                const { text, button, resetFn } = item;
                const ICON_LOADING = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="9" stroke-dasharray="42" stroke-dashoffset="12" stroke-linecap="round"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite"/></circle></svg>';
                var ICON_STOP = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="5" y="5" width="14" height="14" rx="2"/></svg>';

                button.innerHTML = ICON_LOADING;
                button.classList.add('loading');
                button.style.color = '#ccc';
                button.title = 'Loading...';

                try {
                    if (!this._processing) return;

                    // Await the background pre-synthesis promise
                    const audioUrl = await item.audioUrlPromise;

                    if (!this._processing) return;
                    if (!audioUrl) throw new Error("Synthesis failed");

                    button.innerHTML = ICON_STOP;
                    button.classList.remove('loading');
                    button.classList.add('playing');
                    button.title = 'Stop';

                    if (this.useBrowserTTS) {
                        const plainText = this.extractPlainText(text);
                        await this._playBrowser(plainText);
                    } else {
                        if (this.currentAudio) {
                            this.currentAudio.pause();
                            this.currentAudio = null;
                        }

                        await new Promise((resolve, reject) => {
                            const audio = new Audio(audioUrl);
                            if (this._provider === 'local' && this.playbackSpeed !== 1) {
                                audio.playbackRate = this.playbackSpeed;
                            }
                            this.currentAudio = audio;
                            audio.onended = () => {
                                this.isPlaying = false;
                                if (this.currentAudio === audio) this.currentAudio = null;
                                resolve();
                            };
                            audio.onerror = (e) => {
                                this.isPlaying = false;
                                if (this.currentAudio === audio) this.currentAudio = null;
                                reject(new Error('Audio playback error'));
                            };
                            audio.onpause = () => {
                                if (this.currentAudio !== audio) {
                                    resolve();
                                }
                            };
                            audio.play().then(() => {
                                this.isPlaying = true;
                            }).catch(reject);
                        });
                    }
                } catch (e) {
                    console.error(DEBUG_PREFIX, 'Play queue item error:', e);
                } finally {
                    if (resetFn) resetFn();
                }
            } else {
                return originalPlayQueueItem.call(this, item);
            }
        };

        // Run availability check immediately to set proper state
        window.aiTTSManager.checkAvailability();
    }

    // ── Inject Composer Microphone Button (STT) ──
    function injectComposerMicButton() {
        const chatInputLeft = document.querySelector('.chat-input-left');
        if (!chatInputLeft || document.getElementById('maximus-mic-toggle-btn')) return;

        // Create mic button
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'input-icon-btn';
        btn.id = 'maximus-mic-toggle-btn';
        btn.title = 'Dictar texto (Whisper)';
        btn.setAttribute('aria-pressed', 'false');
        btn.setAttribute('data-mode-tool', 'true');
        
        const SVG_MIC = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path>
                <path d="M19 10v1a7 7 0 0 1-14 0v-1"></path>
                <line x1="12" y1="19" x2="12" y2="22"></line>
            </svg>
        `;
        btn.innerHTML = SVG_MIC;

        // Insert right after #maximus-tts-toggle-btn or #bash-toggle-btn, or at the end
        const refBtn = document.getElementById('maximus-tts-toggle-btn') || document.getElementById('bash-toggle-btn');
        if (refBtn && refBtn.nextSibling) {
            chatInputLeft.insertBefore(btn, refBtn.nextSibling);
        } else {
            chatInputLeft.appendChild(btn);
        }

        let mediaRecorder = null;
        let audioChunks = [];
        let isRecording = false;

        btn.addEventListener('click', async () => {
            if (isRecording) {
                // Stop recording
                if (mediaRecorder && mediaRecorder.state === 'recording') {
                    mediaRecorder.stop();
                }
            } else {
                // Check secure context
                if (!window.isSecureContext) {
                    showToast('El dictado por voz requiere un contexto seguro (HTTPS o localhost).');
                    return;
                }

                if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                    showToast('Tu navegador no soporta el acceso al micrófono.');
                    return;
                }

                try {
                    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                    audioChunks = [];
                    mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
                    
                    mediaRecorder.ondataavailable = (event) => {
                        if (event.data.size > 0) {
                            audioChunks.push(event.data);
                        }
                    };

                    mediaRecorder.onstop = async () => {
                        // Stop all mic tracks
                        stream.getTracks().forEach(track => track.stop());

                        // Set transcribing state
                        btn.classList.remove('maximus-recording');
                        btn.classList.add('maximus-loading');
                        btn.disabled = true;
                        btn.innerHTML = `<svg class="maximus-loading-spinner" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg>`;
                        showToast('Transcribiendo audio...', 4000);

                        try {
                            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                            const formData = new FormData();
                            formData.append('file', audioBlob, 'audio.webm');

                            const res = await fetch('/api/stt/transcribe', {
                                method: 'POST',
                                body: formData
                            });

                            if (!res.ok) {
                                const err = await res.json().catch(() => ({}));
                                throw new Error(err.detail?.message || 'Error en la transcripción');
                            }

                            const data = await res.json();
                            if (data.text && data.text.trim()) {
                                insertTextAtCursor(data.text.trim());
                                showToast('Dictado finalizado');
                            } else {
                                showToast('No se detectó voz hablada');
                            }
                        } catch (err) {
                            console.error(DEBUG_PREFIX, 'Whisper transcription failed:', err);
                            showToast('Fallo la transcripción: ' + err.message);
                        } finally {
                            btn.classList.remove('maximus-loading');
                            btn.disabled = false;
                            btn.innerHTML = SVG_MIC;
                            isRecording = false;
                        }
                    };

                    mediaRecorder.start();
                    isRecording = true;
                    btn.classList.add('maximus-recording');
                    showToast('Escuchando... pulsa de nuevo para transcribir');
                } catch (err) {
                    console.error(DEBUG_PREFIX, 'Microphone start error:', err);
                    if (err.name === 'NotAllowedError') {
                        showToast('Permiso de micrófono denegado');
                    } else {
                        showToast('Error de micrófono: ' + err.message);
                    }
                    isRecording = false;
                }
            }
        });
    }

    // ── Helper to insert text at the cursor position in composer input ──
    function insertTextAtCursor(text) {
        const input = document.getElementById('message');
        if (!input) return;

        const start = input.selectionStart;
        const end = input.selectionEnd;
        const currentText = input.value;

        // Insert spacing around if needed
        const preSpace = (start > 0 && currentText[start - 1] !== ' ') ? ' ' : '';
        const postSpace = (end < currentText.length && currentText[end] !== ' ') ? ' ' : '';
        const insertText = preSpace + text + postSpace;

        input.value = currentText.substring(0, start) + insertText + currentText.substring(end);

        // Position cursor right after the inserted text
        const newPos = start + insertText.length;
        input.selectionStart = input.selectionEnd = newPos;

        // Trigger resize and other listeners
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.focus();
    }

    // ── Toast notification helper ──
    function showToast(msg, duration = 3000) {
        const toastEl = document.getElementById('toast');
        if (!toastEl) return;
        
        toastEl.textContent = msg;
        toastEl.classList.remove('error', 'exiting');
        toastEl.classList.add('show');
        
        clearTimeout(toastEl._hideTimer);
        toastEl._hideTimer = setTimeout(() => {
            toastEl.classList.add('exiting');
            toastEl.classList.remove('show');
        }, duration);
    }
})();
