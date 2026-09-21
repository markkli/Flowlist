import os
from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.database import get_db
from app.api import goals, tasks, sessions, dashboard, queue, history

app = FastAPI(title="Flowlist API")
origins = ["http://127.0.0.1:5500", "http://localhost:5500"]
origins += [value.strip() for value in os.getenv("FLOWLIST_CORS_ORIGINS", "").split(",") if value.strip()]
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["*"], allow_headers=["*"])
for module in (goals, tasks, sessions, dashboard, queue, history):
    app.include_router(module.router)

@app.get("/health")
def health(db: Session = Depends(get_db)):
    db.execute(select(1))
    return {"ok": True, "database": "connected", "ai_titles_configured": bool(os.getenv("OPENAI_API_KEY"))}
