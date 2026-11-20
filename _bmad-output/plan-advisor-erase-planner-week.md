---
title: 'Advisor erase sticks and the planner never shows an empty entitled week'
type: 'bugfix'
ticket: ''
created: '2026-11-20'
status: 'in-progress'
baseline_revision: '147f82d1'
route: 'oneshot'
route_source: 'auto'
risk: 'medium'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Two CodeRabbit findings left open on PR 259. (1) After a member erases their palette advisor data, a delayed recovery read that retried after a bearer rotation can return the profile it read before the erase and put the old consent state and analysis back on screen. Erasure must stick. (2) In the planner rail, a late foreground Retry read can set `entitled` with no week after a focus refresh reported the planner disabled and a reshuffle advanced the week generation, rendering an empty list instead of the disabled panel; a late transient failure of an older Retry can also clear a newer reshuffled week.

**Approach:** Give each recovery read in the advisor the write generation it started under and drop its answer when a newer accepted write superseded it. In the planner, restore `entitled` only when a newer usable week exists, otherwise keep the newer lock or error state, and apply the week-generation check to late failures as well as successes.

## Boundaries & Constraints

**Always:** a recovery result is still accepted when no newer write supersedes it; the last profile stays visible during an outage; a foreground read that fails with no newer week shows its error.

**Never:** no change to API contracts, `readAsMember`, or the Settings and Home session model; no new strings.

</frozen-after-approval>

## Code Map

- `apps/web/src/app/components/palette-advisor-panel.tsx:760-800` -- `refresh()` recovery read after a wardrobe write; `runWrite` accepts writes and clears results (erase); add a write generation counter bumped on every accepted write and checked by recovery reads.
- `apps/web/src/app/components/planner-rail.tsx:620-660` -- foreground read success and catch paths using `weekGenerationRef`, `plannerData`, `entitlementState`; check the generation in the catch, restore `entitled` only with usable data.
- Tests (TEA owns, do not edit): new `apps/web/src/app/components/palette-advisor-erase-race.test.tsx` and `planner-rail-week-race.test.tsx`.

## Tasks & Acceptance

- [ ] `palette-advisor-panel.tsx` -- write generation; recovery read drops its answer when a newer write was accepted.
- [ ] `planner-rail.tsx` -- generation check in the failure path; `entitled` only with a usable week.
- [ ] Learning path Step 58 production follow-ups: add this fix with test cross-links.

Working rules: never git stash, git checkout -- or git reset; never touch /Users/murat/opensource/cc/couture-cast; no local suites (owner rule: CI is the proof), only tsc and eslint on files you touch; do not commit or git add.

**Acceptance Criteria:**

- Given a recovery read delayed past an erase, when it returns the pre-erase profile, then the panel stays empty.
- Given a disabled planner and a Retry GET that succeeds after a reshuffle advanced the generation, then the rail shows the disabled panel, never an empty entitled list.
