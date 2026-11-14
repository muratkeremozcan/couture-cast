# Review 615 — Round 31 (`956fe627..99480151`)

Target: `/Users/murat/opensource/cc/couture-cast-wt-615` at commit `99480151` (range `956fe627..99480151`).
Verdict: **Range is clear above P3** (0 P0, 0 P1, 0 P2; 2 P3 findings below).

## Test Verification & Security Scan Summary

- `node --test scripts/lib/live-font-*.test.mjs scripts/lib/maestro-driver-sync.test.mjs` in `/Users/murat/opensource/cc/couture-cast-wt-615`: **157 tests / 23 suites passed, 0 failed, 0 skipped**.
- Codex Security preflight (`config_preflight.py --profile security_diff_scan`) returned `status: "ready"` (only `suggest` notice for `goal_tools_available=false`); security diff audit across the 14 changed files in `956fe627..99480151` found only P3-1 (`harnessDatabaseUrl` URL query/scheme validation).
- Cleanliness: mutant worktree `/tmp/wt-615-mutant-r31` removed and `git worktree prune`d; repository working tree is clean.

## Closure Verification (Mutants & Probes in Detached `/tmp/wt-615-mutant-r31`)

All 14 closure mutants were **KILLED** independently on clean `99480151`:

- `M1_stage_prefix` (`scripts/lib/live-font-scale-proof.mjs:stageKeys` drops `${stage}:` prefix): **KILLED** (`live-font-scale-proof.test.mjs`).
- `M2_growth_exact` (`scripts/lib/live-font-scale-proof.mjs:exactnessProblem` skips `multisetDifference(failingProbes, baseline.review.growthFailing)`): **KILLED** (`live-font-scale-proof.test.mjs`).
- `M3_baseline_selector` (`scripts/lib/live-font-journey.mjs:residualBaselineFor` always picks `sameLeg[0]`): **KILLED** (`live-font-journey.test.mjs`).
- `M4a_hour_mask_none` (`scripts/lib/live-font-scale-proof.mjs:entryKeys` never masks `HOUR_LABEL`): **KILLED** (`live-font-scale-proof.test.mjs`).
- `M4b_hour_mask_no_renumber` (`scripts/lib/live-font-scale-proof.mjs:entryKeys` fixes index `0` instead of per-`testID` screen order): **KILLED** (`live-font-scale-proof.test.mjs`).
- `M5a_weather_host` (`scripts/lib/live-font-weather.mjs:harnessDatabaseUrl` skips `['127.0.0.1', 'localhost']` check): **KILLED** (`live-font-weather.test.mjs`).
- `M5b_weather_db` (`scripts/lib/live-font-weather.mjs:harnessDatabaseUrl` skips `/^\/tea_community_[a-f0-9]{32}$/` check): **KILLED** (`live-font-weather.test.mjs`).
- `M5c_weather_rowcount` (`scripts/lib/live-font-weather.mjs:ageWeatherSnapshot` skips `if (!(snapshots > 0))` check): **KILLED** (`live-font-weather.test.mjs`).
- `M5d_weather_location_where` (`scripts/lib/live-font-weather.mjs:ageWeatherSnapshot` drops `WHERE "location_key" = $2`): **KILLED** (`live-font-weather.test.mjs`).
- `M6a_env_banner_field` (`scripts/lib/live-font-scale-proof.mjs:environmentProblem` skips `baseline.weatherBanner !== weatherBanner`): **KILLED** (`live-font-scale-proof.test.mjs`).
- `M6b_env_banner_captures` (`scripts/lib/live-font-scale-proof.mjs:environmentProblem` skips `before`/`settled` `weatherBannerState` check): **KILLED** (`live-font-scale-proof.test.mjs`).
- `M7a_guard_abort_on_first_throw` (`scripts/lib/live-font-run-guard.mjs:restore` rethrows first step error): **KILLED** (`live-font-run-guard.test.mjs`).
- `M7b_guard_run_twice` (`scripts/lib/live-font-run-guard.mjs:restore` omits `if (step.done) continue`): **KILLED** (`live-font-run-guard.test.mjs`).
- `M7c_guard_no_signals` (`scripts/lib/live-font-run-guard.mjs:installRestoreGuard` omits `SIGINT` handler): **KILLED** (`live-font-run-guard.test.mjs`).

Re-run of Round 30 Probes A–C against `99480151`:

