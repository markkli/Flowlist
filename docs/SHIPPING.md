# Release status

Updated October 10, 2026. The cleanup was completed in `2cb52f3`. The approved
Mac beta launch work is on `codex/mac-beta-launch`. The Cloudflare build now
includes the browser workspace; the account API still runs on Render.

## Public download

The product website is hosted at `https://flowlist-beta.pages.dev/`.
Mac beta `0.5.0` is published in
[GitHub Releases](https://github.com/markkli/Flowlist/releases/tag/mac-v0.5.0).
Its public ZIP was downloaded without authentication and its byte count and
SHA-256 verified before enabling `frontend/public/releases/mac.json`.
The package requires Apple silicon and macOS 14 or later, is ad-hoc signed,
and does not include the desktop widget. Native tests, the bundled WebKit
workspace smoke check, and the website download interaction were checked.

## Prepared in this branch

- Public product and download pages, with a separate static hosting build.
- Browser workspace at Cloudflare `/app/`, with same-origin Google PKCE and a
  private API proxy. Static login configuration does not wait for Render.
- Mac Google/guest entry and email-code support gated by sender configuration.
- Guide followed by once-per-device menu-bar setup. Mac settings can change the
  menu choice later. No repeated notification permission prompt is added.
- Durable Plan-create receipts and native retry support. A lost response can
  retry without creating a duplicate. Legacy ambiguous uploads remain guarded.
- Ad-hoc signed, architecture-labelled Mac ZIP; checksum verification and a
  draft-release workflow. The desktop widget is omitted from this distribution.

## External steps still required

1. Optionally purchase a custom website domain and connect its DNS to the
   existing Cloudflare Pages project. A domain is needed for the email sender.
2. Verify a sending domain in Resend, configure Supabase SMTP/code templates,
   and test a real email sign-in before enabling it publicly.
3. Deploy API migration `20260928_16`, then intentionally enable open signup in
   both the API and Supabase. Check Google OAuth audience settings.
4. Test the actual ZIP's first-run approval on another Mac/fresh account; that
   installation check has not been completed on a separate Mac.
5. Allow the Cloudflare `/app/?auth=google` return URL in Supabase before the
   frontend cutover. The Render account API still has cold starts; migrating
   that service is separate from this browser-interface deployment.

Future downloads must remain unavailable until their ZIP exists at a verified
public URL. Apple sign-in, notarization, App Store distribution, automatic
updates, and a distributable desktop widget remain deferred.

See [WEBSITE-LAUNCH.md](WEBSITE-LAUNCH.md) for the exact commands and provider
settings. [REPOSITORY-REVIEW.md](REPOSITORY-REVIEW.md) remains the historical
cleanup review; its observations should not be mistaken for current release
validation.

Future iOS clients can share saved account data. Live timer handoff and
concurrent-edit conflict handling are separate work, not implied by account sync.
