# Render private beta

Deploy one Docker web service using the root `render.yaml`. Nginx serves the
website and forwards `/api` to FastAPI over loopback. Render supplies HTTPS and
an `onrender.com` address. Supabase remains the database and identity provider.

## Initial deployment

1. Push the deployment files to the GitHub repository connected to Render.
2. In Render choose **New → Blueprint**, connect `markkli/Flowlist`, and select
   the branch containing `render.yaml`.
3. Name the Blueprint `flowlist-beta`. Verify it creates just one **Free** web
   service, with no Render database or disk.
4. Fill the prompted variables from the ignored local `.env.beta`:
   `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`,
   `SUPABASE_SECRET_KEY`, and `FLOWLIST_BETA_EMAILS`. Set the prompted
   `FLOWLIST_GOOGLE_LOGIN` to `true` once the Google provider is configured.
   Paste only each value, without surrounding quotes or the `NAME=` prefix.
   Use the restricted `flowlist_api` database URL. Do not upload `.env.beta` or
   add `MIGRATION_DATABASE_URL` to the running service.
5. Deploy and wait for the health check to pass. Open the assigned HTTPS URL.
6. In Supabase, set Authentication's Site URL to that exact HTTPS origin. Keep
   public signups disabled. The current beta uses Google sign-in with
   `FLOWLIST_EMAIL_LOGIN=false`; email sending is hidden until custom SMTP and
   its template are ready. Test Google sign-in with the invited
   account, save a task, reload, and verify that it persists.

Google stays hidden until its provider and exact callback are configured. See
[BETA-SETUP.md](BETA-SETUP.md) for that separate setup and release acceptance
checks. If enabling email-code login later, an unconfirmed account must first
complete email verification; OTP login for an unconfirmed account fails while
public signups are disabled. For Google-only onboarding, Google verifies the
email when the tester signs in. Keep public signup disabled.

For adding testers, follow [TESTER-ONBOARDING.md](TESTER-ONBOARDING.md). Changing
the local `.env.beta` alone does not change Render's deployed allowlist.

## Releases and limits

Automatic deployment is disabled. Apply any future Alembic migration as an
explicit release step using the migration credentials, then manually deploy
the tested commit in Render. The initial Supabase schema is already migrated.
The runtime image contains neither local data nor migration credentials.

The Free service sleeps after 15 minutes without incoming traffic, so opening
the website or saving a ritual after a quiet interval may wait for startup.
Use it for owner testing; choose paid compute before a regular-user beta.
The timer runs in the browser, but saving still requires the API to respond.

The API listens only on loopback. Rate limiting conservatively uses Render's
proxy connection address, so users sharing an edge connection can share a
limit. Configure a verified trusted-proxy strategy before increasing scale.

No persistent disk is needed. All durable application data lives in Supabase;
browser drafts remain account-scoped in the browser. Render restarts cannot
erase saved tasks and sessions. The database CA path is supplied by the
Blueprint and resolves inside the container.

References: [Render Blueprints](https://render.com/docs/blueprint-spec),
[Docker services](https://render.com/docs/docker),
[free-service limits](https://render.com/docs/free).

## Local verification (September 22, 2026)

The release image built successfully from a 5.9 MB source-only context. The
non-root container passed checks for the built website and JavaScript, missing
asset and hidden-file denial, security headers, anonymous API rejection,
public configuration filtering, and OAuth query omission from access logs.
Its health endpoint connected to the actual Supabase database with the
restricted runtime role and verified TLS. Live email sign-in and Render's
public HTTPS endpoint still require testing after deployment.
