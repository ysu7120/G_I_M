from sqlalchemy import create_engine, Column, Integer, String, Float, Text, DateTime, JSON
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from datetime import datetime

DATABASE_URL = "sqlite:///./interview_app.db"

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

class Question(Base):
    __tablename__ = "questions"
    id = Column(Integer, primary_key=True, index=True)
    category = Column(String, index=True) # 구상형, 즉답형
    title = Column(String, nullable=True) # 문항명 (e.g. 2021 기출)
    content = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow)

class PracticeLog(Base):
    __tablename__ = "practice_logs"
    id = Column(Integer, primary_key=True, index=True)
    session_date = Column(DateTime, default=datetime.utcnow)
    duration_seconds = Column(Integer)
    # Store full session detail as JSON
    # Structure: { "planning": [ {q...} ], "immediate": [ {q...} ], "answers": { "q_id": "text" } }
    details_json = Column(JSON)

def init_db():
    Base.metadata.create_all(bind=engine)
