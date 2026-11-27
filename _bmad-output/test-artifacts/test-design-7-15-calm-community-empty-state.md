# Test design for CC-7.15 Calm Community with an empty state

The [story](../planning-artifacts/epics.md#epic-7-first-use-clarity-and-member-reliability)
and [epic context](../implementation-artifacts/epic-7-context.md) define the acceptance bar.
TEA owns the acceptance tests, test review, visual evidence, and CI repairs. The builder
owns the story spec, product implementation, and PR.

| ID           | Priority | Acceptance evidence                                                                                                                                                                                                                                                                  |
| ------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 7.15-COM-001 | P0       | The Community title and Post appear first, followed by one climate trigger, one dismissible challenge row, and the feed. Opening the climate sheet reveals All climates, the six bands, and the explainer. Dismissing the challenge leaves the feed usable. AC1                      |
| 7.15-COM-002 | P0       | Two published synthetic peer looks render once each. A post present in both reads leads the feed and carries Near you. Each card shows its image, title, pseudonymous author, and one reaction row. One action opens the detail for the same post. AC1, AC2, AC4                     |
| 7.15-COM-003 | P0       | Card overflow opens without opening detail. A peer card offers Report and an owned card offers Withdraw where policy permits. Exercise the established report submission and immediate withdrawal, including success feedback and removal. AC2                                       |
| 7.15-COM-004 | P0       | A settled, eligible climate read with zero displayed posts offers exactly one See all climates action. Activating it requests all climates and reveals the two peer looks. Restricted and unavailable surfaces retain their existing state and suppress the climate action. AC3, AC4 |
| 7.15-COM-005 | P1       | At compact phone width and enlarged text, use long localized labels to exercise the climate sheet and empty action. Check that the text fits its controls and that controls remain reachable. Exercise the native surface on Android small_phone. AC4                                |

## Fixtures and execution

- Use the production Community route on both clients. Keep the zero and two-post presentation
  scenarios isolated from the shared community seed. Use the published feed and Spotlight
  schemas, stable post IDs, two synthetic peer aliases, and a duplicate across reads.
- Reuse the merged Playwright fixtures and the native Community HTTP harness. Keep the real
  publication, reporting, moderation, and privacy coverage in their established CI lanes.
- Review route scope, exact card targets, usable controls, absence assertions after settling,
  and fixture isolation. Check head-SHA workflow results and retry summaries in CI.

The browser cases use actionability and retrying assertions for observable UI state.
[Playwright best practices](https://playwright.dev/docs/best-practices)
