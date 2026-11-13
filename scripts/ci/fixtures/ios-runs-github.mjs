// Story 6.15: a fake GitHub API for the iOS run reads in scripts/ci/ios-native-inputs.mjs
// (passingRun): the runs of one workflow file, 100 a page, filtered by the query the way GitHub
// filters them (head_sha, event, branch, status); the jobs of one run, 100 a page; and a commit's
// date. A path in `deny` answers 403, and `totals` maps a run id to the total_count its jobs
// listing reports, so the pages can hold fewer jobs than it says. With `loose`, the runs listing ignores its query, so the
// reader's own filters are what reject another commit, branch or repository. A compare of
// base...head answers `ancestry[base]`, 'ahead' by default.
export const REPO = 'o/r'
export const SHA = 'a'.repeat(40)
export const MAIN = 'd'.repeat(40)
export const PUSH_FILE = '.github/workflows/ios-native.yml'
export const DISPATCH_FILE = '.github/workflows/ios-native-dispatch.yml'

let next = 1000

/** A completed, successful run of `kind` (push, schedule or dispatch) on main for SHA. */
export function iosRun(kind, patch = {}) {
  const dispatch = kind === 'dispatch'
  return {
    id: next++,
    path: dispatch ? DISPATCH_FILE : PUSH_FILE,
    event: dispatch ? 'workflow_dispatch' : kind,
    head_branch: 'main',
    head_repository: { full_name: REPO },
    head_sha: dispatch ? MAIN : SHA,
    display_title: `iOS native ${SHA}`,
    status: 'completed',
    conclusion: 'success',
    created_at: '2026-11-13T10:00:00Z',
    html_url: `https://github.com/${REPO}/actions/runs/${next}`,
    ...patch,
  }
}

// The execution fields of a job in the jobs API: a runner and started steps once a runner took
// it, neither while it waits or when it was skipped or cancelled before it started.
const STARTED_AT = '2026-11-13T10:00:00Z'
const RUNNER = { runner_id: 7, runner_name: 'GitHub Actions 7' }
const executed = {
  ...RUNNER,
  steps: [{ number: 1, name: 'Set up job', status: 'completed', conclusion: 'success' }],
}
const unassigned = { runner_id: null, runner_name: null, steps: [] }
// A job waiting for a runner: GitHub already sets started_at.
export const QUEUED = {
  status: 'queued',
  conclusion: null,
  started_at: STARTED_AT,
  ...unassigned,
}
// A job cancelled before a runner took it.
export const CANCELLED_BEFORE_START = {
  status: 'completed',
  conclusion: 'cancelled',
  started_at: STARTED_AT,
  ...unassigned,
}
// A job a runner is executing.
export const STARTED = {
  status: 'in_progress',
  conclusion: null,
  started_at: STARTED_AT,
  ...RUNNER,
  steps: [
    { number: 1, name: 'Set up job', status: 'completed', conclusion: 'success' },
    { number: 2, name: 'Run the shard', status: 'in_progress', conclusion: null },
  ],
}

/**
 * The jobs of a run of `kind` whose every job passed, as the jobs API lists them, runner and
 * steps included; a dispatch skips ios-build. `patch` maps a job name to fields to change, and
 * `extra` adds jobs.
 */
export function iosJobs(kind, patch = {}, extra = []) {
  const dispatch = kind === 'dispatch'
  const names = [
    ...(dispatch ? ['ios-dispatch-gate', 'ios-cache-proof'] : ['ios-changes']),
    'ios-native / ios-build',
    'ios-native / ios-shard (1)',
    'ios-native / ios-shard (2)',
    'ios-native / ios-shard (3)',
    'ios-native / ios-shard (4)',
    'ios-native / ios-expo-go',
    'ios-native / iOS app build',
    'ios-native / ios-evidence',
    ...extra,
  ]
  return names.map((name) => {
    const skipped = dispatch && name === 'ios-native / ios-build'
    return {
      name,
      status: 'completed',
      conclusion: skipped ? 'skipped' : 'success',
      started_at: STARTED_AT,
      ...(skipped ? unassigned : executed),
      ...patch[name],
    }
  })
}

export function runsApi({
  runs = [],
  jobs = {},
  deny = [],
  totals = {},
  ancestry = {},
  loose = false,
  date = '2026-11-12T08:00:00Z',
} = {}) {
  const requested = []
  const reply = (body, status = 200) => ({
    ok: status < 300,
    status,
    json: async () => body,
  })
  const fetchImpl = async (url) => {
    const { pathname, searchParams } = new URL(url)
    requested.push(`${pathname}?${searchParams}`)
    if (deny.some((pattern) => pattern.test(pathname))) return reply({}, 403)
    const query = Object.fromEntries(searchParams)
    const page = Number(query.page ?? 1)
    const per = Number(query.per_page ?? 30)
    const slice = (all) => all.slice((page - 1) * per, page * per)
    const workflow = /\/actions\/workflows\/([\w.-]+)\/runs$/.exec(pathname)
    if (workflow) {
      const listed = runs.filter(
        (run) =>
          run.path === `.github/workflows/${workflow[1]}` &&
          (loose ||
            ((!query.head_sha || run.head_sha === query.head_sha) &&
              (!query.event || run.event === query.event) &&
              (!query.branch || run.head_branch === query.branch) &&
              (!query.status || run.conclusion === query.status)))
      )
      return reply({ total_count: listed.length, workflow_runs: slice(listed) })
    }
    const run = /\/actions\/runs\/(\d+)\/jobs$/.exec(pathname)
    if (run) {
      const all = jobs[run[1]] ?? []
      return reply({ total_count: totals[run[1]] ?? all.length, jobs: slice(all) })
    }
    const compare = /\/compare\/([0-9a-f]{40})\.\.\.([0-9a-f]{40})$/.exec(pathname)
    if (compare) return reply({ status: ancestry[compare[1]] ?? 'ahead' })
    if (/\/commits\/[0-9a-f]{40}$/.test(pathname))
      return reply({ commit: { committer: { date } } })
    return reply({}, 404)
  }
  return { fetchImpl, requested }
}
