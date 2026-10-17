// Story 6.2b, AC 3: measures block coverage of the image disposition function
// under the policy-surface sweep.
//
// Runs in its own Node process, launched by community-screening-policy.sweep.spec.ts.
// It cannot run inside the Vitest worker: precise coverage is collected per
// isolate and `Profiler.takePreciseCoverage` resets the counters, so taking it
// there would corrupt the coverage run that `npm run validate` gates on.
//
// V8 block coverage reports every executed range of a function: each branch of
// an `if`, each right-hand side of `&&` and `||`, each callback. A range with a
// zero count is code the sweep never reached. The probe enables coverage before
// importing the module, so every function in it is compiled with counters.
import fs from 'node:fs'
import inspector from 'node:inspector/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildPolicySweep, type SweepImagePolicy } from './policy-sweep-vectors.js'

/** The functions whose every block the sweep must execute, nested callbacks included. */
const TARGET_FUNCTIONS = [
  'evaluateNsfwDisposition',
  'validateVector',
  'review',
  'emptyEvaluation',
]

interface CoverageRange {
  startOffset: number
  endOffset: number
  count: number
}

interface FunctionCoverage {
  functionName: string
  ranges: CoverageRange[]
}

interface ScriptCoverage {
  scriptId: string
  url: string
  functions: FunctionCoverage[]
}

async function main(): Promise<void> {
  const apiRoot = path.resolve(__dirname, '../..')
  const modulePath = path.join(
    apiRoot,
    'src/modules/community/tensorflow-nsfw-image-screener.ts'
  )
  const policy = JSON.parse(
    fs.readFileSync(
      path.join(apiRoot, 'policies/community-screening/policy-v2.json'),
      'utf8'
    )
  ) as { image: SweepImagePolicy & Record<string, unknown> }

  const session = new inspector.Session()
  session.connect()
  const sources = new Map<string, string>()
  session.on('Debugger.scriptParsed', (message) => {
    const { scriptId, url } = message.params
    if (url.endsWith('tensorflow-nsfw-image-screener.ts')) sources.set(scriptId, url)
  })
  await session.post('Debugger.enable')
  await session.post('Profiler.enable')
  await session.post('Profiler.startPreciseCoverage', { callCount: true, detailed: true })

  const screener = (await import(pathToFileURL(modulePath).href)) as {
    evaluateNsfwDisposition: (
      probabilities: readonly number[],
      classNames: readonly string[],
      policy: unknown
    ) => unknown
  }

  const vectors = buildPolicySweep(policy.image)
  for (const vector of vectors) {
    screener.evaluateNsfwDisposition(
      vector.probabilities,
      vector.classNames,
      policy.image
    )
  }

  const { result } = (await session.post('Profiler.takePreciseCoverage')) as {
    result: ScriptCoverage[]
  }
  const script = result.find((entry) => sources.has(entry.scriptId))
  if (!script) {
    throw new Error('The screener module was not found in the coverage result')
  }
  const { scriptSource } = (await session.post('Debugger.getScriptSource', {
    scriptId: script.scriptId,
  })) as { scriptSource: string }

  const targets = script.functions.filter((fn) =>
    TARGET_FUNCTIONS.includes(fn.functionName)
  )
  const missing = TARGET_FUNCTIONS.filter(
    (name) => !targets.some((fn) => fn.functionName === name)
  )
  const outer = targets.map((fn) => fn.ranges[0] as CoverageRange)
  // Anonymous callbacks declared inside a target function are part of it.
  const nested = script.functions.filter(
    (fn) =>
      !TARGET_FUNCTIONS.includes(fn.functionName) &&
      outer.some(
        (range) =>
          (fn.ranges[0] as CoverageRange).startOffset >= range.startOffset &&
          (fn.ranges[0] as CoverageRange).endOffset <= range.endOffset
      )
  )

  const report = [...targets, ...nested].map((fn) => {
    const uncovered = fn.ranges
      .filter((range) => range.count === 0)
      .map((range) =>
        scriptSource
          .slice(range.startOffset, range.endOffset)
          .replace(/\s+/g, ' ')
          .slice(0, 160)
      )
    return {
      functionName: fn.functionName || '(anonymous callback)',
      blocks: fn.ranges.length,
      calls: (fn.ranges[0] as CoverageRange).count,
      uncovered,
    }
  })

  process.stdout.write(
    `${JSON.stringify({ vectorCount: vectors.length, missingFunctions: missing, functions: report })}\n`
  )
  await session.post('Profiler.stopPreciseCoverage')
  session.disconnect()
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`
  )
  process.exit(1)
})
