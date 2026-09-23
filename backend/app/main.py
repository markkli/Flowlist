import os
from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends, HTTPException
from app.config import public_config, auth_mode
from app.security import RequestSafety
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.database import SessionLocal
from app.api import goals, tasks, sessions, dashboard, queue, history, account

@asynccontextmanager
async def lifespan(app):
    public_config()
    if os.getenv('FLOWLIST_ENV') == 'production' and not os.getenv('SUPABASE_SECRET_KEY'):
        raise RuntimeError('Configure SUPABASE_SECRET_KEY for account deletion')
    yield


app = FastAPI(title="Flowlist API", lifespan=lifespan, docs_url=None if os.getenv('FLOWLIST_ENV') == 'production' else '/docs', redoc_url=None)


@app.get('/config')
def config():
    try:
        return public_config()
    except RuntimeError:
        raise HTTPException(503, 'Flowlist sign-in is not configured yet.')

app.add_middleware(RequestSafety)
origins = ["http://127.0.0.1:5500", "http://localhost:5500"]
origins += [value.strip() for value in os.getenv("FLOWLIST_CORS_ORIGINS", "").split(",") if value.strip()]
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["*"], allow_headers=["*"])
for module in (goals, tasks, sessions, dashboard, queue, history, account):
    app.include_router(module.router)

@app.get("/health")
def health():
    with SessionLocal() as db:
        db.execute(select(1))
    return {"ok": True, "database": "connected"}
