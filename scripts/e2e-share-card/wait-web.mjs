import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'
import { assertStartupFailure, summarizeStartupFailure } from './web-startup-failure.mjs'

const execute = promisify(execFile)
const signatures = {
  missing_module: /Cannot find module|Module not found|MODULE_NOT_FOUND/,
  missing_file: /ENOENT/,
  disk_full: /ENOSPC|no space left on device/i,
  out_of_memory: /ENOMEM|heap out of memory|Allocation failed/,
  address_in_use: /EADDRINUSE/,
  webpack_factory: /Cannot read properties of undefined \(reading '(?:call|apply)'\)/,
  client_manifest:
    /Cannot read properties of undefined \(reading '(?:clientModules|entryCSSFiles|entryJSFiles)'\)/,
  next_invariant: /Invariant:|invariant expected/i,
  compilation_error: /Failed to compile|Compilation error/,
}
const resourceKeys = ['freeMemoryBytes', 'totalMemoryBytes', 'freeDiskBytes', 'load1']
const frameworkFiles = [
  'server/base-server.js',
  'server/app-render/app-render.js',
  'server/dev/hot-reloader-webpack.js',
  'server/dev/next-dev-server.js',
  'compiled/next-server/app-page.runtime.dev.js',
  'server/require.js',
  'server/load-components.js',
  'server/next.js',
  'server/lib/router-server.js',
  'server/lib/start-server.js',
  'server/lib/render-server.js',
]
const keys = (value, expected) =>
  value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).length === expected.length &&
  expected.every((key) => Object.hasOwn(value, key))
const bounded = (value, max) => Number.isFinite(value) && value >= 0 && value <= max

function requireFact(condition) {
  if (!condition) throw new Error('invalid_web_startup_evidence')
}
function position(value) {
  return Number.isInteger(value) && value >= 1 && bounded(value, 10000000)
}
function assertLogFacts(value) {
  requireFact(typeof value.logCaptured === 'boolean')
  requireFact(Array.isArray(value.logSignals))
  requireFact(value.logSignals.length <= Object.keys(signatures).length)
  requireFact(new Set(value.logSignals).size === value.logSignals.length)
  requireFact(value.logSignals.every((name) => Object.hasOwn(signatures, name)))
  requireFact(Array.isArray(value.frameworkFrames) && value.frameworkFrames.length <= 8)
  for (const frame of value.frameworkFrames) {
    requireFact(keys(frame, ['file', 'line', 'column']))
    requireFact(frameworkFiles.includes(frame.file))
    requireFact(position(frame.line) && position(frame.column))
  }
  if (!value.logCaptured)
    requireFact(value.logSignals.length === 0 && value.frameworkFrames.length === 0)
}
function assertResources(value) {
  requireFact(keys(value, ['before', 'after']))
  for (const facts of Object.values(value)) {
    requireFact(keys(facts, resourceKeys))
    requireFact(
      resourceKeys.every(
        (key) =>
          facts[key] === null || bounded(facts[key], key === 'load1' ? 100000 : 1e16)
      )
    )
  }
}
function assertProbe(probe, index, length) {
  requireFact(keys(probe, ['phase', 'httpStatus', 'exitCode', 'durationMs']))
  requireFact(probe.phase === (index === length - 1 ? 'verify' : 'wait'))
  requireFact(Number.isInteger(probe.httpStatus))
  requireFact(
    probe.httpStatus === 0 || (probe.httpStatus >= 100 && bounded(probe.httpStatus, 599))
  )
  requireFact(Number.isInteger(probe.exitCode) && bounded(probe.exitCode, 255))
  requireFact(bounded(probe.durationMs, 86400000))
  if (probe.exitCode === 0) requireFact(probe.httpStatus >= 100 && probe.httpStatus < 400)
  if (probe.phase === 'wait' && probe.exitCode === 0) requireFact(index === length - 2)
}
export function assertWebStartupEvidence(value) {
  requireFact(
    keys(value, [
      'version',
      'passed',
      'probes',
      'logCaptured',
      'logSignals',
      'frameworkFrames',
      'resources',
      'failureDetails',
    ])
  )
  requireFact(value.version === 1 && typeof value.passed === 'boolean')
  if (value.failureDetails !== null) assertStartupFailure(value.failureDetails)
  if (value.passed) requireFact(value.failureDetails === null)
  assertLogFacts(value)
  assertResources(value.resources)
  requireFact(
    Array.isArray(value.probes) && value.probes.length >= 2 && value.probes.length <= 91
  )
  value.probes.forEach((probe, index) => assertProbe(probe, index, value.probes.length))
  requireFact(value.passed === (value.probes.at(-1).exitCode === 0))
}

