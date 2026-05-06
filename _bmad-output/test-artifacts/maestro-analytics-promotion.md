# Maestro analytics promotion criteria

Updated: 2026-05-05 - Added Story 0.14 Task 3 mobile analytics validation flow,
artifact expectations, and advisory promotion gates.

Status: active

## Scope

The mobile analytics flow validates that the Expo app emits the three core shared analytics
events through the repo-local mobile analytics facade:

| Event                     | Journey exercised by Maestro                            | Assertion surface                           |
| ------------------------- | ------------------------------------------------------- | ------------------------------------------- |
| `ritual_created`          | Tap `Generate outfit ritual` on the first tab.          | Diagnostics panel shows the captured event. |
| `wardrobe_upload_started` | Tap `Start wardrobe upload` in diagnostics mode.        | Diagnostics panel shows the captured event. |
| `alert_received`          | Tap `Record weather alert analytics` on the second tab. | Diagnostics panel shows the captured event. |

The wardrobe and alert steps intentionally use diagnostics mode to avoid OS photo-picker and push
notification nondeterminism. Unit and integration coverage remain responsible for the media-picker,
notification listener, and PostHog transport contracts.

## Execution

Android local run:

```bash
npm run test:mobile:e2e:android
```

iOS local run:

```bash
npm run test:mobile:e2e:ios
```

Manual GitHub Actions run:

- Workflow: `.github/workflows/pr-mobile-e2e.yml`
- Dispatch input: `flow=analytics`
- Required gate status: disabled
- Job posture: `continue-on-error: true`

## Evidence

Each successful run should preserve these artifacts under `maestro/artifacts/`:

| Artifact                                                    | Purpose                                      |
| ----------------------------------------------------------- | -------------------------------------------- |
| `analytics-report.xml`                                      | JUnit result for CI/testcase ingestion.      |
| `analytics-maestro.log`                                     | Maestro command log for assertion triage.    |
| `commands-*.json`                                           | Structured command execution diagnostics.    |
| `screenshots/maestro/artifacts/mobile-analytics-ritual.png` | Screenshot after `ritual_created` assertion. |
| `screenshots/maestro/artifacts/mobile-analytics-upload.png` | Screenshot after upload analytics assertion. |
| `screenshots/maestro/artifacts/mobile-analytics-alert.png`  | Screenshot after `alert_received` assertion. |

## Promotion Criteria

PR optional gating may be enabled only after all criteria are met:

| Criterion             | Threshold                                                                        |
| --------------------- | -------------------------------------------------------------------------------- |
| Repeatability         | 20 consecutive analytics-flow passes on the same runner class/device image.      |
| Flake rate            | Less than 5% infrastructure-only failure rate across the latest 30 runs.         |
| Runtime               | Median runtime under 12 minutes and p95 under 20 minutes.                        |
| Artifact completeness | JUnit report, flow Maestro log, command JSON, and all three screenshots present. |
| Failure diagnostics   | At least 3 injected/known failures produce actionable assertion evidence.        |
| Ownership             | Named owner reviews weekly flake evidence and promotion decision.                |

Required PR gating remains disabled until the optional PR check has produced at least 50 runs with
less than 2% infrastructure-only failures and no unresolved P1/P2 reliability defects.

## Gate Decision

Current decision: `CONCERNS`.

Rationale: Analytics journey coverage now exists, but the mobile runner still depends on emulator
startup, Expo runtime readiness, and manual dispatch. The flow is useful as advisory evidence; it
is not yet reliable enough to protect merges.
