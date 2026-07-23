import os
import tarfile
import logging
import urllib.request
from pathlib import Path

logger = logging.getLogger(__name__)

MODELS_DIR = Path("data/models/stt")

MODEL_URLS = {
    "canary-180m-flash": "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-canary-180m-flash-en-es-de-fr-int8.tar.bz2",
}

ARCHIVE_DIRS = {
    "canary-180m-flash": "sherpa-onnx-nemo-canary-180m-flash-en-es-de-fr-int8",
}

def get_model_path(model_id: str) -> Path:
    return MODELS_DIR / model_id

def is_model_downloaded(model_id: str) -> bool:
    model_path = get_model_path(model_id)
    if not model_path.exists():
        return False
    
    if model_id == "canary-180m-flash":
        has_encoder = (model_path / "encoder.onnx").exists() or (model_path / "encoder.int8.onnx").exists()
        has_decoder = (model_path / "decoder.onnx").exists() or (model_path / "decoder.int8.onnx").exists()
        return has_encoder and has_decoder and (model_path / "tokens.txt").exists()
    return False

def download_model(model_id: str, progress_callback=None) -> bool:
    if is_model_downloaded(model_id):
        logger.info(f"Model {model_id} already downloaded.")
        return True
        
    url = MODEL_URLS.get(model_id)
    if not url:
        logger.error(f"Unknown model ID: {model_id}")
        return False
        
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    archive_path = MODELS_DIR / f"{model_id}.tar.bz2"
    
    logger.info(f"Downloading Canary model ({model_id}) from {url}...")
    try:
        def reporthook(blocknum, blocksize, totalsize):
            if totalsize > 0 and progress_callback:
                percent = min(100, int(blocknum * blocksize * 100 / totalsize))
                progress_callback(percent)
                
        urllib.request.urlretrieve(url, archive_path, reporthook if progress_callback else None)
        logger.info(f"Downloaded model archive to {archive_path}")
        
        logger.info("Extracting Canary model archive...")
        with tarfile.open(archive_path, "r:bz2") as tar:
            tar.extractall(path=MODELS_DIR)
            
        extracted_name = ARCHIVE_DIRS.get(model_id)
        if extracted_name:
            extracted_path = MODELS_DIR / extracted_name
            target_path = get_model_path(model_id)
            if target_path.exists():
                import shutil
                shutil.rmtree(target_path)
            extracted_path.rename(target_path)
            logger.info(f"Canary model placed in {target_path}")
            
        archive_path.unlink(missing_ok=True)
        return True
    except Exception as e:
        logger.error(f"Failed to download/extract Canary model {model_id}: {e}", exc_info=True)
        archive_path.unlink(missing_ok=True)
        return False
