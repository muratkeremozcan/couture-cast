/*
 * Fails a community worker runtime measurement that exceeds the committed
 * performance gates.
 *
 * Story 6.2, Task 6 and AC 8. The model manifest commits two limits per metric:
 * `performance.absoluteCeilings`, which bound a pathological run anywhere, and
 * `performance.regressionGate`, set at three times the developer-machine
 * measurement and capped at the ceiling, which catches a change of kind (a
 * network fetch on startup, the union TensorFlow package returning) long before
 * the ceiling would. This reads a report written by
 * `scripts/measure-community-worker-runtime.mjs` and exits 1 when any measured
 * value is above either limit, or when a value the gate needs is missing.
 *
 * The regression gate is only comparable on the hardware class it was measured
 * on. A container capped at 0.2 vCPU is several times slower by construction,
 * which is why the readiness generator judges container runs on the absolute
 * ceilings alone. This command is the developer-machine check:
 *
 *   npm run community:screening:measure:gate
 *
 * Usage: node scripts/check-community-worker-regression-gate.mjs <runtime-report.json>
 *        [--manifest <model-manifest.json>]
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')
const DEFAULT_MANIFEST = path.join(
  projectRoot,
  'apps/api/model-manifests/community-nsfw-mobilenet-v2-mid-nsfwjs-4.3.0.json'
)

/** Gate key in the manifest, and where the runtime report keeps the measured value. */
const GATED_METRICS = [
  ['coldStartupMs', (report) => report.coldStartupMs],
  ['warmP95Ms', (report) => report.warmSupervisedMs?.p95],
  ['warmP99Ms', (report) => report.warmSupervisedMs?.p99],
  ['peakResidentMib', (report) => report.peakResidentMib],
]

const finite = (value) => typeof value === 'number' && Number.isFinite(value)

/**
 * Judges one runtime report against the manifest's `performance` block. Returns
 * every breach rather than the first, so a run that is both slow and heavy says
 * so in one pass.
 */
export function assessRuntimeAgainstGates(report, performance) {
  const ceilings = performance?.absoluteCeilings ?? {}
  const regressionGate = performance?.regressionGate ?? {}
  const failures = []
  const metrics = {}

  if (!Number.isInteger(report?.warmSamples) || report.warmSamples < 1) {
    failures.push('the report carries no warm samples')
  }

  for (const [key, read] of GATED_METRICS) {
    const measured = read(report ?? {})
    const ceiling = ceilings[key]
    const gate = regressionGate[key]
    metrics[key] = {
      measured: measured ?? null,
      regressionGate: gate ?? null,
      ceiling: ceiling ?? null,
    }

    failures.push(
      ...limitFailures(key, measured, ceiling, 'absolute ceiling'),
      ...limitFailures(key, measured, gate, 'regression gate')
    )
    if (!finite(measured)) failures.push(`${key} was not measured`)
  }

  return { ok: failures.length === 0, failures, metrics }
}

/** A missing limit fails as loudly as a breached one: a deleted gate must not pass. */
function limitFailures(key, measured, limit, label) {
  if (!finite(limit)) return [`the manifest has no ${label} for ${key}`]
  if (finite(measured) && measured > limit) {
    return [`${key} ${measured} is above the ${label} ${limit}`]
  }
  return []
}

function parseArgs(argv) {
  const options = { report: null, manifest: DEFAULT_MANIFEST }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--manifest') options.manifest = path.resolve(argv[++index] ?? '')
    else if (arg.startsWith('--')) throw new Error(`Unknown argument: ${arg}`)
    else if (options.report === null) options.report = path.resolve(arg)
    else throw new Error(`Unexpected argument: ${arg}`)
  }
  if (options.report === null) {
    throw new Error(
      'Pass the runtime report written by measure-community-worker-runtime.mjs'
    )
  }
  return options
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  const report = JSON.parse(fs.readFileSync(options.report, 'utf8'))
  const manifest = JSON.parse(fs.readFileSync(options.manifest, 'utf8'))
  const verdict = assessRuntimeAgainstGates(report, manifest.performance)

  console.log(
    JSON.stringify(
      {
        report: path.relative(projectRoot, options.report),
        manifest: path.relative(projectRoot, options.manifest),
        profile: report.profile ?? null,
        ...verdict,
      },
      null,
      2
    )
  )
  if (!verdict.ok) {
    for (const failure of verdict.failures) console.error(`[gate] ${failure}`)
    process.exit(1)
  }
}

const invokedDirectly =
  process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) {
  try {
    main()
  } catch (error) {
    console.error(`[gate] ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}
