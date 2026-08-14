#!/usr/bin/env node
/**
 * Summarise a Maestro run from the JUnit reports it wrote.
 *
 * Every other test tier in this repo reports itself on the pull request:
 * Playwright merges its shard blobs and posts a status table, Pact posts its
 * contract outcome, k6 posts its thresholds, the unit suite posts coverage.
 * The mobile suite posted nothing. Four sharded Android jobs each uploaded an
 * artifact and a reader had to open four zip files to learn which flow broke,
 * so in practice nobody looked and a red shard was read as "mobile is flaky
 * again".
 *
 * This script is the data half of that report. It reads what the suite already
 * writes -- `maestro/artifacts/<flow>-report.xml` per flow, plus the combined
 * `parallel-suite-report.xml` the local sharded runner produces -- and turns it
 * into one JSON document. `.github/actions/mobile-e2e-report-comment` renders
 * that into the PR comment; a developer can run it directly after a local run.
 *
 * The reports are the authority on what happened, not the exit code. That rule
 * is `run-maestro.mjs`'s (see `readSuiteReport` there) and it holds here for the
 * same reason: Maestro has been observed exiting 0 from a run whose own report
 * carried `failures="1"`.
 *
 * Usage:
 *   node scripts/summarize-maestro-junit.mjs [dir ...]            # JSON
 *   node scripts/summarize-maestro-junit.mjs [dir ...] --pretty   # text table
 *
 * With no directory the default is `maestro/artifacts`, which is where both the
 * local and the CI runner write.
 */
import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const pretty = args.includes('--pretty')
const dirs = args.filter((arg) => !arg.startsWith('--'))
const roots = dirs.length > 0 ? dirs : ['maestro/artifacts']

/**
 * Recursively collect every JUnit report under a directory.
 *
 * Maestro 2.8.0 moved its artifacts under `<timestamp>/<Flow Name>/`, and the
 * CI download lands each shard's artifact in its own subdirectory, so a
 * non-recursive read would find nothing in either layout.
 *
 * @param {string} root
 * @returns {string[]}
 */
const findReports = (root) => {
  const found = []
  const stack = [root]
  while (stack.length > 0) {
    const dir = stack.pop()
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) stack.push(full)
      else if (entry.name.endsWith('.xml') && entry.name.includes('report'))
        found.push(full)
    }
  }
  return found.sort()
}

const unescapeXml = (value) =>
  value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, '&')

const attr = (segment, name) => {
  const match = new RegExp(`${name}="([^"]*)"`).exec(segment)
  return match ? unescapeXml(match[1]) : null
}

/**
 * The shard a report came from, read off the artifact directory name.
 *
 * CI uploads `android-test-results-shard-<n>-attempt-<n>`, so the shard is in
 * the path once the artifacts are downloaded unmerged. A local run has no
 * shard directory and gets `null`, which the renderer prints as a dash rather
 * than inventing a shard 1.
 *
 * @param {string} reportPath
 * @returns {number | null}
 */
const shardOf = (reportPath) => {
  const match = /shard-(\d+)/.exec(reportPath)
  return match ? Number(match[1]) : null
}

/**
 * Parse one JUnit file into flow records.
 *
 * Deliberately regex-based rather than pulling in an XML parser: this reads
 * files Maestro wrote in a shape this repo already parses the same way in
 * `run-maestro.mjs`, and a CI reporting step should not need a dependency
 * install to run.
 *
 * @param {string} reportPath
 * @returns {{ flows: object[], unreadable: string | null }}
 */
const parseReport = (reportPath) => {
  let xml
  let mtimeMs = 0
  try {
    xml = fs.readFileSync(reportPath, 'utf8')
    mtimeMs = fs.statSync(reportPath).mtimeMs
  } catch (error) {
    return { flows: [], unreadable: `${reportPath}: ${error.message}` }
  }

  const device = attr(xml.split('<testcase')[0], 'device')
  const flows = []

  // Each `<testcase` runs to the next one, so a nested `<failure>`, `<error>`
  // or `<skipped>` is attributable to the case that owns it. Self-closing cases
  // carry none of those and are passes.
  for (const segment of xml.split('<testcase').slice(1)) {
    const name = attr(segment, 'name')
    if (!name) continue
    const body = segment.split('</testcase>')[0]
    const failureMatch = /<(?:failure|error)[^>]*>([\s\S]*?)<\/(?:failure|error)>/.exec(
      body
    )
    const hasFailureTag = /<(?:failure|error)[\s>/]/.test(body)
    const isSkipped = /<skipped[\s/>]/.test(body)
    const status = attr(segment, 'status')

    let outcome = 'passed'
    if (hasFailureTag || status === 'ERROR' || status === 'FAILED') outcome = 'failed'
    else if (isSkipped || status === 'SKIPPED') outcome = 'skipped'

    flows.push({
      name,
      file: attr(segment, 'file'),
      status: outcome,
      seconds: Number(attr(segment, 'time') ?? 0) || 0,
      timestamp: attr(segment, 'timestamp'),
      device: attr(segment, 'device') ?? device,
      failure: failureMatch ? unescapeXml(failureMatch[1]).trim() : null,
      shard: shardOf(reportPath),
      reportPath,
      mtimeMs,
    })
  }

  return { flows, unreadable: null }
}

