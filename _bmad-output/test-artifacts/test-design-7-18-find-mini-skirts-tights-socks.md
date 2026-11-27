# Test design for CC-7.18 Find mini skirts, tights and socks

The [story](../planning-artifacts/epics.md#epic-7-first-use-clarity-and-member-reliability)
defines the signed-in sample look journey. The builder owns implementation and the PR. TEA owns
acceptance coverage, test review, and CI repairs.

## Baseline

In the [phone study](first-use-phone-study.md), G01 reported making two looks on build `5862e9cf`
and being unable to preview or save them. The tester could not find a mini skirt. Hosiery options
were unchecked. The existing catalog contains all three pieces, so a catalog presence assertion
alone would have passed in the earlier build.

## Acceptance coverage

| ID            | Priority | Evidence                                                                                                                                                                                            |
| ------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7.18-PICK-001 | P0       | A signed-in member opens the sample picker on a phone viewport. With All and Mild or Cool, the member can find and preview a sample look with a mini skirt and tights and find socks as a swap. AC1 |
| 7.18-SAVE-001 | P0       | Choose a different piece, save, and reopen the saved look. Check the chosen catalog piece in the preview, save request, and reopened outfit. AC1                                                    |
| 7.18-SAVE-002 | P0       | Save the same outfit twice under different collections. Changing the collection restores the Save action and sends the new collection with the same pieces. AC1                                     |
| 7.18-SWAP-001 | P0       | Inspect the accessible groups and the weather order. Confirm the current choice is marked, then select it again and check that the sheet closes without changing the look. AC2                      |
| 7.18-SWAP-002 | P1       | With a deterministic extended assortment, assert that 12 options appear before Show more, the 13th appears afterward, and reentering the sheet restores the initial limit. AC2                      |

Use the existing Playwright shell and network fixtures for web and the native browser harness
with MSW. The save fixture returns the submitted composition so a dropped swap fails on reopen.
Use explicit option identities and wait for the rendered save confirmation before reopening.
Exercise the pagination boundary with synthetic entries when the live catalog is smaller.

The shared tests cover keeping the current look, opening a look with the right slot, choosing
an eligible fallback when the exact piece is absent, rejecting unavailable choices, and preserving
undo when the current piece is selected again. The picker journeys confirm that reselecting the
current choice preserves the prior Undo action and leaves the existing announcement in place.
The web and native component tests exercise the 12-row limit, focus on the first newly revealed
piece, and confirm the next open starts collapsed. Web coverage exercises arrow focus, Space,
and Enter.

Use static checks locally and GitHub Actions for test execution. Verify every workflow and
inspect retry evidence for the final PR head. The Mild web case attaches the 390 by 844 picker and
swap sheet screenshots to the Playwright report for visual review.

[Playwright assertions](https://playwright.dev/docs/test-assertions) and
[Vitest Browser Mode](https://vitest.dev/guide/browser/).
