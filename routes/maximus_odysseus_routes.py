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
            whisper_model = request.whisper_model.strip()
            whisper_language = request.whisper_language.strip()
            whisper_gpu = request.whisper_gpu
            whisper_preload = request.whisper_preload
            
            # Validation
            if not kokoro_dir:
                raise HTTPException(status_code=400, detail="El directorio de Kokoro no puede estar vacío.")
            if not os.path.exists(kokoro_dir):
                raise HTTPException(status_code=400, detail=f"El directorio especificado no existe: {kokoro_dir}")
                
            model_path = os.path.join(kokoro_dir, "kokoro-v1.0.onnx")
            voices_path = os.path.join(kokoro_dir, "voices-v1.0.bin")
            if not os.path.exists(model_path) or not os.path.exists(voices_path):
                raise HTTPException(
                    status_code=400, 
                    detail="El directorio debe contener los archivos 'kokoro-v1.0.onnx' y 'voices-v1.0.bin'."
                )
                
            old_settings = get_maximus_odysseus_settings()
            
            # Invalidate cached Whisper model if model size or GPU acceleration changed
            if old_settings.get("whisper_model") != whisper_model or old_settings.get("whisper_gpu") != whisper_gpu:
                try:
                    from services.stt import get_stt_service
                    stt = get_stt_service()
                    stt.invalidate_whisper_model()
                except Exception as ex:
                    logger.warning(f"Could not invalidate whisper model cache: {ex}")

            save_maximus_odysseus_settings({
                "kokoro_dir": kokoro_dir,
                "voice": voice,
                "whisper_model": whisper_model,
                "whisper_language": whisper_language,
                "whisper_gpu": whisper_gpu,
                "whisper_preload": whisper_preload
            })
            return {"success": True, "message": "Configuración guardada correctamente."}
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
                raise HTTPException(status_code=400, detail="El directorio configurado no existe.")
                
            voices_file = os.path.join(path, "voices-v1.0.bin")
            if not os.path.exists(voices_file):
                raise HTTPException(
                    status_code=400, 
                    detail="No se encontró el archivo 'voices-v1.0.bin' en el directorio especificado."
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
                raise HTTPException(status_code=400, detail="El texto a sintetizar no puede estar vacío.")
            if not request.voice.strip():
                raise HTTPException(status_code=400, detail="Se debe especificar una voz.")
                
            # Perform synthesis
            wav_bytes = synthesize_speech(request.text, request.voice)
            if not wav_bytes:
                raise HTTPException(
                    status_code=500,
                    detail="Falló la síntesis de audio (el texto resultante tras la limpieza quedó vacío o el modelo no está cargado)."
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
            raise HTTPException(status_code=400, detail=f"Error al cargar el modelo: {str(e)}")
        except Exception as e:
            logger.error(f"Synthesis error: {e}", exc_info=True)
            raise HTTPException(status_code=500, detail=f"Error durante la síntesis: {str(e)}")

    return router
