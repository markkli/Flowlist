# History

Keep History a retrospective surface. Do not add scheduling, drag-to-create, event invitations, or estimated task durations.

- Default to a Monday-aligned week in the viewer's IANA timezone, with previous/next/this-week navigation. Preserve All records and deleted-record recovery.
- Desktop uses a quiet time grid; narrow windows use chronological day lists. Keep the full 00:00–24:00 desktop axis even on empty weeks; start the scroll position at 08:00. Omit empty days from the mobile list.
- Blocks reflect recorded start/end instants; breaks never appear as focus. Show exact durations in labels and record details. Use one pixel per minute on desktop, without a minimum height that exaggerates time. Intervals under five minutes go in a compact Brief sessions section, grouped by day, with expandable accessible record buttons. Overlapping timed blocks get separate columns. Short blocks use one text line or a thin marker, with exact times in their accessible label and title. All records remains an alternative for detailed browsing.
- Legacy rituals retain their original minutes and save dates, appear below the grid, and explicitly state that block times were not recorded. Never estimate their start times from save time minus duration.
- A block opens the entire ritual. Its reflection and task attribution belong to that ritual, not to an individual block.
- Editing a record can change reflection and attribution, including Finished, without changing task completion in Plan. Preserve snapshots for deleted tasks; allow existing completed tasks to be attributed.
- Failed edits retain their draft. Concurrent edits use revision checks and offer explicit reload. Escape/Cancel restores focus and asks before dropping unsaved edits.
- Export is portable, versioned JSON covering Plan, queue, saved/deleted history, attribution snapshots, and block times. It excludes credentials, browser preferences, and unsaved local timer drafts. There is no import/restore interface yet.
