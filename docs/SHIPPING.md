# Release status and next phase

Updated September 28, 2026. Repository cleanup is the current phase. The following
product changes remain proposals until the owner approves proceeding.

## Current state

The hosted beta provides the shared Home, Plan, and History workspace through
FastAPI and Supabase authentication. The Mac development build bundles that same
interface and adds local Plan/session saving, background account sync, a compact
menu timer, and a WidgetKit target. Native Google sign-in and guest use exist.

Local signing/build success is not distribution readiness. The Mac has no
notarized download, updater, or App Store release process yet. Pending sync
limitations and remaining manual integration checks are listed in
[REPOSITORY-REVIEW.md](REPOSITORY-REVIEW.md).

## Proposed next phase — not implemented in the cleanup

1. An explanatory product home page and a Mac download page. Decide whether to
   keep the current web workspace at a separate path/subdomain before replacing
   it; existing users and auth redirects must keep working.
2. A first-launch choice of Google, Apple, email, or guest. Guest data stays local;
   any later transfer to an account should be an explicit, reviewable action.
3. The Guide, followed by menu-bar and widget setup prompts. Explain what is
   already enabled and avoid repeatedly asking for granted permissions.
4. A distribution choice: direct notarized download or App Store. Resolve signing,
   installer/update delivery, privacy information, and support/recovery first.

Future iOS clients can share account data through the existing API. Active timer
handoff and concurrent editing require explicit conflict rules; saving records
to the same account alone does not implement those features.

## Existing operational guides

- [Render setup](RENDER-SETUP.md)
- [Authentication, PostgreSQL, backups, and local-data import](BETA-SETUP.md)
- [Invite-only tester onboarding](TESTER-ONBOARDING.md)
- [Open signup configuration](OPEN-BETA.md)
- [Mac build/signing and current sync limitations](../macos/README.md)

These are distinct deployment/access modes. Do not apply every guide to a single
environment or assume that a documented configuration has been deployed.
