import os
import re
import io
import json
import logging
import threading
import numpy as np
import soundfile as sf
from typing import Dict, List, Optional, Any
from kokoro_onnx import Kokoro
from src.constants import DATA_DIR

logger = logging.getLogger(__name__)

# Default settings
DEFAULT_KOKORO_SETTINGS = {
    "kokoro_dir": "/home/maximo/Código/maximus-odysseus/kokoro-v1.0",
    "voice": "em_alex",
    "whisper_model": "base",
    "whisper_language": "",
    "whisper_gpu": True,
    "whisper_preload": False
}



SETTINGS_FILE = os.path.join(DATA_DIR, "maximus_odysseus_settings.json")

# Lazy-loaded pipeline cache
_kokoro_pipeline = None
_current_kokoro_dir = None
_pipeline_lock = threading.Lock()

# Language prefix description mapping
LANGUAGE_MAP = {
    "af": "English (US) - Female",
    "am": "English (US) - Male",
    "bf": "English (UK) - Female",
    "bm": "English (UK) - Male",
    "ef": "Spanish - Female",
    "em": "Spanish - Male",
    "ff": "French - Female",
    "hf": "Hindi - Female",
    "hm": "Hindi - Male",
    "if": "Italian - Female",
    "im": "Italian - Male",
    "jf": "Japanese - Female",
    "jm": "Japanese - Male",
    "pf": "Portuguese - Female",
    "pm": "Portuguese - Male",
    "zf": "Chinese (Mandarin) - Female",
    "zm": "Chinese (Mandarin) - Male"
}

def clean_text_for_tts(text: str) -> str:
    """Clean markdown, HTML, reasoning blocks and emojis from text for clean speech synthesis."""
    if not text:
        return ""
    
    # 1. Remove reasoning blocks <think>...</think> and unclosed <think>... at the end
    text = re.sub(r'<think(?:ing)?>[\s\S]*?</think(?:ing)?>', '', text, flags=re.IGNORECASE)
    text = re.sub(r'<think(?:ing)?>[\s\S]*$', '', text, flags=re.IGNORECASE)
    
    # 2. Remove HTML tags
    text = re.sub(r'<[^>]+>', '', text)
    
    # 3. Remove markdown images ![alt](url) before removing links
    text = re.sub(r'!\[[^\]]*\]\([^)]+\)', '', text)
    
    # 4. Replace markdown links [text](url) with just the text
    text = re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1', text)
    
    # 5. Remove code blocks
    text = re.sub(r'```[\s\S]*?```', '', text)
    
    # 6. Remove inline code backticks
    text = re.sub(r'`([^`]+)`', r'\1', text)
    
    # 7. Remove header tags (#)
    text = re.sub(r'#+\s+', '', text)
    
    # 8. Remove bold/italic markers (* and _)
    text = text.replace('*', '').replace('_', '')
    
    # 9. Remove lists and blockquote characters at the start of lines
    text = re.sub(r'^\s*[-+*]\s+', '', text, flags=re.MULTILINE)
    text = re.sub(r'^\s*\d+\.\s+', '', text, flags=re.MULTILINE)
    text = re.sub(r'^\s*>\s*', '', text, flags=re.MULTILINE)
    
    # 10. Remove emojis and specific dingbats/technical symbols
    emoji_pattern = re.compile(
        '['
        '\U00010000-\U0010ffff'  # Emoji blocks
        '\u2600-\u27BF'          # Miscellaneous Symbols and Dingbats
        '\u2300-\u23FF'          # Miscellaneous Technical
        '\u2B50'                 # Star
        '\u2934-\u2935'          # Curved arrows
        ']+', flags=re.UNICODE
    )
    text = emoji_pattern.sub('', text)
    
    # 11. Normalize white space
    text = re.sub(r'[ \t]+', ' ', text)
    text = re.sub(r'\n{2,}', '\n', text)
    
    return text.strip()

def infer_lang_from_voice(voice: str) -> str:
    """Map the voice prefix to a Kokoro language code."""
    prefix = voice[:2].lower()
    mapping = {
        "af": "en-us",
        "am": "en-us",
        "bf": "en-gb",
        "bm": "en-gb",
        "ef": "es",
        "em": "es",
        "ff": "fr",
        "hf": "hi",
        "hm": "hi",
        "if": "it",
        "im": "it",
        "jf": "ja",
        "jm": "ja",
        "pf": "pt",
        "pm": "pt",
        "zf": "zh",
        "zm": "zh"
    }
    return mapping.get(prefix, "en-us")

