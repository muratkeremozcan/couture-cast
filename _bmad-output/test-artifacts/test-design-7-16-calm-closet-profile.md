# Test design for CC-7.16 Calm Closet and Profile

The [story](../planning-artifacts/epics.md#epic-7-first-use-clarity-and-member-reliability),
[epic context](../implementation-artifacts/epic-7-context.md), and
[CC-7.11 handoff](../implementation-artifacts/spec-7-11-five-tab-navigation-back-pattern.md)
define the acceptance bar. TEA owns the tests, test review, and CI repairs. The builder owns
the product implementation, story spec, and PR.

| ID           | Priority | Acceptance evidence                                                                                                                                                                                                                                                                                                           |
| ------------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7.16-CLO-001 | P0       | Closet shows one title row with Add and More, one category chip row, and then the garment grid. Selecting a category filters the grid. Selecting All restores the mixed grid. Each card shows its photo and short name. AC1                                                                                                   |
| 7.16-CLO-002 | P0       | A mixed wardrobe shows text and distinct icons and tones for Needs tags, Failed, and Processing. A ready garment has no status badge. Existing tag and retry actions still work through the supported garment flow. AC1                                                                                                       |
| 7.16-CLO-003 | P1       | An incomplete fixture shows one setup progress row below the grid. Its action opens setup. A completed fixture keeps the grid and omits the progress row. AC1                                                                                                                                                                 |
| 7.16-PRO-001 | P0       | The signed-in Profile lists Account, Places, Style, Premium, Notifications, Language, and About and privacy in order, then Sign out. Rows display current values from the applicable settings. Each row opens its own titled screen and back returns to Profile. AC2                                                          |
| 7.16-PRO-002 | P0       | Web Places opens from Profile and loads the member's places after direct entry or refresh with a real session. A direct entry's back action returns to Profile. Native Style opens from its Profile row and offers Silhouette, Closet setup, and Color palette. Back returns to the Profile tab. AC2, CC-7.11 handoff         |
| 7.16-PRO-003 | P1       | The Profile menu contains no Planner control. Looks > Plan remains reachable. Today has no About action in its header. The compact Profile shows its topic rows in place of the language buttons, opt-out toggle, and settings links listed in D-KNOWN-7.11. AC2                                                              |
| 7.16-ACC-001 | P1       | Secondary help appears as a concise line with a Learn more action. The action reaches the relevant help. At enlarged text the line may wrap so the full label and action stay readable. AC3, AC4                                                                                                                              |
| 7.16-ACC-002 | P1       | At 320 CSS px and 200 percent browser text, German labels and a long fixture value fit their controls or wrap. Exercise Closet, Profile, and Places in light and dark. Capture Android at 320 dp and 2.0 font scale in both appearances and inspect complete labels and controls, including the native Style destination. AC4 |

## Fixtures and CI evidence

- Reuse the Playwright signed-in shell and native screen fixtures. Use synthetic member data.
  Control garment statuses and setup completion through the existing response schemas. Reuse
  the real-session location lane for auth, refresh, and account-switch coverage.
- Use focused component cases for status variants and Profile contents. Use Playwright and
  Maestro for navigation, hierarchy, and accessible layout. Reuse existing shell visual jobs.
  Restore device size, font scale, appearance, and locale after native visual captures.
- Review changed tests for deterministic setup, direct witnesses for user-visible behavior, and
  waits tied to a response or observable UI state. Check all workflows and retry summaries for
  the published head. Open each updated image before committing a generated baseline.

The UI tests use isolated fixtures and waits on visible outcomes.
[Playwright best practices](https://playwright.dev/docs/best-practices),
[Maestro visible assertions](https://docs.maestro.dev/reference/commands-available/assertvisible.md)
