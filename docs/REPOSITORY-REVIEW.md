# Repository cleanup and engineering review

September 28, 2026. Scope: reduce confirmed redundancy, improve code/documentation
clarity, find regressions, and prepare a reviewable change. The download website,
Apple/email native login, and revised first-launch flow are deferred pending owner
approval. This is a maintenance review, not a security certification or a claim
that no defects remain.

## Changes made

| Area | Result |
| --- | --- |
| Native prototype leftovers | Removed unused task CRUD, selection, paging, and remote-history edit/delete methods from `WorkspaceStore`, the unused history paging flag, and the unused native logo view. The shared web interface remains the presentation authority. |
| Redundant cache paths | Removed obsolete remote Plan/queue cache reconciliation from `WebWorkspaceAPI`; signed-in Plan already uses the local reducer/outbox. Kept cloud history handling. |
| Frontend | Removed 34 CSS rules for retired controls; removed an unreachable standalone-task branch from the project summary; made initialization/navigation code readable; consolidated native connection-status copy. |
| Backend | Removed unused imports. No endpoint, schema, ownership, or migration changes. |
| Tests and CI | Replaced prototype-only test calls with the real bridge/API. Added cache-race and pending-status regressions. Updated stale Home navigation selectors. Added native tests and app/widget compilation to CI; expanded WebKit from a subset to the full browser suite. Enabled unused-symbol checks for typed frontend modules. |
| Documentation | Shortened the root README and separated architecture, product behavior, operational setup, and future plans. Corrected the old claims about native Plan screens, priorities, and online-only Mac Plan edits. |

No dependency upgrade or framework replacement was needed. Personal signing
configuration, local workspaces, credentials, historical migrations, and generated
local builds were not removed. Existing API names, URL schemes, and storage keys
were retained for compatibility.

## Bugs reproduced and fixed

1. **History stayed stale after a successful Mac upload.** The session was
   acknowledged, but cached Home totals and session pages survived. Upload
   acknowledgement now clears those caches in the same atomic file write.
   A regression checks both memory and reloaded disk state.
2. **A late read could cache a record from before an edit.** A GET started while
   PATCH was pending could finish afterward and refill the cache with the old
   record. The worker and web adapter now share an invalidation generation,
   advanced at mutation boundaries. A deterministic two-request test reproduces
   the ordering without sleeps and verifies rejection of the obsolete cache entry.
3. **Mac status omitted pending Plan changes.** The toolbar counted pending
   sessions only, and duplicate renderers could disagree. It now counts both
   queues and gives errors precedence over a pending count.
4. **Heatmap legend did not represent the chart.** Five heat levels existed in
   CSS, but the HTML had only two swatches. Restored all five; the existing theme
   regression now passes without weakening its color/contrast assertions.
5. **Certain URL fragments could blank the workspace.** Navigation used JavaScript's
   `in` operator, which treated inherited names such as `constructor` as valid
   views. A mocked browser reproduced zero visible views and a null-element error.
   Navigation now checks only the actual registered views and falls back to Home;
   a regression covers inherited and unknown fragment names.

Both cache tests were observed failing before their fixes. The first full browser
baseline was 149 passed / 5 failed: four outdated Today selectors and the real
legend defect. Those are addressed, not skipped.

## Validation

- Backend: **98 passed**, including ownership, hierarchy, sessions, and SQLite migrations.
- Frontend unit tests: **11 passed**; production TypeScript/Vite build passed.
- Chromium and WebKit: **155 passed in each full suite**, including the new
  native status regression. After the final navigation fix, all **5 UI-clarity
  checks passed again in each browser**, including the added URL-fragment case.
- Native: **45 passed** (22 Mac/bridge/sync tests and 23 core tests).
- Signed Xcode app/widget build passed, and both code signatures verified.
  The isolated bundled-WKWebView smoke test passed. The final rebuild includes
  the atomic cache write refinement and final navigation fix.
