# Sprint change proposal: Re-slice Epic 6

**Date:** 2026-09-06
**Project:** couture-cast
**Scope:** Moderate backlog reorganization inside Epic 6
**Approval:** Murat explicitly requested the sprint-status rewrite after reviewing the sizing
analysis on 2026-09-06.

## 1. Issue summary

Story 6.1 showed that the remaining Epic 6 entries were feature packages sized beyond a focused
implementation and review context. Its merge changed 316 files with 59,729 additions. Generated API
artifacts accounted for 7,683 additions and documentation accounted for 3,486. Product code,
database work, and tests still accounted for 48,560 additions.

The Story 6.1 review required two passes because the diff exceeded the review workflow's chunking
threshold by roughly sixteen times. The first pass found nine high-severity issues. The second pass
found twenty-six findings, including eight high-severity issues. The completed story also delivered
parts of challenge administration, reporting, moderation intake, operator actions, SLA clocks,
audit records, and rollout control that the old Epic 6 plan assigned implicitly to later work.

The trigger is categorized as a planning granularity problem discovered during implementation.

## 2. Impact analysis

### Epic impact

- Epic 6 remains valid and retains its original Community Beta outcome.
- Story 6.1 remains complete and supplies the shared post, feed, upload, report, challenge,
  screening-pipeline, erasure, analytics, and rollout foundations.
- The four former backlog stories are replaced by twelve focused stories numbered 6.2 through 6.13.
- Community Beta remains closed until all twelve stories and all eight release-gate signatures are
  complete.
- No new epic is required. Completed epics and their dependencies remain unchanged.

### Artifact impact

- **PRD:** No requirement change. FR4, FR7, and the existing non-functional requirements remain the
  source of product and operational intent.
- **Architecture:** No technology or invariant change. The revised stories project the existing
  NestJS, Prisma, Zod/OpenAPI, Socket.io, BullMQ, Next.js admin, Expo, Redis, PostHog, and Grafana
  decisions into smaller delivery units.
- **UX:** No design-system or journey change. The revised stories separate reaction, comment,
  spotlight, export, and moderator interactions already described by the UX specification.
- **Epics:** Replace the four broad backlog stories, revise dependencies, correct story totals, and
  retire the stale two-sprint estimate for Phase 2.
- **Epic context:** Replace the story list and dependency map. Record the unresolved Following scope.
- **Sprint tracking:** Replace four backlog keys with twelve backlog keys.
- **Implementation stories:** Draft one at a time from the revised epic, beginning with Story 6.2.
- **Test planning:** Create focused acceptance and risk coverage per story. Preserve contract,
  database, Pact, Playwright, Maestro, accessibility, and performance evidence only where the story
  boundary reaches that tier.

### Open artifact conflict

The product brief requires follow and unfollow behavior from feed and profile views. FR4 and the old
Epic 6 story set omit a follow graph and public community profile. The Following filter stays
disabled until product adds separately sized stories or amends the brief and UX promise. This
decision must close before Community Beta sign-off.

## 3. Recommended approach

### Selected path: Direct adjustment

Modify Epic 6 inside the existing product and architecture boundaries. Preserve completed Story 6.1
and build every remaining capability behind the disabled production read and write controls.

**Effort:** High product scope distributed across twelve reviewable stories.

**Risk after re-slicing:** Medium. The highest risks are model readiness, comment moderation,
realtime delivery, account sanctions, and audit retention. Each now has an explicit owner story and
acceptance boundary.

### Alternatives evaluated

- **Rollback Story 6.1:** Rejected. Its feed, post, report, moderation-pipeline, challenge, erasure,
  and rollout foundations are required by every remaining delivery lane. Reversion would remove
  validated work without simplifying the target architecture.
- **Reduce the Community Beta scope:** Rejected for this correction. The PRD outcome remains
  achievable and the user requested decomposition. Product may still amend the unresolved Following
  promise through the recorded decision.
- **Create a new epic:** Rejected. Every affected requirement belongs to the existing community and
  moderation outcome, and the architecture already groups the same components under Epic 6.

## 4. Detailed change proposal

### Story structure

#### Old

1. CC-6.2 Reactions and comments
2. CC-6.3 Locale highlight modules
3. CC-6.4 Social export workflows
4. CC-6.5 Moderation queue and SLA tracking

#### New

