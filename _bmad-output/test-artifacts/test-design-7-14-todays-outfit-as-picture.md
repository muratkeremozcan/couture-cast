# Test design for CC-7.14 Today's outfit as a picture

The [story](../planning-artifacts/epics.md#epic-7-first-use-clarity-and-member-reliability)
and [epic context](../implementation-artifacts/epic-7-context.md) define the acceptance bar.
TEA owns this plan, acceptance tests, coverage review, visual evidence, and CI repairs. The
builder owns the product spec, implementation, and PR.

## Acceptance coverage

| ID           | Priority | Acceptance evidence                                                                                                                                                                                                                                                                                  |
| ------------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7.14-PIC-001 | P0       | On web and native, render an owned photo and catalog artwork together as individually named pieces. An empty closet still shows a composed catalog look. AC1                                                                                                                                         |
| 7.14-PIC-002 | P0       | Test absent and failing photo sources. The affected slot keeps its category illustration and other pieces remain usable. A guardian-pending teen can use the catalog path without a member photo request. AC1, AC3                                                                                   |
| 7.14-PIC-003 | P0       | Check a short name and one weather reason on the closed card. Open detail and check comfort notes, badge details, and a permitted Shop this look action with its disclosure. Exercise the existing suppression rules. AC2                                                                            |
| 7.14-PIC-004 | P0       | Hold a photo response while measuring the rendered picture and its adjacent content, then deliver it and compare the bounds. Assert Chromium layout shift stays at or below 0.1 and keep the existing Today content-height and first-view checks. AC4                                                |
| 7.14-PIC-005 | P0       | Measure each piece's actual target at 44 CSS px or native dp in both axes. Open Swap from a piece, choose a same-slot replacement, and confirm the updated outfit. Press Wear this and verify the CC-7.2 request persists the pictured composition, provides save feedback, and can be reopened. AC5 |
| 7.14-VIS-001 | P1       | Compare full closet, empty closet, missing photo, and dark mode at 390 × 844 in Linux Chromium and 360 × 640 dp on Android small_phone. Assert the intended scenario is present before capture. AC6                                                                                                  |

## Fixtures and execution

- Drive the production Today route on both clients. Reuse the CC-7.7 shell fixtures, frozen
  time and merged Playwright fixtures on web. Use synthetic photos with recognizable content.
  Wait on a visible card, a settled photo or fallback, and fonts before capturing.
- Exercise native interactions in the production Today screen harness, including a photo
  error event and actual focusable targets. Capture the Android small-phone visual cases
  in the existing visual shard with isolated test data.
- Keep the CC-7.13 weather fallback and first-view checks and the CC-5.1 disclosure and
  preference regressions. Use the existing saved-look coverage for account ownership,
  idempotency, and cross-client reopening where the saved-look contract is shared.
- Refresh baselines from the exact PR head in CI and inspect each changed PNG. Verify the
  preview and review all head-SHA workflows, including retry and flake summaries. Keep
  smart Playwright sharding and the Linux Android lane.
