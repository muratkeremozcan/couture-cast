# pr-gate

> Vendored 2026-07-29 from `seontechnologies/seon-gh-actions/pr-gate@d0bdf28`
> (the event-driven `watch` mode branch). That repo is private, so this copy is
> the source of truth here. Local edits beyond the `user-agent` and
> `external_id` strings: per-request timeout, integer-input fallback,
> duplicate-create guard on retried check-run POSTs. These should be ported back
> upstream, then this copy can return to byte-identity.

Passes only if every other check run on the commit passed. This is the single
required status check configured in the branch ruleset, so adding or renaming a
CI job never needs a matching branch-protection edit.

Two modes. `wait` holds a job open until the siblings finish.
`watch` recomputes the verdict on each CI completion event and publishes it as a check run,
costing seconds per event instead of a runner slot for the length of the slowest job.

`mode` is required. There is no default, because the two modes need different
permissions and different triggers.

## mode: wait

```yaml
jobs:
  gate:
    name: gate
    runs-on: ubuntu-latest
    timeout-minutes: 45
    permissions:
      contents: read
      checks: read
      actions: read
    if: "!startsWith(github.head_ref, 'hotfix/') && !startsWith(github.head_ref, 'emergency/')"
    steps:
      - uses: seontechnologies/seon-gh-actions/pr-gate@<sha>
        with:
          mode: wait
          skip-list: |
            [
              {
                "workflowFile": "claude-code-review.yaml",
                "jobName": "review",
                "jobMatchMode": "prefix"
              }
            ]
```

## mode: watch

Every other workflow that finishes triggers a run of this one. Each run checks the
whole commit and writes the result to a check run named `gate`: pending while jobs
are still going, pass or fail once they are all done. So the last workflow to
finish is the one that concludes the gate. Name the job something else, since the
check run is the gate.

It fires per workflow, not per job. Twenty jobs in one workflow is one event.

```yaml
name: PR Gate

on:
  pull_request:
    types: [opened, synchronize, reopened]
  workflow_run:
    types: [completed]
    workflows: ['**'] # every workflow; an omitted list disables the trigger

# Serializes per commit so two events cannot race the same check run.
# cancel-in-progress would drop a terminal verdict and leave the PR pending.
concurrency:
  group: pr-gate-${{ github.event.workflow_run.head_sha || github.event.pull_request.head.sha }}
  cancel-in-progress: false

jobs:
  watch:
    name: watch
    runs-on: ubuntu-latest
    timeout-minutes: 5
    # Do not re-trigger on your own completion. workflow_run fires for this
    # workflow too, and GitHub chains it three levels deep before stopping.
    if: github.event.workflow_run.path != '.github/workflows/pr-gate.yml'
    permissions:
      contents: read
      checks: write
      actions: read
    steps:
      - uses: seontechnologies/seon-gh-actions/pr-gate@<sha>
        with:
          mode: watch
          skip-list: |
            [
              {
                "workflowFile": "claude-code-review.yaml",
                "jobName": "review",
                "jobMatchMode": "prefix"
              }
            ]
```

### Watch mode requirements

- `workflows: ['**']`, because these values are globs and an omitted or empty list
  disables the trigger with no error.
- `concurrency` keyed on the head SHA with `cancel-in-progress: false`, because a
  cancelled run drops a terminal verdict.
- The `if:` guard excluding this workflow's own path, because `workflow_run` fires
  for this workflow too and GitHub chains it three levels deep.
- Only `gate` in the ruleset. Requiring the watch job as well does nothing: its
  runs on `workflow_run` events attach their check runs to the default branch tip,
  not to the PR head, so the PR never sees them.
- `checks: write`, because the verdict is a published check run.
- Merge to master last. `workflow_run` only fires for files already on the default
  branch, so nothing happens at all while this lives on a PR branch.

A workflow the trigger misses leaves the gate pending, which blocks the merge.

### What it saves

Wait mode holds a runner for as long as your slowest job. A 20 minute CI is 20
minutes of a held slot.

Watch mode runs once per workflow completion, 20 to 30 seconds each counting pod
startup. Six workflows is about 3 minutes.

So roughly 6x less runner time, and no long hold on the pool. It costs more queued
runs, `checks: write`, and no testing on a branch.

### Why a check run and not the exit code

A check run's name is a status context, so a ruleset requires it like a job. That
lets one workflow post a verdict on commits it did not build, and keeps the watch
job green while the gate is red.

Unfinished means `in_progress`, which blocks the merge.

The gate ignores the check run carrying its own `external_id`, or it reads its own
last verdict as a failing sibling forever. Ownership is the `external_id` and not
the name, so a real sibling job called `gate` is still watched, and the action
refuses to update a same-named check run it did not create.

Each event writes twice. A terminal verdict is moved back to `in_progress` before
the new one is computed, so a write that then fails leaves the gate unconcluded and
blocking, rather than leaving a stale green that merges.

### Known limits

- Commit statuses are invisible. The gate reads check runs, so a status-based
  integration is neither watched nor waited for. Require those separately.
- A write that fails before the gate has ever been published leaves no gate at all
  on the commit. A required check that does not exist blocks the merge, so this
  fails closed.

These two predate watch mode and apply to `wait` as well:

- A commit with no visible check runs passes. `warmup-delay` is the only guard.
- Once the gate concludes, rerunning a sibling does not re-evaluate it, so the last
  verdict stands until that sibling completes again. Watch mode recovers on the
  completion event; wait mode never does, because its job already exited.

## Why this is ours and not a third-party action

**A required gate must not go red because an API call blipped.** `api-retry-limit`
retries transient failures: 5xx, 429, secondary rate limits, network errors. A
job failure is never retried. Those are different things, and conflating them
either hides real failures or produces false reds on green PRs.

