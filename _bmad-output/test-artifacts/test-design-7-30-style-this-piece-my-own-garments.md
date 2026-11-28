# CC-7.30 acceptance plan

| ID           | Priority | Acceptance evidence                                                                                                                                                                                                                                                            |
| ------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 7.30-CLOSET  | P0       | Start in an empty Closet and verify its empty state. Open styling from a sparse Closet with only the anchor and verify catalog fill. Add a weather-compatible owned piece and verify its placement before comparable catalog options. AC1, AC3                                 |
| 7.30-WEATHER | P0       | In a populated Closet, compare school, weekend and going out for the selected weather. Verify the anchor stays pinned, occupied slots prefer eligible owned pieces, and leftovers use weather-compatible catalog pieces. AC1, AC2                                              |
| 7.30-PHOTO   | P0       | Use an owned companion with unavailable photo access and verify its placeholder. Verify another owned companion loads its authorized photo and an ineligible item does not appear in styling. AC1                                                                              |
| 7.30-ACCOUNT | P0       | Save a mixed look through CC-7.2. Assert ordered garment and catalog references, then reopen after reload and verify the same pieces and weather. Verify owner scoping and references at the saved-look service boundary if the implementation changes that boundary. AC1, AC3 |
| 7.30-NATIVE  | P1       | Open the native Closet styling flow and verify occasion labels, owned and catalog pieces, and placeholder parity using the native component harness. AC1, AC2                                                                                                                  |

The browser cases reuse the merged Playwright Utils fixtures and the existing loopback wardrobe and
account-save doubles. Shared utility cases exercise deterministic selection and saved-look round trips.
The builder owns installation, production, the spec, Step 87, and publishing the PR. TEA owns this
plan, test code, test review, and CI triage. GitHub Actions runs the suites. The gate includes every
workflow for the final head and checks for recovered retries in executed lanes.

[Playwright locators](https://playwright.dev/docs/locators) and
[Playwright retry outcomes](https://playwright.dev/docs/test-retries) inform the browser evidence.
