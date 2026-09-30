# Flowlist

Flowlist combines a project checklist, a Pomodoro timer, and a record of focused
work. The website and Mac main window share one interface. The Mac app adds a
local timer, local storage, background account sync, a menu-bar panel, and a
WidgetKit extension.

## Start here

- [Architecture and code ownership](docs/ARCHITECTURE.md)
- [Product behavior](docs/PRODUCT-BEHAVIOR.md)
- [Mac build, signing, local storage, and sync](macos/README.md)
- [Render deployment](docs/RENDER-SETUP.md) and [backend/auth setup](docs/BETA-SETUP.md)
- [Review findings and validation](docs/REPOSITORY-REVIEW.md)
- [Release status and next phase](docs/SHIPPING.md)
- [Public website, Mac download, domain, and email sender](docs/WEBSITE-LAUNCH.md)

## Run the website locally

Requires Python 3.13 and Node.js 22.12+.

```sh
python3 -m venv backend/.venv
backend/.venv/bin/pip install -r backend/requirements.txt -r backend/requirements-dev.txt
npm --prefix frontend ci
./scripts/run-local.sh
```

Open the [product site](http://127.0.0.1:5500/) or [workspace](http://127.0.0.1:5500/app/). The launcher applies migrations to
`backend/flowlist.local.db`, starts FastAPI on port 8000, and starts Vite with an
`/api` proxy. It creates the ignored `backend/local-development.env` from its
example on first use. AI history titles are optional and disabled by default.
Logs are `.flowlist-backend.log` and `.flowlist-frontend.log`.

For separate terminals, configure `DATABASE_URL` locally, then run:

```sh
# From backend/
export FLOWLIST_AUTH_MODE=local FLOWLIST_ENV=development
.venv/bin/alembic upgrade head
.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000

# From the repository root in a second terminal
npm --prefix frontend run dev
```

`FLOWLIST_API_TARGET` overrides Vite's API target. Use Vite or a production build;
opening the source `index.html` directly does not load the application.
Local mode is single-user and must stay on loopback. Hosted mode requires
verified authentication and per-account database ownership; see the setup guides.

## Build and preview

```sh
npm --prefix frontend run build
# From backend/, with DATABASE_URL and explicit local mode configured as above:
.venv/bin/uvicorn preview:app --host 127.0.0.1 --port 8010
```

The preview serves the built UI and API at [localhost:8010](http://127.0.0.1:8010).
Alternatively, copy `.env.example` to `.env` and use `docker compose up --build`.
That local PostgreSQL/FastAPI/Nginx stack binds only to `127.0.0.1:8080`.

For the Mac app, follow [macos/README.md](macos/README.md). Xcode and the local
packaging script both rebuild and bundle `frontend/`; no separate Mac dashboard
implementation needs to be maintained. Signing is needed for widget installation.
The local development `.app` is not a notarized installer.

## Tests

```sh
backend/.venv/bin/python -m pytest backend/tests -q
npm --prefix frontend run build
npm --prefix frontend test
npm --prefix frontend exec -- playwright install chromium webkit
npm --prefix frontend run test:e2e -- --workers=4
FLOWLIST_TEST_BROWSER=webkit npm --prefix frontend run test:e2e -- --workers=2
# On macOS, with Xcode installed:
bash macos/scripts/build-web.sh
bash macos/scripts/test.sh
bash macos/scripts/verify-web.sh
```

Backend tests use disposable SQLite databases. Playwright intercepts API calls
and uses isolated browser profiles. Native tests use temporary files and fake
network responses. The WebKit smoke app uses a separate synthetic workspace;
it never reads personal account files. PostgreSQL release checks and unsigned
app/widget compilation also run in [CI](.github/workflows/tests.yml).

## Repository map

```text
frontend/       Shared Vite interface, browser timer, features, browser tests
backend/        FastAPI, ownership checks, persistence, migrations, API tests
macos/          Swift timer/storage/sync, WKWebView bridge, menu panel, widget
scripts/        Local development launcher
deploy/         Render and self-hosted deployment configuration
docs/           Architecture, behavior, setup, review, and release notes
design-system/  Visual design reference
```

Build output, caches, local databases, credentials, and personal Xcode settings
are not source artifacts. Keep migrations and legacy data readers: removing
those would break existing installations. Artwork provenance is documented in
[APPEARANCE-ASSETS.md](docs/APPEARANCE-ASSETS.md).
