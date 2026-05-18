// Shared handleSummary() — k6 calls this automatically at the end of every test run.
// It receives all collected metrics and threshold results, and you decide what to do with them.
//
// This implementation produces two outputs:
//   stdout       -> colored human-readable summary (what you see in the terminal)
//   summary.json -> machine-parseable JSON (ex: consumed by a test report or GHA step summary)
//
// How to use: just re-export from your test script. That's it.
//   import { handleSummary } from 'k6-toolkit/handle-summary'
//   export { handleSummary }
//
// This ensures consistent summary format across all k6 tests.

// textSummary from k6's jslib formats the colored console output you see after a k6 run.
// This is a URL import — k6 fetches it at runtime (esbuild leaves it alone via --external).
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.1.0/index.js'

// Types for the data object k6 passes to handleSummary.
// k6 collects metrics throughout the test and passes them here at the end.
type K6Metric = {
  values?: Record<string, number> // p(50), p(95), p(99), avg, max, etc.
  thresholds?: Record<string, { ok: boolean }> // threshold expr -> result
}

type K6Summary = {
  metrics: Record<string, K6Metric> // all collected metrics (http_req_duration, custom Trends, etc.)
}

type SummaryEnv = Record<string, string | undefined>

// The JSON structure written to summary.json.
// Designed to be easy to parse in bash (jq) and display in GHA step summaries.
type SummaryOutput = {
  timestamp: string
  summarySchemaVersion: 2
  testScript: string
  environment: string
  gitSha: string
  testId: string | null
  smoke: boolean
  runMode: 'smoke' | 'load' | 'unknown'
  thresholdsEvaluated: boolean
  metrics: Record<string, Record<string, number | undefined>> // per-metric percentiles
  thresholds: Record<string, Record<string, boolean>> // metric name -> threshold expr -> pass/fail
  pass: boolean | null // true = all passed, false = some failed, null = no threshold results present
}

/**
 * k6 calls this at the end of the test run with all collected metrics.
 * Extracts percentiles from every metric that has p(95) values — this includes
 * built-in http_req_duration AND any custom Trend metrics you define.
 * Reads TEST_SCRIPT, ENVIRONMENT, and GIT_SHA env vars for metadata tagging.
 * Set SUMMARY_OUTPUT env var to control the output file path (default: 'summary.json').
 * Example: SUMMARY_OUTPUT=k6/summary.json to write inside a k6/ folder.
 * @returns `{ stdout: string, '<output-path>': string }`
 */
export function buildSummary(
  data: K6Summary,
  env: SummaryEnv = __ENV as SummaryEnv
): SummaryOutput {
  const runMode =
    env.K6_RUN_MODE === 'smoke'
      ? 'smoke'
      : env.K6_RUN_MODE === 'load'
        ? 'load'
        : 'unknown'

  const summary: SummaryOutput = {
    timestamp: new Date().toISOString(),
    summarySchemaVersion: 2,
    testScript: env.TEST_SCRIPT || 'unknown',
    environment: env.ENVIRONMENT || 'dev',
    gitSha: env.GIT_SHA || 'local',
    testId: env.TEST_ID || null,
    smoke: runMode === 'smoke',
    runMode,
    thresholdsEvaluated: false,
    metrics: {},
    thresholds: {},
    pass: null,
  }

  // Extract percentiles from every metric that has them.
  // k6 adds p(50), p(95), p(99), avg, max to Trend-type metrics (http_req_duration, custom Trends).
  // Counter and Rate metrics don't have percentiles, so the 'p(95)' check filters them out.
  for (const [key, metric] of Object.entries(data.metrics)) {
    if (metric.values && 'p(95)' in metric.values) {
      summary.metrics[key] = {
        p50: metric.values['p(50)'],
        p95: metric.values['p(95)'],
        p99: metric.values['p(99)'],
        avg: metric.values.avg,
        max: metric.values.max,
      }
    }
  }

  // Threshold results live under each metric in real k6 summary data.
  // Preserve the metric name plus expression so multiple thresholds per
  // metric are represented faithfully in the JSON output.
  let sawThreshold = false
  let allThresholdsPassed = true

  for (const [metricName, metric] of Object.entries(data.metrics)) {
    const thresholdEntries = Object.entries(metric.thresholds || {})
    if (thresholdEntries.length === 0) continue

    summary.thresholds[metricName] = {}
    for (const [expr, threshold] of thresholdEntries) {
      summary.thresholds[metricName][expr] = threshold.ok
      sawThreshold = true
      if (!threshold.ok) allThresholdsPassed = false
    }
  }
  summary.thresholdsEvaluated = sawThreshold
  summary.pass = sawThreshold ? allThresholdsPassed : null

  return summary
}

export function handleSummary(data: K6Summary): Record<string, string> {
  const summary = buildSummary(data)

  // Output path configurable via SUMMARY_OUTPUT env var (default: summary.json).
  // Consumers set this to write summary into a subfolder (e.g. k6/summary.json).
  const outputPath = __ENV.SUMMARY_OUTPUT || 'summary.json'

  return {
    // stdout: colored terminal output (what the user sees after k6 run)
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
    // JSON file written to disk, consumed by a test report or GHA step summary
    [outputPath]: JSON.stringify(summary, null, 2),
  }
}
