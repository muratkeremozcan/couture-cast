# Test design: Story CC-7.13 Calm Today with one primary job

The Today test plan follows [CC-7.13 in the epic](../planning-artifacts/epics.md) and the
[epic context](../implementation-artifacts/epic-7-context.md). TEA owns the acceptance tests,
coverage review, and CI repairs. The builder owns the implementation and PR.

## Risks and coverage

| ID           | Priority | Risk                                                                                     | Acceptance evidence                                                                                                                                                                                                 |
| ------------ | -------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7.13-WEB-001 | P0       | Screen chrome or competing actions push the outfit out of the first view.                | At 390 × 844 the weather line, outfit card, and one primary action fit above the tab bar. The recent closet strip follows the outfit, then Plan and at most one Community row. AC1, AC2                             |
| 7.13-WEB-002 | P0       | An empty closet or failed forecast leaves the member without an outfit or a way forward. | Exercise an empty closet and both no-city and unavailable-forecast responses. Check a labeled sample, an actionable weather setting and, for the empty closet, one Add row. AC1, AC3                                |
| 7.13-WEB-003 | P0       | Today bypasses Community eligibility or sponsorship preferences.                         | Assert zero rows for an ineligible response even after the request settles. Assert one linked row for an eligible response. Sponsor coverage checks disclosure and opt-out on both clients. AC1                     |
| 7.13-WEB-004 | P0       | Old Home controls survive or moved actions become unreachable.                           | Assert the removed hero, actions, chips, feed and its controls, heading, and sign-out are absent. Verify Today’s Plan row and Profile’s Sign out at their destinations. AC2                                         |
| 7.13-WEB-005 | P0       | Content exceeds the default height budget or clips at enlarged text.                     | Measure actual scrollable content against 1,688 px for empty, populated and forecast-unavailable fixtures. At 320 px and 200% text, scroll to each control and check its visible bounds and input reachability. AC4 |
| 7.13-NAT-001 | P0       | Native diverges from Today’s layout or leaves the hourly forecast permanently expanded.  | Check the same primary and section order in the production tab, then open and dismiss the hourly ribbon from the weather line. Exercise no-city and unavailable-weather fallback. AC1, AC2, AC3, AC5                |
| 7.13-NAT-002 | P0       | The scenario control wastes space or changes no recommendation.                          | Identical forecast periods hide the control. Differing periods produce one group with morning, midday and evening. Selecting a period changes the displayed recommendation. AC2                                     |
| 7.13-NAT-003 | P0       | Small-phone native chrome or large text obscures actions.                                | Measure the real screen in the native budget harness. Capture an Android device screenshot at the supported 360 × 640 dp layout and link it from the PR. AC4, AC5                                                   |

## Fixtures and execution

- Playwright uses the merged fixtures, the CC-7.7 fixture shell, and the CC-7.10 budget probe.
  Serve synthetic data with a fixed clock. Distinguish an empty closet from a missing city and
  an unavailable forecast so each fallback proves its own condition. Wait on the screen gate,
  the specific visible state, and any Community response before checking absence.
- Native uses the production tab in the mobile Vitest browser harness for ordering, budgets and
  branch coverage. An Android Maestro flow proves the weather-line interaction and captures the
  device screenshot. The PR uses Linux runners.
- Keep the existing Plan, Spotlight handoff and focus, sponsored disclosure and opt-out, share,
  and signed-in shell coverage as applicable to their real entry points. Refresh Today visual
  baselines through the existing CI artifact flow after inspecting the renders.
- Run suites in CI. Use the preview for staging verification and inspect every check and flaky
  test on the final PR head. Retain smart sharding for Playwright.