This is not theoretical. The previous setup wrapped `kachick/wait-other-jobs` in
`Wandalen/wretry.action` for exactly this reason. In `wait-other-jobs` v3.8.1,
`src/main.ts` awaits `fetchChecks` bare inside the polling loop with no
`try`/`catch` anywhere in the source, and `src/github-api.ts` builds Octokit with
only the pagination plugin, no `plugin-retry` and no `plugin-throttling`. A 5xx
becomes an unhandled rejection and the step exits non-zero. Its `attempt-limits`
bounds the poll count and then reports `reached to given attempt limits`, which is
a timeout and not an error retry.

**It runs no third-party JavaScript.** The retry wrapper reintroduced
supply-chain exposure: its SHA-pinned commit is a wrapper whose `action.yml`
delegates at runtime to `Wandalen/wretry.action@v3.8.0_js_action`, a mutable tag,
so the pin froze the wrapper and not the code that executed. On self-hosted
runners that is not academic.

**Zero dependencies.** No `node_modules` to audit, no bundle step, no install
step. It uses the runtime's global `fetch` against the GraphQL API.

## Inputs

Names and formats match `kachick/wait-other-jobs`, so migrating a caller is a
one-line change to `uses:`. Durations accept ISO 8601 (`PT15S`) or plain seconds
(`15`).

| Input                  | Default                        | Notes                                                                                                             |
| ---------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `mode`                 | required, no default           | `wait` or `watch`                                                                                                 |
| `check-name`           | `gate`                         | Watch mode only. The published check run's name, and the required status context                                  |
| `github-token`         | `${{ github.token }}`          | Read access to checks and actions; watch mode also needs `checks: write`                                          |
| `github-api-url`       | `${{ github.api_url }}`        | Override only for GHES                                                                                            |
| `ref`                  | PR head SHA, else `GITHUB_SHA` | Check runs attach to the head SHA, not the merge commit                                                           |
| `warmup-delay`         | `PT10S`                        | Lets siblings register their check runs first. In watch mode it applies on the `pull_request` seed event only     |
| `minimum-interval`     | `PT15S`                        | Wait between polls                                                                                                |
| `retry-method`         | `equal_intervals`              | Or `exponential_backoff`                                                                                          |
| `attempt-limits`       | `180`                          | Max polls. A timeout, not an error retry                                                                          |
| `api-retry-limit`      | `5`                            | Retries per failed API call. The reason this action exists                                                        |
| `api-retry-base-delay` | `PT2S`                         | Doubled per attempt, capped at 60s, 50-100% jitter                                                                |
| `skip-same-workflow`   | `true`                         | Ignore this workflow's own check runs                                                                             |
| `skip-list`            | `[]`                           | JSON array, see below                                                                                             |
| `early-exit`           | `true`                         | Fail on the first bad sibling instead of waiting for the rest                                                     |
| `dry-run`              | `false`                        | Report and always pass. In watch mode it also skips the check-run write. For verifying a rollout before enforcing |

Outputs: `polls`, `conclusion` (`success`, `failure`, `timed_out`, or `pending` in
watch mode when siblings are still running).

### skip-list

```json
[
  {
    "workflowFile": "claude-code-review.yaml",
    "jobName": "review",
    "jobMatchMode": "prefix"
  }
]
```

`jobMatchMode` is `exact` (default) or `prefix`; use `prefix` for matrix jobs,
whose check-run names carry a suffix. Omit `jobName` to skip a whole workflow
file. Omit `workflowFile` to skip a job name in any workflow. A malformed
`skip-list` fails loudly rather than silently skipping nothing, because the
quiet version leaves the gate waiting forever on a job it was told to ignore.

## Behaviour worth knowing

**`skip-same-workflow` matches the workflow file, not just the run id.** A re-run,
or a second trigger on the same commit, gives the same workflow a different run
id. Matching on run id alone left the gate waiting on an earlier instance of
itself and inheriting its result. `GITHUB_WORKFLOW_REF` supplies the file name,
with run id kept as a fallback.

**Check suites with no workflow run are ignored, and the ignore is logged.** These
come from non-Actions GitHub Apps, whose jobs the gate cannot reason about.
Silently dropping an external app's red X would be indistinguishable from
"nothing to wait for", so each drop emits a `::notice::`.

**An unrecognised conclusion is treated as a failure.** If GitHub adds a new
conclusion value, the gate fails closed rather than passing something it does not
understand.

**No siblings at all passes.** A repo with only the gate workflow is not stuck.
`warmup-delay` exists so this does not fire before siblings register.

## Tests

```bash
cd pr-gate
node --test tests/*.test.js
```

132 tests, no dependencies. The action runs on the `node24` runtime.

Leave the glob unquoted so the shell expands it. `node --test` only learned to
expand globs itself in Node 22, and a quoted pattern is passed through verbatim
and reported as not found on older runtimes.

`.github/workflows/test-pr-gate.yml` runs the tests, a dry-run of wait mode, and
watch mode for real against the live check runs of that very commit, publishing
`gate-smoke`. That last one is the only place the check-run write executes against
the actual API rather than a stub.

Watch mode's check-run writes are asserted against a stubbed `fetch`, including
that the update omits `head_sha` (the endpoint rejects it), that a 502 on the
write is retried so a verdict is not lost, and that a 422 surfaces instead of
being retried away.

The group that matters most is `graphql: API errors are retried, real errors are
not`. It stubs `fetch` and asserts that a 500 is retried, a 401 is not, a
secondary rate limit is, a `NOT_FOUND` GraphQL error is not, and that retries are
bounded. That distinction is the whole reason this action exists, so it is
asserted directly rather than inferred.
