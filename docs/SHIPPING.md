# Release status

Updated September 29, 2026. The cleanup was completed in `2cb52f3`. The approved
Mac beta launch work is on `codex/mac-beta-launch`; production has not been
replaced by this branch.

## Prepared in this branch

- Public product and download pages, with a separate static hosting build.
- Existing browser workspace at `/app/`, with legacy bookmarks and Google
  callbacks forwarded on the existing origin.
- Mac Google/guest entry and email-code support gated by sender configuration.
- Guide followed by once-per-device menu-bar setup. Mac settings can change the
  menu choice later. No repeated notification permission prompt is added.
- Durable Plan-create receipts and native retry support. A lost response can
  retry without creating a duplicate. Legacy ambiguous uploads remain guarded.
- Ad-hoc signed, architecture-labelled Mac ZIP; checksum verification and a
  draft-release workflow. The desktop widget is omitted from this distribution.

## External steps still required

1. Select and purchase a domain. Create the static hosting project and connect
   its DNS after the branch is reviewed and merged.
2. Verify a sending domain in Resend, configure Supabase SMTP/code templates,
   and test a real email sign-in before enabling it publicly.
3. Deploy API migration `20260928_16`, then intentionally enable open signup in
   both the API and Supabase. Check Google OAuth audience settings.
4. Test the actual ZIP's first-run approval on another Mac/fresh account, publish
   the reviewed release, and promote its checksum-verified public manifest.

The website download button is intentionally unavailable until the ZIP exists
at a verified public URL. Apple sign-in, notarization, App Store distribution,
automatic updates, and a distributable desktop widget remain deferred. The owner
has chosen not to buy Apple Developer membership for this beta.

See [WEBSITE-LAUNCH.md](WEBSITE-LAUNCH.md) for the exact commands and provider
settings. [REPOSITORY-REVIEW.md](REPOSITORY-REVIEW.md) remains the historical
cleanup review; its observations should not be mistaken for current release
validation.

Future iOS clients can share saved account data. Live timer handoff and
concurrent-edit conflict handling are separate work, not implied by account sync.
