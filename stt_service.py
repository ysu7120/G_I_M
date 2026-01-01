import asyncio
import numpy as np
import functools
from faster_whisper import WhisperModel

MODEL_SIZE = "tiny"
DEVICE = "cpu"
COMPUTE_TYPE = "int8"

class STTService:
    def __init__(self):
        print(f"Loading Whisper Model ({MODEL_SIZE})...")
        self.model = WhisperModel(MODEL_SIZE, device=DEVICE, compute_type=COMPUTE_TYPE)
        print("Model Loaded.")

    async def transcribe_audio(self, loop, audio_bytes: bytes):
        # Convert bytes to floats
        audio_np = np.frombuffer(audio_bytes, dtype=np.int16).flatten().astype(np.float32) / 32768.0
        
        func = functools.partial(self.model.transcribe, audio_np, language="ko")
        # Run in executor
        segments, _ = await loop.run_in_executor(None, func)
        return " ".join([s.text for s in segments])

stt_service = STTService()
