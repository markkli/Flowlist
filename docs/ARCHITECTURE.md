# Architecture

Reviewed September 28, 2026. This describes the current implementation, not the
proposed download website or additional authentication providers.

## Application boundaries

| Area | Owns | Entry points |
| --- | --- | --- |
| Public site | Product explanation and verified Mac download | `frontend/index.html`, `frontend/download/`, `frontend/src/site/` |
| Shared interface | Home, Plan, History, session review, Guide, appearance | `frontend/src/main.js`, `frontend/app/index.html` |
| Browser runtime | Browser timer/draft persistence, Supabase web auth, HTTP | `features/timer/state.ts`, `features/auth/`, `shared/api.ts` |
| Mac runtime | Native timer, atomic files, account sync, Keychain, reminders | `TimerStore.swift`, `WorkspaceStore.swift`, `CloudClient.swift` |
| Mac bridge | Bundled web loading, validated IPC, local API contract | `WebWorkspaceView.swift`, `WebBridge.swift`, `WebWorkspaceAPI.swift` |
| Cloud API | Auth verification, ownership, canonical account data | `backend/app/main.py`, `auth.py`, `tenancy.py`, `api/` |
| Native compact surfaces | Menu timer and read-only desktop widget | `TimerViews.swift`, `Widget/FlowlistWidget.swift` |

All Mac filenames in this table are under `macos/Sources/FlowlistMac/` unless
otherwise specified. Pure state/data models live in `macos/Sources/FlowlistCore/`.

The Mac main window bundles the shared frontend in WKWebView through the private
`flowlist-app://workspace` scheme. It does not load the live Render website.
`shared/api.ts` switches from browser HTTP to native IPC when the bridge exists.
The app's native timer remains the authority even with the window closed. The
browser timer is intentionally separate; an active timer is not synchronized
between devices.

## Mac write and sync path

1. A Plan action passes through the bridge's route allowlist and local validation.
2. `WebWorkspaceAPI` updates the Plan and appends a `PlanChange` to the same
   `LocalWorkspace` snapshot. `WorkspaceFile` atomically saves that file before
   reporting success. Guest actions use the same reducer without an outbox.
3. `WorkspaceStore` drains the outbox serially. New local objects have negative
   IDs; server acknowledgements map them to positive IDs in dependent commands,
   priorities, draft selections, and saved sessions.
4. Saved sessions retain a UUID for idempotent upload. A task's pending sessions
   upload before its cloud deletion, preserving historical task snapshots.
5. A Plan refresh only replaces the cache if its revision is unchanged and there
   are no pending Plan edits. Ambiguous non-idempotent creates pause for explicit
   resolution; definite offline failures can retry.

Guest files and each account's files are separate. Switching accounts does not
import guest data. Access and refresh tokens stay in Keychain, outside the web
page and workspace JSON. See the Mac README for file locations and recovery.

## Reads and caching

Plan and priority reads use the local model after an initial account download.
Visited cloud history/dashboard pages have an owner-tagged, bounded response
cache. Uncached history and historical edits still need a connection.

A shared in-memory cache generation rejects reads that overlap a successful
history edit or session upload. Upload acknowledgements and changed cloud history
invalidate cached pages; the main window refreshes after a successful sync.
Failures retain local changes and expose a sync issue. This is not a complete
offline history replica or collaborative merge protocol.

## Backend ownership and compatibility

`database.py` creates SQLAlchemy sessions and installs tenancy rules. Authenticated
requests derive ownership from verified identity; clients never choose an owner.
Routes validate relationships inside that scope. Ownership tests exercise foreign
IDs, queue edits, history access, export, and deletion.

Alembic revisions form the upgrade history. Do not squash or delete previously
applied revisions to make the tree look smaller. SQLite development and hosted
PostgreSQL are intentional adapters, not duplicate products. `backend/main.py`
remains a compatibility entry point for existing launch commands.

Some API/domain names predate visible labels: `goals` means Plan projects,
`queue` means Priority tasks, and `ritual` is a multi-interval focus session.
Avoid schema/API renaming merely to match copy; use the current labels in the UI.
Older timer/history readers and the Guide fallback preserve installed-client
compatibility. Changes to that contract need migration/contract tests.

## Build ownership

- `frontend/dist/` and `macos/Sources/FlowlistMac/Resources/WebUI/` are generated.
- Xcode and `build-local.sh` run `build-web.sh` before compiling/packaging.
- The widget shares core models and native artwork, not the large web bundle.
- WebP web landscapes and native JPEG landscapes are platform-specific assets.
- `generate-project.py` owns Xcode source/resource membership and preserves local
  signing selections. Do not commit a developer's team or private signing files.

## Review focus

Start with storage/sync invariants and account isolation, then the native bridge
allowlist, timer transitions, API migrations, and browser accessibility. Current
risks and the verification evidence are in [REPOSITORY-REVIEW.md](REPOSITORY-REVIEW.md).
