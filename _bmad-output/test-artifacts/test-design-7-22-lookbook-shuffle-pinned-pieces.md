# Test design for CC-7.22 Lookbook

| ID           | Priority | Acceptance evidence                                                                                                                                                                                                                                                                                   |
| ------------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7.22-IDEAS   | P0       | Open Looks > Ideas on a phone with an empty closet and a known style profile. Check three mood chips in one row. Select each mood and check that exactly one complete catalog look appears with one weather reason. AC1, AC2                                                                          |
| 7.22-TODAY   | P0       | Check that Today shows the top outfit for empty and small closets. Check the regular closet outfit when the closet meets the story threshold. Check that Saved, Plan, Closet, Community, and Profile render without a lookbook card. AC1                                                              |
| 7.22-SHUFFLE | P0       | Pin a named piece, shuffle, and compare piece IDs by slot. Every unpinned slot changes and the pinned slot keeps its piece. Reload and verify the pin still holds during the next shuffle. Use a weather fixture with multiple eligible choices and test constrained pools at the selector level. AC3 |
| 7.22-SAVE    | P0       | Tap Save once. Observe one CC-7.2 create request carrying the visible composition, then verify the saved composition after reload. Confirm successful save and reset clear pins. Check failure preserves the draft. AC3, AC4                                                                          |
| 7.22-SCOPE   | P0       | Exercise account-scoped persistence with two members and a stale saved draft. The second member opens a fresh look. Invalid or superseded pins cannot carry into a new look. AC3                                                                                                                      |

Use the existing Playwright merged fixtures for the web member journey and fixed weather.
Keep selector cases in shared unit tests so thermal compatibility and exhausted pools have
deterministic fixtures. Check native interactions at the component layer with the existing
React Native harness. Use the existing CC-7.2 save path and contract fixtures to assert the
exact composition. Backend persistence and authorization remain covered by the CC-7.2 suite.

Write acceptance assertions against the agreed interface before implementation where practical.
GitHub Actions executes the suites. Check all workflows on the PR head SHA and inspect attempts
for retries that became passes.

[Playwright assertions](https://playwright.dev/docs/test-assertions) ·
[GitHub Actions run history](https://docs.github.com/en/actions/how-tos/monitor-workflows/view-workflow-run-history)
