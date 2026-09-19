# Flowlist Design System

**Direction:** Native Mac forest utility

**Updated:** 2026-09-18

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

- Use a compact vertical sticky dot navigator between the app sidebar and direction panels at every supported width. It must remain visible while scrolling, stay above card stacking contexts, and reveal an unclipped label on hover/focus.
- A goal is one collapsible panel containing its heading, controls, active outline, and completed archive. Collapsing hides the body without changing completion state.
- Keep Project, Learning, and Task creation individually reachable in the page header, but style them as quiet text actions rather than three competing primary buttons. Each opens one compact composer.
- Task rows have no horizontal divider or tinted background band. Use whitespace, indentation, and type weight to express grouping.
- Child steps are indented without connector lines or shaded containers.
- Leaf steps show completion. Rename by selecting the title. Add, AI draft, and delete appear in an overlaid hover/focus tray so hidden controls never reserve an empty right column; on touch layouts they remain available with 44px targets.
- Every task row reserves the same disclosure slot and completion slot. Leaves keep an invisible disclosure placeholder; unfinished parents keep a visible but disabled completion box. Titles must never jump horizontally when node state changes.
- Parent steps show direct-child progress and can expand or collapse. Once every direct child is finished, the already-present parent checkbox becomes enabled; completion never rolls up automatically.
- A completed leaf leaves the active outline but its ancestors remain. Closing a completed parent exposes completion at the next level. Reopening any descendant reopens every ancestor while preserving completed siblings.
- Collect all checked work in an expandable list and show its parent path as a restrained breadcrumb. Fully closed top-level directions move to Completed directions.
- Priority controls are forbidden. Sequence communicates what comes first.
- Whole directions move with explicit up/down controls; large panels are not draggable. After a move, viewport position and focus follow the moved control so repeated clicks continue without reacquiring it. Compact task reordering is limited to siblings within the same parent, with Alt+Arrow as its keyboard alternative.
- Do not prescribe a duration for an individual task. Focus time is observed by the Pomodoro, then attributed to work afterward.
- AI-generated milestones and nested steps are proposals: display them as a multi-select list with one explicit “Add selected” action.
- Goal-level controls remain explicit and labelled because they affect the entire direction: move, Add step, AI draft Beta, and Remove. AI planning is never the main action. State that personal planning usually fits pace and preference better, and label every generated proposal as an AI draft.
- Treat the plan as a compact outline, not a stack of nested cards or a diagram made from intersecting lines.
- Keep plan content to a readable desktop measure rather than stretching each task across the entire window.

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
- The end-of-ritual dialog accepts an optional reflection and can create missing work in Tasks, an existing group, or a new project/learning objective before attribution.
- Short meaningful reflections become cleaned history titles; longer reflections and selected-task sets use the title agent. Gibberish becomes General focus, and AI failure always falls back locally without blocking the save.
- The task queue contains only completion, title, and parent context. Keep each title and its project, learning objective, or “Task” label to one line with an ellipsis and native title tooltip for the full text.
- “Task” covers simple personal or administrative work that needs no plan hierarchy. Collect these items in one lightweight list and do not offer AI breakdown or nested-step controls.
- The Pomodoro and queue panels maintain the same intentional height on desktop. The queue scrolls internally when it contains more rows.
- Supporting panels remain quieter and use minimal shadows.
- Activity heatmap always renders its empty cells so the record is visible before data exists. Populated cells expose focused minutes and ritual count on hover and keyboard focus; empty cells have no tooltip.

### History

- Each focus session is one record even when it was attributed to several tasks.
- Show which tasks were worked on and which were finished.
- Provide a compact, explicitly labelled delete control on every record; deletion updates statistics but never reopens completed tasks.

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
- Verify keyboard focus, empty states, long task names, three hierarchy levels, and no horizontal overflow.
