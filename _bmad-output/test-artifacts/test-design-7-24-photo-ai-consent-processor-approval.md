# Test design for CC-7.24 photo AI consent and processor approval

| ID            | Priority | Acceptance evidence                                                                                                                                                                                                                                                                                                        |
| ------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7.24-POLICY   | P0       | Check the registry against the photo features named in Epic 7. Assert each feature has a decision for every age band, an explicit manual path, and zero approved production recipients for photo data. Review the spec's processor and permitted-field inventory against the runtime defaults. AC1, AC4, AC5               |
| 7.24-CONSENT  | P0       | Exercise the execution service with an explicitly approved synthetic policy. Check missing, expired, revoked, wrong account, superseded version, wrong feature/input/provider, missing assent, and missing required guardian approval. Assert each denied attempt leaves the source and processor untouched. AC2, AC3, AC6 |
| 7.24-DISPATCH | P0       | Hold a fresh authorized photo read, revoke consent, and release the read. Observe zero dispatches. In an eligible request, inspect the exact synthetic processor input and decode the image to verify metadata removal. AC3, AC4                                                                                           |
| 7.24-LATE     | P0       | Hold a processor reply across revocation. Observe the cancellation or deletion path, then release the reply and check that the service discards it before persistence or delivery. Check a normal successful request to establish that the fixture can reach those effects. AC3                                            |
| 7.24-HTTP     | P0       | Exercise the authenticated Profile list and revoke routes with distinct member fixtures. Check owner-only responses and mutations, private cache headers, stable repeat revocation, and signed-out rejection. AC2, AC6                                                                                                     |
| 7.24-PROFILE  | P0       | Open Photo AI from Profile and confirm the disabled state and manual paths. Revoke a scoped grant and verify the displayed result. Switch accounts across an in-flight read or revocation and verify the previous member's state stays hidden. AC2, AC5, AC6                                                               |

Use synthetic member, image, and processor fixtures. Pause async work on explicit barriers
at the storage and processor boundaries. Use the shared network fixture in Playwright to
exercise the browser workflow and the existing native component runner for account switching.
GitHub Actions runs the suites. Audit every workflow on the final PR head, including job
attempts and in-run test retries.

[NestJS testing](https://docs.nestjs.com/fundamentals/testing) ·
[Playwright network mocking](https://playwright.dev/docs/mock) ·
[GitHub Actions run history](https://docs.github.com/en/actions/how-tos/monitor-workflows/view-workflow-run-history)
