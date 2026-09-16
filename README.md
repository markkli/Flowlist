# Flowlist

Flowlist is a focus ritual app: turn a goal into concrete tasks, protect a
focus block, and see that work accumulate in your activity ledger.

Roadmap items can be projects, learning objectives, or tasks. Tasks share one
simple list for work such as paying a bill or reading a book; they do not
expose nested steps or AI breakdown controls.

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

### Quick local mode (no Docker)

This is the easiest way to run Flowlist on your Mac while developing. It uses
SQLite, a small local database file, instead of PostgreSQL.

First, install the local environment once:

```bash
python3 -m venv backend/.venv
backend/.venv/bin/pip install -r backend/requirements.txt -r backend/requirements-dev.txt
```

Then start both servers with one command:

```bash
./scripts/run-local.sh
```

The script creates `backend/local-development.env` on first run, applies all
database migrations, starts FastAPI and the frontend, and prints the connected
URL. Open `http://127.0.0.1:5500`. Press `Ctrl+C` to stop both servers.

If `backend/local-development.env` leaves `OPENAI_API_KEY` blank, the launcher
reuses the key from `backend/.env` when one is already present. It never prints
the key or writes it into the repository.

The database is stored in `backend/flowlist.local.db`, which is local-only and
can be deleted when you want a fresh development database.

If you prefer to run the frontend separately:

```bash
python3 -m http.server 5500 -d frontend
```

Then open `http://127.0.0.1:5500`.

### PostgreSQL mode (Docker)

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
create goal → add task → run Pomodoro → attribute session → optionally complete task → update stats
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

## Focus timer behavior

The Pomodoro is intentionally independent from the roadmap: start a focus ritual
without choosing a task, then attribute the accumulated focus time only when the
ritual ends. Flowlist suggests unfinished tasks in roadmap order, with recently
focused work first.

The default cycle is four rounds of 25 minutes of focus and 5 minutes of rest,
followed by a 15-minute long break. Focus length, short break, rounds, and long
break can all be changed from the timer settings dialog. Flowlist does not
prescribe durations for individual tasks; the session records the time actually
spent instead.

Each running block has a visible “Skip to next” control. Skipping focus advances
directly to its break and only adds time that actually elapsed; skipped time is
never credited. Skipping or naturally completing a break begins the next focus
round. Cycles continue until “End ritual” is selected. Only then does Flowlist
show the task-attribution checklist and save one record for the entire ritual.

A session can be attributed to several tasks. Each task can be marked as
“worked on” and, independently, “finished”; finishing a task also counts it as
worked on. The focus duration is counted once regardless of how many tasks are
selected. Leaving all tasks unchecked saves the record as General focus.

Individual records can be removed from History. Removing a record updates the
activity totals but does not reopen tasks that were completed during it.

While a block is running, the frontend stores its phase and end timestamp in
browser storage—not private notes or credentials. If the window is refreshed,
Flowlist calculates the remaining time and continues the block. The recovery
record is cleared when the focus or break interval ends.
