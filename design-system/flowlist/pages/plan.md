# Plan Page Override

**Updated:** 2026-09-18

## Purpose

The Plan page is a working outline, not a dashboard of nested cards. It should make three things immediately clear: where the user is headed, what remains active, and what has already been finished.

## Desktop Structure

- Use a 44px sticky vertical dot group beside one readable column of direction panels. Do not connect the dots with a rule.
- The active dot follows the visible direction. Hover and keyboard focus enlarge it and reveal type/name in a floating label; clicking scrolls directly to the direction.
- Keep Project, Learning, and Task as separate but low-emphasis creation actions in the atmospheric page heading. Each reveals one compact composer.
- Each goal header contains its editable title, overall progress, and context actions that reveal only on hover/focus. Learning directions expose a restrained AI Beta sparkle.

## Task Hierarchy

- Render unfinished work and every ancestor required to understand it. Finishing a leaf must never erase its parent context.
- Parent progress counts direct children. When every direct child is checked, show “Ready to close” and expose the parent checkbox.
- Use indentation, spacing, and type weight for hierarchy; do not use horizontal row dividers, vertical guide lines, tinted background bands, or nested bordered task cards.
- Rename by clicking the title. Reveal Add substep, AI Beta, Remove, and reorder on hover/focus; keep equivalent touch-safe access.
- Expand/collapse applies to parent nodes and persists locally.
- Whole directions use visible-on-hover up/down controls because dragging a large card is imprecise. Compact task drag reorder works only within a sibling group; Alt+Up/Down is the keyboard alternative.
- Confirm deletion because removing a parent may also remove descendants.

## Completed Work

- Place all checked nodes in an expandable Completed section at the bottom of their direction.
- Rows use checked controls, crossed titles, and breadcrumbs made from ancestor titles.
- Reopening an item returns it and its ancestor chain to the active outline while preserving completed siblings.
- A direction becomes closable only after every top-level node is manually closed. Closed directions move to a separate Completed directions section.
- Completion uses a brief cause-and-effect fade and an Undo toast.

## AI Drafting

- “Generate learning path” is a restrained sparkle action in the learning-direction header and is marked Beta in its tooltip/wizard.
- “Generate smaller steps” uses the same sparkle action on eligible task rows.
- Copy must explain that AI output is a draft and that a personally considered plan will usually fit pace and preferences better.
- Never insert generated work automatically. Show a multi-select proposal list and require Add selected.

## Responsive Behavior

- Below the desktop breakpoint, convert the dot index into a sticky horizontal group above the goal stack, still without a connecting rule.
- At compact widths, group the three creation actions into a quiet segmented strip, preserve 44px touch targets, and allow row controls to remain operable without relying on hover.
- No horizontal scrolling at 375px.
