# Story 6.15 handoff

Updated: 2026-11-13, about 2 PM CST. The builder pane closes. A fresh builder, TEA and Antigravity reviewer take over.

- Worktree: `/Users/murat/opensource/cc/couture-cast-wt-615`, branch `feat/story-6-15-expo-sdk-58`.
- Spec: `_bmad-output/implementation-artifacts/spec-6-15-expo-sdk58-live-font-scale-layout.md`. Read D1, D5, D6 (with the 2026-11-13 owner amendment) and the Plan Change Log first.
- Test design: `_bmad-output/test-artifacts/test-design/cc615-expo-sdk58-live-font-scale-test-design.md`. Flake log: `cc615-ios-native-flake-log.md` beside it.
- No PR is open. The coordinator said not to open it; the new team decides when. A draft body is at the end of this file.

## Current state

- `main` (`ca7bf1f3`, after PRs 216 and 222) is merged into the branch as `3d6bd7a8`. The only conflict was the import block of `scripts/ci/node-test-gate.test.mjs` (took `main`'s `parse` from `yaml`; 66/66 pass).
- After the merge, `node --test scripts/ci/*.test.mjs scripts/lib/*.test.mjs`: 2489 of 2502 pass. The 13 failures are the two known environment cases in the gotchas below.
- The branch is still on SDK 54. All Step 0 work is here; Steps 1 to 4 have not started.
- No background job, watcher or device agent is running for this story. The last simulator run ended with exit 1 (see the iOS results below).

## Owner rule that changes the plan (2026-11-13)

No macOS runner job runs on a pull request or gates a merge. iOS and watchOS native run on the nightly cron and `workflow_dispatch` only. `ios-native-evidence` is no longer a required check. TEA is cutting a PR off `main` (`de333b5e`), branch `ci/no-macos-on-prs`. It moves watchOS, share-card iOS, accessibility-focus iOS and share-native-unit Swift to nightly plus dispatch. It drops the `ios-native` push trigger, deletes the evidence judge, the dispatch workflow and the gate guard, and adds a test that fails on any macOS job on PR or push and on any PR job over 20 minutes. No PR number yet when this was written.

Spec D6 records the rule (`5c4ddbcc`). Never dispatch the story for evidence again. Each step's pre-merge iOS evidence is a recorded local run on the exact head SHA.

## Done

- Step 0 code: `expo-background-task` replaces `expo-background-fetch`, with tolerant unregister of the old task. `newArchEnabled` and `edgeToEdgeEnabled` are gone from `app.json`, checked by `scripts/lib/prebuild-semantic-diff.mjs`. The font-scale config-changes plugin is listed first in `app.json` (TEA-16, `8c9c181f`).
- Live font-scale proof: `scripts/run-live-font-proof.mjs` with `scripts/lib/live-font-*.mjs`. It classifies by the bundled React Native version (TEA-01) and checks hierarchy source by device fingerprint and build (`live_font_hierarchy_wrong_build:missing`, retried 3 times for that error only). A centred touch target is exempt from clipping only when the cold base launch shows the same height and overhang. Dev and test builds render `LiveFontMountMarker`; `EdgeToEdgeModal` puts it inside the first `accessibilityViewIsModal` view.
- Capsule builder: `accessibilityViewIsModal` moved from `EdgeToEdgeModal` onto the sheet view (`66de9e80`), where VoiceOver honors it.
- iOS proof fixes from the last run: mount markers compared by scope (`a4505d81`), and iOS static text read once instead of twice (`b3bfd15e`).
- CI: `deploy-mobile` refuses a production build under the D12 hold (`scripts/ci/mobile-release-hold.mjs`). The release export is scanned for a RevenueCat Test Store key. `scripts/ci/pr-job-p95.mjs` measures PR jobs with queue time and every outcome. The plugin suites and the Foundation-only Swift rules run on Linux PRs.
- Android Step 0, API 36 emulator, Release:

  | Build             | 1.0 to 1.5                                                                                 | 1.5 to 1.0                                       |
  | ----------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------ |
  | SDK 54, no plugin | Activity recreated; text stale (Home 32/39, composer 5/5, Settings 19/23, Community 11/15) | restored                                         |
  | SDK 54, plugin    | known residual: Activity and root kept, JS scale updated, same stale counts                | matches cold, except Home Collapse (65 vs 43 px) |
  | SDK 58, no plugin | text correct, but the Activity is recreated, which AC3 forbids                             | restored                                         |
  | SDK 58, plugin    | fixed on Home (5/5), composer, Community                                                   | Home fixed 2/5; Settings failed once going up    |

  P0-07 passes: SDK 54 plugin build installed over `a01e0307`, then reboot, session kept, one WorkManager job, no crash. Config changes on SDK 54: theme in place, density recreates, locale `ar-EG` in place but RTL waits for the next launch (R3-07, TEA).

- Review rounds with Antigravity: merge-a (2 P2 and a P3), r2, then r3 PASS on `13873a7d..2561c69c`. r3's pre-existing P3 on the capsule builder is fixed in `66de9e80`. TEA signed off the merge resolution, `c119df78` and `f2b59869`.

## Left before merge

1. When `ci/no-macos-on-prs` merges, merge `main` and take its deletions. Then drop the story's own PR evidence work that `main` does not delete: the judge additions and `runJobsPassed` in `scripts/ci/ios-native-inputs.mjs` (plus `ios-native-inputs.test.mjs` cases), `scripts/ci/ios-native-runs.test.mjs`, `scripts/ci/ios-native-evidence.mjs` and its test, `scripts/ci/fixtures/ios-runs-github.mjs`, the `ios-dispatch-gate` job, and `RUN_IF` and `PUSH_GROUP` in `scripts/ci/ios-native-workflow.mjs` with their workflow tests. `git grep` every caller before deleting an export.
2. Wire the iOS live font legs into the nightly `ios-native.yml` in this story (TEA, 2026-11-13).
3. D6 record: TEA agreed to drop the apple-native p95 and the `macos-15` queue records; `pr-job-p95` stays for Linux PR jobs only. The amendment in `5c4ddbcc` still keeps the old macOS tables as history; reconcile with TEA.
4. iOS Step 0 legs on the merged head: rebuild Release, rerun Home, Settings, Community and composer, P0-08 on one simulator, and the capsule-builder hierarchy check. Report them in the Android table shape. Delete DerivedData after.
5. Steps 1 to 4 per the spec table, including the SDK 58 `live_font_relayout_on_scroll` fix and the R8 keep rule (finding below), D15 RevenueCat Test Store journey, plugin needs, D12 memory hold.
6. D7 production-shaped run, learning path Step 55 (D8), the deployment guide.
7. Merge gate: green CI, Antigravity clear, a local code-review at high, and zero open threads checked in its own step. Do not wait on CodeRabbit.

## Open findings

- iOS four-screen Release run (`runs/ios261-sdk54-release-all`, built from `e23216b4`, simulator `679BE700`) ended `pass: false`:
  - Home and Community: `live_font_residual_unapproved` on each leg.
  - Settings: `live_font_control_text_changed` on both controls and `live_font_baseline_unexpected` on each leg. `a4505d81` and `b3bfd15e` address the Settings dumps; offline re-stitch agrees at 33 lines. A rerun is needed.
  - Composer: `live_font_command_failed`, visited no scale. That leg was already void because the modal-marker fix landed after the build.
- SDK 58 Android with the plugin: the screen can settle with old heights (Cloudy 78 px vs 51) while JS has the new scale, and text re-measures only after a scroll. Reported as `live_font_relayout_on_scroll`. Step 4 must close it.
- SDK 58 Release crashes at launch: `NoSuchMethodException: WorkDatabase_Impl.<init>`. R8 strips the WorkManager database constructor; a keep rule is needed in Step 4.
- R3-07 RTL on a live locale change (TEA owns).
- Not yet reviewed by Antigravity: `66de9e80`, `a4505d81`, `b3bfd15e`, the `5c4ddbcc` spec amendment, and the merge `3d6bd7a8`.
- D11 store and device gates stay blocked on Apple and Google enrollment.
- Security, owner action: a Cursor MCP helper process carries a live GitHub token on its command line (visible in `ps`). The owner should rotate it.

## TEA open items (from the outgoing TEA, 2026-11-13)

- C-15: the iOS first-flow cap stays at 240 s, and a first flow over 192 s is a finding. The shards now run on macos-15 with the iOS 18.5 simulator, in the nightly run only.
- C-16 evidence still owed:
  - 20 first flows on macos-26 from the canary;
  - canary triage;
  - first-flow p95;
  - a retirement trigger for macos-15. When GitHub announces the end of the macos-15 image, move the shards to macos-26 once the canary has been green 5 nights in a row.
- Flake log: `_bmad-output/test-artifacts/test-design/cc615-ios-native-flake-log.md`. The open rows are iOS 26.5 runtime classes, which now appear only in the canary:
  - the XCUITest audit cannot find `share-card-cancel`;
  - Maestro stalls, such as `settings.yaml` in `assertNotVisible`;
  - first `open-app` stalls.
- Every nightly native red goes to TEA each morning and gets classified in the flake log.
- Canary rules: `ios-native-canary.yml` runs at 04:47 UTC and never gates or blocks a merge. Triage a canary red; never rerun it to green.
- D5 residual baselines: the device agent's SDK 54 release-plugin reruns (all four screens, plus Debug) are still unreviewed. Approve an entry in `scripts/lib/fixtures/live-font-residual-baselines.json` only when all of these hold:
  - the leg is `known-residual`;
  - the control passes;
  - every structural check passes;
  - every miss is stale;
  - growth fails only on the named probe;
  - ids and counts are exact, with no headroom.
- No macOS job runs on a pull request or a merge. The PR from `ci/no-macos-on-prs` does this.
  - `scripts/ci/pr-job-ceilings.test.mjs` fails any macOS job a pull request or push can run, and any PR job over 20 minutes.
  - The owner skipped the 2-week p95 audit of Linux PR jobs. Run `scripts/ci/pr-job-p95.mjs` when a PR job nears 15 minutes.
- PR 216 already carries the fixture-reap fix (18b81d7f). The local branch `tea/ba216-reap` is obsolete.

## Reports and evidence

- Antigravity reports: `_bmad-output/implementation-artifacts/story-6-15/reviews/` (copied from `/tmp/agy-review-615-*.md`).
- Device runs, logs and screenshots: `_bmad-output/test-artifacts/story-6-15/runs/` and `runtime/`. Local only; `.gitignore` keeps them out of git. Do not delete them.
- `_bmad-output/test-artifacts/story-6-15/s0-01-app-json-prebuild.md`: prebuild comparison for the `app.json` key removal.
- Red-proof logs from this pane were in its scratchpad and are gone; each fix's test fails without it, so rerun a mutant to reproduce.

## Gotchas

- Shared checkout: no `git stash`, `git checkout --` or `git reset`. Red proofs go in a throwaway worktree. No AI attribution trailers in commits.
- Never run Playwright without an isolated `DATABASE_URL` plus `PLAYWRIGHT_SKIP_DB_RESET=true`.
- `node --test` false reds: `scripts/lib/story68-api-entry.test.mjs` is a vitest file, and `worklets staging` needs a prebuilt Android tree.
- iOS builds: never install a new build on a simulator while a proof run is using it. Keep free disk above 16 GiB; APFS purgeable space and macOS update snapshots swing the reading by 20 GiB with no deletions.
- herdr: `herdr agent prompt <pane> '<single-quoted text>'` then `herdr agent send-keys <pane> enter`, no backticks. Check reviewer idle with `herdr agent get` status. One review at a time; briefs give the exact range and the security lens `~/.codex/skills/codex-security-review/SKILL.md`.
- A changed export: `git grep` all callers (`runJobsPassed` had a missed caller once).
- Commits and `npm run typecheck` rebuild shared packages; use `npm exec tsc` per workspace during parallel work.
- Quote times in Chicago time.

## Draft PR body

Step 0 of Story 6.15 (PR 1 of 5 toward Expo SDK 58 and React Native 0.88). It gets the app and CI ready on SDK 54 so each SDK step after it is a version bump with a proof attached.

- The ritual refresh moves from `expo-background-fetch` to `expo-background-task`, with tolerant unregister of the old task and an in-place upgrade proof.
- `newArchEnabled` and `edgeToEdgeEnabled` leave `app.json`, checked by a semantic prebuild diff.
- A live font-scale proof for Android and iOS classifies the result by the bundled React Native version: below 0.87 it expects the known 6.8 bug signature, from 0.87 the fix.
- The capsule builder sheet sets `accessibilityViewIsModal` on its sheet view, where VoiceOver honors it.
- `deploy-mobile` refuses a production build while the SDK 56 memory hold applies, and the release export is scanned for a RevenueCat Test Store key.
- `scripts/ci/pr-job-p95.mjs` measures PR jobs with queue time and every outcome; the plugin suites and the Foundation-only Swift rules run on Linux pull requests.
