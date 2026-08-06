# Flowlist

Flowlist is a focus ritual app: turn a goal into concrete tasks, protect a
focus block, and see that work accumulate in your activity ledger.

## How the app fits together

```text
Frontend (browser, port 5500)
        ↓ HTTP requests
FastAPI backend (port 8000)
        ↓ SQLAlchemy
PostgreSQL (Docker)
```

- `frontend/` is the browser interface.
- `backend/main.py` defines Flowlist's HTTP API routes.
- `backend/models.py` defines goals, tasks, and focus-session tables.
- `backend/schemas.py` validates data crossing the API boundary.
- `backend/database.py` creates database connections.

## Run Flowlist locally

### 1. Configure local secrets

```bash
cp backend/.env.example backend/.env
```

`OPENAI_API_KEY` is optional. Leave it blank if you do not want the AI task
breakdown feature; the rest of Flowlist will still work.

### 2. Start PostgreSQL and the API

```bash
docker compose up --build
```

This starts PostgreSQL and FastAPI. The backend health endpoint is available at
`http://127.0.0.1:8000/health`.

On a new database, the backend automatically runs all Alembic migrations before
it starts. If you already created a local Flowlist database before migrations
were added, do not run the initial migration against those existing tables.
Instead, once, mark its matching baseline version:

```bash
docker compose run --rm backend alembic stamp 20260804_01
```

`stamp` records the version without changing tables. Future Flowlist migrations
will then run normally when the backend starts.

### 3. Serve the frontend

In another terminal:

```bash
python3 -m http.server 5500 -d frontend
```

Open `http://127.0.0.1:5500` in the browser. Do not open `index.html` using a
`file://` URL: the UI can render, but it cannot reliably reach the backend.

## Test the core ritual

The end-to-end test proves the most important product loop:

```text
create goal → add task → complete task → log focus session → update stats
```

Create the local development environment once:

```bash
python3 -m venv backend/.venv
backend/.venv/bin/pip install -r backend/requirements.txt -r backend/requirements-dev.txt
```

Then run the test:

```bash
cd backend
.venv/bin/pytest tests/test_ritual_flow.py
```

The test uses a disposable SQLite database and never touches your real
PostgreSQL data.
