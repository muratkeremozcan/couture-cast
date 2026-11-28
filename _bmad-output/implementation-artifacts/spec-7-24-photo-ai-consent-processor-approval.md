---
title: 'Story CC-7.24: Photo AI consent and processor approval'
type: feature
ticket: '7-24-photo-ai-consent-processor-approval'
created: '2026-11-27'
status: in-review
baseline_revision: 'f62155d23e568c9485c897dfdd92c45ef486b837'
route: full
route_source: auto
risk: high
review: thorough
review_source: pinned
lenses_ran: []
review_loop_iteration: 0
context:
  - '_bmad-output/planning-artifacts/epics.md'
  - '_bmad-output/implementation-artifacts/epic-7-context.md'
  - '_bmad-output/test-artifacts/test-design-7-24-photo-ai-consent-processor-approval.md'
---

<frozen-after-approval>

## Intent

Members can see and turn off photo AI permissions from Profile > Account. CoutureCast
can adopt photo AI after it approves a processor and a feature-specific consent policy.
This release keeps external photo processing off for every account.

## Boundaries & Constraints

- The matrix is approved for a disabled launch. Unverified ages, guests, under-13 accounts
  and guardian-pending accounts are blocked. Any future teen enablement requires an active
  guardian relationship, separate guardian approval for the scope, and affirmative teen assent.
  Adults must affirmatively consent. CC-0.11 account consent alone never authorizes photo AI.
- A grant binds the member, feature, input class, provider and policy version. It expires and
  can be revoked by its owner. The production registry has zero approved external recipients.
  Enabling any row requires a code-reviewed policy change and an approved named processor.
- CC-7.25 owns generated Community descriptions, CC-7.26 owns cutout quality, CC-7.27 owns tag
  suggestions and CC-7.29 owns flat-lay staging and detection. Worn-outfit and body or face
  generation stay outside this policy. Source photos and manual saves belong to their
  existing features.

## I/O & Edge-Case Matrix

| Scenario             | Input or state                                                  | Expected behavior                                                 |
| -------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------- |
| Disabled launch      | Any account and photo feature                                   | Show manual workflow. Run zero external image calls.              |
| Consent denied       | Missing, expired, revoked or different member, scope or version | Skip the source and processor.                                    |
| Source denied        | Foreign, missing, deleted, replaced or unsupported photo        | Return the manual fallback.                                       |
| Revocation in flight | Source read or processor reply is pending                       | Stop pending dispatch, cancel local work and discard late output. |
| Account switch       | Prior member's Profile request settles                          | Render only current-member permissions.                           |

</frozen-after-approval>

## Code Map

- `apps/api/src/modules/photo-ai/` owns the policy matrix, Profile controller, grant gate,
  fresh source reads and a synchronous-request execution path. Reuse active guardian checks
  and bounded, server-authenticated storage downloads. Mount the module in `app.module.ts`.
- `packages/db/prisma/schema.prisma` and the new migration store API-only, account-cascading
  grants with RLS. The gate takes the grant row lock shared with revocation at dispatch and
  delivery. Stage work in memory, with no durable photo AI result or job record.
- `packages/api-client/src/contracts/http/photo-ai-consent.ts` defines GET and an owner-scoped
  revocation POST. Regenerate the published contract and SDK. Reuse the web session owner and
  native identity epoch in the respective Account settings screens.

## Tasks & Acceptance

- [x] Implement the matrix, server gate, revocation and authorized photo reads.
- [x] Wire authenticated permission listing and revocation to Profile > Account on both clients.
- [ ] Complete fixture-based acceptance coverage, full review and Step 81.

- Given a member opens Account, when external photo AI is disabled, then the page shows the
  disabled state. Each existing Community or Closet workflow stays available with manual input.
- Given a member revokes a permission, when they reload or retry the action, then the permission
  stays off. An authenticated second account cannot inspect or revoke the first account's grant.
- Given a synthetic approved processor and eligible grant, when the server reads and dispatches,
  then the processor receives only sanitized image bytes and their MIME type. Any loss of
  eligibility before dispatch or delivery yields the manual fallback.

## Design Notes

