# Current product behavior

## Plan and priorities

Projects contain tasks and one subtask level. The shared Tasks list is flat.
Every task has a completion checkbox; parents also have a disclosure arrow.
Completing a parent completes its children, while completing children leaves the
parent open. Reopening a child reopens its ancestors. Project progress counts
both levels. A project can close after its top-level tasks are finished.

Star tasks in Plan to add them to **Priority tasks** on Home. This persistent
shortlist has its own order and does not reset each day. Removing a priority
leaves the task in Plan. Completed tasks and closed projects are hidden from the
shortlist; reopening can restore them. The floating navigator appears on long
plans. Adding a task during focus uses a destination tree with the same depth limit.

## Focus and session review

Start without choosing a task. Defaults are 25 minutes of focus, 5 minutes of
rest, and a 15-minute long break after four rounds. Timer settings apply to the
next session. Breaks start automatically; the next focus requires an explicit
start. Skip credits elapsed focus only. Pause and break time are excluded.
Sleep recovery never invents additional unattended focus rounds.

Ending focus opens a note field and task selection. **Worked on** records
progress; **Finished** also completes the task in Plan. Finished implies Worked
on and includes children when applied to a parent. Time is counted once across
all selected tasks. Save later retains the draft; Discard asks for confirmation.

Browser drafts are device/account-scoped, and tabs coordinate with Web Locks
where supported. The Mac timer/review persist atomically in account-specific
files. A stable session UUID prevents duplicate saves after a lost response.
Clearing browser storage can remove unsaved web work; it is not a cloud backup.

## History and activity

History opens to today and the preceding six days in the device timezone.
Arrows move seven days; the Today button returns to the current window. The grid
covers 24 hours with vertical scrolling and proportional focus blocks. Sessions
under five minutes appear in a consistent brief-session row. Clock-change days
use entries with explicit offsets instead of misleading time geometry.

New records retain actual focus intervals. Notes and task selections describe the
whole session, including multiple intervals. Legacy aggregate-only records appear
below the grid by save date; no intervals are invented.

Editing a historical record never changes Plan completion. Removed-task
snapshots remain readable. Revision checks reject conflicting edits. Deletion
hides a record from totals, offers Undo, and can be reversed through Show deleted.
There is no permanent record purge control.

Activity splits midnight crossings and rounds minutes once per session. The
heatmap uses five levels based on session counts. Streaks require at least one
focused minute per day. The sidebar's weekly count uses Monday-aligned weeks;
the rolling History window is independent of that weekly summary.

Export produces versioned JSON with Plan, priorities, saved history, soft-deleted
records, and focus blocks. It excludes credentials, appearance preferences, and
unsaved drafts. There is no import UI; retain database/local-file backups.
Optional server AI title enrichment is disabled by default. When enabled, it
runs after saving a fallback title; the original note is retained.

## Reminders, appearance, and Guide

Automatic focus/break boundaries show an in-app notice and optional chime. The
first Pomodoro start offers notification permission; already-granted permissions
and opt-outs are respected. Manual Skip/End do not emit completion alerts.
Browser reminders need an open tab and may be delayed by sleep/suspension. Native
reminders also depend on OS permissions and Focus settings.

Grove, Coast, and Hills artwork and Linen, Sage, Slate, and Clay solids coordinate
workspace colors in light/dark modes. Focus and Plan artwork can be disabled
independently. Appearance is stored on the device. See [asset provenance](APPEARANCE-ASSETS.md).

The first authenticated visit opens a seven-step Guide; it can be replayed from
the toolbar. A failed example has a recovery exit. Supported web APIs supply a
marked sample project; older servers and the signed-in Mac use isolated practice
controls. See [OPEN-BETA.md](OPEN-BETA.md) for web onboarding/version details.

## Data migration boundaries

Migration `20260919_11` flattens legacy deeper tasks while preserving identities,
completion, history, and priorities; rollback rejects conflicting structural
edits. `20260919_12` adds focus intervals and rejects downgrade that would lose
recorded blocks. Legacy learning projects migrate to Projects without changing
IDs. Keep these revisions and compatibility readers for existing users.
