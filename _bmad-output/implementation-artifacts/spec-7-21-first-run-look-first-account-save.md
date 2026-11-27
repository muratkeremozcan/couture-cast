---
title: 'Story CC-7.21: First run with the look first and the account on save'
type: feature
ticket: '7-21-first-run-look-first-account-save'
created: '2026-11-27'
status: built
baseline_revision: '4203dd270fdda35e0aa14b05ebc07e79b3f538ef'
route: full
route_source: auto
risk: high
review: thorough
review_source: pinned
lenses_ran:
  - 'independent-correctness'
  - 'codex-security'
review_loop_iteration: 1
context:
  - '_bmad-output/planning-artifacts/epics.md'
  - '_bmad-output/implementation-artifacts/epic-7-context.md'
  - '_bmad-output/test-artifacts/test-design-7-21-first-run-look-first-account-save.md'
---

<frozen-after-approval>

## Intent

Visitors see a complete sample outfit immediately after the eligibility check. They can change
its mood, shuffle or swap pieces, then choose to keep that exact outfit in an account.

## Boundaries & Constraints

- Web and native share the age policy and catalog. Server signup still determines eligibility and
  guardian status. Text and catalog tools are available to guardian-pending teens.
- The eligible birthdate lives in app memory for the signup handoff. A refresh or external sign-in
  can require re-entry. Device storage, navigation parameters and analytics exclude the date.
- Review carries over the selected mood, palette and comfort settings on affirmative consent only.
  Declining settings still saves the selected look. Leaving review without choosing discards the
  offer. Unselected style fields keep the account's existing values.
- CC-7.22 owns the member lookbook and pinned shuffle. This story uses the guest catalog selector.

## I/O & Edge-Case Matrix

| Scenario                                               | Expected result                                                                                      |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Guest opens Today                                      | A single illustrated teaser, Show me looks, and sign-in and signup text links.                       |
| Eligible visitor proceeds                              | The outfit renders immediately without a style question. Mood, Shuffle, Swap and Save are available. |
| Age check refuses                                      | The preview stays locked and clears the submitted date.                                              |
| Save sheet or auth is cancelled                        | The guest returns to the same look and swaps. No account write occurs.                               |
| Verified adult, approved teen or guardian-pending teen | The preview review leads to Looks > Saved and the shared save confirmation.                          |
| Review declines answers                                | The chosen composition is saved and the account settings are untouched.                              |
| Request fails or session changes                       | Retry remains safe for the same member. A different member cannot inherit the confirmed operation.   |

</frozen-after-approval>

## Code Map

- `apps/web/src/app/components/guest-preview/` and `apps/mobile/src/features/preview/` own the
  teaser, preview, age gate, save sheet and review. Reuse the selector, mood row and swap sheet.
- `apps/web/src/app/signup/`, `apps/mobile/src/features/signup/` and each `lib/guest-preview.ts`
  own the date handoff and verified review clients.
- `packages/utils/src/sample-wardrobe/` owns validated preview state and shared carryover logic.
  `saved-looks.ts` and the existing clients persist and reopen an exact catalog composition.

### Implementation ownership

- The implementation agent owns guest UI, localization, age handoff and auth cancel on both
  platforms. Update the teaser copy and native account links. Put the existing mood row near the
  complete outfit and keep color and comfort controls optional. Add the modal at Save, preserve
  the look on dismiss, and retire the first-screen device save and account promotion. Use these
  IDs: `sample-save-look`, `guest-preview-save-sheet`, `guest-preview-save-cancel`,
  `guest-preview-create-account`, `guest-preview-sign-in`. Localize new copy for the ten locales.
  When the user chooses an account door, call `beginGuestLookSave(current, result)` in the store
  update. The builder owns this helper in `@couture/utils`. Handle expiry without entering auth.
  Keep the legacy garment conversion available from the optional preference view, if needed to
  preserve its entry point. Pass and consume eligible birthdate in expiring process memory tied to
  the current preview. Clear the date on refusal, exit and completed signup. Continue using the
  current email or Google door and existing invite/continue controls. The web OAuth fallback may
  request date again after a full navigation.
