# Test design for CC-7.26 clean garment cutouts

| ID            | Priority | Acceptance evidence                                                                                                                                                                                                                                                                                                                    |
| ------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7.26-MASK     | P0       | Score each accepted mask against the matching pixel labels for a plain scene, cluttered scene, pale garment on a pale surface, and patterned garment. Require 95% garment retention and 90% background removal per accepted scene. Require a successful cutout on a plain scene so an implementation that always falls back fails. AC1 |
| 7.26-ORIGINAL | P0       | Compare the decoded fallback to the same crop prepared with cleanup off. Use uncertain scenes and require at least one explicit fallback. Check that the member can continue the upload. AC1                                                                                                                                           |
| 7.26-PARITY   | P0       | Compare dimensions and decoded RGBA from the member's preview and the final private wardrobe object for a cutout and a fallback. Use the real capture and storage flow. AC2                                                                                                                                                            |
| 7.26-PRIVACY  | P0       | Prepare a cutout offline as a new member without a photo AI grant. Confirm the only upload goes to the signed wardrobe storage URL. Confirm CC-7.24 still disables external garment processing. AC3                                                                                                                                    |

Use fixed, metadata-free photos with independently outlined foregrounds, plus the
existing capture fixtures for focused regressions. Score pixels from the real image
pipeline. Measure garment retention and background removal separately for every scene.
Keep image dimensions and crop fixed for the labeled cases.

Reuse the supervised local Playwright fixture for the member journey. Wait for the
preview to decode and the committed garment to become readable. The native harness
checks PNG processing under a UTF-8-only decoder, valid PNG abstention, and cleanup
after a crop or member change. Hold the first crop while changing settings and verify
that only the latest crop runs next. Force browser encoding failures and check that
the original crop can still be prepared.

GitHub Actions supplies execution evidence. Check every workflow and inspect retries
on the final pull request head.

[Playwright assertions](https://playwright.dev/docs/test-assertions) ·
[Sharp raw pixel output](https://sharp.pixelplumbing.com/api-output/#raw) ·
[GitHub Actions run history](https://docs.github.com/en/actions/how-tos/monitor-workflows/view-workflow-run-history)
