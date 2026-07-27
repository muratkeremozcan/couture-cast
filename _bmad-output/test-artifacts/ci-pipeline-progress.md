---
stepsCompleted:
  ['step-01-preflight', 'step-02-generate-pipeline', 'step-03-configure-quality-gates']
lastStep: 'step-03-configure-quality-gates'
lastSaved: '2026-07-27'
workflowType: 'testarch-ci'
---

# CI pipeline progress: Story 3.4 native quality gate

## Preflight

- Git repository: present.
- Remote: `git@github.com:muratkeremozcan/couture-cast.git`.
- Branch: `feat/epic3-story4`.
- Stack: fullstack. Playwright, Next.js, and Vitest configurations are present.
- Test frameworks: Playwright, Vitest browser mode, Node test, Swift compiler
  executables, XCTest, and Maestro.
- Dependencies: installed.
- Runtime: Node 24 from `.nvmrc`; local Node is 24.18.0 and npm is 11.16.0.
- CI platform: GitHub Actions. Existing workflows are being expanded.
- Dependency cache: the repository-local install action uses the npm lockfile and
  caches `node_modules`.

The full `npm test` command passed after one environment fix. Local Xcode test-bundle
compilation no longer requires a watchOS simulator runtime. The workspace results include
431 passing API tests, 85 passing mobile browser tests, 24 passing web tests, all package
tests, two passing watchOS Node subtests, and every native Swift behavior executable.

The first run exposed an Xcode destination failure because the local machine lacks a
watchOS simulator runtime. The harness now compiles the WatchAppTests and
WatchAppUITests targets directly. The new macOS CI lane will install a concrete watchOS
runtime before executing XCTest.

## Pipeline generation

Execution mode resolved to subagent. Three bounded workers inspected workflow integration,
simulator execution, and contract-test compatibility in parallel. The root agent
integrated and reviewed their outputs.

The generic GitHub Actions template was adapted as an extension to the existing pipeline.
The new output is `.github/workflows/watchos-native.yml`. Creating a separate
`.github/workflows/test.yml` would duplicate the repository's established lint, shard,
burn-in, contract, and report workflows.

The native workflow:

- Runs on every pull request, main push, and manual dispatch.
- Uses `macos-15` with Xcode 16.4 and Node 24 from `.nvmrc`.
- Installs dependencies with a fixed `npm ci` command.
- Runs the existing native prebuild, compiler, behavior, and Xcode target checks.
- Executes `WatchAppTests` and `WatchAppUITests` on a dynamically selected watchOS
  simulator.
- Allows one official watchOS runtime download when the runner image has no available
  runtime.
- Retains `.xcresult`, logs, runtime inventory, device inventory, and a failure screenshot
  for five days.
- Cancels obsolete runs and grants read-only repository permissions.

`apps/mobile/scripts/run-watchos-xctest.mjs` creates a disposable Expo prebuild fixture,
selects a runtime-supported device type, boots by UDID, executes the shared test scheme,
and cleans up only the simulator and temporary workspace it created.

The existing `contract-testing.yml` remains the contract stage. Story 3.4 changes no HTTP
provider or consumer contract. Its existing local schema, three-run Pact determinism
gate, and provider verification already block every pull request through `PR Gate`.
Broker publishing, webhooks, and can-I-deploy are a separate system-level enhancement.

## Quality gates and notifications

### Burn-in

- The existing changed-spec Playwright gate remains enabled for pull requests. It repeats
  selected browser scenarios ten times with retries disabled in CI.
- The watchOS native gate executes the complete unit and UI test scheme ten consecutive
  times on the same booted simulator. Each iteration produces an independent `.xcresult`
  bundle and JSON summary.
- Any failed iteration fails its workflow. The repository-wide `PR Gate` then blocks the
  pull request.
- Reusable workflows no longer accept install or test commands as inputs. Commands are
  fixed in versioned workflow code. Data inputs enter shell steps through environment
  variables.

### Thresholds

- P0 threshold: 100 percent.
- P1 threshold: at least 95 percent.
- Story 3.4 tests are treated more strictly than the minimum thresholds. Every generated
  watchOS unit test, UI test, prebuild check, and native compiler check must pass.
- Any critical failure blocks merge through the `PR Gate`.

### Contract gate

- Consumer Pact generation runs three times before provider verification.
- Pact JSON normalization now sorts object keys and interactions before comparing hashes.
- Consumer and provider Vitest processes use the `forks` pool with file parallelism
  disabled and one worker, which is the supported Vitest 4 single-worker configuration.
- Consumer generation, determinism, and provider verification remain merge blocking.
- Broker publishing, webhook staleness checks, and can-I-deploy do not apply to the
  repository's current brokerless contract workflow. They become required before a
  deployment pipeline publishes contracts to a broker.

### Notifications and evidence

- Playwright burn-in failures keep the existing pull request comment and artifact link.
- The watchOS job publishes its artifact link in the GitHub Actions job summary.
- WatchOS evidence includes every `.xcresult`, JSON summary, Xcode log, runtime and device
  inventories, and a simulator screenshot on failure. Retention is five days.
- No Slack or email endpoint is configured in the repository, so GitHub checks, summaries,
  comments, and artifacts are the notification channels.
