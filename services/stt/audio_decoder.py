import io
import logging
import numpy as np
import av

logger = logging.getLogger(__name__)

def decode_audio_to_pcm(audio_bytes: bytes, target_sample_rate: int = 16000) -> np.ndarray:
    """Decodes raw audio bytes (WebM, WAV, MP3, OGG, etc.) into a 1D float32 PCM numpy array at 16kHz."""
    try:
        input_container = av.open(io.BytesIO(audio_bytes))
        audio_stream = next((s for s in input_container.streams if s.type == 'audio'), None)
        if not audio_stream:
            logger.error("No audio stream found in input bytes.")
            return np.array([], dtype=np.float32)
            
        resampler = av.AudioResampler(
            format='flt',      # 32-bit float
            layout='mono',     # Mono channel
            rate=target_sample_rate
        )
        
        pcm_chunks = []
        for packet in input_container.demux(audio_stream):
            for frame in packet.decode():
                resampled_frames = resampler.resample(frame)
                for rframe in resampled_frames:
                    # Convert to numpy array
                    arr = rframe.to_ndarray()
                    pcm_chunks.append(arr.flatten())
                    
        input_container.close()
        if pcm_chunks:
            return np.concatenate(pcm_chunks, axis=0).astype(np.float32)
        else:
            return np.array([], dtype=np.float32)
    except Exception as e:
        logger.error(f"Failed to decode audio to PCM: {e}", exc_info=True)
        return np.array([], dtype=np.float32)
