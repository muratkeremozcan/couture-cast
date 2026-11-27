# Test design for CC-7.19 Garment subtypes

The [story](../planning-artifacts/epics.md#epic-7-first-use-clarity-and-member-reliability)
introduces category-scoped garment subtypes. The builder owns implementation and the PR.
TEA owns the following tests, test review, and CI repairs.

| ID            | Priority | Evidence                                                                                                                                                                          |
| ------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7.19-CATALOG  | P0       | Assert all 14 agreed ids and their category mappings. Check that each subtype appears in an eligible sample look, and that every weather preset offers subtype coverage. AC1, AC4 |
| 7.19-LOCALE   | P1       | Require usable subtype labels for all supported locales and every subtype. AC4                                                                                                    |
| 7.19-HTTP     | P0       | With the real HTTP route and PostgreSQL, verify legacy reads, persistence, omit and clear behavior, incompatible subtype rejection, and clearing on category change. AC2          |
| 7.19-CLOSET   | P0       | Edit a garment subtype, reopen it, and narrow Closet to that subtype. The same category still shows garments with an unset subtype. AC2                                           |
| 7.19-SWAP     | P0       | With eligible member and sample pieces, assert source precedence and subtype ordering. Check that an older piece in the category is still selectable. AC2, AC3                    |
| 7.19-GENERATE | P0       | Give the generator competing garments from one category. Verify it prefers a weather-compatible subtype and retains the category fallback when that subtype is unavailable. AC2   |

Use synthetic owner-scoped garments and uniquely identified candidates. Assert the saved values
after a fresh read. For swaps and generation, include an incompatible candidate and assert
specific option or garment identities so the tests catch ordering and filtering regressions.
Use the existing Playwright fixtures for browser requests and interactions, and the native
browser harness for mobile control parity.

Run static checks locally and exercise the suites in GitHub Actions. Verify every workflow on
the PR head and inspect retry evidence before reporting readiness.

[Playwright assertions](https://playwright.dev/docs/test-assertions).
