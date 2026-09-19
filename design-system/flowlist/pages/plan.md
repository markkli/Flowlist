# Plan page

Updated: 2026-09-19

## Structure

Plan is a compact outline of directions and actionable steps. Keep the forest palette and system typography, with restrained borders and content-sized panels. The title and task list carry the hierarchy; secondary controls belong in an accessible More menu.

- At wide desktop widths, show a named direction index beside the outline. At narrower widths, use a horizontally scrollable strip of named links above it. The page itself must not overflow.
- A direction header has disclosure, a 17–19px editable title, a short type/completion count, Add step, and More. Avoid fixed header heights, large progress bars, and separate toolbar rows.
- Rename, AI draft, Move up/down, and Remove live in More. Keep menu targets at least 44px and render menus in the browser top layer so cards cannot clip them.
- Project, Learning, and Task creation remain available in the page header and each reveal one composer.
- Add and AI draft expand a collapsed direction before revealing their content. Collapse state persists locally.

## Task hierarchy

- Leaves have a completion checkbox and title; do not reserve empty disclosure or drag columns before the title.
- Unfinished sections have a disclosure control and direct-child count. When all their children are complete, replace disclosure with a completion checkbox and “Ready to close.” Completion remains manual.
- Use compact indentation, subtle vertical guides, and stronger section titles. Keep each task in one row when its title fits, including on touch layouts.
- More provides Rename, Add smaller step, AI draft, Move up/down, and Remove where eligible. Leaf tasks also provide Add to / Remove from focus queue.
- Mouse users can drag the trailing handle within a sibling group. Alt+Up/Down and menu actions provide keyboard alternatives.
- Menus support arrow keys, Home/End, Escape, and focus return. Inline rename restores focus on save or Escape.
- Shared Tasks stays flat. It has no hierarchy placeholders, substeps, or AI drafting.

## Completed work

- Finished nodes appear in the expandable Completed list with their ancestor path. Reopening restores the ancestor chain without reopening completed siblings.
- A direction can close after every root section is manually complete. Show the close action beside a concise completion note in the body.
- Completion has an Undo toast; deletion requires confirmation.

## Queue

- Today contains a persistent, manually selected shortlist independent of Plan order.
- Choose tasks / Edit queue opens a searchable picker grouped by direction, with selection count and an expandable order editor.
- Only unfinished leaf tasks in active directions are eligible. Save replaces the queue; Cancel/Escape discard the draft.
- Queue row menus move items or remove membership. Removing from the queue never deletes the Plan task.
- Completion filters a task from the queue. Undo reopens it in its previous position, unless the queue has since been explicitly replaced.
- The picker traps focus, restores its opener, handles errors without losing selections, and fits narrow/short viewports.

## AI

AI drafting remains secondary and marked Beta. Learning questions and generated proposals are drafts. Never add suggestions automatically: require selection and Add selected.

## Responsive checks

Check 375px, tablet, short landscape, and desktop in both themes. Preserve visible keyboard focus and 44px primary touch targets. Long titles wrap in Plan; queue titles expose full text via their title attribute and picker.
