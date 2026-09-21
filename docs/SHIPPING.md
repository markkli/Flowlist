# Flowlist: web MVP and native roadmap

Reviewed September 20, 2026. This is a launch plan, not a claim that the current local build is safe to publish.

## Product decision

Keep the MVP to Plan → Focus → Reflect → History. Projects cover work and learning, with tasks and one subtask level. Tasks is the flat list. The history calendar is retrospective; scheduling, social features, more AI planning, and integrations would add little at this stage. Keep Vite, the existing feature modules, FastAPI, SQLAlchemy, and Alembic. There is no reason to introduce Next.js, microservices, or a frontend rewrite for this launch.

## What must change before public access

1. **Authentication and ownership.** Routes currently operate on a shared dataset; the models have no user owner. Require verified access tokens in FastAPI, add an application user mapped to the auth subject, and scope every read/write, queue reorder, dashboard aggregation, history edit, delete/restore, and export. Derive ownership on the server, never trust a submitted user ID. Validate task/project/session relationships within that same owner. Add negative tests with two users, guessed IDs, expired tokens, and mixed-owner payloads. A login screen alone does not solve this.
2. **Local drafts and account changes.** Namespace timer drafts and collapsed-plan state by user, clear in-memory data on logout, and ensure a draft cannot save into a different account. Appearance can remain device-specific. Claim the existing local database only through an explicit import into its owner's account; never give it to the first visitor who signs in.
3. **Production database and release checks.** Use managed PostgreSQL, run migrations as a release step, and validate them against PostgreSQL in CI as well as SQLite. Test backup restoration and SQLite-to-PostgreSQL transfer with record counts and attribution relationships. The current migration tests use SQLite; they do not establish production PostgreSQL compatibility. Export exists, but a general import/restore UI does not.
4. **Deployment and operations.** Serve frontend and API behind HTTPS on one origin. Keep database credentials server-side, use a restricted database role, configure health checks, error monitoring, backups, and request/body/rate limits. Replace the example Compose password. Dockerfiles and a local Compose stack already exist; Kubernetes and a separate container per user are unnecessary.
5. **Account lifecycle and privacy.** Add verification, recovery, logout, account deletion, and an explanation of stored data. Optional AI history titles currently send note/task context to the model provider when a server key is configured. For the first public beta, leave AI enrichment disabled until there is an explicit user-facing choice and usage limits; the local title fallback already works.
6. **Release validation.** Test Safari as well as Chromium, especially sleep/resume, refreshed drafts, multiple tabs, failed saves, and phone layouts. Browser timers cannot promise alarms after the browser is closed. Clearly state that limitation instead of implying a native background service. Pin a release only after these checks pass.

## Recommended services and what to set up

My recommendation is **Supabase Auth + managed PostgreSQL**, keeping Flowlist's FastAPI API as the application boundary. That combines identity and database provisioning in one provider and supports browser and future Swift clients. This is a project-specific recommendation, not a requirement to change the current framework. See [Supabase's auth architecture](https://supabase.com/docs/guides/auth/architecture).

Clerk is a valid alternative if its hosted account experience is preferred, but it would still need a database and the same ownership work. Do not install both auth systems. Backend verification must validate signatures and relevant token claims; see [Clerk's verification guidance](https://clerk.com/docs/guides/sessions/manual-jwt-verification).

For the next implementation phase, the owner should create a Supabase development project, choose its region, and identify the intended web domain. We will configure redirect URLs and production email delivery when wiring auth. The project URL and publishable key are client configuration; database passwords and any privileged keys belong in local/hosting secret settings, not chat or source control. Keep staging separate from production.

FastAPI can keep SQLAlchemy. Choose the appropriate direct or session-pool connection for the hosting network and require TLS, following [Supabase's connection guide](https://supabase.com/docs/guides/database/connecting-to-postgres). If using Supabase, keep Flowlist tables in a private schema or otherwise prevent the public Data API from exposing them; browser auth does not automatically protect SQLAlchemy queries. Database grants/RLS and application ownership need an explicit design.

No provider account has been provisioned, no auth integration is installed, and no public deployment has been performed by this change.

## Platform sequence

| Phase | Deliverable | Boundary |
|---|---|---|
| 1 | Responsive website with accounts and isolated data | First public MVP; retain the current core workflow |
| 2 | macOS app with a menu-bar timer and queue | Prefer a small SwiftUI companion using the same API if native integration is the goal; choose packaging after validating the web beta |
| 3 | macOS/iOS widgets and an iOS app | Shared API/auth, native timer state synchronization, platform-specific lifecycle handling |

Apple provides [MenuBarExtra](https://developer.apple.com/documentation/swiftui/menubarextra) for a Mac menu-bar interface and [WidgetKit](https://developer.apple.com/documentation/widgetkit) for widgets. These require native work; an installable website alone does not provide those integrations. Design widget content around a current timer, today's focus, and the next task, without assuming an unrestricted background process or a refresh every second. Resolve timer ownership/conflicts across devices before exposing Start/Stop in several clients.
