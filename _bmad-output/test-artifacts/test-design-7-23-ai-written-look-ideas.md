# Test design for CC-7.23 AI-written look ideas

| ID            | Priority | Acceptance evidence                                                                                                                                                                                                                                                                               |
| ------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7.23-PROVIDER | P0       | Review the story spec for the pinned provider and model, retention and training terms, per-call cost, timeout, per-account quota, and deployment-wide spend cap. Check that the implementation uses the documented values. AC1                                                                    |
| 7.23-INPUT    | P0       | Exercise the authenticated route and inspect the fake provider call. Verify coarse weather, enumerated preferences, and catalog IDs. Reject extra request fields such as coordinates or free text. Inspect telemetry on success, rejection, and provider failure for identifiers and content. AC2 |
| 7.23-OUTPUT   | P0       | Return a complete ranking with synthetic descriptions. Reject unknown IDs, incomplete or duplicate rankings, invalid or overlong text, markup, and unsafe suggestions, including body, age, identity, and attractiveness claims. AC3, AC5                                                         |
| 7.23-LIMIT    | P0       | Hold the provider past the deadline and assert cancellation and a fallback response. Reject failed calls gracefully. Exhaust account quota and the shared spend cap, including overlapping reservations, and count provider calls. AC2, AC5                                                       |
| 7.23-APPLY    | P0       | Open explicit Looks > Ideas with forecast, style profile, and Saved reads held. Verify the rule-based look appears within one second of Ideas becoming visible. Resolve generation in an untouched editor and check the highest-ranked look, its description, and the provider mood order. AC4    |
| 7.23-EDIT     | P0       | Pin and shuffle while generation is pending. Verify the original mood order and edited composition when “New ideas ready” appears. Tap it and verify the order and description update while the selected mood, pieces, and pin hold. Check that failed generation leaves the look intact. AC4     |
| 7.23-SCOPE    | P0       | Complete the newer request before the older one. Switch session or account while a request is pending. Resolve each stale request and check that it changes neither the displayed look nor the pending ideas indicator. AC3                                                                       |
| 7.23-LATENCY  | P0       | Run 20 sequential fixture-backed generations through the server service with the real clock. Require 20 valid results and a nearest-rank p95 of at most five seconds. Use fake timers separately for the exact deadline behavior. AC5                                                             |

Use the server's provider seam for validation, timeout, budgets, and telemetry. The HTTP
test checks the authenticated route and the provider input together. Web uses the existing
Playwright fixture shell and network interception. Native uses the component harness.
Release deferred responses on an explicit test action so the ordering is deterministic.

CI uses synthetic responses and makes zero live model calls. The owner authorized a focused
local provider smoke with synthetic catalog and style inputs. Record only the model,
outcome, and elapsed time from that smoke. The smoke is independent of CI acceptance.

Verify every workflow for the final PR head and inspect execution logs for retries or flakes
that passed on a later attempt.

[Playwright API mocking](https://playwright.dev/docs/mock) ·
[Vitest fake timers](https://vitest.dev/guide/mocking/timers) ·
[GitHub Actions run history](https://docs.github.com/en/actions/how-tos/monitor-workflows/view-workflow-run-history)
