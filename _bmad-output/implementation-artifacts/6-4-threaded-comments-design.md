# Story 6.4 implementation decisions

Updated: 2026-10-19: resolved the Opus 5.5 spec review before implementation.

This supports `spec-6-4-threaded-comments.md` and preserves its user-facing goal.
The user authorized resolving the review and continuing delivery.
Keep this story together across database, API, worker, and both user interfaces.

## Lifecycle and thread shape

- Use explicit comment states: `pending_screening`, `published`, `held_for_review`, `blocked`, `screening_failed`, `author_deleted`, `consent_suspended`, `erased`.
- Create commits the pending row, payload-bound receipt and screening outbox atomically.
- Pass publishes once. Review stays author-private and creates durable moderation intake; block stays private with an intake/audit disposition.
- Technical failure retries within existing bounded worker budgets; exhausted attempts or a 15-minute stale-pending deadline yield `screening_failed`.
- Recovery means deleting the withheld submission and resubmitting with a new UUID. Held/blocked content gains no publication path in this story; future operator decisions own that path.
- Root/reply lists include only published content and tombstones for previously published contributions. Never-public deleted/withheld content produces no public item.
- Preserve author-deletion tombstones for roots and replies, including roots with zero replies. Keep their publication positions and surviving replies.
- Public placeholders use a generic unavailable presentation for deletion, erasure and consent suppression. Clear body and public author attribution; expose no suppression cause or minor status.
- A suppressed previously published root remains a placeholder when necessary to keep others' eligible replies readable. Suppressed replies contain no author text.
- Creation accepts only a published, same-post root as parent. Parent fields are immutable and a database trigger or composite foreign key enforces the cross-row nesting invariant.
- Deletion is author-only, including pending submissions. A post owner has the report action on others' contributions.
- Root deletion does not erase existing public replies. A reply queued before its root became unavailable is withheld at publication and gets a private terminal status.

## Contracts, order and retries

- Use separate authenticated comment endpoints under `/api/v1/community/posts/:postId`; preserve legacy feed/detail responses.
- List roots, list replies, list the caller's private submissions, create, delete, and report through canonical Zod contracts and API-client wrappers.
- Public reads use the existing authenticated Community read eligibility. Under-13 users cannot gain participation through the new endpoints. Reuse existing guardian handling for under-16 users.
- Normalize text to NFC and trim it. Count UTF-16 units consistently with the screener and existing Zod contracts. Reject invisible-only input, disallowed control characters and multiline input; preserve ordinary international text and emoji.
- Enforce the same accepted text domain at the database boundary, accounting for supplementary Unicode characters. Supported locale means one of the ten UI locale tags.
- Assign a per-post publication sequence while holding the post lock. Order roots and replies by this sequence.
- Cursor fields identify kind, post, optional parent, snapshot watermark and last sequence. Validate cursor/route scope and bounds; mismatches return the shared 400 envelope.
- Default page size is 20, maximum 50. Reply counts include publicly eligible replies within the same snapshot. Load replies on demand with separate bounded pages.
- Return whether newer publications exist. Refresh starts a fresh snapshot; append uses the existing snapshot. Reconcile owner submissions by ID so a newly published contribution appears once while waiting for refreshed public pages.
- Create UUIDs are payload-bound. Exact replays return the existing authoritative submission, even after deletion, without reapplying side effects. Changed payload returns 409.
- Set new-submission limits to 60 per member per rolling minute and 200 per rolling day, including withheld submissions. Accepted receipt replays bypass new-submission quota.
- Screen-owned memory preserves drafts and unresolved retry payloads across closing/reopening the thread. Page reload/app termination may clear unsent drafts.
- An unresolved request retains its immutable UUID/body; editing begins a distinct draft. Reconcile the unresolved request before silently sending equivalent new intent.
- Clear local comment state on sign-out, account switch, and observed account erasure. Evict unavailable posts and fence all delayed reads/mutations against authoritative deletion or visibility loss.

## Locking, flags and consent

- Follow the existing member advisory-lock then post-row-lock order. Resolve external flag calls before locks.
- Create checks read/write flags and authoritative age/consent under the member lock. Read/report/delete use the read flag; eligible author deletion survives consent revocation and posting freezes.
- Worker screening reads current database text; publication rechecks pending status, author/account/consent eligibility, public parent post, and eligible reply root under the same lock protocol.
- Check rollout flags before publication. A queued comment observed during a posting freeze stays private, retryable through bounded recovery; it must never appear as successfully published during the freeze.
- Guardian revocation locks sorted posts authored, reacted to, or commented on by the affected member. Suspend their published and pending comments atomically with consent revocation.
- Consent re-grant does not automatically restore old comments, matching existing post behavior. Screened content from a revoked member cannot be revived by a delayed worker.
- Deletion takes the same locks and invalidates pending screening. Include direct User deletion and account-erasure paths in database cleanup invariants.

