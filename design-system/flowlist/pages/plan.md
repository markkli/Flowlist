# Plan Page Override

**Updated:** 2026-09-17

## Purpose

The Plan page is a working outline, not a dashboard of nested cards. It should make three things immediately clear: where the user is headed, what remains active, and what has already been finished.

## Desktop Structure

- Use a narrow sticky direction index beside one readable column of goal panels.
- The index shows type, name, and completed/total progress. Its active state follows the visible goal.
- Keep “New direction” in the page heading and reveal its composer only on request.
- Each goal header contains title, overall progress, a visible Add step action, and one overflow menu.

## Task Hierarchy

- Render only unfinished leaves and the parent branches needed to understand them in the active outline.
- Parent progress counts descendant leaves, not only direct children.
- Use indentation and a single guide line for hierarchy; never nest bordered task cards.
- Keep Add substep and Remove visible as quiet icon buttons. Keep Edit and AI drafting in the overflow menu.
- Confirm deletion because removing a parent may also remove descendants.

## Completed Work

- Place finished leaves in an expandable Completed section at the bottom of their goal.
- Rows use checked controls, crossed titles, and breadcrumbs made from their parent branches.
- Reopening a completed item returns it to the active outline immediately.

## AI Drafting

- “Generate learning path” lives in the goal overflow menu and is marked Beta.
- “Generate smaller steps” lives in a task overflow menu and is marked Beta.
- Copy must explain that AI output is a draft and that a personally considered plan will usually fit pace and preferences better.
- Never insert generated work automatically. Show a multi-select proposal list and require Add selected.

## Responsive Behavior

- Below the desktop breakpoint, move the index above the goal stack and let its items wrap.
- At compact widths, stack the page action, preserve 44px touch targets, and move row actions onto a second aligned line rather than crushing the task title.
- No horizontal scrolling at 375px.
