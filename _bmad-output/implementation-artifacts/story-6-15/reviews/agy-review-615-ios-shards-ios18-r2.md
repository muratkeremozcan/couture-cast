# TEA Review Round 2: `ci/ios-shards-ios18` (`92676def..ebb689bd`)

Worktree: `/Users/murat/opensource/cc/couture-cast-wt-iosnative`
Range: `92676def..ebb689bd` (`e074facd`, `93d9048b`, `ebb689bd`)
Verification run: `node --test scripts/ci/ios-native-workflow.test.mjs scripts/ci/native-ios-flow-deadline.test.mjs scripts/ci/native-ios-command-evidence.test.mjs scripts/ci/native-supabase.test.mjs scripts/ci/native-ios-runtime-fits.test.mjs` (462/462 passing) and `node scripts/ci/ios-native-workflow.mjs` (exit 0).

## Verdict: PASS

No P1, P2, or P3 findings remain.

## Closure Verification

- **Round 1 P2-1 (Closed in `e074facd`):** `CLIENT_FITS` (`scripts/ci/ios-native-workflow.mjs:145-149`) is enrolled in `MANDATORY` (`scripts/ci/ios-native-workflow.mjs:269-274`) for both `ios-shard` and `ios-expo-go` with condition `undefined` and required lines `['set -euo pipefail', ...CLIENT_FITS]`, and `consumerProblems` (`scripts/ci/ios-native-workflow.mjs:860-867`) requires `step.id === 'client_fits'`. `scripts/ci/ios-native-workflow.test.mjs:1095-1110` adds failing stubs for `plutil`, `xcrun`, and `node` (`native-ios-runtime-fits.mjs`) under `describe('mandatory checks fail their step')`.
- **Round 1 P2-2 (Closed in `93d9048b`):** When `timingFile` is missing, `spawnIosFlow` (`scripts/ci/native-ios-flow-deadline.mjs:34-42`) prints only lines matching `WORKER_DIAGNOSTIC` (`/^(?:owned_flow_[a-z_]+(?::[A-Za-z0-9_.-]+)?|Timed out at the native flow deadline)$/gm`). `runDeadlineWorker` (`scripts/ci/native-ios-flow-deadline.mjs:122-133`) traps `SIGTERM` (`143`), `SIGINT` (`130`), and `SIGHUP` (`129`), runs `killOwned()` and `writeOnce()` in `uncaughtException` before calling `report()`, and wraps `console.error` in `report()` (`lines 161-167`) so a broken stderr pipe (`EPIPE`) cannot interrupt cleanup. `scripts/ci/native-ios-flow-deadline.test.mjs:146-264` pins secret-stderr suppression, `SIGINT`, `SIGHUP`, and `EPIPE` on `console.error`.
- **Round 1 P3-1 (Closed in `ebb689bd`):** `quietState` (`scripts/ci/native-ios-quiesce.mjs:361-367`) checks `psPids(ps)` (`lines 350-358`) so a listed label whose PID exited between `launchctl list` and `ps` is classified as `'idle'` and booted out, while a listed PID present in `ps` under another manager is classified as `'unowned'` and skipped (`scripts/ci/native-ios-quiesce.mjs:378-395`). `scripts/ci/native-ios-command-evidence.test.mjs:313-345` pins both the `'unowned'` and exited-PID `'idle'` cases.
- **Mutant verification (isolated temp copy outside worktree):** Six workflow mutants on `client_fits` (commenting out `native-ios-runtime-fits.mjs`, appending `|| true`, and adding `set +e` in `ios-shard` and `ios-expo-go`), four deadline mutants (raw stderr dump, removing `SIGINT`, removing `SIGHUP`, and logging before `killOwned`/`writeOnce` in `uncaughtException`), and two quiesce mutants (`pid === null` only for `idle`, and booting out `unowned`) all failed their respective validator and test suites.

## Security (`codex-security-review`)

- **Public log exposure:** `WORKER_DIAGNOSTIC` and `failureCode` (`scripts/ci/native-ios-flow-deadline.mjs:8-9, 37-38, 170-173`) confine missing-record stderr output to closed worker diagnostic tokens, preventing Maestro login email or OTP values from reaching the public CI log.
- **Signal handling and process-group ownership:** `SIGTERM`, `SIGINT`, `SIGHUP`, and `uncaughtException` all terminate `-child.pid` and write `timingFile` before logging through the non-throwing `report()` wrapper.
- **Validator bypass resistance:** Enrolling `client_fits` in `MANDATORY` closes shell-neutralization vectors (`|| true`, `#` comments, `set +e`, `if false; then`, here-documents, and `shell: sh`) on both consumer jobs.

REVIEW-615-IOS-SHARDS-IOS18-R2-DONE
