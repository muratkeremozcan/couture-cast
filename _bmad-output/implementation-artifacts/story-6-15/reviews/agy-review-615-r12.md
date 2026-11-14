# Review Round 12 — PR/Handover #615 (`tea615`)

Targets reviewed (strictly read-only across all repo worktrees; mutants and probes executed only in detached `/tmp/wt-615-mutant-r12-tea` and `/tmp/wt-615-mutant-r12-615`, removed and pruned immediately after):

- **Part A** (`/Users/murat/opensource/cc/couture-cast-wt-615-tea`, commit `3d8c3921`, parent `c9cd3132`):
  - `scripts/ci/workflow-node-deps.mjs` (571 lines)
  - `scripts/ci/workflow-node-deps.test.mjs` (304 lines)
- **Part B** (`/Users/murat/opensource/cc/couture-cast-wt-615`, range `c9cd3132..09806105`):
  - RevenueCat Test Store journey (`ed20e562..b015e6d1`), private output/leak scan (`839b7343`), Worklets Release ABIs (`cddf737e`), `android-native.yml` release-builds staging (`09806105`).

---

## Findings (P0–P3)

### P2 — Part A: `maskJs` division-vs-regex edge cases and `node -e` `$`/nested-`createRequire` gaps can still hide pre-install loads (`scripts/ci/workflow-node-deps.mjs:37-152, 222-233`)

Every r11 closure verified in `/tmp/wt-615-mutant-r12-tea` closed its r11 gap cleanly (including `actions/cache/restore` no longer treated as installed, `createRequire` bound/chained/`resolve`, `node` flags with values, `-e` code, `cd`, `npm run`/`test`/`--prefix`/`--workspace`, `bash`/`sh`, workflow defaults, `if: false`, multiline `# npm ci`, `.cjs`/`index.js`, and template/string/comment/regex masking). Across **all 351 `.js`/`.mjs`/`.cjs` files in `scripts/`**, `maskJs` produced **zero** false blanking of real `import`/`require` statements (all 9 audit hits were verified inside test fixture template/string literals or comments).

However, four concrete bypasses remain:

1. **Postfix `++` / `--` followed by `/` misclassified as regex (`scripts/ci/workflow-node-deps.mjs:37, 75-79`)**:
   - `regexStarts` contains `+` and `-`. On `let x = 1; const r = x++ / 2; const y = require('yaml') / 2;`, `startsRegex` sees `+` before `/` and invokes `regexLiteral`, masking `; const y = require('yaml') /` as a regex body (`R12-FN-postfix-div-masks-require => []`).
   - Concrete failure: a pre-install script computing an average/ratio with `count++ / total` followed by `require('yaml') / scale` on the same line passes `workflowProblems` locally and fails on CI.

2. **Regex literal after `if (x)` / `while (x)` not recognized as regex (`scripts/ci/workflow-node-deps.mjs:37, 75-79`)**:
   - Because `)` is omitted from `regexStarts` (for `(a + b) / c` division), a statement-head regex immediately after `if (x)` or `while (x)` containing `'` or `` ` `` (e.g., `if (x) /a'b/.test(s); const y = require('yaml');` or ``if (x) /`/; const b = 1;\nimport 'yaml'``) is treated as opening an unclosed single-quoted string or template literal in `maskJs`, hiding `require('yaml')` / `import 'yaml'` (`R12-FN-if-regex-quote-unmasked => []`, `R12-FN-regex-after-paren-multiline => []`).

