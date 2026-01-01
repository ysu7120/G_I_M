import asyncio
import websockets
import json
import numpy as np
import functools
from faster_whisper import WhisperModel

# ==========================================
# 1. 설정 (Configuration)
# ==========================================
HOST = "0.0.0.0"
PORT = 8000

# 모델 설정 (CPU 최적화)
MODEL_SIZE = "tiny"      # tiny, base, small 중 선택
DEVICE = "cpu"
COMPUTE_TYPE = "int8"    # CPU 사용 시 필수

# VAD(침묵 감지) 민감도 튜닝
# 소리 크기 임계값 (0.0 ~ 1.0). 주변 소음에 따라 조절 필요.
# 조용한 방: 0.005 ~ 0.01 / 시끄러운 곳: 0.02 ~ 0.05
# SILENCE_THRESHOLD = 0.01
SILENCE_THRESHOLD = 0.02 # 조금 더 높여 잡음에 둔감하게 설정

# 버퍼링 로직 설정 (16kHz 기준)
SAMPLE_RATE = 16000
MIN_CHUNK_DURATION = 1.0  # 최소 1초 이상 말해야 변환 시도 (짧은 잡음 무시)
MAX_CHUNK_DURATION = 5.0  # 말이 안 끊겨도 5초가 지나면 강제 변환 (지연 방지)
SILENCE_DURATION_CHUNKS = 10 # 약 0.2~0.3초간 침묵이 유지되면 말이 끝난 것으로 간주

# 바이트 단위 계산
BYTES_PER_SAMPLE = 2 # 16bit = 2bytes
MIN_BYTES = int(SAMPLE_RATE * MIN_CHUNK_DURATION * BYTES_PER_SAMPLE)
MAX_BYTES = int(SAMPLE_RATE * MAX_CHUNK_DURATION * BYTES_PER_SAMPLE)

# ==========================================
# 2. 모델 로드
# ==========================================
print(f"Loading Whisper Model ({MODEL_SIZE})...")
model = WhisperModel(MODEL_SIZE, device=DEVICE, compute_type=COMPUTE_TYPE)
print("Model Loaded. Ready to start.")

# ==========================================
# 3. 비동기 처리 함수
# ==========================================
async def transcribe_async(loop, audio_np):
    """
    STT 변환을 별도 스레드(Executor)에서 실행하여
    메인 루프(웹소켓 하트비트 등)가 차단되는 것을 방지합니다.
    """
    func = functools.partial(model.transcribe, audio_np, language="ko")
    # run_in_executor는 기본적으로 ThreadPoolExecutor를 사용합니다.
    segments, _ = await loop.run_in_executor(None, func)
    return " ".join([s.text for s in segments])

async def serve(websocket):
    print(f"Client Connected: {websocket.remote_address}")
    
    buffer = bytearray()
    silence_counter = 0
    loop = asyncio.get_running_loop()

    try:
        async for message in websocket:
            # 오디오 데이터(bytes)인 경우에만 처리
            if isinstance(message, bytes):
                buffer.extend(message)
                
                # --- A. 에너지 기반 침묵 감지 (Energy VAD) ---
                # 들어온 조각(Chunk)을 numpy로 변환하여 소리 크기 측정
                # int16 -> float32 정규화 (-1.0 ~ 1.0)
                chunk_np = np.frombuffer(message, dtype=np.int16).flatten().astype(np.float32) / 32768.0
                
                # RMS(Root Mean Square) 에너지 계산
                energy = np.sqrt(np.mean(chunk_np**2))
                
                if energy < SILENCE_THRESHOLD:
                    silence_counter += 1
                else:
                    silence_counter = 0 # 말이 들리면 침묵 카운터 리셋

                # --- B. 변환 결정 로직 ---
                buffer_len = len(buffer)
                
                # 조건 1: 말이 끝남 (최소 길이 충족 AND 침묵 유지됨)
                is_end_of_speech = (buffer_len >= MIN_BYTES) and (silence_counter > SILENCE_DURATION_CHUNKS)
                
                # 조건 2: 버퍼 가득 참 (최대 길이 초과 - 강제 변환)
                is_buffer_full = (buffer_len >= MAX_BYTES)

                if is_end_of_speech or is_buffer_full:
                    # 전체 버퍼를 변환 준비
                    full_audio_np = np.frombuffer(buffer, dtype=np.int16).flatten().astype(np.float32) / 32768.0
                    
                    # 변환 실행 (Non-blocking)
                    # print(f"Processing... (Reason: {'Silence' if is_end_of_speech else 'Full Buffer'})")
                    text = await transcribe_async(loop, full_audio_np)
                    
                    if text.strip():
                        print(f"Recognized: {text}")
                        # 결과 전송
                        await websocket.send(json.dumps({"text": text}))
                    
                    # 상태 초기화
                    buffer.clear()
                    silence_counter = 0

    except websockets.ConnectionClosed:
        print("Client Disconnected")
    except Exception as e:
        print(f"Error: {e}")

# ==========================================
# 4. 서버 실행
# ==========================================
async def main():
    async with websockets.serve(serve, HOST, PORT):
        print(f"Server started on ws://{HOST}:{PORT}")
        await asyncio.Future()  # Run forever

if __name__ == "__main__":
    asyncio.run(main())
