# Flowlist for Mac

The native macOS 14+ app lives alongside the web dashboard and FastAPI service.
SwiftUI owns the windows and menu panel; `FlowlistCore` owns the timer, local data,
and shared widget snapshot. There are no third-party native dependencies.

## Run locally

```sh
cd macos
bash scripts/build-local.sh
open build/Flowlist.app
```

This produces an ad-hoc-signed development app for the current Mac architecture,
not a notarized installer. Closing the window leaves the menu timer running.
Use **… → Quit Flowlist** in the menu panel to quit explicitly.

## Implemented

- Compact menu dial with Start, Pause, Resume, round indicators, and Finish.
  Finish opens Today in the main app; the panel never embeds a record editor.
- Native Today, Plan, History, and Settings, plus keyboard navigation (⌘1–3).
- Projects, standalone tasks, one subtask level, completion, rename, deletion,
  and priorities. Task creation uses a destination tree. Projects can close when
  all tasks are finished; completed items can be shown and reopened.
- Finish review with a note, **Worked on**, and **Finished**. Completing a parent
  completes its children; completing a child leaves its parent open.
- Rolling seven-day history with arrows, a full-day time grid, proportional
  blocks, and separate brief-session summaries. Record editing does not alter Plan.
- Coast, Grove, and Hills with matching controls; native light/dark appearance, solid backgrounds, and optional login startup.
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
Flowlist **Settings → Continue with Google**. The existing beta access rules still
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

## Test and inspect

```sh
bash scripts/test.sh
bash scripts/preview-ui.sh
xcodebuild -project Flowlist.xcodeproj -scheme Flowlist -configuration Debug \
  -derivedDataPath build/Xcode CODE_SIGNING_ALLOWED=NO build
```

Tests cover deadlines, pause/sleep, persistence, old prototype files, hierarchy,
account separation, PKCE, API date/payload formats, offline retry, refresh tokens,
missing tasks, and native local CRUD. Sync tests use URLProtocol and a memory
credential vault; no live account is contacted. Preview rendering captures only
the app's own views into `build/previews/`, never the user's desktop.

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
