# Flowlist website beta

The application now has email-code and Google sign-in, per-account API isolation, account-scoped browser drafts, account deletion, a PostgreSQL migration, and a same-origin HTTPS deployment configuration. Google is hidden until its provider is configured and `FLOWLIST_GOOGLE_LOGIN=true`. Hosting is not provisioned automatically. The local app remains a separate development environment.

## 1. Create the Supabase development project

Use a dedicated project for this beta. Keep its URL and `sb_publishable_…` key handy. Put the `sb_secret_…` key and database credentials only in hosting/local secret settings. Flowlist uses the secret key only to delete an account's Supabase identity; the browser never receives it.

In Authentication:

- Enable email sign-in, disable anonymous sign-ins, and disable public signups for an invite-only beta.
- Configure a real SMTP sender and verify the sending domain before inviting users. Supabase's default email service is limited and is not a production sender. New Free projects created from June 3, 2026 cannot edit auth templates while using the built-in sender; configure custom SMTP before the template step below. Waiting for the email quota to reset does not unlock template editing. See the [Supabase restriction announcement](https://supabase.com/changelog/46599-changes-to-email-template-customisation-on-free-tier).
- Change the **Magic Link** email template to show `{{ .Token }}` as the sign-in code. The UI accepts a 6–10 digit email code. Do not use the default link-only template: this app deliberately does not consume redirect/hash tokens.
- Leave `FLOWLIST_EMAIL_LOGIN=false` for the Google-only beta. Enable it only after the SMTP sender and code template have been tested. This flag controls Flowlist's email form, not Supabase's provider settings or existing sessions.
- Add the intended HTTPS site URL. Keep redirect URLs restricted; Google's exact callback is described below.
- Add approved users' emails to `FLOWLIST_BETA_EMAILS` and complete their email verification through a Supabase invitation before testing email-code login. Merely creating an unconfirmed user is insufficient: Supabase routes OTP requests for unconfirmed accounts through signup, which fails while public signups are disabled. Keep signups disabled and have the user complete the invitation's verification link. This app does not consume the invitation's returned session tokens; after verification, open the normal Flowlist sign-in page and request a code. Do not administratively mark an unverified email as confirmed without explicit authorization. Both provider signup restrictions and the API allowlist protect the invite-only beta.
- Disable the Supabase Data API if unused. The migration also enables RLS and revokes browser-role grants on app tables.