3. **Double-quoted `node -e` script containing `$` or escaped backtick collapsed to `null` (`scripts/ci/workflow-node-deps.mjs:222-233, 371-376`)**:
   - `words()` sets `dynamic = true` whenever `/[$`]/.test(body)`is true in a double-quoted word, returning`null`.
   - `node -e "const a = 1; require('yaml'); console.log(\`ok\`)"`passes`null`to`nodeCommand`, which skips `specifiers(code)` (`R12-FN-node-e-with-dollar-backtick => []`).

4. **Module load forms still missed (`scripts/ci/workflow-node-deps.mjs:139-151, 383, 446-459`)**:
   - **2+ nested parens inside `createRequire(...)`**: e.g., `createRequire(fs.realpathSync(path.join('.', 'package.json')))('yaml')` misses line 140's 1-level paren regex (`R12-FN-createRequire-nested-2-parens => []`).
   - **`let r; r = createRequire(...)` reassignment** (`R12-FN-let-reassigned-createRequire => []`), **`import.meta.resolve('yaml')`** (`R12-FN-import-meta-resolve => []`), **`npx`** (`R11-FN-npx => []`), and **extensionless `node scripts/bin-no-ext`** (`scriptExtension` requires `.mjs`/`.js`/`.cjs`, `R12-FN-node-flags-extensionless-script => []`).

- **Remaining strict-policy behavior on r11 FP probes**: `R11-FP-npm-prefix-ci` (`npm --prefix . ci`) and `R11-FP-composite-custom-install` (`bash scripts/bootstrap-deps.sh` in an unlisted composite action) intentionally still report problems because `3d8c3921` allows only unconditional root `npm ci`/`npm install`/`install-dependencies.sh` or `INSTALL_ACTIONS`. `RUNTIME_PROBES` (`scripts/ci/verify-dependency-tree.mjs`) safely exempts only direct calls inside that probe while still checking relative imports (`verify-dependency-tree.mjs` wraps its `nativeChecks` `createRequire` probes in `try/catch` and its caller installs on nonzero exit).

---

### P2 — Part B: Leak scan misses encodings (notably Base64URL in `member.token`) and `run-test-store-journey.mjs` omits `extraIds` (`scripts/lib/test-store-output.mjs:43-92`, `scripts/lib/mobile-e2e-token.mjs:10-18`, `scripts/run-test-store-journey.mjs:468`)

- **Can the leak scan miss an encoding? Yes.**
  - `scanForLeaks(dir, needles)` (`test-store-output.mjs:43-71`) only searches for `[needle, encodeURIComponent(needle)]` using case-sensitive `String.prototype.includes` over `latin1` bytes.
  - It misses:
    1. **Base64 / Base64URL encoding**: `buildMobileE2EAccessToken(userId)` (`mobile-e2e-token.mjs:10-18`) encodes `JSON.stringify({ sub: userId, role, exp, e2e })` as a **base64url** JWT payload segment. If a bearer token ever reaches `dirs.evidence` (for example, inside `report.records[*].message` from a verbose HTTP/Metro/command error, since `test-store-runner.mjs:218` saves `String(error.message).slice(0, 600)` straight into `report.json`), `scanForLeaks` looking only for `member.userId` will miss it.
    2. **Double URL-encoding** (`%2524RCAnonymousID%253A...` in logged URLs), **case-folded UUIDs**, and **JSON Unicode escapes** (`\u0024RCAnonymousID:...`).
  - Furthermore, `run-test-store-journey.mjs:468` calls `writeRunOutputs({ dirs, label, report, member })` without passing `extraIds` (such as `member.token` or `testStoreKey`), so `assertEvidenceClean` checks only `member.userId` and `encodeURIComponent(member.userId)`.
- **Concrete failure scenario**: A failing `adb`/`maestro`/fetch wrapper logs a request header or dev URL containing `EXPO_PUBLIC_E2E_ACCESS_TOKEN` or a base64url/double-encoded `userId` in the last 900 chars captured by `run()` (`run-test-store-journey.mjs:130-134`); `test-store-runner.mjs:218` persists the first 600 chars into `report.records[*].message` under `dirs.evidence`, and `assertEvidenceClean` exits clean (`hits = []`).

---

### P3 — Part B: Proxy `ID_SEGMENT` only covers UUIDs, `$RCAnonymousID:`, and ≥16-char digit-bearing segments (`scripts/lib/test-store-proxy.mjs:19-45`)

- **Judgment on leak surfaces (evidence dir, proxy log, stdout)**:
  - **Bypass secrets & keys**: `testStoreKey`, `REVENUECAT_SECRET_API_KEY`, `VERCEL_AUTOMATION_BYPASS_SECRET`, and `REVENUECAT_TEST_STORE_WEBHOOK_BYPASS_SECRET` are never written to `dirs.evidence`, `proxy.log`, or stdout (note `probeWebhook` appends `REVENUECAT_TEST_STORE_WEBHOOK_BYPASS_SECRET` to the `fetch` query string, and we empirically verified Node 24's `fetch` error prints `fetch failed` without the URL or secret).
  - **Private dir & raw logs (`839b7343`)**: `outputDirs` sets `0o700` explicitly via `chmodSync` and `write` sets `0o600` on `<label>.member.json`, `metro.log`, `device.log`, Maestro debug output, and pulled APKs inside `<out>.private/`.
  - **Proxy log**: Drops headers, query strings (`new URL(...).pathname`), and bodies, maps any segment immediately following `subscribers` to `:subscriber`, and masks segments matching `ID_SEGMENT`. However, `ID_SEGMENT` (`test-store-proxy.mjs:19-20`) does not mask `< 16`-char IDs (e.g., numeric/short IDs) or ≥16-char letter-only tokens when they appear after path segments other than `subscribers` (e.g., `/users/<shortId>` or `/receipts/<alphaToken>`).
  - **Stdout**: `run-test-store-journey.mjs:469` emits `{ label, verdict, wallSeconds }` only; `test-store-preview-webhook.mjs` prints `urlShape` with placeholder `<REVENUECAT_TEST_STORE_WEBHOOK_BYPASS_SECRET>` and hashed `memberRef`.

---

### P3 — Part B: `worklets-staged-gradle.mjs` checks only the first `-PreactNativeArchitectures=` argument (`scripts/ci/worklets-staged-gradle.mjs:42-44`)

- **Can staging pick a wrong ABI or stale binary?**
  - Inside Gradle (`story68-worklets-staging.mjs`) and `android-native.yml` (`09806105`), **no**: `initScript` requires exact 1:1 `buildCMake(RelWithDebInfo|Debug)[<abi>]` tasks, verifies `compiled` sits at `intermediates/cxx/<nativeConfiguration>/*/obj/<abi>/libworklets.so`, verifies `legacy` sits at `intermediates/cmake/<config>/obj/<abi>/libworklets.so`, has no Gradle task outputs (so `stage` never skips as `UP-TO-DATE` over a stale binary), atomically replaces/verifies SHA-256 hashes before Reanimated consumes `libworklets.so`, clears old proofs before starting, and re-hashes both binaries in `verifyWorkletsStaging`. `STAGED_ABIS.Release` matches `SHIPPED_ABIS` (`armeabi-v7a,arm64-v8a,x86,x86_64`), and `android-native-workflow.mjs:195-202` validates every `--abis` and `-PreactNativeArchitectures=` match in `android-native.yml`.
  - **Minor wrapper check**: Directly invoking `worklets-staged-gradle.mjs` with duplicate `-PreactNativeArchitectures=` flags would only validate the first via `gradle.find(...)` (`worklets-staged-gradle.mjs:42`), whereas Gradle uses the last `-P` flag.

---

## Remaining Part B Judgments

- **Does the restore assertion prove restore and not a refresh or webhook?**
  - **Yes** under its stated Test Store boundary:
    - `journeyOptions` (`test-store-journey.mjs:78-79`) restricts `restore` to `server === 'local'` (`127.0.0.1:4000`, unreachable by RevenueCat webhooks unless externally tunneled).
    - Reading `apps/mobile/app/(tabs)/settings.tsx:759,834` confirms `refreshSubscriptionFromMobile()` (`POST /api/v1/commerce/subscription/refresh`) is invoked **only** after `purchasePremiumPlan()` succeeds (`watchEntitlementActivation`) or `restorePremiumPurchases()` succeeds (`handlePremiumRestore`) — never on screen mount or focus.
    - Proxy policy blocks refreshes from `purchase-unsynced` through `reinstall` and `restore-rejected` (`block-once`), `restore-success.yaml` asserts unpaid (`assert-unpaid.yaml`) before tapping `premium-restore` and entitled afterward (`assert-entitled.yaml`), and `attributeRestore` (`test-store-journey.mjs:227-237`) verifies zero forwarded refreshes before `tapAt`, at least one `200` forwarded refresh at `>= tapAt`, and `syncedAt >= forwarded[0].at - 2_000`.
    - Note (documented in `test-store-journey.mjs:240-245`): in RevenueCat Test Store, `Purchases.restorePurchases()` returns current `CustomerInfo` locally; what the test proves is the app's restore flow (`premium-restore` -> `restorePurchases()` -> `POST /subscription/refresh` -> API ledger pull -> UI update).
- **Can S4-12 pass with a failure or cancel that changed entitlement?**
  - **No for server/UI entitlement changes**: `unpaid-cancel` and `unpaid-failure` both end their Maestro flows (`purchase-cancel.yaml`, `purchase-failure.yaml`) with `assert-unpaid.yaml` and immediately call `await unpaid()` (`assertServerUnpaid`: `status === 'none'`, `premium === false`, `source === 'none'`), and the following step (`unpaid-failure` / `purchase-success*`) re-asserts `assert-unpaid.yaml`.
  - **Caveats**: (1) `unpaid-cancel` and `unpaid-failure` do not assert `proxyLog` had zero `POST /refresh` requests during those steps (only that server & UI remained unpaid); (2) paid cancel/failure cannot run through the app UI because paid members see no purchase or restore buttons (`test-store-runner.mjs:136-137`).

---

## Codex Security Diff-Scan Assessment

- **Preflight**: Executed `config_preflight.py --profile security_diff_scan` against both worktrees (`status: ready`; one `suggest` note: `goal_tools_available=false`).
- **Threat Model & Diff-Scan Discovery/Validation**:
  - **Part A (`3d8c3921`)**: Pure static CI gate. Remaining `maskJs` / `words()` edge cases (`P2`) only weaken pre-install gate coverage; no runtime execution of untrusted input (`nodeLoads` reads static repo files without evaluating them).
  - **Part B (`c9cd3132..09806105`)**: Test/verification tooling handling `.env.preview`/`.env.local` secrets (`VERCEL_AUTOMATION_BYPASS_SECRET`, `REVENUECAT_TEST_STORE_WEBHOOK_BYPASS_SECRET`, `REVENUECAT_SECRET_API_KEY`, `EXPO_PUBLIC_E2E_ACCESS_TOKEN`, `member.userId`). Secrets are isolated to process `env`, HTTPS request headers, or probe query params (verified `probeWebhook` failure errors do not echo the URL secret). The primary residual risk is `P2`: `run()` error-output truncation (`test-store-runner.mjs:218`) can persist unredacted non-`userId` strings (or base64url-encoded `userId` inside `member.token`) into `dirs.evidence`, bypassing `scanForLeaks`.

---

## Executed Test Suites & Mutant Results

| Target                                             | Command                                                                                                                                                                | Observed Result                                                                                                                                                         |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `wt-615-tea` (`3d8c3921`)                          | `node --test scripts/ci/workflow-node-deps.test.mjs scripts/ci/coverage-shards.test.mjs`                                                                               | **39/39 pass, 0 fail** (24 + 15 tests)                                                                                                                                  |
| `wt-615-tea` mutant (`/tmp/wt-615-mutant-r12-tea`) | Reintroduce `yaml` via `createRequire(import.meta.url)('yaml')` in `coverage-shards.test.mjs`, run `workflow-node-deps.test.mjs`                                       | **KILLED (exit 1, 23 pass / 1 fail)**: names `pr-checks.yml tests "Keep every workspace in exactly one coverage shard": scripts/ci/coverage-shards.test.mjs loads yaml` |
| `wt-615-tea` audit & probes                        | Real-repo `maskJs` audit across **351** `scripts/**/*.{js,mjs,cjs}` files + 30 FN/FP probes                                                                            | **0** missed real loads across 351 files; 10 remaining `R12-FN-*` / `npx` bypasses confirmed (`[]`)                                                                     |
| `wt-615` (`09806105`) non-Gradle suites            | `node --test scripts/lib/test-store-*.test.mjs scripts/ci/android-native-workflow.test.mjs scripts/lib/evidence-manifest.test.mjs scripts/ci/coverage-shards.test.mjs` | **147/147 pass, 0 fail**                                                                                                                                                |
| `wt-615` (`09806105`) Worklets suite               | `node --test scripts/lib/story68-worklets-staging.test.mjs`                                                                                                            | **19 tests: 2 pass, 17 fail** (all 17 failed on `requireGradleWrapper` because `apps/mobile/android/gradlew` is not generated without running prebuild first)           |

REVIEW-615-R12-DONE