/** Preserve the CI loop's first-success break and its separate final curl. */
export async function waitForOwnedWeb({
  probe,
  delay,
  readLog,
  resources,
  readBody = () => null,
  secrets = [],
}) {
  const before = resources()
  const probes = []
  for (let attempt = 0; attempt < 90; attempt++) {
    const result = await probe('wait', attempt)
    probes.push({ phase: 'wait', ...result })
    if (result.exitCode === 0) break
    await delay()
  }
  const final = await probe('verify', probes.length)
  probes.push({ phase: 'verify', ...final })
  const rawLog = await readLog({ failed: final.exitCode !== 0 })
  const logCaptured = typeof rawLog === 'string'
  const log = logCaptured ? rawLog : ''
  const frameworkFrames = []
  for (const file of frameworkFiles) {
    const pattern = new RegExp(
      `node_modules/next/dist/${file.replaceAll('.', '\\.')}:(\\d+):(\\d+)`,
      'g'
    )
    for (const match of log.matchAll(pattern)) {
      if (frameworkFrames.length < 8)
        frameworkFrames.push({ file, line: Number(match[1]), column: Number(match[2]) })
    }
  }
  const value = {
    version: 1,
    passed: final.exitCode === 0,
    probes,
    logCaptured,
    logSignals: Object.entries(signatures)
      .filter(([, pattern]) => pattern.test(log))
      .map(([name]) => name),
    frameworkFrames,
    resources: { before, after: resources() },
    failureDetails:
      final.exitCode === 0
        ? null
        : summarizeStartupFailure({ body: readBody(probes.length - 1), log, secrets }),
  }
  assertWebStartupEvidence(value)
  return value
}

export async function probeOwnedWebRoot(url, directory, name) {
  const target = new URL(url)
  if (
    target.protocol !== 'http:' ||
    target.hostname !== '127.0.0.1' ||
    target.pathname !== '/' ||
    target.search ||
    target.hash ||
    target.username ||
    target.password ||
    !/^(wait|verify)-[0-9]+$/.test(name)
  )
    throw new Error('owned_web_startup_origin_required')
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  const started = performance.now()
  let exitCode = 0,
    stdout = ''
  try {
    const result = await execute('curl', [
      '--fail-with-body',
      '--silent',
      '--dump-header',
      path.join(directory, `${name}-headers.txt`),
      '--output',
      path.join(directory, `${name}-body.html`),
      '--write-out',
      '%{http_code}',
      url,
    ])
    stdout = result.stdout
  } catch (error) {
    exitCode =
      Number.isInteger(error.code) && error.code > 0 && error.code <= 255
        ? error.code
        : 127
    stdout = error.stdout ?? ''
  }
  return {
    httpStatus: /^[0-9]{3}$/.test(stdout) ? Number(stdout) : 0,
    exitCode,
    durationMs: Math.round(performance.now() - started),
  }
}

function resources(directory) {
  let freeDiskBytes = null
  try {
    const disk = fs.statfsSync(directory)
    freeDiskBytes = disk.bavail * disk.bsize
  } catch {
    /* Evidence remains explicitly unavailable. */
  }
  return {
    freeMemoryBytes: os.freemem(),
    totalMemoryBytes: os.totalmem(),
    freeDiskBytes,
    load1: Math.round(os.loadavg()[0] * 100) / 100,
  }
}

export async function readStartupLog(directory, { failed }) {
  // Next can finish its response before flushing the corresponding error to stderr.
  if (failed) await new Promise((resolve) => setTimeout(resolve, 250))
  try {
    return fs.readFileSync(path.join(directory, 'web-startup-private.log'), 'utf8')
  } catch {
    return null
  }
}
function startupSecrets(directory) {
  const secrets = []
  const visit = (value) => {
    for (const [key, item] of Object.entries(value ?? {})) {
      if (
        typeof item === 'string' &&
        /key|secret|token|password|authorization/i.test(key)
      )
        secrets.push(item)
      else if (item && typeof item === 'object') visit(item)
    }
  }
  visit(process.env)
  for (const name of ['owned-env.json', 'public-build-env.json', 'auth-harness.json']) {
    try {
      visit(JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8')))
    } catch {
      // Startup evidence also runs when provisioning did not produce these files.
    }
  }
  return secrets
}

async function main() {
  const directory = path.resolve(
    process.env.CC68_HARNESS_DIR ?? '_bmad-output/test-artifacts/story-6-8/runtime'
  )
  fs.rmSync(path.join(directory, 'web-startup.json'), { force: true })
  const value = await waitForOwnedWeb({
    probe: (phase, index) =>
      probeOwnedWebRoot(
        'http://127.0.0.1:3088/',
        path.join(directory, 'web-startup-private'),
        `${phase}-${index}`
      ),
    delay: () => new Promise((resolve) => setTimeout(resolve, 1000)),
    readLog: (options) => readStartupLog(directory, options),
    readBody: (index) => {
      try {
        const file = path.join(
          directory,
          'web-startup-private',
          `verify-${index}-body.html`
        )
        return fs.statSync(file).size <= 4 * 1024 ** 2
          ? fs.readFileSync(file, 'utf8')
          : null
      } catch {
        return null
      }
    },
    secrets: startupSecrets(directory),
    resources: () => resources(directory),
  })
  fs.writeFileSync(
    path.join(directory, 'web-startup.json'),
    JSON.stringify(value, null, 2) + '\n',
    { mode: 0o600 }
  )
  console.log('Owned web startup:', JSON.stringify(value))
  process.exitCode = value.probes.at(-1).exitCode
}
if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
)
  await main()
