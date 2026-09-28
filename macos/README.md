# Flowlist for Mac

The macOS 14+ app lives alongside the web dashboard and FastAPI service. Its main
window bundles the existing website UI in WKWebView, so dashboard cards, Plan,
History, themes, and Guide share the same implementation. SwiftUI owns the compact
menu panel; `FlowlistCore` owns the timer, local data, and widget snapshot. There
are no third-party native dependencies.

## Run locally

```sh
cd macos
bash scripts/build-local.sh
open build/Flowlist.app
```

Install frontend dependencies once with `cd frontend && npm ci` from the repository
root. The Mac build needs Node.js/npm and runs the frontend build before Swift.
Xcode builds also rebuild the dashboard automatically; neither workflow ships an
old `frontend/dist` directory. Homebrew Node is detected when Xcode launches from
Finder. Other Node installations must be available on Xcode's `PATH`.

This produces an ad-hoc-signed development app for the current Mac architecture,
not a notarized installer. Closing the window leaves the menu timer running.
Use **… → Quit Flowlist** in the menu panel to quit explicitly.

## Implemented

- Compact menu dial with Start, Pause, Resume, round indicators, and Finish.
  Finish opens Today in the main app; the panel never embeds a record editor.
- The website's Today, Plan, and History inside the app, plus keyboard navigation (⌘1–3).
- Projects, standalone tasks, one subtask level, completion, rename, deletion,
  and priorities. Task creation uses a destination tree. Projects can close when
  all tasks are finished; completed items can be shown and reopened.
- Finish review with a note, **Worked on**, and **Finished**. Completing a parent
  completes its children; completing a child leaves its parent open.
- Rolling seven-day history with arrows, a full-day time grid, proportional
  blocks, and separate brief-session summaries. Record editing does not alter Plan.
- Coast, Grove, Hills, Linen, Sage, Slate, and Clay with matching controls;
  light/dark appearance, independent card artwork, and optional login startup.
- OS-scheduled focus/break reminders, optional chime, and one-time opt-in.
- Local Google sign-in via ASWebAuthenticationSession and Supabase PKCE, verified
  against the existing API. Access/refresh tokens live only in Keychain.
- Account-specific cached Plan and history, and a persisted session upload queue.
  A session UUID is reused on every retry to avoid duplicate uploads.

Breaks start automatically. A completed break waits for **Start focus**.
Paused time is excluded, and sleep never creates unattended later rounds.
Timer and review state survive restart. Notifications depend on macOS permission,
Focus settings, and sleep; fallback chimes require a running app.

## Connect the existing beta account

In Supabase **Authentication → URL Configuration → Redirect URLs**, add exactly:

```text
flowlist://auth-callback
```

Keep the existing website URLs. This is an additional native callback, not a new
Google client or a change to Google's existing Supabase redirect URI. Then open
Flowlist **Account → Continue with Google**. The existing beta access rules still
apply. No client secret, database URL, or service-role key belongs in the app.

Native sign-in needs a real browser/account pass after this dashboard setting is
saved. Automated tests use a substituted network and memory-only credentials;
they do not claim to verify Google's production redirect or macOS Keychain prompts.

## Local data and synchronization

- Guest data: `~/Library/Application Support/Flowlist/workspace.json`.
- Account data: `~/Library/Application Support/Flowlist/accounts/<user-uuid>/workspace.json`.
- Files are atomically replaced with owner-only permissions. Unknown/damaged
  files are preserved and mutations disabled, with a recovery message.
- Signing in/out switches files; it does **not** upload or import a guest's work.
  Finish/save the active session before switching accounts. Pending account
  uploads stay in that account's file when signed out.
- Timer/session saving works offline. Signed-in Plan changes require a connection;
  uncertain mutations are not automatically repeated. Refresh before retrying.
- Sync runs at sign-in, save, refresh, app activation, and connectivity recovery.
  Session uploads use the existing server's idempotency key, and history edits use
  revision checks. Missing tasks keep the session pending for explicit resolution.
- Pending uploads cannot be edited/deleted while their server result is uncertain.
  After acknowledgement, edit the corresponding cloud history record normally.
