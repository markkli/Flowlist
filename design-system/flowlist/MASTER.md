# Flowlist Design System

**Direction:** Native Mac forest utility

**Updated:** 2026-09-13

**Character:** Quiet, capable, natural, precise

## Product Principles

- Flowlist should feel like a focused desktop instrument, not a generic SaaS dashboard.
- Use one visual surface per concept. Do not place bordered cards inside bordered cards.
- Show hierarchy with order, indentation, dividers, and a subtle guide line.
- Roadmap order is the plan. Do not add P1/P2/P3 labels to learning steps or tasks.
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

### Roadmap

- A goal is one panel containing its heading, controls, outline, and quick-add form.
- Each task is a 48px minimum row separated by a one-pixel divider.
- Child steps are indented 22px and connected by a subtle vertical guide.
- Leaf steps show completion and a single contextual menu for secondary actions.
- Parent steps show progress as completed children over total children.
- Priority controls are forbidden. Sequence communicates what comes first.
- Do not prescribe a duration for an individual task. Focus time is observed by the Pomodoro, then attributed to work afterward.
- AI-generated milestones and nested steps are proposals: display them as a multi-select list with one explicit “Add selected” action.
- Treat the roadmap as a compact outline, not a stack of nested cards. Parent rows use a branch marker and progress copy; leaf rows use a restrained circular completion control.
- Keep roadmap content to a readable desktop measure rather than stretching each task across the entire window.

### Learning Path Questions

- Clarification uses a centered modal with a 40–60% scrim and background blur.
- Ask exactly one question at a time with a visible question count and progress track.
- Keep Back, Close, and keyboard Escape available throughout the flow.
- Place validation next to the answer field and preserve earlier answers when navigating backward.
- Show a clear loading state while preparing questions and generating the path.

### Dashboard

- The Pomodoro card is the strongest surface and may contain the forest horizon artwork.
- The timer dial itself is the primary Start control. Use a subtle play affordance on hover/focus; do not add a competing rectangular Start button below it.
- Starting the clock never requires choosing a task first. Default to 25 minutes of focus, 5 minutes of rest, and a 15-minute long break after four rounds.
- Expose focus length, short break, rounds per cycle, and long break in a dedicated modal. Never put interactive number fields inside the atmospheric timer card.
- Exhibit the current round with text and a small dot sequence on the timer card.
- When focus stops, show a centered attribution dialog over a blurred background. Suggest unfinished leaf tasks in useful order and allow multiple selections.
- Every attribution row has separate “Worked on” and “Finished” controls. Finishing implies worked-on; the session duration is still counted only once. No selected tasks means General focus.
- The task queue contains only completion, title, and parent-goal context. Long task names wrap naturally and never compete with duration labels or per-row focus buttons.
- The Pomodoro and queue panels maintain the same intentional height on desktop. The queue scrolls internally when it contains more rows.
- Supporting panels remain quieter and use minimal shadows.
- Activity heatmap always renders its empty cells so the record is visible before data exists.

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