- The builder owns the persisted save intent, verified account review and writes, guardian access,
  shared status feedback and documentation. The review keeps existing `guest-preview-review-use`
  and `guest-preview-review-keep` IDs. The TEA pane owns the acceptance plan and all test changes.
  Apply formatting, lint and workspace type checks locally. The full suites run in CI.

## Tasks & Acceptance

- [x] Lead with the complete look after age check. Place optional colors and comfort below it.
- [x] Open the account sheet from Save on both platforms. Preserve the look on cancel and
      re-enter the email signup flow with the eligible date.
- [x] Review guest choices alongside account values. Save through CC-7.2 and show CC-7.1
      confirmation at Looks > Saved. Fence writes and completion by verified session.
- [x] Land the TEA coverage, record review findings, mark sprint status done and link Step 78.

## Implementation Notes

- The saved look stores the exact catalog slots and swaps. The comfort profile and style profile
  have their own confirmed writes, so a declined answer never appears in the saved look record.
- The email signup form reuses the verified guest date in the same app session. Web Google OAuth
  unloads the app and clears that memory. Its finish form asks for the date again.
- Pending teen session verification can read the owner's profile and read or update their comfort
  settings. In Looks > Saved, the guardian-guarded capsule response leaves the catalog feed usable.
- Ordinary teen sign-in still offers the guardian invitation while approval is pending. A verified
  preview sign-in with a current look-save intent proceeds to review.
- Leaving the web preview and its signup flow clears the in-memory birthdate. The preview look
  can still be reopened from Today until the preview expires.
- Local phone-width Chromium covered the guest teaser, the under-13 block, birthdate prefill and
  preserving the swapped look when leaving the sheet or auth. Account and native coverage run in CI.

## Plan Change Log

## Review Triage Log

The combined review covered `4203dd270fdda35e0aa14b05ebc07e79b3f538ef` through
`fdfca9eef0fd2f3cb80368f3cad699bf3504e3af`. Codex Security inspected 68 source rows and 12
supporting changes. Its one low-severity finding is recorded as P2-1.

| Finding | Resolution                                                                                                      |
| ------- | --------------------------------------------------------------------------------------------------------------- |
| P1-1    | Returning teen sign-in checks invitation status. Preview sign-in can continue with an active look-save intent.  |
| P1-2    | Shared tests exercise the birthdate handoff, validated intent, catalog composition and save choices.            |
| P1-3    | Updated preview labels, test doubles and selectors.                                                             |
| P1-4    | Real-session harness counts include the four account-save scenarios in their policy lanes.                      |
| P1-5    | Garment columns follow available width and text size.                                                           |
| P1-6    | Native Google acceptance uses the prefilled date and avoids centering controls at scroll edges.                 |
| P2-1    | Clear the in-memory date on leaving preview or preview auth. Regression tests reopen the look after navigation. |
| P2-2    | Claim the current intent before writing. Bind style changes and completion to the verified session scope.       |
| P2-3    | Add web and native unit coverage for look review and guarded capsule reads.                                     |
| P2-4    | Native review completion and cancel dismiss to the existing tab stack.                                          |
| P3-1    | Review labels use valid description-list markup.                                                                |
| P3-2    | A consent refusal ends the review attempt.                                                                      |
| P3-3    | Sprint status and Step 78 link to the implementation and acceptance evidence.                                   |

## Design Notes

The 30-second median describes time to the complete look for a visitor who proceeds through the
age gate. CI checks that the look is the first eligible screen and that there is no intervening
prompt. An automated timing sample measures flow overhead. The real visitor median requires
visitor timing evidence. The epic's owner review replaces the dropped formal studies.

## Verification

- Use TEA's real-session Playwright adult and teen lanes, guest cancellation and underage
  coverage, native flow coverage, and the existing full CI workflows on the PR head.
