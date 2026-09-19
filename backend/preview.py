"""Serve a built frontend and API together for local previews."""
from pathlib import Path
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from app.main import app as api

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
app.mount('/api', api)
app.mount('/', StaticFiles(directory=Path(__file__).resolve().parents[1] / 'frontend/dist', html=True), name='frontend')
