# Public website and Mac beta launch

## Hosting layout

- Public product and download pages: Cloudflare Pages, static output. They make
  no requests to Render or Supabase on load.
- Browser workspace: `https://flowlist-beta.pages.dev/app/`, served by Pages.
- `/api/*`: a same-origin Pages Function forwards requests to the existing
  Render API. It does not cache account responses or retry mutations.
- API and migrations: the existing Render service and Supabase database.
- Mac: bundled workspace, local timer/files; optional account sync to the API.
- ZIP downloads: versioned GitHub Releases, with SHA-256 and byte count displayed
  by the download page. No tracking scripts or third-party fonts.

Render's free API can still sleep before account verification or saved-data
requests. The public pages and browser sign-in interface load from Cloudflare
without waking it. This is a frontend move, not a backend migration. Mac guest
use and local edits do not wait for the API.

## Static hosting first; domain optional

Cloudflare Pages is the selected host. Start with the generated `*.pages.dev`
address; buying a domain is not a prerequisite. The owner signs into Cloudflare
and authorizes the GitHub integration in their own account.

1. In Cloudflare, open **Workers & Pages → Create application → Pages → Connect
   to Git**. Connect GitHub and grant access to `markkli/Flowlist`.
2. Use these initial build settings:

   | Field | Value |
   |---|---|
   | Project name | `flowlist-beta` (or an available alternative) |
   | Production branch | `codex/mac-beta-launch` |
   | Framework preset | `None` |
   | Root directory | `frontend` |
   | Build command | `npm run build:site` |
   | Build output directory | `dist` |
   | Environment variable | `NODE_VERSION=22` |

   No API secrets are needed. The launch branch contains the Cloudflare build;
   `main` still serves the existing app. After the launch branch is reviewed
   and merged, change Cloudflare's production branch to `main`.
3. Before deploying the browser workspace, add
   `https://flowlist-beta.pages.dev/app/?auth=google` to Supabase → Authentication
   → URL Configuration → Redirect URLs. Preserve the existing Render and
   `flowlist://auth-callback` entries. Google still returns to Supabase's callback;
   its provider settings do not change. The new web flow creates and exchanges
   its PKCE verifier on the Cloudflare origin. Do not forward tokens or codes
   from one origin to another.
4. Select **Save and Deploy**, then verify the homepage, `/download/`, and
   **Use in browser**. `/app/` must stay on the Pages address. Sign in with an
   invited account and check Plan/History. Existing saved account data is in
   the same database; users sign in once on the new origin. Browser-only drafts,
   active timers, and appearance choices remain on their original origin.

The site build emits `_worker.js` and `_routes.json`. Only `/api/*` invokes the
Function; public pages, the app HTML, and assets are served directly by Pages.
`/api/config` returns the public snapshot in
`frontend/cloudflare/browser-config.json`, verified against the existing API on
October 10, 2026. The build only includes allowlisted public fields and rejects
secret/service-role keys. When changing providers or signup settings, update
this snapshot and the API settings together. The backend still verifies identity
and invitation access on every account request; the snapshot grants no access.

The proxy uses a fixed API origin, drops cookies, preserves bearer and
idempotency headers, refuses upstream redirects, bounds mutation bodies, and
returns private JSON with `Cache-Control: no-store`. No Cloudflare database or
account credentials are introduced. A separate API migration is required to
eliminate Render's saved-data cold starts.

A custom domain can be added later under the Pages project's **Custom domains**.
The domain is not selected or purchased yet. `getflowlist.app` and
`tryflowlist.com` had no RDAP registration record at the initial check; that is
not a reservation or checkout quote. Confirm availability and registration and
renewal prices before purchasing. Use Cloudflare's supplied DNS record and wait
for HTTPS activation before sharing the custom address.

`npm run build` remains the combined Render build. `--mode native` produces only
the bundled workspace. `--mode site` includes the public pages and browser
workspace, Cloudflare headers, a 404 page, and the API Function. Run
`npm run test:cloudflare` to exercise this output in Cloudflare's local runtime;
login/data tests use mock accounts rather than modifying production data.

## Email sender: Resend → Supabase

