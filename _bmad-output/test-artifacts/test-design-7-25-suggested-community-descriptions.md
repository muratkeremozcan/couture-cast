# Test design for CC-7.25 suggested Community descriptions

| ID            | Priority | Acceptance evidence                                                                                                                                                                                                                                                                                           |
| ------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7.25-DRAFT    | P0       | Web and native offer one suggestion action after photo selection. An eligible response fills the editable description and shows Suggested. Accepting or editing clears the marker and keeps the chosen text. AC1                                                                                              |
| 7.25-CONSENT  | P0       | Selecting a photo leaves the description empty. The explicit action sends only the current draft and upload IDs to the existing authenticated route. The server reads only the eligible member's verified private upload and derives a local color cue. CC-7.24 keeps external photo processing off. AC1, AC2 |
| 7.25-FALLBACK | P0       | Cover manual entry without requesting a description, a timeout at the five-second boundary, and malformed output. The member can type and publish a manual description. Use a controlled clock for the deadline and release a held response after it expires. AC1, AC2                                        |
| 7.25-STALE    | P0       | Hold a reply through photo replacement, member/session change, and typing then clearing text. Release the earlier reply and assert the current description and its marker stay unchanged. Show that the current photo can still receive a fresh suggestion. AC3                                               |
| 7.25-PUBLISH  | P0       | Publish an edited suggestion through the real Community route and assert the submitted caption, persisted screening disposition, and both engine identities. The existing Community publication suite covers text refusal with a safe image. AC4                                                              |

Use real web and native composers at the HTTP boundary. Hold async responses on explicit
barriers and reuse the Community upload fixtures. The browser journey uses the shared
Playwright network fixture and the local Community API lane on CI. The API tests use
verified image bytes, owner-scoped draft fixtures and controlled storage responses.
GitHub Actions supplies execution evidence. Check every workflow,
job attempt, and test retry on the final pull request head.

[Vitest timer controls](https://vitest.dev/guide/mocking/timers) ·
[Playwright assertions](https://playwright.dev/docs/test-assertions) ·
[GitHub Actions run history](https://docs.github.com/en/actions/how-tos/monitor-workflows/view-workflow-run-history)