- Visual inspection: native Home and session review, mobile light-mode focus card,
  and mobile Guide spotlight. The existing layout and artwork are preserved.

The isolated smoke app exercises real bundled assets and the Swift bridge,
settings persistence, Plan nesting/stars, History, appearance, native timer start,
review, note saving, and child completion without completing its parent. It uses
synthetic data and disposable files, not the user's account.

The new hosted CI job has not been claimed as passing until it actually runs.
PostgreSQL release validation remains in CI and was not rerun against a local or
production database during this cleanup. No production deployment or migration
is part of this phase. Backend tests emit one upstream TestClient/httpx deprecation
warning; dependency changes should be handled separately.

## Findings for the principal engineer

| Priority | Finding and evidence | Recommended follow-up |
| --- | --- | --- |
| Before wider cloud rollout | Task/project creates lack server idempotency keys. `WorkspaceStore.drainPlanOutbox` pauses ambiguous create results, so a user must check the web workspace before retrying. | Add stable command IDs and server-side deduplication, with lost-response/restart tests, before expanding sync usage. |
| Before multi-device editing | Plan edits apply serially without field-level revisions/merge. A deleted remote task or rejected local edit can block later outbox commands; data is retained, but recovery is limited. | Define conflict rules and a non-destructive resolution flow. Do not advertise simultaneous cross-device editing or active timer handoff yet. |
| Before distributing the Mac beta | Signed development builds exist, but no notarized installer, update delivery, or release acceptance record. Widget gallery behavior, Focus-mode reminders, and two-real-account isolation need a manual signed-build pass. | Make these explicit release gates in the next phase. Local build success is insufficient evidence of distribution readiness. |
| Maintenance | `plan/index.js` and `timer/index.js` remain large view controllers; `checkJs` is off. Swift's local adapter and Python enforce similar domain rules in separate runtimes. | Extract/gradually type these feature boundaries when touching them; add shared contract fixtures for hierarchy, deletion, and history semantics. Avoid another UI rewrite. |
| Scale | `WorkspaceFile.save` serializes the workspace on the main actor; cached responses share that file. Backend `activity_data` walks all active focus sessions. | Benchmark realistic long histories; then introduce a total cache byte budget, incremental/local database storage, and aggregate queries if measured latency warrants it. |
| Developer workflow | SwiftPM, Xcode, and signed Xcode output intentionally produce separate local bundles. Spotlight can index those builds. | Standardize one run/install location for daily use in the packaging phase. Do not delete app data or arbitrary build directories as a source cleanup. |

## UI/UX proposals, not implemented redesigns

The current Home card and task hierarchy are coherent; another visual redesign
would add churn. The following small refinements are more useful:

- **Use one vocabulary.** Prefer Projects in visible copy where Home currently
  says Active goals; prefer Session where some prompts still say ritual. Keep
  internal keys and API paths stable.
- **Make sync status actionable.** A compact status button could open Account's
  pending/error details, including an accessible recovery action. A hover title
  alone is insufficient for keyboard/touch users. The status text itself is fixed.
- **Reduce menu review friction.** Keep the compact timer and app-based session
  review. Consider a quieter optional “review later” indication after a session,
  without adding the full checklist to the menu panel.
- **Keep first-use prompts sequential.** Sign-in/guest choice, Guide, and native
  setup should not compete as stacked overlays. This belongs to the owner's
  proposed next phase; it is not part of this cleanup.

## Review order

1. Compare the cleanup diff with the baseline `bbbde1f`.
2. Review `WorkspaceStore`, `WebWorkspaceAPI`, and their cache regression tests.
3. Review `shared/native.ts` and the native status browser regression.
4. Confirm removed native methods/CSS have no production callers/selectors.
5. Read [ARCHITECTURE.md](ARCHITECTURE.md), then validate the workflow/CI and
   [Mac limitations](../macos/README.md).

This cleanup is ready for review on `codex/repository-cleanup`. The owner's
personal Xcode signing settings remain local and outside the change. The owner
decides when to begin the separate product/distribution phase.
