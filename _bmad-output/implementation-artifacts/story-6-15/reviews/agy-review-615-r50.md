# Tea615 Review — Round 50 (`1b101d1c..3f6b31e1`, skip `c56d26a5` and `3f6b31e1`)

- **Target diff (`1b101d1c..5f45b952`)**: `3020f549` (`scripts/check-artifact-secrets.mjs`, `playwright/support/helpers/artifact-secret-guard.spec.ts`) and `5f45b952` (`scripts/ci/android-network-timeout.sh`, `scripts/lib/expo-manifest-bundle-url.mjs`, `scripts/lib/expo-manifest-bundle-url.test.mjs`, `scripts/ci/android-native-workflow.mjs`, `scripts/ci/android-native-workflow.test.mjs`, `scripts/lib/evidence-manifest.mjs`).
- **Execution environment**: Strictly read-only on `/Users/murat/opensource/cc/couture-cast-wt-615`; all probes and mutants executed at commit `3f6b31e1` inside detached `/tmp/wt-615-mutant-r50` (since removed and pruned). Note that during this review the shared worktree advanced to `c80e241f` with active WIP edits outside our control.
- **Baseline tests at `3f6b31e1`**:
  - `node --test scripts/ci/android-native-workflow.test.mjs scripts/lib/expo-manifest-bundle-url.test.mjs scripts/lib/evidence-manifest.test.mjs` -> `tests 102, suites 3, pass 102, fail 0`
  - `npx vitest run playwright/support/helpers/artifact-secret-guard.spec.ts` -> `47 passed (47)`

---

## Findings

### P1-1 — `isGzipHeader` reserved-flag gate allows gzip secret smuggling across `fflate`, `gzip`, and Python readers

- **Location**: `scripts/check-artifact-secrets.mjs:69-76` (`isGzipHeader`), `scripts/check-artifact-secrets.mjs:276-280` (`containerKind`)
- **Failure scenario**: `isGzipHeader(buffer)` rejects any gzip member whose `FLG` byte (`buffer[3]`) has RFC 1952 reserved bits set (`(buffer[3] & 0xe0) === 0` at `line 74`), causing `containerKind(buffer)` to return `undefined` and `scanBuffer()` to treat the compressed bytes as plain text. While `node:zlib.gunzipSync()` rejects reserved flag bits (`Z_DATA_ERROR`), **other standard gzip readers ignore those bits and inflate the payload cleanly** — including this repository's own bundled `fflate.gunzipSync` (`node_modules/fflate`), CLI `gzip -dc`, and Python `gzip.decompress()`. Before `3020f549`, those payloads failed closed as `unreadable`; after `3020f549`, any `.gz` file, `.zip` entry, or `base64` attachment inside `.jsonl` whose `buffer[3]` sets `0x20`, `0x40`, or `0x80` passes `check-artifact-secrets.mjs` with `exit 0`, `findings: []`, and `unreadable: []`.
- **Probe evidence**:
  - `1a.reserved_flag_0x20` / `0x40` / `0x80`: `readers: { nodeZlib: 'Z_DATA_ERROR', fflate: 'INFLATED', cliGzip: 'INFLATED', pythonGzip: 'INFLATED' }`, `findings: 0, unreadable: 0`.
  - `1.smuggle_0x20_all_containers` (`.gz` + `.zip` containing `.gz` + `.jsonl` carrying `base64` gzip with `buffer[3] |= 0x20`): `decodedMatch: true` (CLI `gzip -dc`, Python `gzip.decompress`, and `fflate.gunzipSync` all extract `secret=dummy_secret_value_for_probe_50`), `mainExitCode: 0`, `files: 3, layers: 5, findings: [], unreadable: []`.

### P2-1 — `manifestBundleUrl` concatenates `url.pathname` without validating scheme or leading `/`, enabling off-host URL construction and breaking relative asset URLs

