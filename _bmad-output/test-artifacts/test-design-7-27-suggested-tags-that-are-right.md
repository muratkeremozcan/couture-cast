# CC-7.27 acceptance plan

| Priority | Acceptance risk                                                             | Test and evidence                                                                                                                                                                                                                                                                                       |
| -------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0       | Category or subtype confidence hides poor accuracy                          | Run the production classifier on a frozen, named, independently labelled garment image set. Enforce category top-1 accuracy of at least 90% and subtype top-1 accuracy of at least 80%. Count each abstention in the denominator for its labelled field. Report case IDs for misses.                    |
| P0       | A member can confirm an unresolved suggestion                               | Capture a garment in the browser, then load a response with a known low-confidence field. Assert the field shows “Pick one,” has no selected guess, and blocks “Looks right.” Resolve it, confirm, and verify the saved tags.                                                                           |
| P0       | Capture and confirmation show different garments                            | Use the real upload and worker-backed review on the existing browser journey. Verify the dialog displays the captured garment on the same screen as the selected category, subtype, material, and comfort chips.                                                                                        |
| P1       | A response overwrites a member's choices or applies an incompatible subtype | Hold the suggestion response in the modal harness, make a member selection, and release the response. Assert that the member's selection survives, remaining confident fields fill, and the update payload matches the chosen tags. Exercise explicit “None” and the legacy response without a subtype. |
| P1       | Native diverges from web review                                             | Exercise the native modal's selected, unresolved, and confirmed states through its existing rendered controls. Verify the cutout and update payload. Preserve the Android capture and tagging journeys.                                                                                                 |

Both onboarding wrappers must also retire a private preview when the active member changes.
Keep the first member's suggestion request pending with their cutout visible. Publish the next
member through the identity store and verify the old cutout disappears immediately and stays
gone when the pending response resolves.

The browser journey uses the shared Playwright Utils fixtures and a new account per test.
The real worker proves integration and persistence. A controlled suggestion response fixes the
confidence inputs for the uncertainty case. The accuracy benchmark uses image bytes and the
production inference worker, with no fixture predictions or external requests during scoring.

CI runs the suites and provides the release evidence. Record every workflow on the published
head, and inspect execution reports for retries and flaky tests even when checks succeed.
