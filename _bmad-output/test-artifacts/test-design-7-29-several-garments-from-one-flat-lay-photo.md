# CC-7.29 acceptance plan

| ID           | Priority | Acceptance evidence                                                                                                                                                                                                                                                     |
| ------------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7.29-REVIEW  | P0       | Pick one flat-lay from Closet. Verify distinct cutout previews and default keep. Edit one piece, remove another, and verify one confirmation submits the kept pieces with the expected tags. AC1, AC4                                                                   |
| 7.29-REJECT  | P0       | Drive person-present and uncertain results at the local detector boundary. Verify no previews, durable photo writes, or garment rows. Exercise the real separation and model-output decisions against fixed rasters and model results. AC2, AC5                         |
| 7.29-PRIVATE | P0       | Try to confirm a signed mask as a second member and with a changed piece ID or mask. Verify the saved pixels match the kept mask, carry no source metadata, and belong to the originating member. Verify the request logs omit mask bytes and tokens. AC3               |
| 7.29-PURGE   | P0       | Cancel or expire a review under a controlled clock. Verify previews and the confirmation action disappear and the API refuses expired tokens. Exercise pending preparation during account change in the native harness. Verify review creates zero durable objects. AC3 |
| 7.29-REPLAY  | P0       | Drop the browser confirmation response and assert retry submits the same payload. At the API, persist the first confirmation and retry against the same masks. Verify the same garment IDs and exactly one piece per kept mask. AC4                                     |
| 7.29-NATIVE  | P1       | Exercise the native single-photo picker and review controls. Verify default keep, removal, edited tags, and cleanup of app-owned copies on failure or account change. AC1, AC3                                                                                          |

The local Playwright lane uses a fresh member, the shared Playwright Utils fixtures, and
deterministic review and confirmation responses. API integration injects the local detector
at the inference boundary and exercises production signing and persistence against an isolated
database and in-memory storage adapter. The source image is processed in the first-party API
request and is discarded. Only the masked previews are staged in UI memory. A large confirm
fixture exceeds the generic JSON limit so the test exercises the route-specific request parser.

The builder owns production code, the story spec, Step 86, and PR publication. TEA owns this plan,
story tests, test review, and red or flaky CI checks. Suite execution runs in GitHub Actions.
Read the workflow conclusions and recovered retry reports for the final PR head.

[Playwright file selection](https://playwright.dev/docs/input#upload-files) and
[Playwright retry outcomes](https://playwright.dev/docs/test-retries) inform the browser evidence.
