'use strict';

/**
 * PR Gate: wait for every other check run on the commit, then pass only if they
 * all passed.
 *
 * The load-bearing distinction in here is between a failed API call and a failed
 * job. The first is retried, because a required gate must not go red on a PR
 * whose jobs all passed. The second is never retried, because retrying it either
 * masks a real failure or just triples the time to report it.
 *
 * Zero dependencies on purpose: no node_modules to audit, no bundle step, and no
 * third-party JavaScript in the path of the one check that blocks merges.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ─── workflow command helpers (replaces @actions/core, which would need deps) ──

/**
 * Mirrors @actions/core's lookup rule: uppercase the name, spaces to
 * underscores, dashes preserved. So `github-token` reads INPUT_GITHUB-TOKEN.
 */
function getInput(name, env = process.env) {
  const raw = env[`INPUT_${name.replace(/ /g, '_').toUpperCase()}`];
  return raw == null ? '' : String(raw).trim();
}

function getBooleanInput(name, env = process.env) {
  const raw = getInput(name, env).toLowerCase();
  if (raw === '') return false;
  if (['true', '1', 'yes'].includes(raw)) return true;
  if (['false', '0', 'no'].includes(raw)) return false;
  throw new Error(`input ${name} must be a boolean, got "${raw}"`);
}

function setOutput(name, value) {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) return;
  try {
    // Delimiter form, matching @actions/core. The `name=value` form lets a newline
    // in a value inject further output parameters. Today's values are a number and
    // one of three literals, so this is hardening rather than a live hole.
    const delimiter = `ghadelimiter_${crypto.randomUUID()}`;
    fs.appendFileSync(file, `${name}<<${delimiter}\n${value}\n${delimiter}\n`);
  } catch {
    /* a lost output must not fail the gate */
  }
}

const log = (msg) => process.stdout.write(`${msg}\n`);
const warn = (msg) => log(`::warning::${msg}`);
const notice = (msg) => log(`::notice::${msg}`);

// ─── pure logic, exported for tests ───────────────────────────────────────────

/** Accepts ISO 8601 (`PT1M30S`) or plain seconds (`90`). */
function parseDurationSeconds(raw, fallbackSeconds) {
  const s = String(raw == null ? '' : raw).trim();
  if (s === '') return fallbackSeconds;
  if (/^\d+(?:\.\d+)?$/.test(s)) return Number(s);
  const m = /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i
    .exec(s);
  if (!m || (m[1] === undefined && m[2] === undefined && m[3] === undefined && m[4] === undefined)) {
    throw new Error(`invalid duration "${raw}", use ISO 8601 like PT15S or plain seconds like 15`);
  }
  const total = Number(m[1] || 0) * 86400 + Number(m[2] || 0) * 3600 +
    Number(m[3] || 0) * 60 + Number(m[4] || 0);
  if (!Number.isFinite(total) || total < 0) throw new Error(`invalid duration "${raw}"`);
  return total;
}

/**
 * Required rather than defaulted. The two modes need different `permissions` and
 * different triggers, so a caller that never said which one it wanted is
 * misconfigured, and defaulting would hide that behind a gate that quietly does
 * the wrong thing.
 */
function parseMode(raw) {
  const mode = String(raw == null ? '' : raw).trim();
  if (mode === '') {
    throw new Error("mode is required: set it to 'wait' or 'watch'");
  }
  if (!['wait', 'watch'].includes(mode)) {
    throw new Error(`mode must be wait or watch, got "${mode}"`);
  }
  return mode;
}

const OK_CONCLUSIONS = new Set(['success', 'skipped', 'neutral']);

/** 'pending' | 'ok' | 'bad'. Anything completed and not explicitly OK is bad. */
function classify(entry) {
  if (String(entry.status || '').toUpperCase() !== 'COMPLETED') return 'pending';
  return OK_CONCLUSIONS.has(String(entry.conclusion || '').toLowerCase()) ? 'ok' : 'bad';
}

function parseSkipList(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (s === '') return [];
  let parsed;
  try {
    parsed = JSON.parse(s);
  } catch (e) {
    throw new Error(`skip-list is not valid JSON: ${e.message}`);
  }
  if (!Array.isArray(parsed)) throw new Error('skip-list must be a JSON array');
  for (const rule of parsed) {
    if (rule === null || typeof rule !== 'object' || Array.isArray(rule)) {
      throw new Error('each skip-list entry must be an object');
    }
    if (!rule.workflowFile && !rule.jobName) {
      throw new Error('each skip-list entry needs workflowFile, jobName, or both');
    }
    if (rule.jobMatchMode && !['exact', 'prefix'].includes(rule.jobMatchMode)) {
      throw new Error(`jobMatchMode must be "exact" or "prefix", got "${rule.jobMatchMode}"`);
    }
  }
  return parsed;
}

