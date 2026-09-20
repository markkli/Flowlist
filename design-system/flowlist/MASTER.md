# Flowlist Design System

**Direction:** Native Mac forest utility

**Updated:** 2026-09-19

**Character:** Quiet, capable, natural, precise

## Product Principles

- Flowlist should feel like a focused desktop instrument, not a generic SaaS dashboard.
- Use one visual surface per concept. Do not place bordered cards inside bordered cards.
- Show hierarchy with order, indentation, spacing, and type weight. Do not substitute faint bands or wide tinted strips for divider lines.
- Plan order communicates sequence. Do not add P1/P2/P3 labels to learning steps or tasks.
- Nature imagery is a quiet atmospheric anchor, not decoration on every panel.
- Keep language plain and direct. Avoid motivational filler and poetic UI copy.
- Light and dark modes are equal products, not color inversions of one another.

## Color

The supplied five-color palette is the visual foundation.

| Role | Light | Dark |
|---|---|---|
| Canvas | `#e8e5dd` | `#0c0a08` |
| Primary surface | `#f4f1ea` | `#171914` |
| Raised surface | `#fcfaf5` | `#1d211a` |
| Ink | `#0c0a08` | `#e8e5dd` |
| Forest action | `#2a3723` | `#b9bba8` |
| Sage support | `#b9bba8` | `#2a3723` |
| Warm accent | `#dcbc98` | `#dcbc98` |
| Destructive | `#9a4439` | `#e29787` |

Use warm accent sparingly. Forest is the main action and progress color. Borders should be translucent and quiet; never use dark outlines around every nested element.

## Typography

- Use the native system stack: `-apple-system`, `BlinkMacSystemFont`, `SF Pro Text`, `Helvetica Neue`, sans-serif.
- Headings are compact and semibold, with slightly tightened letter spacing.
- Small uppercase kickers may identify sections, but never substitute for clear headings.
- Use tabular numerals for timers and statistics.

## Layout and Density

- Desktop: 232px sidebar, 57px translucent toolbar, flexible content workspace.
- Mobile: sidebar becomes a compact top navigation; no horizontal scrolling at 375px.
- Base spacing rhythm: 4, 8, 12, 16, 24, 32px.
- Default content radius: 12px; large feature surface: 18px; compact controls: 7px.
- Use balanced density: concise rows and generous section spacing.

## Core Components

### Plan

- Follow [the Plan page specification](pages/plan.md) for its authoritative layout and interaction details.
- Use a fixed, narrow vertical rail on long plans. Hide it when the whole plan fits; show direction labels only on hover or focus. Never use horizontal direction chips.
- Use an atmospheric forest page cover related to the Pomodoro panel, followed by a quiet creation toolbar. Direction headers stay content-sized with title, concise counts, Add, and More.
- Every task has a checkbox. Parents additionally have a disclosure arrow. Allow only tasks plus one subtask level; explicit parent completion cascades down, while child completion never rolls up. Finished subtasks stay inline beneath an open parent.
- Preserve explicit parent completion, ancestor reopening, completed archives, and AI draft selection before insertion. Ritual checkout offers every unfinished level; parent selection cascades to subtasks.
- Reordering remains within sibling groups, with keyboard/menu alternatives to dragging. Plan order and the manually chosen focus queue order are independent.
- Use feature-owned styles in `frontend/src/features/plan/plan.css`; avoid adding conflicting Plan rules to the global stylesheet.

### Learning Path Questions

- Clarification uses a centered modal with a 40–60% scrim and background blur.
- Ask exactly one question at a time with a visible question count and progress track.
- Keep Back, Close, and keyboard Escape available throughout the flow.
- Place validation next to the answer field and preserve earlier answers when navigating backward.
- Show a clear loading state while preparing questions and generating the path.

### Dashboard

