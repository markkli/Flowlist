# Flowlist for Mac — local prototype

The native companion lives in the same repository as the web dashboard and API.
It requires macOS 14 or newer. SwiftUI handles the menu bar panel and Today window;
`FlowlistCore` contains the timer and persistence without UI dependencies.

## Try the app without full Xcode

With Apple's Command Line Tools and Swift 6 installed:

```sh
cd macos
bash scripts/build-local.sh
open build/Flowlist.app
```

The build is signed ad hoc for local development, not notarized for distribution.
Do not send this build to beta users as a finished installer. The script builds
for the current Mac's architecture. Closing the main window leaves the menu bar
timer running; use the menu bar's **… → Quit Flowlist** to quit explicitly.

Implemented:

- Menu bar panel: start, pause, resume, finish, open Today or Settings.
- Native Today window, local session history, optional finish note, JSON export.
- Coast, Grove, and Hills artwork and matching control colors.
- Notifications at focus and break boundaries, optional chime, one-time opt-in.
- Persisted deadlines and pause state, atomic writes, sleep/relaunch recovery.
- A single timer store shared by the menu bar and Today window.

Breaks start automatically. A completed break waits for **Start focus**. The app
never credits later unattended rounds after sleep, and paused time is excluded.
Notifications use the OS scheduler; delivery is subject to macOS permissions,
Focus settings, and sleep. Local fallback chimes require the app to be running.

Local data is in `~/Library/Application Support/Flowlist/workspace.json` with
owner-only file permissions. A damaged or unsupported file is not overwritten:
the app displays an error and disables mutations. Keep this directory when
upgrading. No secrets, database credentials, or service-role keys are bundled.

**This build does not sign in or sync with the website.** Local notes and history
remain separate from the user's cloud account. Plan opens the existing dashboard
in the browser. The app makes no API calls. The browser and Mac timers are not
coordinated yet; use one at a time until sync is implemented.

## Tests and visual checks

```sh
bash scripts/test.sh
bash scripts/preview-ui.sh
```

The test script handles the Swift Testing framework locations in both Xcode and
the standalone Command Line Tools. Tests cover boundaries, pause/resume, long
sleep, long breaks, idempotent saving, validation, and storage recovery. Visual
checks render the app's own views to `build/previews/`; they do not capture or
automate the desktop or access the user's workspace data.

## Desktop widget (Xcode required to install)

`Flowlist.xcodeproj` contains the app and an embedded WidgetKit extension. The
small and medium widgets read a shared snapshot, display the countdown/theme,
and open `flowlist://today` when clicked. This is the agreed first-version
fallback: start the timer from Today. Direct interactive widget Start/Pause is
not implemented yet. The widget does not run an independent timer.

After installing and opening Xcode once:

1. Open `Flowlist.xcodeproj` and select a signing team for both targets.
2. Both use `$(TeamIdentifierPrefix)dev.flowlist.shared` for the same Mac app
   group. Keep the Info.plist values and entitlements identical.
3. Select the Flowlist scheme and run. Launch the containing app at least once,
   then add Flowlist through macOS **Edit Widgets**.
4. Verify the snapshot, focus-to-rest boundary, pause display, and Today deep
   link with the main window closed. Widget refresh timing is controlled by macOS.

The project is checked in. To regenerate after adding source/resource files:

```sh
python3 scripts/generate-project.py
```

The local SwiftPM `.app` intentionally has no widget extension or app-group
entitlement. The signed Xcode build is required to test widget installation.
Signing, widget registration, and system notification delivery require a manual
Mac integration pass; compilation alone does not prove these behaviors.

## Next milestone: accounts and sync

Keep the current FastAPI/Supabase service. Before connecting this app:

1. Add native browser-based sign-in with a verified callback and Keychain token
   storage; bind local records to an account only with an explicit import choice.
2. Add an offline upload queue using stable session IDs. Retry safely without
   duplicate history. Preserve locally saved sessions until acknowledged.
3. Fetch Plan/priorities for the local finish screen; reconcile task updates and
   deletions. Never store an admin/service key in the app.
4. Define timer ownership across web and Mac. Show an existing active session
   before starting another; don't silently merge or overwrite timers.
5. Test account switching, revoked sessions, duplicate requests, loss of network,
   background reminders, sleep, and quitting/relaunching.

The existing web timer stays unchanged during this local prototype. The pending
web Guide migration is also separate; this Mac work doesn't require touching the
live database. A distributable beta additionally needs Developer ID signing,
notarization, an update path, and widget installation verification.
