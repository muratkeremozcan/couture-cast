# CC-7.28 acceptance plan

| ID               | Priority | Acceptance risk                                                                                              | Verification                                                                                                                                                                                                                                                                                                    |
| ---------------- | -------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7.28-E2E-001     | P0       | A batch saves too early or saves the wrong number of pieces                                                  | From a fresh member's Closet, pick three distinct garment photos. Review each, keep two, and confirm with one Add 2 pieces action. After reloading, verify that the real inventory contains exactly the two saved garment IDs.                                                                                  |
| 7.28-WEB-001     | P1       | The browser admits more than five photos or leaks a stale selection into the next batch                      | Exercise exactly five and an oversized selection through the file input. Assert the cap, the count on the confirmation, and a fresh queue after closing and reopening.                                                                                                                                          |
| 7.28-RETRY-001   | P0       | One failure rolls back good items, replays a success, or duplicates a committed item whose response was lost | Drop the browser response after the second real commit. Verify that the first item is saved and the second offers Retry with its preview cleared. Re-select the same photo and verify the same commit key and garment ID, two allocations in all, and an HTTP 200 replay.                                       |
| 7.28-CLEANUP-001 | P0       | Discarded or failed photos remain in memory, device cache, or private storage after their lifecycle ends     | Exercise cancel, item failure, and delayed preparation completing after discard or owner change. Check that the old review disappears, owned transient resources are released, and later work cannot repopulate the abandoned queue. The existing private staging lifecycle applies after Add starts uploading. |
| 7.28-NAT-001     | P1       | The native picker exceeds the cap, maps status to the wrong item, or leaves capture files behind             | Exercise the Closet library path with Expo picker results and an owned cache-file harness. Verify the selection limit, one-action save, per-item retry, and cleanup while preserving library source files and the existing camera flow.                                                                         |

The browser journey uses an isolated member, real garment fixtures and the shared Playwright Utils
fixtures. It forwards the commit to the real API and drops the response at the browser boundary.
The lower-level tests control preview preparation, ownership and picker timing. Synchronize on
user-visible state or a named operation. Use the existing local API lane for persistence.

The builder owns production code, the story spec, Step 85, and PR publication. TEA owns this plan,
the acceptance tests, test review, and every CI failure or flake. Verify the complete workflow
inventory for the published head and inspect test reports for recovered retries. All suites run in
CI under the Epic 7 rules.

[Playwright file selection](https://playwright.dev/docs/input#upload-files) and
[Playwright retry outcomes](https://playwright.dev/docs/test-retries) inform the browser checks.