- **Probe A** (move a stale key from `updated:` to `cold:` in baseline): **REJECTED** (`live_font_residual_unapproved: stale key outside baseline: updated:["","t-056fa5bb478d"]#0; baseline key no miss hit: cold:["","t-056fa5bb478d"]#0; 1 extra, 1 missing`).
- **Probe B** (`review.growthFailing: []` vs run failing `current-condition`): **REJECTED** (`live_font_residual_unapproved: growth failing differs from baseline; failing in run only: current-condition`).
- **Probe C** (`residualBaselineFor` given `(America/New_York, none)`, `(UTC, none)`, `(UTC, out-of-date)`): picks exact match `(UTC, out-of-date)` first, then falls back to `(UTC, none)` when exact match is absent.

## Findings

### P3-1: `harnessDatabaseUrl` allows `pg` `?host=` query-parameter host/socket override and non-Postgres schemes

- Location: `scripts/lib/live-font-weather.mjs:29-47`, `scripts/run-live-font-proof.mjs:610-617`
- Evidence:
  - `harnessDatabaseUrl(ownedEnv)` checks only `url.hostname` (`['127.0.0.1', 'localhost']`) and `url.pathname` (`/^\/tea_community_[a-f0-9]{32}$/`) and returns `url.toString()` unmodified to `pg.Client({ connectionString: url })` in `harnessQuery`.
  - Probe `P_r31_pg_query_param` verified that `postgresql://appuser:superSecretPass99@127.0.0.1:5432/tea_community_0123456789abcdef0123456789abcdef?host=evil.attacker.com`, `?host=/var/run/postgresql`, and `http://127.0.0.1:5432/tea_community_0123456789abcdef0123456789abcdef` all pass `harnessDatabaseUrl`, and `new pg.Client({ connectionString })` resolves `client.host` to `'evil.attacker.com'` and `'/var/run/postgresql'` respectively.
- Concrete failure scenario: If a harness/test `DATABASE_URL` carries a `pg-connection-string` query parameter such as `?host=<remote-or-unix-socket>`, `harnessDatabaseUrl` reports the URL as local loopback while `pg.Client` connects outside `127.0.0.1`/`localhost` (and transmits DB credentials/SQL there). Rejecting non-`postgres:`/`postgresql:` schemes and non-empty `url.search` (or query overrides like `host`) closes this gap.
- Note on error leakage: `harnessDatabaseUrl` never includes the URL in its thrown messages; `ageWeatherSnapshot` (`scripts/lib/live-font-weather.mjs:70-72`) wraps `error?.message ?? String(error)`. Probing `pg.Client.connect` failures (`ECONNREFUSED`, missing SSL CA file, nonexistent socket, `localhost:1` `AggregateError`) did not leak password or DB name, though `localhost:1` produced an empty `error.message` (`live_font_weather_aging_failed:`).

### P3-2: `environmentProblem` does not verify banner state on `cold` capture, letting a post-settle banner disappearance pass silently

- Location: `scripts/lib/live-font-scale-proof.mjs:747-762`, `scripts/lib/live-font-scale-proof.mjs:175-203`
- Evidence:
  - `environmentProblem` (`L754-760`) checks `weatherBannerState(captures[stage], captures.bannerMarker) !== baseline.weatherBanner` only for `stage` in `['before', 'settled']`, omitting `'cold'`. (Leaving out `'updated'` is intentional per `scripts/lib/live-font-scale-proof.test.mjs:893` because pressing Show All Bands clears the banner on Community.)
  - Meanwhile, `parity()` (`L175-203`) iterates over `liveNodes` (`settled`) and skips any node whose key is absent from `coldNodes` (`if (!counterpart) continue`).
  - Probe `P_r31_banner_cold_flip` confirmed that when `before` and `settled` show `'out-of-date'` (`community-band-unresolved` + `WEATHER_STALE_TEXT`) and `cold` has `'none'` (no banner or stale text), `assertLiveFontProof` returns `verdict: 'known-residual'` cleanly without flagging either `live_font_residual_environment_differs` or `coldParity`. (By contrast, when `before` has the banner and `settled` flips to `'none'`, `P_r31_SETTLED_FLIP_REJECTED` fails via `fullText` and `environmentProblem`.)
- Concrete failure scenario: If the snapshot ceases to be stale (or fails to render the unresolved-band banner) after `settled` and before the `cold` capture on Community, the proof passes with `cold` comparing a non-banner hierarchy against `settled`'s banner hierarchy. Checking `'cold'` in `environmentProblem` alongside `['before', 'settled']` prevents this.