- The Pomodoro card is the strongest surface and uses the full-bleed `focus-grove.webp` woodland artwork under a legibility gradient. Atmospheric art must touch every card edge without exposed background gaps.
- The timer dial itself is the primary Start control. Use a subtle play affordance on hover/focus; do not add a competing rectangular Start button below it.
- Theme the primary dial independently: dark mode uses a deep forest center with a warm sand ring, while light mode uses a cream center, dark numerals, and a restrained forest progress ring.
- Starting the clock never requires choosing a task first. Default to 25 minutes of focus, 5 minutes of rest, and a 15-minute long break after four rounds.
- Expose focus length, short break, rounds per cycle, and long break in a dedicated modal. Never put interactive number fields inside the atmospheric timer card.
- Exhibit the current round with text and a small dot sequence on the timer card.
- Every running focus, short-break, and long-break block exposes “Skip to next.” Skipping focus advances the round but records only fully elapsed focus minutes; skipping a break begins the next focus block. Keep “End ritual” available as the exit route.
- Continue from focus to break and into later cycles without interrupting the ritual. Show the centered attribution dialog only when the user chooses “End ritual,” and save the accumulated focus time as one record without presenting a target-time ratio.
- Every deliberate Start begins a fresh ritual at round one. A long break follows every configured set of rounds, after which the round count begins again while the ritual continues.
- Keep “Add to plan” available during focus and breaks in a nested modal that does not pause or dismiss the running timer. It captures one task into the shared Tasks list or an existing active project/learning objective; creating an entirely new direction stays in the full Plan view.
- Every attribution row has separate “Worked on” and “Finished” controls. Finishing implies worked-on; the session duration is still counted only once. No selected tasks means General focus.
- Missing-task capture starts with a task name and Add task. State that it creates a Plan task marked Worked on; keep the destination behind a Save to disclosure, defaulting to Tasks. Do not discard a typed, unadded task on ritual save.
- The end-of-ritual dialog accepts an optional reflection and can create missing work in Tasks, an existing group, or a new project/learning objective before attribution.
- Preserve every reflection. Save a local history title immediately; longer reflections and multi-task sets may receive an optional title update after saving. AI failure never prevents saving or removes the note.
- The task queue is a persistent shortlist chosen by the user, independent of Plan order. Choose tasks / Edit queue opens a searchable picker with selection and order controls. Each row offers completion, title/context, and a quiet menu for movement or membership removal. Finished tasks disappear; Undo restores them. The queue has no daily reset.
- “Task” covers simple personal or administrative work that needs no plan hierarchy. Collect these items in one lightweight list and do not offer AI breakdown or nested-step controls.
- The Pomodoro and queue panels maintain the same intentional height on desktop. The queue scrolls internally when it contains more rows.
- Supporting panels remain quieter and use minimal shadows.
- Activity heatmap always renders its empty cells so the record is visible before data exists. Populated cells expose focused minutes and ritual count on hover and keyboard focus; empty cells have no tooltip.

### History

- Follow [the History specification](pages/history.md) for the weekly timeline, record editing, and export.
- Record focus intervals separately from save time. Never fabricate times for older records.
- Each focus session is one record even when it was attributed to several tasks.
- Show which tasks were worked on and which were finished.
- Provide a compact, explicitly labelled delete control on every record, followed by Undo. A deleted-records view supports later restoration. Deletion updates statistics but never reopens completed tasks.

### Controls

- Buttons and fields need visible keyboard focus using the theme focus-ring token.
- Desktop controls may be compact; touch layouts use a minimum 44px target.
- At narrow widths, keep primary controls and overflow menus at least 44px tall without inventing extra per-task actions.
- Hover must not move surrounding layout.
- Destructive actions use restrained red text rather than oversized red surfaces.

## Motion

- Interaction transitions: 150–220ms ease.
- Timer changes should feel smooth and stable; avoid bouncing, overshoot, and entrance cascades.
- Respect `prefers-reduced-motion` and disable nonessential animation when requested.

## Accessibility and QA

- Text contrast: WCAG AA or better.
- Every icon-only control has an accessible label.
- Use consistent inline SVG icons; no emoji icons.
- Verify light and dark modes at 375, 768, 1024, and 1440px.
- Verify keyboard focus, empty states, long task names, two task levels, and no horizontal overflow.

## Reliability and Recovery

- Running focus can minimize into a persistent bottom bar; reserve content space and respect safe-area insets.
- Escape minimizes the timer or keeps attribution for later. Only explicit confirmed Discard removes an unsaved ritual.
- Preserve the current block, accumulated time, reflection, and task selections through refresh. Show unsaved rituals in the bottom bar.
- Keep session saves retryable without duplicate records. Show actionable errors and retain form values.
- Use the browser timezone consistently for activity and streaks, align the heatmap to Monday, and show a true weekly sidebar count.
- Progress counts both parents and subtasks, so unchecked parents never appear as a fully complete direction.
- Keep Plan headers compact at narrow widths. Preserve the established forest palette and system typography.

## Brand assets

Use `/brand/flowlist-mark.svg` for the ambient, flowing F app mark and `/favicon.svg` for its small-size variant. Use a deep petrol tile, a restrained mint glow, and a crisp flowing silhouette. Keep the ambient color treatment inside the mark; the app retains its forest palette.
