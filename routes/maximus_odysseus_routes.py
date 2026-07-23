import os
import logging
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel
from services.maximus_odysseus_tts import (
    get_maximus_odysseus_settings,
    save_maximus_odysseus_settings,
    get_kokoro_voices,
    synthesize_speech
)

logger = logging.getLogger(__name__)

class SettingsRequest(BaseModel):
    kokoro_dir: str
    voice: str
    stt_engine: str = "whisper"
    stt_model: str = "canary-180m-flash"
    whisper_model: str
    whisper_language: str
    whisper_gpu: bool = True
    whisper_preload: bool = False

class SynthesizeRequest(BaseModel):
    text: str
    voice: str

def setup_maximus_odysseus_routes():
    """Setup Maximus Odysseus custom API routes"""
    router = APIRouter(prefix="/api/maximus-odysseus", tags=["maximus-odysseus"])

    @router.get("/settings")
    async def get_settings_route():
        """Retrieve custom Maximus Odysseus settings"""
        try:
            return get_maximus_odysseus_settings()
        except Exception as e:
            logger.error(f"Failed to get custom settings: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    @router.post("/settings")
    async def save_settings_route(request: SettingsRequest):
        """Save custom Maximus Odysseus settings, with path validation"""
        try:
            kokoro_dir = request.kokoro_dir.strip()
            voice = request.voice.strip()
            stt_engine = request.stt_engine.strip() if request.stt_engine else "whisper"
            stt_model = request.stt_model.strip() if request.stt_model else "canary-180m-flash"
            whisper_model = request.whisper_model.strip()
            whisper_language = request.whisper_language.strip()
            whisper_gpu = request.whisper_gpu
            whisper_preload = request.whisper_preload
            
            # Validation
            if not kokoro_dir:
                raise HTTPException(status_code=400, detail="Kokoro directory cannot be empty.")
            if not os.path.exists(kokoro_dir):
                raise HTTPException(status_code=400, detail=f"The specified directory does not exist: {kokoro_dir}")
                
            model_path = os.path.join(kokoro_dir, "kokoro-v1.0.onnx")
            voices_path = os.path.join(kokoro_dir, "voices-v1.0.bin")
            if not os.path.exists(model_path) or not os.path.exists(voices_path):
                raise HTTPException(
                    status_code=400, 
                    detail="The directory must contain the files 'kokoro-v1.0.onnx' and 'voices-v1.0.bin'."
                )
                
            old_settings = get_maximus_odysseus_settings()
            
            # Invalidate cached models if engine, model size, GPU acceleration or language changed
            if (old_settings.get("stt_engine") != stt_engine or 
                old_settings.get("stt_model") != stt_model or
                old_settings.get("whisper_model") != whisper_model or 
                old_settings.get("whisper_language") != whisper_language or 
                old_settings.get("whisper_gpu") != whisper_gpu):
                try:
                    from services.stt import get_stt_service
                    stt = get_stt_service()
                    stt.invalidate_models()
                except Exception as ex:
                    logger.warning(f"Could not invalidate model cache: {ex}")

            save_maximus_odysseus_settings({
                "kokoro_dir": kokoro_dir,
                "voice": voice,
                "stt_engine": stt_engine,
                "stt_model": stt_model,
                "whisper_model": whisper_model,
                "whisper_language": whisper_language,
                "whisper_gpu": whisper_gpu,
                "whisper_preload": whisper_preload
            })
            return {"success": True, "message": "Settings saved successfully."}
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Failed to save settings: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    @router.get("/voices")
    async def list_voices_route(path: str = Query(None)):
        """Retrieve available voices from the specified path or current settings"""
        try:
            if not path:
                settings = get_maximus_odysseus_settings()
                path = settings.get("kokoro_dir")
                
            if not path or not os.path.exists(path):
                raise HTTPException(status_code=400, detail="The configured directory does not exist.")
                
            voices_file = os.path.join(path, "voices-v1.0.bin")
            if not os.path.exists(voices_file):
                raise HTTPException(
                    status_code=400, 
                    detail="The 'voices-v1.0.bin' file was not found in the specified directory."
                )
                
            return get_kokoro_voices(path)
        except HTTPException:
            raise
        except FileNotFoundError as e:
            raise HTTPException(status_code=400, detail=str(e))
        except Exception as e:
            logger.error(f"Failed to list voices: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    @router.post("/synthesize")
    async def synthesize_speech_route(request: SynthesizeRequest):
        """Synthesize clean text using Kokoro ONNX and return WAV stream"""
        try:
            if not request.text.strip():
                raise HTTPException(status_code=400, detail="The text to synthesize cannot be empty.")
            if not request.voice.strip():
                raise HTTPException(status_code=400, detail="A voice must be specified.")
                
            # Perform synthesis
            wav_bytes = synthesize_speech(request.text, request.voice)
            if not wav_bytes:
                raise HTTPException(
                    status_code=500,
                    detail="Audio synthesis failed (the clean text became empty or the model is not loaded)."
                )
                
            return Response(
                content=wav_bytes,
                media_type="audio/wav",
                headers={
                    "Content-Disposition": "inline; filename=speech.wav"
                }
            )
        except HTTPException:
            raise
        except FileNotFoundError as e:
            raise HTTPException(status_code=400, detail=f"Error loading model: {str(e)}")
        except Exception as e:
            logger.error(f"Synthesis error: {e}", exc_info=True)
            raise HTTPException(status_code=500, detail=f"Error during synthesis: {str(e)}")

    return router