const reportPaths = roots.flatMap((root) => findReports(root))
const unreadable = []
const parsed = []
for (const reportPath of reportPaths) {
  const result = parseReport(reportPath)
  if (result.unreadable) unreadable.push(result.unreadable)
  parsed.push(...result.flows)
}

// One flow can appear in more than one report: `maestro/artifacts` is not
// cleared between local runs, and the sharded local runner writes both
// per-flow reports and a combined `parallel-suite-report.xml`. Keeping the
// newest record per flow is what makes a local invocation describe the run that
// just happened instead of every run since the directory was created. In CI
// each flow runs once and the directory is fresh, so this is a no-op there.
//
// The testcase timestamp decides, and the report file's mtime breaks ties. The
// tie-break is load-bearing rather than defensive: a combined report from an
// old sharded run carries the same timestamps as the per-flow reports it was
// built alongside, so without it the winner would be whichever the directory
// walk happened to reach first, and a stale combined report could shadow every
// fresh per-flow result.
const newestPerFlow = new Map()
let duplicatesDropped = 0
const isNewer = (candidate, existing) => {
  const candidateStamp = candidate.timestamp ?? ''
  const existingStamp = existing.timestamp ?? ''
  if (candidateStamp !== existingStamp) return candidateStamp > existingStamp
  return candidate.mtimeMs > existing.mtimeMs
}
for (const flow of parsed) {
  const key = flow.file ?? flow.name
  const existing = newestPerFlow.get(key)
  if (!existing) {
    newestPerFlow.set(key, flow)
    continue
  }
  duplicatesDropped += 1
  if (isNewer(flow, existing)) newestPerFlow.set(key, flow)
}

const flows = [...newestPerFlow.values()].sort((a, b) =>
  (a.file ?? a.name).localeCompare(b.file ?? b.name)
)

const count = (status) => flows.filter((flow) => flow.status === status).length
const totals = {
  total: flows.length,
  passed: count('passed'),
  failed: count('failed'),
  skipped: count('skipped'),
  seconds: Math.round(flows.reduce((sum, flow) => sum + flow.seconds, 0)),
}

const shardNumbers = [
  ...new Set(flows.map((flow) => flow.shard).filter((shard) => shard !== null)),
].sort((a, b) => a - b)

const shards = shardNumbers.map((shard) => {
  const own = flows.filter((flow) => flow.shard === shard)
  return {
    shard,
    total: own.length,
    passed: own.filter((flow) => flow.status === 'passed').length,
    failed: own.filter((flow) => flow.status === 'failed').length,
    skipped: own.filter((flow) => flow.status === 'skipped').length,
    seconds: Math.round(own.reduce((sum, flow) => sum + flow.seconds, 0)),
  }
})

const summary = {
  roots,
  reportsRead: reportPaths.length,
  duplicatesDropped,
  unreadable,
  devices: [...new Set(flows.map((flow) => flow.device).filter(Boolean))],
  totals,
  shards,
  flows,
}

if (!pretty) {
  console.log(JSON.stringify(summary, null, 2))
} else {
  const mark = { passed: 'PASS', failed: 'FAIL', skipped: 'SKIP' }
  console.log(
    `Maestro: ${totals.passed} passed, ${totals.failed} failed, ${totals.skipped} skipped ` +
      `of ${totals.total} flows in ${totals.seconds}s ` +
      `(${reportPaths.length} report file(s) under ${roots.join(', ')})`
  )
  for (const flow of flows) {
    const shard = flow.shard === null ? '' : ` [shard ${flow.shard}]`
    console.log(
      `  ${mark[flow.status]}${shard} ${flow.file ?? flow.name} (${flow.seconds.toFixed(1)}s)`
    )
    if (flow.failure) console.log(`       ${flow.failure.split('\n')[0]}`)
  }
  for (const problem of unreadable) console.log(`  UNREADABLE ${problem}`)
}