## Explicit Judgments Requested

1. **Can the hour mask hide a real regression (a label that changed text but kept position, or non-hour text matching `HOUR_LABEL`)?**
   - _Label changing text while keeping position_:
     - **Within one run (`before` vs `settled`, or `updated` vs `coldUpdated`)**: **No**, `multiset()` / `fullText` compares unmasked text from `appNodes`, so a change between `before` and `settled` still fails `fullText`.
     - **Across runs**: If a miss shifts to non-hour text (failing `HOUR_LABEL`), or an hour label becomes un-stale / adds a new stale hour / changes `testID` screen order, `staleKeys` catches it. The only case intentionally masked (confirmed by `P_r31_HOUR_SAME_PATTERN_CHANGED_TEXT`) is when an `HOUR_LABEL` miss stays stale and changes to another valid `HOUR_LABEL` across every capture of the new run (`1\u202fAM` -> `9\u202fPM`); position/index (`#0..#4`) and count per `testID` still match, and per TEA's ruling this is the required tradeoff for clock-dependent hourly ribbon headers.
   - _Non-hour text matching `HOUR_LABEL`_:
     - `HOUR_LABEL = /^(?:[1-9]|1[0-2])\u202f(?:AM|PM)$/` requires `1`–`12` with no leading zero, no minutes, Unicode `U+202F` (`NARROW NO-BREAK SPACE`), and uppercase `AM|PM`. Normal copy or ASCII/NBSP spaces (`U+0020`, `U+00A0`) will not match. Only another bare `Intl` hour formatted with `U+202F` under the same `testID` (`''`) would collide with the ribbon indices.

2. **Can weather aging write to a database that is not the harness one, or leak its URL in an error?**
   - Under `scripts/run-story68-native.mjs`, `owned-env.json` uses a loopback host and `tea_community_<32 hex>` DB; `harnessDatabaseUrl` checks both (`127.0.0.1`/`localhost`, `/tea_community_[a-f0-9]{32}`), and `ageWeatherSnapshot` runs one parameterized `UPDATE "WeatherSnapshot" SET "fetched_at" = $1 WHERE "location_key" = $2` expecting `rowCount > 0`. Neither `harnessDatabaseUrl` nor `pg.Client` connect/socket/missing-cert errors echoed the URL or credentials. See **P3-1** above for the remaining `?host=...` query-param and scheme validation gap in `harnessDatabaseUrl`.

3. **Does the API refetch a stale snapshot during a run and flip the banner mid-run (and is that then caught)?**
   - In the Story 6.8 `serve` harness (`scripts/run-story68-native.mjs:1122-1135`), only `weatherProviderDouble` and the Nest API (`scripts/lib/story68-api-entry.mjs` -> `apps/api/src/main.ts`) are started — **not** the BullMQ worker (`apps/api/src/workers/bootstrap.ts`, which hosts `registerWeatherRefreshScheduler` and `weather-ingestion`). `WeatherQueryService.getLatestWeather` (`apps/api/src/modules/weather/weather-query.service.ts:65-115`), `WeatherController.getLatestWeather` (`apps/api/src/modules/weather/weather.controller.ts:142-164`), and `CommunityService` (`apps/api/src/modules/community/community.service.ts:550-560`) read snapshots passively and return `{ status: 'stale' }` without triggering ingestion on read. Thus, under standard harness `serve`, the API will not refetch mid-run.
   - If a background worker were running concurrently and flipped the banner mid-run: a flip between `before` and `settled` **is caught** by both `fullText` and `environmentProblem`, whereas a flip after `settled` and before `cold` is **not caught** (see **P3-2**).

4. **Does a signal leave the report unwritten in a way that matters?**
   - **No (non-blocking).** On `SIGINT`/`SIGTERM`, `installRestoreGuard` (`scripts/lib/live-font-run-guard.mjs:35-42`) synchronously executes all registered device-restore steps once (in isolated `try/catch`), writes any `live_font_restore_failed` errors to stderr, and exits immediately with `130`/`143` without invoking `writeReport` (`scripts/run-live-font-proof.mjs:793-816`). Because the process exits non-zero, CI/automation rejects the interrupted run regardless, and omitting `live-font-report.json` / `live-font-residual-baselines.proposed.json` on abort avoids leaving a partial baseline proposal behind.

REVIEW-615-R31-DONE
