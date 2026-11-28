---
title: 'Story CC-7.22: Lookbook with shuffle and pinned pieces'
type: feature
ticket: '7-22-lookbook-shuffle-pinned-pieces'
created: '2026-11-27'
status: built
baseline_revision: 'e90debe40babc02312ae0d5a4bc4416b4118270f'
route: full
route_source: pinned
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
  - '_bmad-output/test-artifacts/test-design-7-22-lookbook-shuffle-pinned-pieces.md'
---

<frozen-after-approval>

## Intent

Members can find a complete outfit in Looks > Ideas before uploading any garments.
The weather, style profile and selected mood choose the outfit.
Members can keep individual pieces, shuffle the rest, and save the exact composition.

## Boundaries & Constraints

- Web and native share selection, draft validation and the three available moods.
  A current day mood or account mood comes first, then Chic, Active and Cozy fill the row to three.
- A small closet has up to two active pieces.
  The confirmed Today wardrobe read determines whether this rule applies.
  Today shows the first ranked mood's outfit and Ideas provides the pin editor.
- Ideas reads weather for the primary saved city through the authenticated ritual endpoint.
  Without a forecast, the catalog uses mild and dry.
  Today's temperature override preserves rain protection.
- The device draft stores only catalog identifiers, mood and pins under the member's scope.
  A forecast or style change can replace incompatible pieces.
  Account switching fences reads, writes and status feedback.
- The saved look uses the existing CC-7.2 owner-scoped catalog contract.
  AI ranking belongs to CC-7.23.

## I/O & Edge-Case Matrix

| Scenario                              | Expected result                                                                                                 |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Empty closet with a profile           | Three mood choices, each with a complete outfit and one weather reason.                                         |
| Some pieces pinned                    | Shuffle changes every unpinned piece and keeps every compatible pinned piece.                                   |
| Every piece pinned                    | Shuffle is disabled. Unpinning a piece enables it again.                                                        |
| Refresh or mood change                | The selected mood, exact outfit and pins reload for the current member.                                         |
| Invalid draft or incompatible weather | The selector rebuilds the outfit and retains compatible pinned pieces.                                          |
| Save fails                            | The draft and pins remain available to retry.                                                                   |
| Save succeeds or Reset is tapped      | That mood's pins clear. Save keeps the confirmed outfit visible and Reset restores the top outfit for the mood. |

</frozen-after-approval>

## Code Map

- `packages/utils/src/sample-wardrobe/member-lookbook.ts` builds three ranked looks from the catalog
  selector and validates local drafts. `selector.ts` owns comfort and protection rules.
- `apps/web/src/app/components/looks-screen.tsx` and
  `apps/mobile/src/features/looks/looks-screen.tsx` mount the lookbook in Ideas.
  Platform editors reuse the catalog artwork and shared save feedback.
- `apps/web/src/app/components/home-ritual.tsx` and `apps/mobile/app/(tabs)/index.tsx` choose
  the top catalog outfit for small closets using the existing wardrobe result.
- The existing web and native saved-look clients send the exact composition and notify Saved.

## Tasks & Acceptance

- [x] Build the shared chooser, weather-safe shuffle and draft reconciliation.
- [x] Mount the Ideas editor in both clients and wire session-bound CC-7.2 save and feedback.
- [x] Apply the small-closet rule to Today on both clients.
- [x] Land TEA's acceptance coverage, resolve the one full review, and link Step 79.

- Given a member in Looks > Ideas, selecting a mood shows one complete look and one weather reason.
- Given a pinned piece and an unpinned piece, tapping Shuffle keeps the pin and replaces the
  unpinned piece with a weather-qualified alternative. After reload, the displayed composition
  and the pin match the draft.
- Given a confirmed wardrobe of zero through two pieces, opening Today shows one top look.
  Closet, Community and Profile do not render the member lookbook.
- Given a valid look, one tap on Save confirms it and Looks > Saved reopens its exact pieces.

## Implementation Notes

- The selector uses catalog templates with a replacement available for every displayed slot.
  It keeps the catalog's temperature and rain rules when composing and restoring pieces.
- The primary mood uses the account or current day choice. Editorial mood changes and pins stay
  on the device. Saving through CC-7.2 persists the composition and clears pins after confirmation.
- The Today wardrobe read confirms the closet size. The existing recommendation path supplies
  Today when the member has a usable wardrobe and the catalog fallback does not apply.

## Plan Change Log

## Review Triage Log

The full review used base `e90debe40babc02312ae0d5a4bc4416b4118270f` and
head `73c98098a265325780a40c8a8bf7cbb7782c58aa`.
Codex Security accounted for all 25 changed paths and reported zero security findings.

| Finding                                        | Resolution                                                                                                                             |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| P1-1 Shared coverage                           | Exercise draft validation, weather safety and the localized controls.                                                                  |
| P1-2 Today compatibility                       | Mount one outfit for a small closet. Legacy live-outfit fixtures use at least three garments.                                          |
| P1-3 Editor coverage and missing forecast mock | Mock the existing ritual endpoint and exercise pinned edits, save feedback and session changes.                                        |
| P2-1 Today wardrobe timing                     | Both clients already wait at the screen gate. The outfit now also waits for a bounded wardrobe read when the gate opens on a deadline. |
| P2-2 Pin accessibility                         | Use a stable Pin name and pressed state.                                                                                               |
| P2-3 Save and Undo                             | Bind feedback to the exact composition and live session. Replays do not offer Undo. Block same-tick edits during save.                 |
| P2-4 Reset with an unedited outfit             | Discard a default draft with zero pins. Enable Reset only for a visible edit.                                                          |
| P2-5 Native draft filename                     | Use the existing dot-delimited naming convention.                                                                                      |
| P3-1 Nested day-control card                   | Use a flat disclosure inside the Ideas card.                                                                                           |
| P3-2 Story closeout                            | Mark sprint status done and link editor coverage from Step 79.                                                                         |

## Verification

Run type checks and targeted lint locally. Run automated suites in CI and verify every workflow
on the exact PR head.