/**
 * The workflow file this job belongs to, from GITHUB_WORKFLOW_REF, which looks
 * like `owner/repo/.github/workflows/pr-gate.yml@refs/heads/branch`.
 */
function currentWorkflowFile(env = process.env) {
  const ref = String(env.GITHUB_WORKFLOW_REF || '');
  const withoutGitRef = ref.split('@')[0];
  return withoutGitRef ? path.basename(withoutGitRef) : '';
}

function shouldSkip(entry, { currentRunId, currentWorkflowFile: ownFile, skipSameWorkflow, skipList, ownExternalId }) {
  // Watch mode publishes its verdict as a check run on the same commit it is
  // inspecting. Without this the gate reads its own previous verdict as a
  // sibling and, once that verdict is a failure, can never recover to success.
  //
  // Matched on external_id, which this action sets and owns, rather than on the
  // check run's name. Name matching would also silence a legitimate sibling job
  // that happens to be called `gate`.
  if (ownExternalId && String(entry.externalId || '') === ownExternalId) return true;
  if (skipSameWorkflow) {
    // Match on the workflow file, not just the run id. A re-run, or a second
    // trigger on the same commit, produces a different run id for the same
    // workflow, and the gate would then sit waiting on an earlier instance of
    // itself and inherit its result. Run id is kept as a fallback for
    // environments that do not set GITHUB_WORKFLOW_REF.
    if (ownFile && path.basename(entry.workflowPath || '') === ownFile) return true;
    if (currentRunId && String(entry.workflowRunId) === String(currentRunId)) return true;
  }
  for (const rule of skipList) {
    if (rule.workflowFile && path.basename(entry.workflowPath || '') !== rule.workflowFile) continue;
    if (rule.jobName) {
      const prefix = rule.jobMatchMode === 'prefix';
      const name = String(entry.name || '');
      if (prefix ? !name.startsWith(rule.jobName) : name !== rule.jobName) continue;
    }
    return true;
  }
  return false;
}

/**
 * skip-list rules that matched nothing.
 *
 * The failure mode this catches is quiet and expensive: a rule naming
 * `claude-code-review.yml` when the repo's file is `claude-code-review.yaml`
 * matches nothing, so the gate waits on, and can fail because of, a job it was
 * explicitly told to ignore. Both spellings are legitimate in different repos, so
 * the fix is to report a rule that matches nothing rather than to standardise the
 * filename.
 */
function unmatchedSkipRules(entries, skipList) {
  return skipList.filter(
    (rule) => !entries.some((entry) =>
      shouldSkip(entry, { skipSameWorkflow: false, skipList: [rule] })
    )
  );
}

/**
 * `done` means stop polling. `ok` is only meaningful once done.
 * With earlyExit, one bad sibling ends it immediately; otherwise the gate waits
 * for the full picture before reporting.
 */
function evaluate(entries, { earlyExit }) {
  const pending = [];
  const bad = [];
  for (const entry of entries) {
    const kind = classify(entry);
    if (kind === 'pending') pending.push(entry);
    else if (kind === 'bad') bad.push(entry);
  }
  const allDone = pending.length === 0;
  if (bad.length > 0 && (earlyExit || allDone)) return { done: true, ok: false, pending, bad };
  if (allDone) return { done: true, ok: true, pending, bad };
  return { done: false, ok: bad.length === 0, pending, bad };
}

function formatEntry(entry) {
  const state = classify(entry) === 'pending'
    ? String(entry.status || '').toLowerCase()
    : String(entry.conclusion || '').toLowerCase();
  return `${entry.workflowName || '(unknown workflow)'} / ${entry.name}: ${state}`;
}

/**
 * Renders untrusted text as a code span. Job and workflow names come from
 * workflow files, which a PR can edit, and this text lands in a markdown check
 * run summary. Backticks are stripped rather than escaped because there is no
 * escape for them inside a span, and a name containing one is not worth
 * reproducing exactly.
 */
function codeSpan(text) {
  return `\`${String(text == null ? '' : text).replace(/`/g, '')}\``;
}

// The Checks API rejects an output.summary over 65535 characters, and a monorepo
// with a big matrix can produce a lot of entries. A rejected write loses the
// verdict entirely, so the list is bounded well short of the limit.
const MAX_LISTED_ENTRIES = 30;

