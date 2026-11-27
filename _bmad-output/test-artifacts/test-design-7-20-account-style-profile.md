# Test design for CC-7.20 Account style profile

The [story](../planning-artifacts/epics.md#epic-7-first-use-clarity-and-member-reliability) adds
optional picture choices to the first member look and makes style answers account-owned. The
builder owns the implementation and PR. TEA owns this plan, the acceptance tests, and CI repairs.

| ID           | Priority     | Evidence                                                                                                                                                                                                                                                                                       |
| ------------ | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7.20-FIRST   | P0           | At phone width, Today shows the first look and its primary action before any style choice. Check that four labeled picture controls share one row and that a member can continue without answering. AC1, AC2                                                                                   |
| 7.20-TUNE    | P0           | Open Tune my style from Today and Profile > Style. Finish within three skippable screens. Exercise swatches, picture choices, and an illustrated avoid toggle. Check that advancing saves, Skip preserves earlier answers, reopening restores selections, and clear resets them. AC1, AC2, AC3 |
| 7.20-ACCOUNT | P0           | Write partial answers over HTTP, then read and clear them. A second account keeps its own answers. Reject signed-out requests and invalid fields. Check pending-teen access, private cache headers, stale responses, and JSON array transport. AC3                                             |
| 7.20-RANK    | P0           | Use competing catalog looks to check preference ranking, weather eligibility, and the default order after clearing. AC3                                                                                                                                                                        |
| 7.20-DAY     | P1           | Set temperature and mood from Today, read and change them in Looks, then verify that the override expires at the day boundary and leaves account answers intact. AC4                                                                                                                           |
| 7.20-NATIVE  | P1           | In the native component harness, reopen saved answers, retry a failed write with the same draft, and clear. Exercise the day controls while saving a sample look. AC1 through AC4                                                                                                              |
| 7.20-PILOT   | Owner review | AC5 specifies five of six participants finishing within 60 seconds. That outcome is unmeasured. The [Epic 7 owner decision](../implementation-artifacts/epic-7-context.md#sequencing) moves usability review to the owner's post-epic walkthrough.                                             |

Use the existing Playwright fixtures and unique synthetic accounts. Install browser intercepts
before navigation and verify the visible result after each mutation. Use a fixed clock for expiry
and assert that the account write payload contains only the answer fields for the completed screen.

Run static checks locally and use GitHub Actions for suite execution. Check every workflow on the
PR head and read retry or flaky-test evidence before reporting readiness.

[Playwright assertions](https://playwright.dev/docs/test-assertions)
