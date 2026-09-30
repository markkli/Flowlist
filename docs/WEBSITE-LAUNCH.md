# Public website and Mac beta launch

## Hosting layout

- Public product and download pages: Cloudflare Pages, static output. They make
  no requests to Render or Supabase on load.
- Optional browser workspace: `https://flowlist-beta.onrender.com/app/`.
- API and migrations: the existing Render service and Supabase database.
- Mac: bundled workspace, local timer/files; optional account sync to the API.
- ZIP downloads: versioned GitHub Releases, with SHA-256 and byte count displayed
  by the download page. No tracking scripts or third-party fonts.

Render's free service can still sleep before cloud sign-in/sync or browser use.
Separate static hosting removes that dependency from the public website. It does
not make the API always awake. Mac guest use and local edits do not wait for it.

## Domain and static hosting

The domain is not selected or purchased yet. `getflowlist.app` and
`tryflowlist.com` had no RDAP registration record at the initial check. That is
not a reservation or checkout quote. Confirm registration and renewal prices
before purchasing. The owner performs purchases in their own account.

1. Register the chosen domain with Cloudflare Registrar. Enable account 2FA.
2. Create a Cloudflare Pages project connected to `markkli/Flowlist`.
3. Production branch: `main` **after the release branch has been reviewed and
   merged**. Root directory: `frontend`. Build command: `npm run build:site`.
   Build output: `dist`. Node version: `22`. No API secrets are needed.
4. Add the purchased domain under the Pages project's Custom domains. Use the
   DNS record Cloudflare supplies. Wait for HTTPS activation before sharing it.
5. `/app/` redirects to the existing Render workspace. Do not change Supabase's
   Site URL or Google callback to the static site: the browser's PKCE verifier
   remains on the Render origin. Keep `flowlist://auth-callback` for Mac.

`npm run build` remains the combined Render build. `--mode native` produces only
the bundled workspace. `--mode site` produces only the static public pages,
Cloudflare headers, a 404 page, and the workspace redirect.

## Email sender: Resend → Supabase

Keep `FLOWLIST_EMAIL_LOGIN=false` until all steps, including a real delivery
test, have passed. Google and Mac guest use remain available.

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