function entryList(heading, entries) {
  const shown = entries.slice(0, MAX_LISTED_ENTRIES);
  const lines = shown.map((entry) => `- ${codeSpan(formatEntry(entry))}`);
  if (entries.length > shown.length) {
    lines.push(`- and ${entries.length - shown.length} more`);
  }
  return [heading, ...lines].join('\n');
}

/**
 * The check run body for a verdict, for watch mode.
 *
 * A `done` verdict becomes a terminal conclusion. Anything else stays
 * `in_progress`, which reads as pending to the branch ruleset and so keeps
 * blocking the merge. That is the fail-closed direction: a gate that never hears
 * about the last sibling leaves the PR unmergeable rather than mergeable.
 */
function verdictCheckRun(result, { name, totalWatched }) {
  if (!result.done) {
    return {
      name,
      status: 'in_progress',
      title: `Waiting on ${result.pending.length} of ${totalWatched} job(s)`,
      summary: entryList('Still running:', result.pending),
    };
  }
  if (result.ok) {
    return {
      name,
      status: 'completed',
      conclusion: 'success',
      title: `All ${totalWatched} watched job(s) passed`,
      summary: totalWatched === 0
        ? 'No other check runs on this commit, so there was nothing to gate.'
        : 'Every watched check run on this commit finished and passed.',
    };
  }
  return {
    name,
    status: 'completed',
    conclusion: 'failure',
    title: `${result.bad.length} job(s) did not pass`,
    summary: entryList('Failed:', result.bad),
  };
}

// Bounds a single request. Without it a stalled connection parks until the job
// timeout kills it, with no retry; the abort surfaces as a network error and is
// retried like any other transient failure.
const REQUEST_TIMEOUT_MS = 30_000;

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const RETRYABLE_GRAPHQL_TYPES = new Set([
  'RATE_LIMITED',
  'INTERNAL_SERVER_ERROR',
  'SERVICE_UNAVAILABLE',
  'TIMEOUT',
]);

function isRetryableStatus(status, headers) {
  if (RETRYABLE_STATUS.has(status)) return true;
  // A 403 is normally a permissions problem, except when it carries the
  // secondary-rate-limit signals, which are transient.
  if (status === 403 && headers && typeof headers.get === 'function') {
    if (headers.get('retry-after')) return true;
    if (headers.get('x-ratelimit-remaining') === '0') return true;
  }
  return false;
}

/**
 * Retry only when every error is transient. A mix of RATE_LIMITED and NOT_FOUND
 * will never succeed on retry, so it is surfaced instead of looped over.
 *
 * An error with no `type` is not retried. GraphQL validation errors (a bad field,
 * a malformed query) arrive as `{message}` with no type, and retrying those would
 * burn the retry budget on every poll and then report a confusing timeout instead
 * of the actual query problem.
 */
function isRetryableGraphQLErrors(errors) {
  if (!Array.isArray(errors) || errors.length === 0) return false;
  return errors.every((e) => {
    const type = e && e.type;
    return type ? RETRYABLE_GRAPHQL_TYPES.has(String(type).toUpperCase()) : false;
  });
}

/** Exponential with 50-100% jitter, capped, so retries do not synchronise. */
function backoffMs(attempt, baseMs, rand = Math.random) {
  const capped = Math.min(baseMs * Math.pow(2, Math.max(0, attempt - 1)), 60_000);
  return Math.round(capped * (0.5 + rand() * 0.5));
}

function retryAfterMs(headers) {
  if (!headers || typeof headers.get !== 'function') return null;
  const retryAfter = headers.get('retry-after');
  if (retryAfter && /^\d+$/.test(retryAfter)) return Number(retryAfter) * 1000;
  const reset = headers.get('x-ratelimit-reset');
  if (reset && /^\d+$/.test(reset)) {
    const ms = Number(reset) * 1000 - Date.now();
    if (ms > 0) return Math.min(ms, 60_000);
  }
  return null;
}

function pollIntervalMs(method, minimumMs, attempt) {
  if (method === 'exponential_backoff') {
    return Math.min(minimumMs * Math.pow(2, Math.max(0, attempt - 2)), 300_000);
  }
  return minimumMs;
}