- History initially caches 100 records, supports older-page loading, and fetches
  the displayed calendar window separately. Cached data remains available offline.

The **Mac menu, app, and desktop widget share one timer**. The existing web timer
is still independent: saved work syncs, but an active countdown does not transfer
between devices. Use one running timer at a time. Cross-device timer ownership
and conflict warnings remain a separate feature, not an implied part of sync.

## Bundled dashboard

`scripts/build-web.sh` builds `frontend/` and stages the complete output into
`Sources/FlowlistMac/Resources/WebUI/`. This generated folder is excluded from Git.
The installed app has `Contents/Resources/WebUI/index.html` and its original asset
directory structure. SwiftPM preserves the same tree under its resource bundle's
`Resources/WebUI/` directory. The widget excludes the web bundle entirely.

For a direct `swift run` or `swift build`, run `bash scripts/build-web.sh` first.
The local packaging script and Xcode build phase already do this every time.

## Test and inspect

```sh
bash scripts/test.sh
bash scripts/preview-ui.sh
bash scripts/verify-web.sh
xcodebuild -project Flowlist.xcodeproj -scheme Flowlist -configuration Debug \
  -derivedDataPath build/Xcode CODE_SIGNING_ALLOWED=NO build
```

Tests cover deadlines, pause/sleep, persistence, old prototype files, hierarchy,
account separation, PKCE, API date/payload formats, offline retry, refresh tokens,
missing tasks, and native local CRUD. Sync tests use URLProtocol and a memory
credential vault; no live account is contacted. Native preview rendering captures
the compact menu views; the WebKit smoke test covers the main workspace.
Both write only the app's own views into `build/previews/`, never the user's desktop.
The WebKit smoke test briefly presents a separate test app with synthetic
tasks and a disposable workspace file. It exercises the actual bundled page,
timer settings, Plan hierarchy, History, appearance, and session review through
the native bridge, and saves `web-*.png` snapshots. It never signs in or loads
personal workspace files.

## Desktop widget

The checked-in Xcode project contains the app and WidgetKit extension. Small and
medium widgets show the countdown and landscape; clicking opens Today. Start is
in the app for this version. The widget never owns a separate timer.

1. Open `Flowlist.xcodeproj`; select your signing team for **both** targets.
2. Both targets use `$(TeamIdentifierPrefix)dev.flowlist.shared`. Keep the app-group
   values in their Info.plist files and entitlements identical.
3. Run the Flowlist scheme, launch the app once, then use macOS **Edit Widgets**.
4. Check focus → rest → ready, pause, and the Today link with the main window closed.

Unsigned compilation has been checked. Signing, registration in the widget gallery,
and notification delivery still need a manual Mac integration pass. The SwiftPM
local package intentionally omits the extension/app group. Do not assume an unsigned
Xcode build is enough to register a working widget.

Logging into Xcode alone does not select the project's signing team or create a
signing identity. A Personal Team can be selected for local testing; verify the
signed app and widget before deciding whether paid distribution membership is
needed. macOS team-prefixed app groups do not require separate group registration,
but their prefix must match the team in both code signatures.

`generate-project.py` preserves existing per-target signing selections. For a
local setting that does not appear in the tracked project, copy
`Configuration/Signing.local.xcconfig.example` to
`Configuration/Signing.local.xcconfig` and put your team ID there. Both targets
include this ignored optional file. Explicit signing choices made in the Xcode
target settings take precedence over the config file. Do not commit private
signing material or another developer's team configuration.

Regenerate after adding source/resource files:

```sh
python3 scripts/generate-project.py
```

## Before distributing to testers

Verify Google login and account isolation with two real accounts, offline/relaunch
recovery, notifications, and the signed widget. Then add Developer ID signing,
notarization, a versioned installer, and an update mechanism. This is a development
build, not yet a distributable Mac beta. No web deployment or live database migration
is required for these native changes; the pending web Guide migration stays separate.
Until the deployed API supports Guide examples, the walkthrough uses practice
controls without adding an example project to the account. A failed Guide request
always offers a way back to the workspace.