See [email OTP setup](https://supabase.com/docs/guides/auth/auth-email-passwordless) and [custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp).

### Enable Continue with Google

1. In [Google Auth Platform](https://console.cloud.google.com/auth/overview), create/select a project. Configure Flowlist's branding, support contact, audience, and only the basic `openid`, email, and profile scopes. Google exempts apps requesting only those basic identity scopes from the Testing test-user allowlist. See [Google's current app-state guidance](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview).
2. Create an OAuth client with application type **Web application**. Add the website origin, such as `https://beta.your-domain.com`, as an authorized JavaScript origin.
3. In Supabase **Authentication → Sign In / Providers → Google**, copy the provider callback URL. Add that exact URL to Google's **Authorized redirect URIs**—normally `https://YOUR_PROJECT.supabase.co/auth/v1/callback`. This is Google's return to Supabase, not Flowlist's return URL.
4. Enable Google in Supabase and enter the Google client ID and client secret there. The Google secret does not belong in frontend code or Flowlist's public config.
5. In Supabase's authentication URL configuration, add the exact Flowlist return URL: `https://beta.your-domain.com/?auth=google`. For local auth testing, separately add `http://127.0.0.1:8010/?auth=google` and its origin in Google's client settings. Use the actual test port and hostname consistently; localhost and 127.0.0.1 have separate browser storage. Avoid wildcard production redirects.
6. Set `FLOWLIST_GOOGLE_LOGIN=true` in `.env.beta` and recreate the backend container. The frontend reads this setting at runtime; no frontend rebuild is required.

Keep `FLOWLIST_BETA_SIGNUPS=invite` and provider signups disabled for the initial beta. Pre-create each intended account with its exact Google email address. The Google account must also be listed in `FLOWLIST_BETA_EMAILS`. Do not enable public signups just to work around an invitation error.

The Google flow uses PKCE and must finish in the browser/tab where it started. Flowlist removes callback parameters, exchanges the one-use code through the Supabase SDK, then verifies `/api/account` before opening the workspace. Canceled, expired, or invalid callbacks leave the app locked and offer another Google attempt, or an email code if email login is configured. Only the known Today/Plan/History views can be restored; arbitrary redirect destinations are ignored. Nginx access logs exclude query strings to avoid recording callback codes.

Test on the real HTTPS domain: successful Google login, cancel/back, non-invited email rejection, logout, reload, and switching between Google and email for the same verified email. Verify both methods resolve to the same Supabase user UUID and retain the same Flowlist records. Supabase manages [identity linking](https://supabase.com/docs/guides/auth/auth-identity-linking); Flowlist never merges accounts by a browser-supplied email. Different email addresses remain separate accounts.

Google sign-in itself does not need an SMTP service; the email-code option still does. Google may refuse OAuth inside embedded browsers; use a normal Chrome or Safari window for the hosted acceptance test. No Google credentials or live provider configuration have been created by this implementation task. See [Supabase's Google setup guide](https://supabase.com/docs/guides/auth/social-login/auth-google).

## 2. Choose a domain and a Docker-capable host

For the initial Render beta, follow [RENDER-SETUP.md](RENDER-SETUP.md). It uses
one service and Render's supplied HTTPS address, so a custom domain and the
Compose gateway below are not needed for that deployment.

Point a beta subdomain at the host. Only ports 80 and 443 are public. Caddy provides HTTPS; Nginx serves the built website and proxies `/api` internally. PostgreSQL remains managed by Supabase. The current application needs no native packaging, Kubernetes, or framework rewrite.

Copy `deploy/beta.env.example` to `.env.beta` (ignored by Git), then fill its values using the host's secret settings. URL-encode special characters in database passwords and use `sslmode=verify-full`. The beta containers supply the bundled Supabase CA through `PGSSLROOTCERT`; local administrator commands need that variable set to the absolute path of `backend/certs/supabase-prod-ca-2021.crt`. Use Supabase's session pooler if the host cannot connect to its direct database IPv6 address. Pooler usernames include the project reference, such as `flowlist_api.YOUR_PROJECT_REF`. For a custom Supabase auth domain, update the gateway's `connect-src` CSP to that exact origin.

The frontend gets its public config from `/api/config` at runtime. The same frontend artifact can be promoted to staging/production without embedding privileged keys. Missing auth config fails closed. `FLOWLIST_AUTH_MODE=local` is rejected when `FLOWLIST_ENV=production`.

## 3. Migrate and restrict database access

Take a database backup first. Run the release migration separately from app startup:

```sh
docker compose --env-file .env.beta -f docker-compose.beta.yml --profile release run --rm migrations
```

Run `deploy/database-role.sql` once through an administrator SQL client. Set the new `flowlist_api` password through a secure prompt (`psql` supports `\password flowlist_api`). Use that role in `DATABASE_URL`; use the owner/migration role only in `MIGRATION_DATABASE_URL`. The runtime role can access the app tables but has no DDL, role creation, or access to Supabase's auth schema. Its RLS policy permits the API server to operate; account scoping is enforced by the server's request session, not a client-supplied user ID.

Do not grant `anon` or `authenticated` access to Flowlist tables. Do not run the public beta using the development Compose file.

```sh
docker compose --env-file .env.beta -f docker-compose.beta.yml up -d --build
```

Validate `/api/health`, email delivery, sign-in, logout, refresh, data export, and account deletion on the real HTTPS origin. Confirm anonymous `/api/goals` returns 401 and one invited account cannot see another's work. No public deployment has been performed by the implementation task.

## 4. Preserve your existing local work

The ownership migration adds nullable ownership columns without claiming any record. Local mode sees only unclaimed records; beta users see only their own records. Never assign data to the first person who signs in.

An explicit one-time import is available. Back up the local SQLite file, sign in once to the intended empty beta account, and copy that account's exact UUID from Supabase. Set `DATABASE_URL` to the destination migration connection in the shell environment, without printing it.

```sh
backend/.venv/bin/python backend/scripts/import_local.py --source backend/flowlist.local.db --user YOUR_USER_UUID
# Review the dry-run counts, then repeat with --apply to commit.
```

The source is opened read-only. The destination must be empty. IDs and relationships are remapped in one transaction; titles, reflections, completion, historical timestamps, focus blocks, and queue order are preserved. Unsaved browser rituals are intentionally not imported or claimed. Save them in the local app before the move.

## 5. Release and operations checklist

- Run backend tests, TypeScript/build, unit tests, Chromium browser tests, and the WebKit release checks.
- CI also runs `backend/scripts/verify_postgres.py` against a disposable PostgreSQL database to verify migrations, restricted role access, browser-role denial, queue scoping, and export isolation.
- Configure provider backups and practice a restore into a separate database. Keep staging and production separate.
- Use the host's uptime/health alerting and inspect error logs. Avoid logging Authorization headers, email codes, notes, or session payloads. The app does not yet include a third-party error-monitoring SDK.
- Account deletion removes app content immediately and deletes the Supabase identity. A minimal UUID/deletion-time tombstone prevents stale tokens from recreating the account. If identity deletion fails, the account stays blocked and the delete route allows a retry. Managed backups expire according to provider retention; publish that period and a support contact before inviting people outside the initial test group.
- AI enrichment is disabled for authenticated beta use even if an old server AI key remains configured.
- Timer ownership is per browser, coordinated across its tabs. Cross-device live timer synchronization is not included. Desktop notifications require permission and an open tab; sleep/suspension can delay them.
- The beta is ready for a hosted acceptance test after provisioning, not a claim of production operation. Real SMTP, provider account deletion, TLS/domain setup, backup restoration, and OS notification behavior must be verified on the deployed service.

## Implementation boundaries

`backend/app/auth.py` verifies every supplied access token with Supabase's authenticated user endpoint. It never trusts a browser-decoded JWT. This keeps the initial beta simple and fail-closed; provider unavailability gives a retryable 503 rather than anonymous access.

`backend/app/tenancy.py` applies account criteria to ORM reads, relationship loaders, aggregates, and bulk update/delete operations. API routes must use `get_db`; `SessionLocal` is reserved for health checks, local-only background enrichment, and administrator scripts. Raw SQL is forbidden in user request sessions. Add two-user negative tests whenever adding a new data route.

`frontend/src/shared/account.ts` namespaces user drafts and blocks requests after an account switch. The full app initializes only after `/api/account` verifies the signed-in identity. Signing out freezes existing tabs; signing back in reloads their state before private UI is shown.

## Verification completed locally (September 21, 2026)

- Backend regression and account/import tests passed; frontend build and 11 unit tests passed.
- All 77 Chromium browser tests and 24 WebKit release tests passed. Sign-in was visually checked at phone and desktop sizes in light and dark modes.
- PostgreSQL 16 passed the migration, restricted-role, cross-account isolation, and concurrent-deletion checks.
- Both release images built with clean dependency installation. Compose, Nginx, and Caddy configurations validated. The containerized site served correctly, `/api/health` connected to PostgreSQL, and anonymous `/api/goals` returned 401.
- The local SQLite database was backed up before migration. Counts for every content table were preserved, and existing content remains unclaimed.

Google sign-in additionally has automated coverage for the PKCE challenge/verifier exchange, URL cleanup, view restoration, cancellation, failed exchange, unsolicited/expired callbacks, disabled provider configuration, and invite-only rejection. Browser authentication tests use a simulated provider. Real Google consent, Supabase email delivery, identity linking/deletion, and the public HTTPS origin still require hosted acceptance testing after configuration.