1. CC-6.2 Production content-screening readiness
2. CC-6.3 Curated reactions
3. CC-6.4 Threaded comments
4. CC-6.5 Realtime engagement and notifications
5. CC-6.6 Community City Spotlight
6. CC-6.7 Home spotlight teaser
7. CC-6.8 Safe branded share-card export
8. CC-6.9 Native platform sharing
9. CC-6.10 Moderator queue and case detail
10. CC-6.11 Moderation decisions and account sanctions
11. CC-6.12 SLA monitoring and escalation
12. CC-6.13 Immutable moderation history

The full story statements, acceptance criteria, and prerequisites are recorded in `epics.md`.

### Delivery lanes

1. **Safety:** CC-6.2 closes production model and multilingual text-screening readiness.
2. **Engagement and highlights:** CC-6.3 and CC-6.4 feed CC-6.5 and CC-6.6. CC-6.6 feeds CC-6.7.
3. **Export:** CC-6.8 feeds CC-6.9 and can proceed independently after Story 6.1.
4. **Moderation operations:** CC-6.10 feeds CC-6.11 and CC-6.12. CC-6.11 feeds CC-6.13.

Implementation across lanes may overlap while rollout controls remain disabled. Community Beta
enablement waits for every lane and the signed release gate.

### Story review envelope

Draft each story around one primary actor outcome, one major state machine or algorithm, and one to
three focused end-to-end journeys. Re-slice during drafting when the forecast exceeds roughly fifty
manually reviewed files or eight thousand non-generated additions. Generated contract artifacts
remain synchronized in the contract-changing story and are reported separately in review statistics.

## 5. Implementation handoff

### Classification

Moderate. This correction reorganizes the backlog while preserving product scope and architecture.

### Responsibilities

- **Product owner:** Resolve the Following scope before beta sign-off and approve any story-level
  product decisions uncovered during drafting.
- **Developer:** Draft and implement one revised story at a time, beginning with CC-6.2, while
  preserving contract-first APIs and disabled production rollout controls.
- **Architect:** Review any proposed divergence from ADR-013, the moderation role model, retention
  invariants, or the established worker topology.
- **Test architect:** Produce story-level risk coverage and the final Community Beta gate evidence.

### Success criteria

- Each revised story has a dedicated implementation artifact before development begins.
- Each story maps its acceptance criteria to deterministic tests at the closest useful tier.
- Generated SDK and OpenAPI changes remain derived from canonical Zod contracts.
- The Following decision is closed and reflected consistently across the brief, PRD, epics, UX, and
  sprint tracker.
- Community read and write rollout controls remain disabled until all eight release-gate signatures
  are present.

## 6. Change navigation checklist

- [x] 1.1 Triggering story identified: CC-6.1 Community feed by climate band.
- [x] 1.2 Core issue categorized: planning granularity discovered during implementation.
- [x] 1.3 Evidence recorded from merge size and code-review findings.
- [x] 2.1 Epic 6 can complete with backlog reorganization.
- [x] 2.2 Existing epic modified; no additional epic required.
- [x] 2.3 Completed epics and future dependencies reviewed.
- [x] 2.4 No epic is invalidated or made obsolete.
- [x] 2.5 Epic 6 work resequenced into four delivery lanes.
- [x] 3.1 PRD reviewed; no requirement edit required.
- [x] 3.2 Architecture reviewed; no invariant or technology edit required.
- [x] 3.3 UX reviewed; no design edit required for the approved re-slice.
- [x] 3.4 Planning, context, sprint tracking, story drafting, and test planning impacts recorded.
- [x] 4.1 Direct adjustment selected with high scope effort and medium residual risk.
- [x] 4.2 Rollback evaluated and rejected with rationale.
- [x] 4.3 Scope reduction evaluated and rejected for this correction.
- [x] 4.4 Direct adjustment selected for quality, reviewability, and long-term maintainability.
- [x] 5.1 Issue summary completed.
- [x] 5.2 Epic and artifact impacts completed.
- [x] 5.3 Path and alternatives completed.
- [x] 5.4 Product scope retained and delivery sequence defined.
- [x] 5.5 Handoff responsibilities defined.
- [x] 6.1 Applicable checklist items completed; Following remains a documented product decision.
- [x] 6.2 Proposal checked against PRD, architecture, UX, shipped code, and sprint status.
- [x] 6.3 User approval recorded from the explicit rewrite request on 2026-09-06.
- [x] 6.4 Epic 6 entries updated in `sprint-status.yaml`.
- [x] 6.5 Next steps and ownership recorded.