- **Location**: `scripts/lib/expo-manifest-bundle-url.mjs:28-29` (`manifestBundleUrl`)
- **Failure scenarios**:
  1. **Non-special scheme host suffix hijack**: `manifestBundleUrl` runs `const url = new URL(named)` and returns `` `${new URL(origin).origin}${url.pathname}${url.search}` `` without checking `url.protocol` (`http:`/`https:`) or `url.pathname.startsWith('/')`. A non-special scheme URI without `//` such as `x:.evil.com/pwn.bundle?a=1` parses in Node `URL` with `url.pathname === '.evil.com/pwn.bundle'`, turning `http://127.0.0.1:8081` into `http://127.0.0.1:8081.evil.com/pwn.bundle?a=1` (an external hostname instead of loopback Metro, though Metro at `127.0.0.1:8081` is runner-local trusted here). Similarly `javascript:alert(1)` yields `http://127.0.0.1:8081alert(1)`.
  2. **Relative `launchAsset.url` rejection**: Because `origin` is not passed as the base to `new URL(named)`, a legitimate relative path `"/apps/mobile/index.ts.bundle?platform=android"` throws `TypeError: Invalid URL`.
- **Probe evidence**:
  - `2.nonSpecialSchemeHostTrick`: `manifestBundleUrl('{"launchAsset":{"url":"x:.evil.com/pwn.bundle?a=1"}}', 'http://127.0.0.1:8081')` -> `'http://127.0.0.1:8081.evil.com/pwn.bundle?a=1'`.
  - `2.jsScheme` -> `'http://127.0.0.1:8081alert(1)'`.
  - `2.relativeUrl` -> throws `Invalid URL`.

### P3-1 — `android-network-timeout.sh` warm-up `curl` omits `--globoff` (`-g`)

- **Location**: `scripts/ci/android-network-timeout.sh:62`
- **Failure scenario**: `new URL().search` preserves raw `[`, `]`, `{`, `}` characters (`2.shellCharsInQuery`), and `curl -fsS --max-time 600 -o /dev/null "$bundle"` runs without `-g`/`--globoff`. Any manifest bundle query containing `[0]` or `{a,b}` causes `curl` to parse URL globs (`curl: (3) bad range` or brace expansion into extra requests). Shell command injection via `$(...)`/backticks is blocked because `"$bundle"` is double-quoted.
- **Probe evidence**:
  - `2.curl_no_globoff`: `?x[0]=1` -> `FAIL: 3 curl: (3) bad range in URL position 35`; `?x={a,b}` -> brace-expanded into two requests.

---

## Focus Verification Notes

### Focus (1) — `3020f549` (`scripts/check-artifact-secrets.mjs`)

- **Valid RFC 1952 headers & multi-member streams (`1c`, `1d`)**: `FLG = 0x1f` (`FTEXT|FHCRC|FEXTRA|FNAME|FCOMMENT`) and multi-member concatenated gzips both open via `zlib.gunzipSync` and report secrets (`findings: 1, unreadable: []`).
- **Method byte != 8 (`1b`)**: `0`, `1`, `9` fail in all tested readers (`node:zlib`, `fflate`, CLI `gzip -dc`, Python `gzip`).
- **Truncated / trailing-junk gzip (`1e`, `1g`)**: Truncated `>= 10` byte gzip (`len12`) and gzip with trailing non-gzip junk both fail closed (`unreadable: 1`). Truncated `< 10` bytes (`len9`) is classed as plain bytes (`findings: [], unreadable: []`), too short to compress an 8-byte secret. Note: pre-existing `1f` (preamble bytes before gzip at offset `> 0`) also skips gunzip (`containerKind` checks magic at offset 0).
- **Fake `1f 8b 08` in zip/base64 (`1h`)**: Both `.zip` entry and `.jsonl` base64 layer starting `1f 8b 08 00` that fail to inflate still fail closed (`zipUnreadable: 1`, `b64Unreadable: 1`).
- **Base64 alignment & depth limit (`1i`, `1j`)**: On a skipped `1f 8b 09 00` base64 layer, all three byte offsets (`0`, `1`, `2`) still detect `PROBE_SECRET`; `MAX_DEPTH = 8` (`lines 44, 395-398`) still fails closed with `'nested deeper than 8 levels'` on depth 8 and 9.

### Focus (2) — `5f45b952` (Nightly network-timeout job)