Keep `FLOWLIST_EMAIL_LOGIN=false` and the Cloudflare public configuration's
`email_enabled` false until all steps, including a real delivery test, have
passed. Google and Mac guest use remain available.

1. Create a Resend account; add a sending subdomain of the purchased domain,
   such as `auth.YOUR_DOMAIN`. Copy **Resend's actual** DKIM/SPF DNS records into
   Cloudflare DNS, or use its domain connection flow. Do not invent record
   values or overwrite existing mail records. Wait for Verified.
2. Create a Resend API key restricted to sending for that domain. Save it in
   Supabase, not the repository, public frontend, Render, or a chat message.
3. In Supabase → Authentication → Email → SMTP Settings, enable custom SMTP:

   | Field | Value |
   |---|---|
   | Sender name | `Flowlist` |
   | Sender email | `signin@auth.YOUR_DOMAIN` |
   | Host | `smtp.resend.com` |
   | Port | `465` |
   | Username | `resend` |
   | Password | The Resend API key |

4. In Supabase Email Templates, change **Magic Link** and **Confirm signup** to
   show an OTP, not just a link. Suggested subject: `Your Flowlist sign-in code`.
   Minimal body:

   ```html
   <h2>Your Flowlist sign-in code</h2>
   <p>Enter this code in Flowlist:</p>
   <p style="font-size:32px;letter-spacing:6px"><strong>{{ .Token }}</strong></p>
   <p>If you didn’t request this code, you can ignore this email.</p>
   ```

5. Set the email OTP expiry to 600 seconds to match the app's verification
   window. Review Supabase/Resend rate limits for the intended tester count.
6. Enable new users in Supabase and set Render `FLOWLIST_BETA_SIGNUPS=open` only
   when intentionally opening the beta. The Google OAuth project's Audience
   must also allow the desired testers; do not request extra Google API scopes.
7. Temporarily enable `FLOWLIST_EMAIL_LOGIN=true` in a controlled rollout and
   test a new address end to end: one numeric-code email, successful verification,
   account isolation, sign-out/sign-in, and task/session sync. Disable it again
   if delivery or verification fails. Never announce email availability from
   configuration alone.

Official references: [Resend SMTP setup](https://resend.com/docs/send-with-supabase-smtp),
[Supabase custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp).
Email sending does not provide a support inbox; arrange receiving separately
if a reply address is advertised.

## Package and publish

1. Run regression checks. The backend must migrate through `20260928_16` before
   advertising safe Plan-create retries. Existing ambiguous uploads from older
   clients still require review; they cannot retroactively get a retry receipt.
2. `bash macos/scripts/package-beta.sh` writes a ZIP, checksum, and proposed
   manifest under ignored `macos/build/releases/`. It uses ad-hoc signing and
   omits the widget/app-group capability; no personal team ID is distributed.
3. Alternatively run **Prepare Mac beta download** in GitHub Actions. It runs
   native tests, packages the app, and creates a **draft** release. Its build
   architecture is recorded in the archive and manifest. Draft assets are not
   yet public downloads.
4. Test the packaged app on a fresh Mac account (ideally another Mac), including
   the quarantine/Open Anyway flow, Google login, offline guest work, menu timer,
   Guide/setup, reminders, quit/relaunch, and updating an existing installation.
5. Publish the reviewed GitHub release. Check that its repository and assets are
   publicly accessible without signing in. Do not change repository visibility
   merely to enable downloads; use a dedicated public release repository instead
   if the source is private, and update the explicit URL allowlist.
6. Run `python3 scripts/promote-mac-release.py macos/build/releases/mac.json`.
   It downloads the public ZIP, verifies byte count and SHA-256, then updates the
   website's manifest. Commit that manifest and deploy the static site.

Until step 6, the website deliberately says that the Mac download is being
prepared. Never expose a download button pointing at an absent/private asset.

## Rollback

Set `available` to `false` in `frontend/public/releases/mac.json` and redeploy the
static site to withdraw a download. Restore a prior verified manifest to offer
the prior version. Do not remove receipt data during a routine API rollback;
clients that previously used receipts pause if the old API lacks the capability.