/** Flattens the GraphQL shape and reports any check suite it had to drop. */
function flattenCheckSuites(suites, onDropped = () => {}) {
  const entries = [];
  for (const suite of suites || []) {
    if (!suite) continue;
    // Check suites from non-Actions GitHub Apps have no workflowRun. The gate
    // cannot reason about their jobs, and reporting the drop beats silently
    // treating an external app's red X as "nothing to wait for".
    if (!suite.workflowRun) {
      const names = (suite.checkRuns?.nodes || []).filter(Boolean).map((r) => r.name);
      if (names.length > 0) onDropped(names);
      continue;
    }
    for (const run of suite.checkRuns?.nodes || []) {
      if (!run) continue;
      entries.push({
        name: run.name,
        status: run.status,
        conclusion: run.conclusion,
        url: run.detailsUrl,
        externalId: run.externalId || '',
        workflowName: suite.workflowRun.workflow?.name || '',
        workflowPath: suite.workflowRun.workflow?.resourcePath || '',
        workflowRunId: suite.workflowRun.databaseId,
      });
    }
  }
  return entries;
}

// ─── IO ───────────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const SUITES_QUERY = /* GraphQL */ `
  query Gate($owner: String!, $repo: String!, $sha: String!, $cursor: String) {
    repository(owner: $owner, name: $repo) {
      object(expression: $sha) {
        ... on Commit {
          checkSuites(first: 100, after: $cursor) {
            pageInfo { hasNextPage endCursor }
            nodes {
              id
              workflowRun {
                databaseId
                workflow { name resourcePath }
              }
              checkRuns(first: 100) {
                totalCount
                pageInfo { hasNextPage endCursor }
                nodes { name status conclusion detailsUrl externalId }
              }
            }
          }
        }
      }
    }
  }
`;

const SUITE_RUNS_QUERY = /* GraphQL */ `
  query GateSuiteRuns($id: ID!, $cursor: String) {
    node(id: $id) {
      ... on CheckSuite {
        checkRuns(first: 100, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          nodes { name status conclusion detailsUrl externalId }
        }
      }
    }
  }
