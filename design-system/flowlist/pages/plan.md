# Plan page

Updated: 2026-09-19

## Structure

Plan is a compact outline of directions and actionable steps. Keep the forest palette and system typography, with restrained borders and content-sized panels. The title and task list carry the hierarchy; secondary controls belong in an accessible More menu.

- On long plans, use a fixed vertical rail of short marks at the viewport edge. It stays in place while the page scrolls, takes minimal width, and exposes labels on hover or keyboard focus. Hide it when the plan fits the viewport. Reserve its gutter beside both the header and outline.
- The page has an atmospheric forest cover echoing the Pomodoro, with a quiet icon-and-label creation toolbar. Each direction has disclosure, a 17–19px editable title, a short type/completion count, Add step, and More.
- Rename, Move up/down, and Remove live in More. Keep menu targets at least 44px and render menus in the browser top layer so cards cannot clip them.
- Project, Learning, and Task creation remain available in the page header and each reveal one composer.
- Add expands a collapsed direction before revealing their content. Collapse state persists locally.

## Task hierarchy

- Leaves have a completion checkbox and title; do not reserve empty disclosure or drag columns before the title.
- Tasks support only one subtask level. Every task always has a checkbox; parents also have disclosure and a subtask count. Explicitly completing a parent completes its descendants. Completing all subtasks never checks the parent. Keep finished subtasks visible under an open parent.
- Use compact indentation, subtle vertical guides, and stronger section titles. Keep each task in one row when its title fits, including on touch layouts.
- More provides Rename, Add smaller step, Move up/down, and Remove where eligible. Leaf tasks also provide Add to / Remove from focus queue.
- Mouse users can drag the trailing handle within a sibling group. Alt+Up/Down and menu actions provide keyboard alternatives.
- Menus support arrow keys, Home/End, Escape, and focus return. Inline rename restores focus on save or Escape.
- Shared Tasks stays flat. It has no hierarchy placeholders, substeps, or AI drafting.

## Completed work

- Finished root tasks and their descendants appear in Completed with ancestor paths. Finished subtasks of an open parent stay inline. Reopening restores the ancestor chain without reopening completed siblings.
- A direction can close after every root section is manually complete. Show the close action beside a concise completion note in the body.
- Completion has an Undo toast that restores the exact previously unfinished subtree; deletion requires confirmation. Restore keyboard focus after rerendering a checked row.

## Queue

- Today contains a persistent, manually selected shortlist independent of Plan order.
- Choose tasks / Edit queue opens a searchable picker grouped by direction, with selection count and an expandable order editor.
- Only unfinished leaf tasks in active directions are eligible. Save replaces the queue; Cancel/Escape discard the draft.
- Queue row menus move items or remove membership. Removing from the queue never deletes the Plan task.
- Completion filters a task from the queue. Undo reopens it in its previous position, unless the queue has since been explicitly replaced.
- The picker traps focus, restores its opener, handles errors without losing selections, and fits narrow/short viewports.

## Ritual checkout

Offer every unfinished hierarchy level grouped by direction. Finished on a parent selects its descendants; Finished on every child never selects the parent. Clearing a child clears ancestor Finished while retaining Worked on. Persist the reconciled selection in the saved draft. Count session minutes once.

## Types

Projects unify work and learning into one structured card with tasks and one subtask level. Tasks is the shared flat list. There are only two creation choices. AI planning and clarification wizards are removed; manual editing and hierarchy behavior remain.
