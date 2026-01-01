from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request, Depends, HTTPException, UploadFile, File
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session
from sqlalchemy.sql.expression import func
import json
import asyncio
import numpy as np
import openpyxl
from io import BytesIO

from models import SessionLocal, init_db, Question, PracticeLog
from stt_service import stt_service

app = FastAPI(title="Gyeonggi Interview Practice")

app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="static")

init_db()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# --- Seed Data ---
def seed_default_questions(db: Session):
    if db.query(Question).count() == 0:
        defaults = [
            ("구상형", "학생들이 수업에 집중하지 못하고 산만한 상황에서 교사가 취할 수 있는 구체적인 지도 방안을 3가지 말하시오."),
            ("구상형", "동료 교사 간의 갈등이 발생했을 때, 이를 원만하게 해결하기 위한 본인만의 의사소통 전략을 말하시오."),
            ("구상형", "학부모가 자녀의 성적 이의제기를 하며 강하게 항의할 때, 어떻게 대처할 것인지 단계별로 설명하시오."),
            ("즉답형", "자유학년제 시행 취지에 비추어 자신이 운영하고 싶은 동아리 활동을 구체적으로 제안하시오."),
            ("즉답형", "교권 침해 사안이 발생했을 때 교사로서 가장 먼저 해야 할 조치는 무엇인지 말하시오."),
        ]
        for cat, content in defaults:
            db.add(Question(category=cat, content=content))
        db.commit()

# --- Routes ---

@app.on_event("startup")
def startup_event():
    db = SessionLocal()
    seed_default_questions(db)
    db.close()

@app.get("/", response_class=HTMLResponse)
async def read_root(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})

@app.get("/api/simulation/random_set")
def get_random_set(db: Session = Depends(get_db)):
    # 3 Planning, 2 Immediate
    planning = db.query(Question).filter(Question.category == "구상형").order_by(func.random()).limit(3).all()
    immediate = db.query(Question).filter(Question.category == "즉답형").order_by(func.random()).limit(2).all()
    
    # Fill if not enough (Duplicate for prototype safety)
    if len(planning) < 3 and len(planning) > 0:
        planning = (planning * 3)[:3]
    if len(immediate) < 2 and len(immediate) > 0:
        immediate = (immediate * 2)[:2]
        
    return {"planning": planning, "immediate": immediate}

@app.post("/api/history")
async def save_history(data: dict, db: Session = Depends(get_db)):
    # data: { duration: int, details: json }
    log = PracticeLog(
        duration_seconds=data.get("duration", 0),
        details_json=data.get("details", {})
    )
    db.add(log)
    db.commit()
    return {"status": "ok"}

@app.get("/api/history")
def get_history(db: Session = Depends(get_db)):
    return db.query(PracticeLog).order_by(PracticeLog.session_date.desc()).all()

@app.get("/api/questions")
def get_questions(db: Session = Depends(get_db)):
    return db.query(Question).all()

@app.post("/api/questions")
def create_question(category: str, content: str, title: str = "", db: Session = Depends(get_db)):
    q = Question(category=category, title=title, content=content)
    db.add(q)
    db.commit()
    return {"status": "ok"}

@app.post("/api/upload_excel")
async def upload_excel(category: str = "구상형", file: UploadFile = File(...), db: Session = Depends(get_db)):
    contents = await file.read()
    wb = openpyxl.load_workbook(BytesIO(contents))
    sheet = wb.active
    
    count = 0
    # Assuming A=Title, B=Content
    for row in sheet.iter_rows(values_only=True):
        if not row or not row[0]: continue
        
        # If row has 2 columns: Title, Content. If 1: Content only?
        # Let's assume standard format: A=Title, B=Content
        title = str(row[0]).strip() if row[0] else ""
        content = str(row[1]).strip() if len(row) > 1 and row[1] else ""
        
        if not content: continue

        q = Question(category=category, title=title, content=content)
        db.add(q)
        count += 1
    db.commit()
    return {"status": "ok", "count": count}

# --- WebSocket STT (Same VAD Logic) ---
SILENCE_THRESHOLD = 0.02
SAMPLE_RATE = 16000
MIN_CHUNK_DURATION = 1.0 
MAX_CHUNK_DURATION = 5.0
SILENCE_DURATION_CHUNKS = 10
BYTES_PER_SAMPLE = 2
MIN_BYTES = int(SAMPLE_RATE * MIN_CHUNK_DURATION * BYTES_PER_SAMPLE)
MAX_BYTES = int(SAMPLE_RATE * MAX_CHUNK_DURATION * BYTES_PER_SAMPLE)

@app.websocket("/ws/stt")
async def websocket_stt(websocket: WebSocket):
    await websocket.accept()
    buffer = bytearray()
    silence_counter = 0
    loop = asyncio.get_running_loop()
    
    try:
        while True:
            message = await websocket.receive_bytes()
            buffer.extend(message)

            chunk_np = np.frombuffer(message, dtype=np.int16).flatten().astype(np.float32) / 32768.0
            energy = np.sqrt(np.mean(chunk_np**2))

            if energy < SILENCE_THRESHOLD:
                silence_counter += 1
            else:
                silence_counter = 0

            buffer_len = len(buffer)
            is_end_of_speech = (buffer_len >= MIN_BYTES) and (silence_counter > SILENCE_DURATION_CHUNKS)
            is_buffer_full = (buffer_len >= MAX_BYTES)

            if is_end_of_speech or is_buffer_full:
                full_audio = bytes(buffer)
                buffer.clear()
                silence_counter = 0

                text = await stt_service.transcribe_audio(loop, full_audio)
                if text.strip():
                    await websocket.send_json({"text": text})

    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"WS Error: {e}")
