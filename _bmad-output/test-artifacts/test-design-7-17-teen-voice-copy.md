# Test design for CC-7.17 Teen voice and copy

The [story](../planning-artifacts/epics.md#epic-7-first-use-clarity-and-member-reliability)
and [epic context](../implementation-artifacts/epic-7-context.md) set the acceptance bar.
TEA owns the acceptance tests, test review, baseline verification, and CI repairs.
The builder owns the copy inventory, product changes, spec, and PR.

| ID              | Priority | Acceptance evidence                                                                                                                                                                                                                                                                              |
| --------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 7.17-VOICE-001  | P1       | Review the design-system guide for second person, short sentences, school, weekends, going out, pictures for fashion terms, and the rule against percentages and match scores. Review the rendered English copy against it. AC1                                                                  |
| 7.17-COPY-001   | P0       | Audit web and native Today, Closet, Looks, Community, Profile, and first run in US and Canadian English. Use grade 6 as the ceiling for prose and three words for visible button labels. Review short strings, names, interpolation, and required legal or safety wording in context. AC2        |
| 7.17-COPY-002   | P0       | Check rendered Today states, all shared sample garment and look descriptions, and the share card's generated text for the retired work language. Assert the new situations on representative rendered paths. Preserve member-authored text and age, consent, and privacy behavior. AC3           |
| 7.17-I18N-001   | P0       | Check every changed public copy key in all ten locales across the client catalogs, shared sample strings, and share renderer. Check nonempty values and matching placeholders. Use rendered examples to catch fallback and verify the intended translation reaches the member. AC4               |
| 7.17-LAYOUT-001 | P1       | Exercise long German labels and prose on web at 320 CSS px and Android at 320 dp. Check text bounds, working controls, and horizontal overflow on affected routes, including first run. Inspect light and dark screenshots from the existing visual jobs before importing changed baselines. AC4 |

## Fixtures and verification

- Start with acceptance assertions that the old copy would fail. Use focused catalog and renderer
  checks for exhaustive string coverage and the existing shell and onboarding journeys for
  rendered text. Use synthetic member data and retain independent expected values for key copy.
- Use the existing Playwright merged fixtures and `interceptNetworkCall`. Keep copy-sensitive
  assertions where the wording is the behavior under test. Use stable IDs for unrelated controls.
  Reuse the existing Maestro visual setup and restore locale, font scale, size, and appearance.
- Check each updated test for an observable failure, deterministic state, and waits tied to a real
  outcome. Run static checks locally. Use CI for suite evidence and inspect retries, logs, and
  images across every workflow for the published head.

[Playwright assertions](https://playwright.dev/docs/test-assertions),
[Maestro visible assertions](https://docs.maestro.dev/reference/commands-available/assertvisible)
