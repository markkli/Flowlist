# Flowlist

Flowlist is a private focus app: organize projects, learning objectives, and a
shared Tasks list; run a focus ritual; then attribute the time to the work.

## Local development

Requires Python 3.13 and Node.js 22.12+.

```bash
python3 -m venv backend/.venv
backend/.venv/bin/pip install -r backend/requirements.txt -r backend/requirements-dev.txt
npm --prefix frontend ci
./scripts/run-local.sh
```

Open http://127.0.0.1:5500. The launcher applies migrations, runs FastAPI on
port 8000, and starts Vite with an `/api` proxy. It creates
`backend/local-development.env` from the example on first use and reuses an
existing `backend/.env` API key without printing it. AI features are optional.
The local database is `backend/flowlist.local.db`.

To run the servers separately:

```bash
# Terminal 1, from backend (configure DATABASE_URL first)
.venv/bin/alembic upgrade head
.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000

# Terminal 2, from the repository root
npm --prefix frontend run dev
```

Set `FLOWLIST_API_TARGET` for the Vite process if your API uses another port.
The frontend now requires Vite or a production build; do not serve its source
with `python -m http.server` or open `index.html` directly.

## Production build and local preview

```bash
npm --prefix frontend run build
cd backend
# Configure DATABASE_URL, then:
.venv/bin/alembic upgrade head
.venv/bin/uvicorn preview:app --host 127.0.0.1 --port 8010
```

The preview serves `frontend/dist` and the API together at
http://127.0.0.1:8010. Assets are fingerprinted by Vite.

Alternatively, copy `.env.example` to `.env` and run:

```bash
docker compose up --build
```

The Compose stack uses PostgreSQL, FastAPI, and Nginx. The frontend is exposed
on **127.0.0.1:8080 only**; the API and database stay inside the Docker network.
Authentication and per-user ownership are deliberately deferred until shipping.
Do not expose this single-user build publicly. Back up the database before
upgrades. `.env` files, database files, logs, builds, and caches are ignored.

## Repository structure

```text
backend/
  app/
    main.py             # app assembly, CORS, health
    api/                # goals, tasks, sessions, dashboard HTTP routes
    services/           # shared completion/ordering and title enrichment
    models.py           # SQLAlchemy tables
    schemas.py          # request/response validation
    database.py         # database connections
    ai.py               # optional AI integration
  migrations/           # Alembic schema history
  tests/                # API and migration regression tests
  preview.py            # combined local production preview
frontend/
  src/
    shared/             # typed API client, domain types, safe DOM helpers
    features/
      timer/            # typed timer transitions plus UI adapter
      plan/
      history/
      dashboard/
    main.js             # navigation, theme, feature initialization
  public/images/        # original artwork
  tests/                # isolated Playwright browser tests
  styles.css            # existing forest theme and responsive styles
  index.html            # semantic page and dialog templates
```

The frontend uses Vite and TypeScript for shared services and timer state.
Existing view adapters remain ES modules in JavaScript, allowing gradual typing
without rewriting the interface. FastAPI, SQLAlchemy, Alembic, SQLite for local
development, and PostgreSQL for the container stack remain in place.

## Product behavior

- Plan order is the task queue order. The queue shows unfinished leaf tasks;
  completed work remains accessible in Plan. Closed directions are excluded
  from the dashboard. There are no task priorities or prescribed task durations.
- Projects and learning objectives support three task levels. The shared Tasks
  list stays flat, with no AI breakdown. Parent sections close only when all
  direct children are complete. Reopening a child reopens its ancestor chain.
  Session attribution uses the same completion rules as direct task edits.
- AI planning produces proposals that require explicit selection. Learning
  paths ask clarification questions first.
- Start a ritual without choosing a task. Defaults are 25 minutes of focus,
  5 minutes of rest, and a 15-minute break after four rounds. Settings apply to
  the next ritual. Skip credits only elapsed focus, never break time. Minutes
  are rounded down once across the whole ritual.
- Minimize the timer to browse the app while it continues. Escape minimizes
  the running timer. After sleep, only the current focus block is credited;
  additional unattended focus rounds are never invented.
- Ending a ritual opens attribution. Worked on and Finished are independent
  choices, except that Finished implies Worked on. Time is counted once.
  Long rituals are supported beyond eight hours.
- Running state, unsaved reflections, and selections are stored **on this
  browser/device** until saved or deliberately discarded. Refresh restores them.
  Escape and Save later retain the draft. Discard asks for confirmation. Browser
  storage is not a cloud backup; clearing it removes unsaved work.
- A stable ritual ID makes save retries safe after a lost response. Tabs share
  the ritual state, using browser locks where available. A saved ritual clears
  its local reflection and selections.
- Reflections are preserved even if unusual or written in another language.
  The backend commits a fallback title immediately. Optional AI enrichment runs
  after the response with a bounded timeout; failure keeps the local title.
  This enrichment is best effort, not a durable job queue.
- History loads in pages. Delete hides a record from totals and offers Undo;
  Show deleted records allows later restoration. Deletion never changes tasks.
  There is currently no permanent purge control.
- Activity cells and streaks use the browser's IANA timezone, with Monday-aligned
  weeks. Streaks require at least one focused minute that day. This week is a
  weekly count; the activity totals are lifetime figures.
- Navigation uses URL fragments so refresh and browser Back preserve the view.

## Tests

```bash
backend/.venv/bin/python -m pytest backend/tests -q
npm --prefix frontend run build
npm --prefix frontend test
cd frontend
npx playwright install chromium
npm run test:e2e
```

API tests use a uniquely named disposable SQLite database. Migration tests check
upgrades and downgrades against seeded data. Browser tests use intercepted API
responses and isolated browser profiles, never the user's database. Timer tests
cover skipped blocks, long breaks, sleep recovery, and long rituals. Playwright
checks draft recovery, failed saves, safe title rendering, history Undo,
keyboard behavior, navigation, and responsive layouts.