- **Manifest & edge answers (`2.*`)**: Normal manifest (`2.valid`), alternate host swap (`2.otherHost` -> `http://127.0.0.1:8081/foo.bundle?x=1`), multipart (`2.multipartAnswer` -> `expo_manifest_not_json`), and HTML (`2.htmlAnswer` -> `expo_manifest_not_json`) behave as intended (`set -euo pipefail` aborts before `curl "$bundle"` or Maestro). Note `android-native-workflow.test.mjs`'s stub test exercises `{}` (`MANIFEST: '{}'`), not HTML/multipart directly (`expo-manifest-bundle-url.test.mjs` covers `'<html>'`).
- **`APP_URL` `disableOnboarding=1`**: Confirmed `node_modules/expo-dev-menu/android/src/debug/java/expo/modules/devmenu/DevMenuManager.kt:111-127` checks `launchUrl.contains("disableOnboarding=1")` (`DevLauncherController.kt:321` sets `devMenuManager.launchUrl = launchUrl`), and `maestro/subflows/open-link.yaml:31-35` passes `${APP_URL}` through `- openLink: ${LINK}` when `MAESTRO_EXPO_GO_OPEN_URL` is unset.
- **Policy & evidence leg**: `android-native-workflow.mjs` `NETWORK_LINES` (`lines 85-90`) rejects dropping either `curl "$bundle"` or `&disableOnboarding=1` (`3.policy_drop_disableOnboarding`, `3.policy_drop_bundle_warmup`). `uncoveredReads('network-timeout')` returns `[]`. Adding `scripts/lib/expo-manifest-bundle-url.mjs` to `LEGS['network-timeout'].entries` (`evidence-manifest.mjs:75`) is redundant with `importClosure` over `scripts/ci/android-network-timeout.sh` (see `M8` below).

---

## Mutation Testing (`3f6b31e1` in `/tmp/wt-615-mutant-r50`, removed and pruned)

- `M1_isGzipHeader_no_method_check` (`scripts/check-artifact-secrets.mjs`): **KILLED** (`artifact-secret-guard.spec.ts` — 1 failed)
- `M2_isGzipHeader_always_false` (`scripts/check-artifact-secrets.mjs`): **KILLED** (`artifact-secret-guard.spec.ts` — 4 failed)
- `M3_isGzipHeader_no_length10` (`scripts/check-artifact-secrets.mjs`): **SURVIVED** (no test passes a `< 10`-byte `1f 8b 08` header)
- `M4_isGzipHeader_no_reserved_bits` (`scripts/check-artifact-secrets.mjs`): **SURVIVED** (no test sets `buffer[3] & 0xe0`; note removing this gate restores fail-closed rejection of `0x20/0x40/0x80` smuggling via `Z_DATA_ERROR`)
- `M5_manifestBundleUrl_no_origin_swap` (`scripts/lib/expo-manifest-bundle-url.mjs`): **KILLED** (`moves the launch asset path and query onto the given origin`)
- `M6_manifestBundleUrl_no_empty_check` (`scripts/lib/expo-manifest-bundle-url.mjs`): **KILLED** (`refuses a manifest without a launch asset URL, or no JSON`)
- `M7_workflow_drop_disableOnboarding_policy` (`scripts/ci/android-native-workflow.mjs`): **KILLED** (`the committed workflow and script pass`)
- `M8_evidence_drop_bundle_url_entry` (`scripts/lib/evidence-manifest.mjs`): **SURVIVED** (equivalent mutant: `importClosure` already discovers `scripts/lib/expo-manifest-bundle-url.mjs` via `repoPathLiterals` in `scripts/ci/android-network-timeout.sh`)

---

## Codex Security Diff Scan Result

- Scan dir: `/private/tmp/codex-security-scans/couture-cast-wt-615/5f45b952_r50` (`report.md`, `scan-manifest.json`, `coverage.json`, `findings.json`, sealed via `finalize_scan_contract.py` exit `0`)
- Result: **1 reportable medium-severity finding** (`completeness: complete`):
  - **[1] Artifact secret scan skips gzip payloads carrying RFC 1952 reserved flag bits** (`scripts/check-artifact-secrets.mjs:69-76, 276-280`, CWE-693 / CWE-345, matches **P1-1** above). `manifestBundleUrl`'s `x:.evil.com/...` scheme quirk (`P2-1`) is recorded as defense-in-depth hardening since Metro at `127.0.0.1:8081` is spawned locally in the same CI shell.

REVIEW-615-R50-DONE