`;

/**
 * One HTTP call to the GitHub API, with retries for transient failures only. A
 * non-retryable response throws, because a 401 or a 404 will not fix itself.
 *
 * `retryBody` lets a caller retry on a 200 whose body carries a transient error,
 * which is how GraphQL reports rate limiting. It shares this attempt counter on
 * purpose, so `api-retry-limit` bounds the total call count rather than being
 * spent twice over.
 *
 * `retryGuard` is for non-idempotent requests. It runs before each retry, and a
 * non-null return settles the call without sending the request again. A create
 * whose response was lost may have landed server-side, and blind retries would
 * then duplicate it; the guard re-checks instead.
 */
async function requestWithRetry({
  apiUrl,
  token,
  method = 'POST',
  path = '/graphql',
  body,
  retryLimit,
  baseDelayMs,
  retryBody,
  retryGuard,
}) {
  const endpoint = `${String(apiUrl || 'https://api.github.com').replace(/\/+$/, '')}${path}`;

  // A failed guard must not eat the retry budget, so its errors read as "keep retrying".
  const settledByGuard = async () => {
    if (!retryGuard) return null;
    try {
      return (await retryGuard()) ?? null;
    } catch {
      return null;
    }
  };

  for (let attempt = 1; ; attempt += 1) {
    let res;
    try {
      res = await fetch(endpoint, {
        method,
        headers: {
          authorization: `bearer ${token}`,
          'content-type': 'application/json',
          accept: 'application/vnd.github+json',
          'user-agent': 'couture-cast/pr-gate',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      if (attempt > retryLimit) {
        throw new Error(`network error contacting the GitHub API: ${err.message}`);
      }
      const settled = await settledByGuard();
      if (settled != null) return settled;
      const waitMs = backoffMs(attempt, baseDelayMs);
      warn(`Network error contacting the GitHub API (${err.message}), retrying in ${Math.round(waitMs / 1000)}s (${attempt}/${retryLimit})`);
      await sleep(waitMs);
      continue;
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      if (isRetryableStatus(res.status, res.headers) && attempt <= retryLimit) {
        const settled = await settledByGuard();
        if (settled != null) return settled;
        const waitMs = retryAfterMs(res.headers) ?? backoffMs(attempt, baseDelayMs);
        warn(`GitHub API returned ${res.status}, retrying in ${Math.round(waitMs / 1000)}s (${attempt}/${retryLimit})`);
        await sleep(waitMs);
        continue;
      }
      throw new Error(`GitHub API returned ${res.status}: ${text.slice(0, 300)}`);
    }

    const json = await res.json().catch(() => null);
    if (!json) {
      if (attempt <= retryLimit) {
        const settled = await settledByGuard();
        if (settled != null) return settled;
        const waitMs = backoffMs(attempt, baseDelayMs);
        warn(`GitHub API returned an unparseable body, retrying in ${Math.round(waitMs / 1000)}s (${attempt}/${retryLimit})`);
        await sleep(waitMs);
        continue;
      }
      throw new Error('GitHub API returned an unparseable body');
    }

    const transient = retryBody ? retryBody(json) : null;
    if (transient) {
      if (attempt <= retryLimit) {
        const waitMs = backoffMs(attempt, baseDelayMs);
        warn(`${transient}, retrying in ${Math.round(waitMs / 1000)}s (${attempt}/${retryLimit})`);
        await sleep(waitMs);
        continue;
      }
      // Returning the body here would hand the caller a response known to be
      // broken and let it decide, silently, whether that matters. graphql()
      // happens to re-check and throw, so nothing is wrong today, but a gate is
      // the wrong place to leave that depending on a second look.
      throw new Error(`${transient} persisted after ${retryLimit} retries`);
    }

    return json;
  }
}

async function graphql({ apiUrl, token, query, variables, retryLimit, baseDelayMs }) {
  const json = await requestWithRetry({
    apiUrl,
    token,
    path: '/graphql',
    body: { query, variables },
    retryLimit,
    baseDelayMs,
    retryBody: (parsed) =>
      isRetryableGraphQLErrors(parsed.errors) ? 'GraphQL transient error' : null,
  });

  if (json.errors) {
    throw new Error(`GraphQL error: ${JSON.stringify(json.errors).slice(0, 300)}`);
  }
  return json.data;
}

/** REST counterpart, same retry rules. Used only by watch mode's check-run writes. */
function rest({ apiUrl, token, retryLimit, baseDelayMs }, method, path, body, retryGuard) {
  return requestWithRetry({ apiUrl, token, method, path, body, retryLimit, baseDelayMs, retryGuard });
}

async function fetchChecks(ctx) {
  const suites = [];
  let cursor = null;
  for (;;) {
    const data = await graphql({ ...ctx, query: SUITES_QUERY, variables: { owner: ctx.owner, repo: ctx.repo, sha: ctx.sha, cursor } });
    const commit = data?.repository?.object;
    if (!commit) throw new Error(`commit ${ctx.sha} not found in ${ctx.owner}/${ctx.repo}`);
    const page = commit.checkSuites;
    suites.push(...(page?.nodes || []).filter(Boolean));
    if (!page?.pageInfo?.hasNextPage) break;
    cursor = page.pageInfo.endCursor;
  }

  // A workflow with more than 100 jobs needs its check runs paged separately.
  for (const suite of suites) {
    let runPage = suite.checkRuns;
    while (runPage?.pageInfo?.hasNextPage) {
      const data = await graphql({ ...ctx, query: SUITE_RUNS_QUERY, variables: { id: suite.id, cursor: runPage.pageInfo.endCursor } });
      const next = data?.node?.checkRuns;
      if (!next) break;
      suite.checkRuns.nodes.push(...(next.nodes || []).filter(Boolean));
      runPage = next;
    }
  }

  return suites;
}

function readEventPayload(env = process.env) {
  const eventPath = env.GITHUB_EVENT_PATH;
  if (!eventPath || !fs.existsSync(eventPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(eventPath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * On pull_request the head SHA carries the check runs; GITHUB_SHA is the merge
 * commit. On workflow_run it is worse: GITHUB_SHA is the tip of the default
 * branch and GITHUB_REF is the default branch, neither of which has anything to
 * do with the PR being gated, so the head SHA must come from the payload.
 */
function resolveSha(env = process.env) {
  const explicit = getInput('ref', env);
  if (explicit) return explicit;
  const payload = readEventPayload(env);
  const head = payload?.pull_request?.head?.sha || payload?.workflow_run?.head_sha;
  if (head) return head;
  return env.GITHUB_SHA || '';
}

/** Stamped on every check run this action creates, so it can recognise its own. */
function externalIdFor(checkName) {
  return `couture-cast/pr-gate:${checkName}`;
}

/**
 * Finds the check run this action owns on the commit, or null on the first event.
 *
 * Ownership is decided by external_id, not by the name. Patching a same-named
 * check run this action did not create would hijack someone else's check, and two
 * writers on one name means the context flips to whoever wrote last, so a foreign
 * owner is an error rather than something to write through.
 */
async function findOwnedCheckRun(ctx, name) {
  const externalId = externalIdFor(name);
  const found = await rest(
    ctx,
    'GET',
    `/repos/${ctx.owner}/${ctx.repo}/commits/${encodeURIComponent(ctx.sha)}/check-runs` +
      `?check_name=${encodeURIComponent(name)}&filter=latest&per_page=100`
  );
  const sameName = (found?.check_runs || []).filter(Boolean);
  const owned = sameName.find((run) => run.external_id === externalId);
  if (owned) return owned;

  if (sameName.length > 0) {
    const owners = [...new Set(sameName.map((run) => run.app?.slug || 'unknown'))].join(', ');
    throw new Error(
      `a check run named "${name}" on ${ctx.sha} was created by something else (${owners}). ` +
        'Pick a different check-name; two writers on one name make the required status context flip between them.'
    );
  }
  return null;
}

/**
 * The body that invalidates a terminal verdict before it is recomputed.
 *
 * Without this step a write failure is fail-open: the previous verdict stays
 * published, so a gate that went green before a later failure merges. Moving it
 * back to in_progress first means any failure from here on leaves the gate
 * unconcluded, which blocks.
 */
function invalidationCheckRun(name) {
  return {
    name,
    status: 'in_progress',
    title: 'Recomputing',
    summary:
      'A CI workflow finished, so the previous verdict no longer describes this commit. ' +
      'The gate stays unconcluded until the new verdict is published, so a failure to ' +
      'publish blocks the merge instead of leaving a stale result in place.',
  };
}

/**
 * Writes the verdict as a check run on the inspected commit, creating it when
 * `existing` is null and updating it otherwise.
 *
 * The name is what the branch ruleset requires, so it must stay stable across
 * updates. GitHub keeps only the most recently updated check run of a given name
 * as the status context, which is what makes the update path safe.
 */
async function writeCheckRun(ctx, verdict, existing) {
  const base = `/repos/${ctx.owner}/${ctx.repo}`;
  const body = {
    status: verdict.status,
    output: { title: verdict.title, summary: verdict.summary },
  };
  if (verdict.status === 'completed') {
    body.conclusion = verdict.conclusion;
    body.completed_at = new Date().toISOString();
  }

  if (existing) {
    // head_sha is not an accepted field on the update endpoint, and sending it
    // is a 422. The SHA is already fixed by the check run being updated.
    await rest(ctx, 'PATCH', `${base}/check-runs/${existing.id}`, body);
    return { created: false, id: existing.id };
  }

  const created = await rest(
    ctx,
    'POST',
    `${base}/check-runs`,
    {
      ...body,
      name: verdict.name,
      head_sha: ctx.sha,
      external_id: externalIdFor(verdict.name),
      started_at: new Date().toISOString(),
    },
    async () => findOwnedCheckRun(ctx, verdict.name)
  );
  return { created: true, id: created?.id };
}

/** Kept as the simple composition, for callers that write once. */
async function upsertCheckRun(ctx, verdict) {
  return writeCheckRun(ctx, verdict, await findOwnedCheckRun(ctx, verdict.name));
}

/**
 * Missing or non-numeric input falls back instead of producing NaN, which
 * comparisons silently swallow: `attempt > NaN` is always false, so a NaN
 * retryLimit would retry forever and a NaN attemptLimits would never poll.
 */
function parseIntOr(raw, fallback) {
  const s = String(raw == null ? '' : raw).trim();
  if (s === '') return fallback;
  const n = Number(s);
  return Number.isFinite(n) ? n : fallback;
}

/** Everything both modes need, read once from inputs and the environment. */
function buildOptions() {
  const token = getInput('github-token');
  if (!token) throw new Error('github-token is required');

  const [owner, repo] = String(process.env.GITHUB_REPOSITORY || '').split('/');
  if (!owner || !repo) throw new Error('GITHUB_REPOSITORY is not set');

  const sha = resolveSha();
  if (!sha) throw new Error('could not determine the commit SHA to inspect');

  const mode = parseMode(getInput('mode'));

  const retryMethod = getInput('retry-method') || 'equal_intervals';
  if (!['equal_intervals', 'exponential_backoff'].includes(retryMethod)) {
    throw new Error(`retry-method must be equal_intervals or exponential_backoff, got "${retryMethod}"`);
  }

  const checkName = getInput('check-name') || 'gate';

  const ctx = {
    apiUrl: getInput('github-api-url') || 'https://api.github.com',
    token,
    owner,
    repo,
    sha,
    retryLimit: Math.max(0, Math.trunc(parseIntOr(getInput('api-retry-limit'), 5))),
    baseDelayMs: parseDurationSeconds(getInput('api-retry-base-delay'), 2) * 1000,
  };

  return {
    ctx,
    mode,
    checkName,
    retryMethod,
    warmupMs: parseDurationSeconds(getInput('warmup-delay'), 10) * 1000,
    minimumMs: parseDurationSeconds(getInput('minimum-interval'), 15) * 1000,
    attemptLimits: Math.max(1, Math.trunc(parseIntOr(getInput('attempt-limits'), 180))),
    earlyExit: getBooleanInput('early-exit'),
    dryRun: getBooleanInput('dry-run'),
    skipOpts: {
      currentRunId: process.env.GITHUB_RUN_ID,
      currentWorkflowFile: currentWorkflowFile(),
      skipSameWorkflow: getBooleanInput('skip-same-workflow'),
      skipList: parseSkipList(getInput('skip-list')),
      // Only watch mode publishes a check run of its own to collide with.
      ownExternalId: mode === 'watch' ? externalIdFor(checkName) : '',
    },
  };
}

/** Reports each non-Actions check suite it had to drop, once per name. */
function droppedReporter() {
  const seen = new Set();
  return (names) => {
    for (const name of names) {
      if (seen.has(name)) continue;
      seen.add(name);
      notice(`Ignoring "${name}": its check suite has no workflow run, so it is not a job this gate can wait on`);
    }
  };
}

function warnUnmatchedSkips(all, skipList) {
  // Report a skip-list rule that matches nothing. Usually a filename typo, and
  // the quiet version leaves the gate waiting on the job it was told to skip.
  for (const rule of unmatchedSkipRules(all, skipList)) {
    warn(`skip-list rule ${JSON.stringify(rule)} matched no check run on this commit. Check the workflow filename and job name.`);
  }
}

/**
 * Watch mode: compute the verdict once from the current state of the commit and
 * publish it as a check run, then exit. No waiting.
 *
 * The job's own exit code is deliberately not the verdict. The verdict lives in
 * the published check run, which is what the branch ruleset requires, so this job
 * stays green even when the gate is red.
 */
async function runWatch(opts) {
  const { ctx, checkName, skipOpts, earlyExit, dryRun, warmupMs } = opts;
  const reportDropped = droppedReporter();

  log(`Gate (watch) on ${ctx.owner}/${ctx.repo}@${ctx.sha}, publishing check run "${checkName}"`);
  log(`  event: ${process.env.GITHUB_EVENT_NAME || '(unknown)'}, api retries: ${ctx.retryLimit}`);
  if (skipOpts.skipList.length > 0) log(`  skip-list: ${JSON.stringify(skipOpts.skipList)}`);

  const collect = async () => {
    const all = flattenCheckSuites(await fetchChecks(ctx), reportDropped);
    return { all, watched: all.filter((entry) => !shouldSkip(entry, skipOpts)) };
  };

  // Read the check run before computing anything, so a terminal verdict can be
  // invalidated first. Recomputing and only then discovering the write fails is
  // what leaves a stale green behind.
  let existing = dryRun ? null : await findOwnedCheckRun(ctx, checkName);
  if (existing && existing.status === 'completed') {
    await writeCheckRun(ctx, invalidationCheckRun(checkName), existing);
    log(`Invalidated the previous ${existing.conclusion} verdict before recomputing.`);
  }

  const seedEvent = ['pull_request', 'pull_request_target'].includes(process.env.GITHUB_EVENT_NAME);
  if (seedEvent && warmupMs > 0) {
    // On the first event of a commit the siblings have not registered their check
    // runs yet, and an empty commit reads as "nothing to gate", which would
    // publish a premature success.
    log(`Waiting ${Math.round(warmupMs / 1000)}s for sibling check runs to register.`);
    await sleep(warmupMs);
  }

  let { all, watched } = await collect();
  if (watched.length === 0 && !seedEvent && warmupMs > 0) {
    // Nothing visible on a completion event should be impossible, since the
    // workflow that triggered it is itself a check run on this commit. Warm up
    // and look again rather than concluding success off an empty read.
    warn(`No watched check runs visible on a ${process.env.GITHUB_EVENT_NAME} event. Retrying after ${Math.round(warmupMs / 1000)}s.`);
    await sleep(warmupMs);
    ({ all, watched } = await collect());
  }

  log(`${watched.length} watched check run(s) of ${all.length} total.`);
  for (const entry of watched) log(`  ${formatEntry(entry)}`);
  if (all.length > 0) warnUnmatchedSkips(all, skipOpts.skipList);

  const result = evaluate(watched, { earlyExit });
  const verdict = verdictCheckRun(result, { name: checkName, totalWatched: watched.length });

  setOutput('polls', '1');
  setOutput('conclusion', result.done ? (result.ok ? 'success' : 'failure') : 'pending');

  if (dryRun) {
    warn(`dry-run: would have set check run "${checkName}" to ${verdict.status}${verdict.conclusion ? `/${verdict.conclusion}` : ''} — ${verdict.title}`);
    return 0;
  }

  const { created } = await writeCheckRun(ctx, verdict, existing);
  log(`${created ? 'Created' : 'Updated'} check run "${checkName}": ${verdict.status}${verdict.conclusion ? `/${verdict.conclusion}` : ''} — ${verdict.title}`);
  return 0;
}

async function runWait(opts) {
  const { ctx, skipOpts, earlyExit, dryRun, warmupMs, minimumMs, retryMethod, attemptLimits } = opts;
  const { owner, repo, sha } = ctx;
  const reportDropped = droppedReporter();

  log(`Gate (wait) on ${owner}/${repo}@${sha}`);
  log(`  api retries: ${ctx.retryLimit}, poll limit: ${attemptLimits}, interval: ${minimumMs / 1000}s (${retryMethod})`);
  if (skipOpts.skipList.length > 0) log(`  skip-list: ${JSON.stringify(skipOpts.skipList)}`);

  let polls = 0;
  let warnedUnmatchedSkips = false;
  for (let attempt = 1; attempt <= attemptLimits; attempt += 1) {
    polls = attempt;
    const waitMs = attempt === 1 ? warmupMs : pollIntervalMs(retryMethod, minimumMs, attempt);
    if (waitMs > 0) {
      log(`Waiting ${Math.round(waitMs / 1000)}s before poll ${attempt}.`);
      await sleep(waitMs);
    }

    const suites = await fetchChecks(ctx);
    const all = flattenCheckSuites(suites, reportDropped);
    const watched = all.filter((entry) => !shouldSkip(entry, skipOpts));

    log(`Poll ${attempt}: ${watched.length} watched check run(s) of ${all.length} total.`);
    for (const entry of watched) log(`  ${formatEntry(entry)}`);

    if (!warnedUnmatchedSkips && all.length > 0) {
      warnedUnmatchedSkips = true;
      warnUnmatchedSkips(all, skipOpts.skipList);
    }

    if (watched.length === 0 && attempt === 1) {
      notice('No other check runs visible yet. If this repo genuinely has no other jobs the gate will pass.');
    }

    const result = evaluate(watched, { earlyExit });
    if (!result.done) {
      log(`  ${result.pending.length} still running.`);
      continue;
    }

    setOutput('polls', String(polls));

    if (result.ok) {
      setOutput('conclusion', 'success');
      log('All watched jobs passed.');
      return 0;
    }

    setOutput('conclusion', 'failure');
    const lines = result.bad.map((entry) => `  ${formatEntry(entry)}${entry.url ? ` (${entry.url})` : ''}`);
    if (dryRun) {
      warn(`dry-run: the gate would have failed on ${result.bad.length} job(s):\n${lines.join('\n')}`);
      return 0;
    }
    log(`::error::Gate failed. ${result.bad.length} job(s) did not pass:\n${lines.join('\n')}`);
    return 1;
  }

  setOutput('polls', String(polls));
  setOutput('conclusion', 'timed_out');
  if (dryRun) {
    warn(`dry-run: gate gave up after ${polls} polls with jobs still running`);
    return 0;
  }
  log(`::error::Gate gave up after ${polls} polls with jobs still running. Raise attempt-limits if the slowest job legitimately takes longer.`);
  return 1;
}

async function run() {
  const opts = buildOptions();
  return opts.mode === 'watch' ? runWatch(opts) : runWait(opts);
}

if (require.main === module) {
  run()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      log(`::error::${err && err.message ? err.message : String(err)}`);
      process.exitCode = 1;
    });
}

module.exports = {
  getInput,
  setOutput,
  getBooleanInput,
  parseDurationSeconds,
  classify,
  parseMode,
  parseSkipList,
  currentWorkflowFile,
  shouldSkip,
  unmatchedSkipRules,
  evaluate,
  isRetryableStatus,
  isRetryableGraphQLErrors,
  backoffMs,
  retryAfterMs,
  pollIntervalMs,
  parseIntOr,
  flattenCheckSuites,
  formatEntry,
  codeSpan,
  verdictCheckRun,
  externalIdFor,
  findOwnedCheckRun,
  writeCheckRun,
  invalidationCheckRun,
  resolveSha,
  graphql,
  rest,
  upsertCheckRun,
};