The four age columns below are the approved launch policy. "Off" means no processor receives
photos. Any future change for ages 13 to 17 requires scoped guardian approval and teen assent.

| Feature               | Input class     | Unknown / under 13 | 13-15 | 16-17 | 18+ | Manual path                |
| --------------------- | --------------- | ------------------ | ----- | ----- | --- | -------------------------- |
| Community description | Community photo | Off                | Off   | Off   | Off | Write the description      |
| Garment cutout        | Garment photo   | Off                | Off   | Off   | Off | Keep the original photo    |
| Garment tags          | Garment photo   | Off                | Off   | Off   | Off | Select tags                |
| Flat-lay detection    | Flat-lay photo  | Off                | Off   | Off   | Off | Add garments one at a time |

Batch import can use the individual cutout and tag policies for each image if approved later.

| Recipient                                    | Permitted fields and use                                                                                                                |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| CoutureCast API and private Supabase Storage | Existing owner-scoped source photo and object key for a fresh authorized read. An image URL is never part of photo AI input or output.  |
| CoutureCast database on Supabase             | Grant ID, member, scope, policy version, decision timestamps and linked guardian consent reference when applicable. No image or result. |
| Vercel AI Gateway and model providers        | No fields for any photo feature in this release. CC-7.23's text-only approval is separate.                                              |
| Job queues and workers                       | No fields for any photo feature.                                                                                                        |
| Observability                                | No photo input, output, object keys, grant IDs or linked account identity from the photo AI routes.                                     |

Photo inputs, outputs, object keys, grant IDs and account IDs stay out of photo AI logging.
Revocation marks the grant immediately. Work running on the same instance is aborted. Other
instances recheck the shared grant before dispatch or delivery. Working buffers are cleared
when the attempt ends. No photo AI jobs, assets, or outputs are stored. Original account
photos stay under their existing deletion controls. A future external processor must prove
transient processing and document its deletion behavior before its registry entry is approved.
There is no grant creation UI or live processor adapter in this release.

## Implementation Notes

- The worktree is shared with TEA, who owns tests, test links inside those files, and the test
  plan. Leave every file unstaged for the builder. Do not run local test suites or touch a
  database. Node 24.22.3 npm ci is complete. Only targeted lint, generated files, package
  builds and touched workspace type checks are local.
- API is GET `/api/v1/privacy/photo-ai-consent` and POST on that path with `/revoke`.
  Revocation takes `{grantId}` in the body so the identifier stays out of URL logs.
  Both return `{data:{externalProcessingEnabled:false,grants:[{id,feature,inputClass,provider,policyVersion,expiresAt}]}}`.
  A missing or foreign ID returns the caller's current list. Keep policy IDs stable:
  `community-description`, `garment-cutout`, `garment-tags`, `flat-lay-garments`;
  input classes `community-photo`, `garment-photo`, `flat-lay-photo`.
- Profile > Account uses `photo-ai-consent`, `photo-ai-consent-status`, and
  `photo-ai-revoke-<id>` on web and native. Keep loading, errors and mutation replies
  scoped to a single member/session with an abort signal and an identity fence.
- The service seam is `PhotoAiExecutionService.execute(actor, request, processor)`.
  Request: `{grantId, feature, inputClass, provider, photoId}`. Return null on denial.
  Re-read current stored age, account status and linked guardian consent at every
  checkpoint. Bind the resolved source to the actor and source row, verify that it
  still matches before dispatch and return, and re-encode to a bounded metadata-free
  image before dispatch. The processor receives only `{bytes, mimeType}` and a
  separate abort signal. Bind the adapter ID to the approved provider. Inject a policy for
  synthetic tests. Production has an empty
  approval list and no external integration. No account or grant IDs go to the processor.
- TEA needs the concrete execution, gate and source types as soon as they are written.
  The builder will relay them. Keep this spec's task state and review log for the builder.

## Plan Change Log

## Review Triage Log

## Verification

Use targeted lint and workspace type checks locally. The
[TEA test plan](../test-artifacts/test-design-7-24-photo-ai-consent-processor-approval.md)
defines acceptance in CI. Verify every workflow on the final PR head.