def get_maximus_odysseus_settings() -> Dict[str, Any]:
    """Retrieve settings from data/maximus_odysseus_settings.json."""
    if not os.path.exists(SETTINGS_FILE):
        return dict(DEFAULT_KOKORO_SETTINGS)
    try:
        with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
            saved = json.load(f)
            return {**DEFAULT_KOKORO_SETTINGS, **saved}
    except Exception as e:
        logger.error(f"Error loading maximus-odysseus settings: {e}")
        return dict(DEFAULT_KOKORO_SETTINGS)

def save_maximus_odysseus_settings(settings: Dict[str, Any]) -> None:
    """Persist settings to data/maximus_odysseus_settings.json."""
    try:
        os.makedirs(os.path.dirname(SETTINGS_FILE), exist_ok=True)
        # Check if kokoro_dir changed to invalidate the cached model
        old_settings = get_maximus_odysseus_settings()
        if old_settings.get("kokoro_dir") != settings.get("kokoro_dir"):
            invalidate_kokoro_pipeline()
            
        with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
            json.dump(settings, f, indent=2)
    except Exception as e:
        logger.error(f"Error saving maximus-odysseus settings: {e}")
        raise e

def invalidate_kokoro_pipeline() -> None:
    """Reset the cached model and configuration."""
    global _kokoro_pipeline, _current_kokoro_dir
    with _pipeline_lock:
        _kokoro_pipeline = None
        _current_kokoro_dir = None
        logger.info("Kokoro ONNX pipeline cache invalidated")

def get_kokoro_pipeline(kokoro_dir: str) -> Kokoro:
    """Instantiate and return the Kokoro ONNX pipeline with caching and thread safety."""
    global _kokoro_pipeline, _current_kokoro_dir
    
    model_path = os.path.join(kokoro_dir, "kokoro-v1.0.onnx")
    voices_path = os.path.join(kokoro_dir, "voices-v1.0.bin")
    
    if not os.path.exists(model_path) or not os.path.exists(voices_path):
        raise FileNotFoundError(f"Model file or voices binary not found in {kokoro_dir}")
        
    with _pipeline_lock:
        if _kokoro_pipeline is None or _current_kokoro_dir != kokoro_dir:
            logger.info(f"Loading Kokoro ONNX model from {model_path}...")
            _kokoro_pipeline = Kokoro(model_path, voices_path)
            _current_kokoro_dir = kokoro_dir
        return _kokoro_pipeline

def get_kokoro_voices(kokoro_dir: str) -> List[Dict[str, str]]:
    """Retrieve available voices from the specified path and map to languages."""
    voices_path = os.path.join(kokoro_dir, "voices-v1.0.bin")
    if not os.path.exists(voices_path):
        raise FileNotFoundError(f"Voices binary voices-v1.0.bin not found in {kokoro_dir}")
        
    try:
        data = np.load(voices_path)
        voices = []
        for key in sorted(data.keys()):
            prefix = key[:2].lower()
            lang_label = LANGUAGE_MAP.get(prefix, "Unknown Accent/Language")
            voices.append({
                "value": key,
                "label": f"{key} ({lang_label})"
            })
        return voices
    except Exception as e:
        logger.error(f"Failed to read voices file: {e}")
        raise e

def synthesize_speech(text: str, voice: str) -> Optional[bytes]:
    """Clean text and run local Kokoro ONNX synthesis, returning WAV bytes."""
    cleaned_text = clean_text_for_tts(text)
    if not cleaned_text:
        logger.warning("Synthesis skipped: text is empty after cleaning")
        return None
        
    settings = get_maximus_odysseus_settings()
    kokoro_dir = settings.get("kokoro_dir")
    
    if not kokoro_dir:
        logger.error("Synthesis failed: kokoro_dir settings is not configured")
        return None
        
    pipeline = get_kokoro_pipeline(kokoro_dir)
    lang = infer_lang_from_voice(voice)
    
    # Run thread-safe inference
    with _pipeline_lock:
        logger.info(f"Synthesizing '{cleaned_text[:50]}...' with voice {voice} (lang: {lang})")
        samples, sample_rate = pipeline.create(
            cleaned_text,
            voice=voice,
            speed=1.0,
            lang=lang
        )
        
    # Convert numpy samples to WAV bytes
    buf = io.BytesIO()
    sf.write(buf, samples, sample_rate, format='WAV', subtype='PCM_16')
    return buf.getvalue()
