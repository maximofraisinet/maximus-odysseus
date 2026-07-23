# services/stt/stt_service.py
"""Multi-provider Speech-to-Text service — dispatches to local Whisper, Canary (via sherpa-onnx), OpenAI-compatible API, or browser."""

import io
import logging
import httpx
import tempfile
import threading
from pathlib import Path
from typing import Optional, Dict, Any

from services.stt.downloader import download_model, is_model_downloaded, get_model_path
from services.stt.audio_decoder import decode_audio_to_pcm

logger = logging.getLogger(__name__)


class STTService:
    """Multi-provider STT service.

    Reads provider config from data/settings.json and Maximus settings.
    Providers/Engines:
      "disabled"        — no STT
      "browser"         — client-side Web Speech API
      "whisper" / local — faster-whisper on CPU/GPU
      "canary"          — sherpa-onnx NeMo Canary model
      "endpoint:<id>"   — OpenAI-compatible /audio/transcriptions via ModelEndpoint
    """

    def __init__(self):
        self._whisper_model = None  # lazy-init faster-whisper
        self._sherpa_model = None   # lazy-init sherpa-onnx (Canary)
        self._sherpa_model_id = None
        self._lock = threading.Lock()

    # ── Settings ──

    def _load_settings(self, for_stats: bool = False) -> dict:
        from src.settings import load_settings
        saved = load_settings()
        
        stt_enabled = saved.get("stt_enabled", False)
        stt_provider = saved.get("stt_provider", "disabled")
        stt_model = saved.get("stt_model", "base")
        stt_language = saved.get("stt_language", "")
        
        # Load Maximus settings
        from services.maximus_odysseus_tts import get_maximus_odysseus_settings
        stt_engine = "whisper"
        try:
            maximus = get_maximus_odysseus_settings()
            stt_engine = maximus.get("stt_engine", "whisper")
            stt_model_val = maximus.get("stt_model", "canary-180m-flash")
            whisper_model = maximus.get("whisper_model", "base")
            whisper_gpu = maximus.get("whisper_gpu", True)
            whisper_preload = maximus.get("whisper_preload", False)
        except Exception:
            stt_engine = "whisper"
            stt_model_val = "canary-180m-flash"
            whisper_model = "base"
            whisper_gpu = True
            whisper_preload = False
        
        if not for_stats:
            try:
                stt_enabled = True
                if stt_engine == "whisper":
                    stt_provider = "local"
                    stt_model = whisper_model
                else:
                    stt_provider = stt_engine  # "canary"
                    stt_model = stt_model_val
                stt_language = maximus.get("whisper_language", "")
            except Exception:
                pass
                
        return {
            "stt_enabled": stt_enabled,
            "stt_provider": stt_provider,
            "stt_model": stt_model,
            "stt_language": stt_language,
            "whisper_gpu": whisper_gpu,
            "whisper_preload": whisper_preload,
            "stt_engine": stt_engine,
        }

    @property
    def available(self) -> bool:
        settings = self._load_settings()
        if settings.get("stt_enabled") is False:
            return False
        provider = settings["stt_provider"]
        if provider == "disabled":
            return False
        if provider == "browser":
            return True  # handled client-side
        if provider == "local":
            preload = settings.get("whisper_preload", False)
            if not preload:
                try:
                    from faster_whisper import WhisperModel
                    return True
                except Exception:
                    return False
            return self._get_whisper() is not None
        if provider == "canary":
            try:
                import sherpa_onnx
                return True
            except ImportError:
                return False
        if provider.startswith("endpoint:"):
            return True  # assume reachable
        return False

    # ── Local Whisper ──

    def _get_whisper(self):
        if self._whisper_model is None:
            try:
                from faster_whisper import WhisperModel
                settings = self._load_settings()
                model_name = settings["stt_model"]
                use_gpu = settings.get("whisper_gpu", True)
                device = "cuda" if use_gpu else "cpu"
                compute_type = "float16" if use_gpu else "int8"
                logger.info(f"Loading Whisper model '{model_name}' on device '{device}' ({compute_type})...")
                
                try:
                    self._whisper_model = WhisperModel(model_name, device=device, compute_type=compute_type)
                except Exception as cuda_err:
                    if device == "cuda":
                        logger.warning(f"Failed to load Whisper on CUDA ({cuda_err}). Falling back to CPU...")
                        self._whisper_model = WhisperModel(model_name, device="cpu", compute_type="int8")
                    else:
                        raise cuda_err
                        
                logger.info(f"Whisper model '{model_name}' loaded successfully.")
            except Exception as e:
                logger.error(f"Failed to load whisper model: {e}")
                self._whisper_model = None
        return self._whisper_model

    def _transcribe_local(self, audio_bytes: bytes, language: str = "") -> Optional[str]:
        model = self._get_whisper()
        if not model:
            return None
        with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as tmp:
            tmp.write(audio_bytes)
            tmp_path = tmp.name
        try:
            kwargs = {}
            if language:
                kwargs["language"] = language
            segments, _ = model.transcribe(tmp_path, **kwargs)
            text = " ".join(s.text.strip() for s in segments)
            return text.strip()
        except Exception as e:
            logger.error(f"Local whisper transcription failed: {e}")
            return None
        finally:
            Path(tmp_path).unlink(missing_ok=True)

    # ── Sherpa-ONNX (Canary Engine) ──

    def _get_sherpa_recognizer(self, engine_type: str, model_id: str):
        with self._lock:
            if self._sherpa_model is None or self._sherpa_model_id != model_id:
                try:
                    import sherpa_onnx
                except ImportError:
                    logger.error("sherpa-onnx is not installed. Install with: pip install sherpa-onnx")
                    return None
                
                if not is_model_downloaded(model_id):
                    logger.info(f"Model '{model_id}' not found locally. Starting download...")
                    success = download_model(model_id)
                    if not success:
                        logger.error(f"Failed to download ASR model: {model_id}")
                        return None
                
                model_dir = get_model_path(model_id)
                logger.info(f"Loading sherpa-onnx model '{model_id}' from {model_dir}...")
                
                try:
                    if model_id == "canary-180m-flash":
                        settings = self._load_settings()
                        lang = settings.get("stt_language", "es")
                        if not lang or lang not in ("en", "de", "es", "fr"):
                            lang = "es"
                            
                        encoder_file = model_dir / "encoder.onnx"
                        if not encoder_file.exists():
                            encoder_file = model_dir / "encoder.int8.onnx"
                            
                        decoder_file = model_dir / "decoder.onnx"
                        if not decoder_file.exists():
                            decoder_file = model_dir / "decoder.int8.onnx"
                            
                        logger.info(f"Loading Canary model with language '{lang}' (encoder: {encoder_file.name}, decoder: {decoder_file.name})")
                        self._sherpa_model = sherpa_onnx.OfflineRecognizer.from_nemo_canary(
                            encoder=str(encoder_file),
                            decoder=str(decoder_file),
                            tokens=str(model_dir / "tokens.txt"),
                            src_lang=lang,
                            tgt_lang=lang,
                            num_threads=4,
                            provider="cpu"
                        )
                    else:
                        logger.error(f"Unsupported sherpa-onnx model ID: {model_id}")
                        return None
                        
                    self._sherpa_model_id = model_id
                    logger.info(f"sherpa-onnx model '{model_id}' loaded successfully")
                except Exception as e:
                    logger.error(f"Failed to load sherpa-onnx model '{model_id}': {e}", exc_info=True)
                    return None
            return self._sherpa_model

    def _transcribe_sherpa(self, audio_bytes: bytes, engine_type: str, model_id: str) -> Optional[str]:
        recognizer = self._get_sherpa_recognizer(engine_type, model_id)
        if not recognizer:
            return None
            
        try:
            pcm_samples = decode_audio_to_pcm(audio_bytes)
            if len(pcm_samples) == 0:
                logger.warning("Decoded PCM audio sample vector is empty")
                return ""
                
            stream = recognizer.create_stream()
            stream.accept_waveform(16000, pcm_samples)
            recognizer.decode_stream(stream)
            
            text = stream.result.text.strip()
            logger.info(f"sherpa-onnx ({model_id}) STT: {len(text)} chars")
            return text
        except Exception as e:
            logger.error(f"sherpa-onnx transcription error: {e}", exc_info=True)
            return None

    # ── Remote OpenAI-compatible API ──

    def _transcribe_api(self, audio_bytes: bytes, endpoint_id: str, model: str, language: str = "") -> Optional[str]:
        from src.endpoints import endpoint_manager
        ep = endpoint_manager.get_endpoint(endpoint_id)
        if not ep or not ep.enabled:
            logger.error(f"Endpoint '{endpoint_id}' not found or disabled.")
            return None

        url = ep.url.rstrip("/") + "/audio/transcriptions"
        headers = {}
        if ep.api_key:
            headers["Authorization"] = f"Bearer {ep.api_key}"

        data = {"model": model or "whisper-1"}
        if language:
            data["language"] = language

        files = {"file": ("speech.webm", audio_bytes, "audio/webm")}

        try:
            with httpx.Client(timeout=60.0) as client:
                resp = client.post(url, headers=headers, data=data, files=files)
                resp.raise_for_status()
                result = resp.json()
                return result.get("text", "").strip()
        except Exception as e:
            logger.error(f"API transcription failed: {e}")
            return None

    # ── Main Entrypoint ──

    def transcribe(self, audio_bytes: bytes, filename: str = "speech.webm") -> Optional[str]:
        settings = self._load_settings()
        provider = settings["stt_provider"]
        model = settings["stt_model"]
        language = settings["stt_language"]
        
        logger.info(f"ASR Request - Provider: {provider}, Model: {model}")

        if provider in ("disabled", "browser"):
            return None

        if provider == "local":
            return self._transcribe_local(audio_bytes, language)
        elif provider == "canary":
            return self._transcribe_sherpa(audio_bytes, provider, model)
        elif provider.startswith("endpoint:"):
            endpoint_id = provider.split(":", 1)[1]
            return self._transcribe_api(audio_bytes, endpoint_id, model, language)
        else:
            logger.error(f"Unknown STT provider: {provider}")
            return None

    def get_stats(self) -> Dict[str, Any]:
        settings = self._load_settings(for_stats=True)
        provider = settings["stt_provider"]
        stt_enabled = settings.get("stt_enabled", False)
        stt_engine = settings.get("stt_engine", "whisper")
        
        effective_provider = provider if stt_enabled else "disabled"
        if stt_enabled and stt_engine != "whisper":
            effective_provider = stt_engine

        stats = {
            "available": self.available and stt_enabled,
            "provider": effective_provider,
            "model": settings["stt_model"],
            "language": settings.get("stt_language", ""),
            "stt_engine": stt_engine,
        }

        if stt_engine == "whisper":
            preload = settings.get("whisper_preload", False)
            if preload:
                whisper = self._get_whisper()
                stats["model_loaded"] = whisper is not None
            else:
                stats["model_loaded"] = self._whisper_model is not None
        elif stt_engine == "canary":
            stats["model_loaded"] = (self._sherpa_model is not None and self._sherpa_model_id == settings["stt_model"])
            stats["model_downloaded"] = is_model_downloaded(settings["stt_model"])
        elif provider == "browser":
            stats["model"] = "Browser (Web Speech API)"
        elif provider.startswith("endpoint:"):
            stats["endpoint_id"] = provider.split(":", 1)[1]

        return stats

    def invalidate_models(self) -> None:
        """Reset all cached local models (Whisper and Canary)."""
        with self._lock:
            self._whisper_model = None
            self._sherpa_model = None
            self._sherpa_model_id = None
            logger.info("Local STT models cache invalidated")

    def invalidate_whisper_model(self) -> None:
        """Compatibility alias for invalidate_models."""
        self.invalidate_models()


# Module-level singleton
_stt_service = None

def get_stt_service() -> STTService:
    global _stt_service
    if _stt_service is None:
        _stt_service = STTService()
    return _stt_service