## Screening and operational evidence

- Reuse field `caption` under the current pinned text-screening policy. Do not introduce a new policy field/version solely for comments.
- Screening stays in the standalone worker. Preserve `community.module.spec.ts` import-graph exclusions and the request API cold-start boundary.
- BullMQ job data contains comment identifiers and non-sensitive routing metadata only. Comment text never goes into Redis, logs, metrics or analytics.
- Use deterministic job identity per submission and a real retry/generation strategy when recovery encounters retained completed/failed jobs.
- Integrate with the existing worker startup/shutdown and durable outbox dispatch. Reuse its low-command idle behavior; avoid an additional independently polling worker without measured need.
- Measure comment completion behavior alongside image work and record the change in Redis/resource budgets. Preserve existing concurrency and resource protections.
- Code/schema changes invalidate the screening input-set hash. Record this honestly in readiness evidence, keep rollout flags disabled, and require regenerated evidence plus the repository owner's fresh signature before a future production rollout. Do not claim the old signature covers new code or sign as the owner.

## Reports, moderation and erasure

- Store comment reports separately with unique comment/reporter identity. Same-reason replay is idempotent; a changed reason returns the existing stable conflict behavior. Refuse self-reporting.
- Share the existing `community_report:` reporter advisory lock and the rolling 50 reports per 24 hours across post and comment reports. Accepted replays bypass quota.
- Route synchronously: report transaction commits a durable moderator-consumable intake/audit record and its target reference together. Record accepted/routed times and a 24-hour review deadline.
- API success means that intake already exists. The five-minute routing requirement has no asynchronous gap. Existing future moderator queue work can query this intake; no moderator UI is added here.
- Every visible thread entry has a report action, including generic placeholders. Reporting a placeholder captures only the content-free visible state; it cannot recover deleted text.
- Capture any report snapshot under the post/comment lock. Distinguish comment and post targets in moderation history and ensure append-only decisions.
- Erasure clears comment text, user links, attributable aliases, receipt payloads, report/intake snapshots, queued/outbox content and pending analytics payloads within 72 hours. Prefer immediate scrubbing in the authoritative erasure transaction where possible.
- Keep content-free audit metadata such as action, reason code and occurrence time for the existing retention requirement. No erased comment text or persistent subject mapping may survive in retained audit JSON.
- Preserve other members' replies through placeholders. A hidden/erased parent post makes its entire thread unavailable, including private author status endpoints.
- Define separate submitted, published, deleted and reported analytics so withheld text does not inflate engagement. Use stable outbox insertion IDs, HMAC identity, server-derived self state and canary exclusion; delivery is deduplicated and survives sink outages.

## UI and evidence

- Web comments live in the existing detail dialog through a focused component. Avoid nested dialogs. Native uses a dedicated accessible sheet with independently focusable children.
- Keep announcements inside the active modal/sheet and make repeated messages announce reliably. Focus pending status after submission and restore the Comments action on close.
- Include accessible loading, empty, private status, tombstone, report/delete, reply target, pagination, error and retry states. Verify 44px targets and contrast across themes.
- Use all ten locale catalogs with existing parity/interpolation checks and deterministic shared factories.
- Load `_bmad/config.toml` and the TEA library integration mandates before test edits. Both Playwright Utils and Pact.js Utils flags are enabled and packages installed; follow the existing utility-based suites.
- Cover each frozen matrix row at its appropriate layer, including real PostgreSQL constraints, concurrency, visibility/consent/publication races, RLS, replay semantics, privacy across stores, and analytics delivery recovery.
- Public contract changes require generation, Optic and Pact consumer/provider verification. Include list roots/replies/private statuses, create/delete/report and stable failure envelopes supported by the routes.
- Run real browser journeys through `scripts/start-api-e2e-with-workers.mjs`, with deterministic pass/review/block texts. Assert durable intake timestamps with an injected clock or database observations; avoid waiting five minutes to prove synchronous routing.
- Run the native comments journey on iOS and Android. Keep device data synthetic and use existing test environment isolation.
- Finish with full `npm run validate`, scoped `npm run verify:changed`, database/RLS, Pact and relevant browser/native evidence. Record actual commands and results; skipped coverage is incomplete.
- Implementation work remains local until complete. Root orchestration then performs the requested own review, existing Claude Code Opus 5.5 review, separate TEA peer review/enhancements, PR, CodeRabbit responses and green CI.

## Review disposition

Opus findings A1-A18 and E1-E13 are resolved by the decisions above or explicit existing invariants.
A3's embedded reply preview is optional; on-demand reply pages avoid loading every reply list.
A4's omission of author-deleted replies would change the tombstone requirement, so retain those placeholders.
A12's proposed 10-second target and separate queue need measured evidence; preserve existing budgets and report actual measurements.
A19's suggested split is declined because all layers implement one user-facing goal.
