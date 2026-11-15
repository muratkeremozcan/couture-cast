// Learning path Step 48: Safe branded share-card export.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-48-safe-branded-share-card-export
//
// A failed native build (scripts/run-story68-native.mjs build) keeps its Gradle or xcodebuild
// output in the private build log, which never crosses the public evidence boundary. Dispatch
// 43693424172 android36-controls failed native_build_failed with nothing public to name a cause.
// This record is read from that log in memory and holds only closed values: the failed task
// paths, one fixed classification, the exit status and the duration.

const keys = [
  'classification',
  'configuration',
  'durationMs',
  'exitCode',
  'failedTasks',
  'platform',
  'signal',
]
// First match wins; a killed build is told by its status before any log text is read.
const signatures = [
  [
    'outofmemory',
    /OutOfMemoryError|Java heap space|GC overhead limit exceeded|Metaspace/,
  ],
  [
    'daemondied',
    /Gradle build daemon disappeared unexpectedly|daemon has (crashed|died)/i,
  ],
  ['diskfull', /No space left on device/],
  [
    'dependencies',
    /Could not resolve (all files|all dependencies|[\w.-]+:[\w.-]+)|Could not (GET|HEAD|download) /,
  ],
  ['kotlin', /^e: file:\/\/|Compilation error\. See log for more details/m],
  ['java', /Compilation failed; see the compiler error output for details/],
  ['native', /CMake Error|ninja: build stopped|clang\S*: error:|ld: error:/],
]
const classifications = new Set([...signatures.map(([id]) => id), 'killed', 'unknown'])
const signals = new Set(['SIGKILL', 'SIGTERM', 'SIGINT', 'SIGABRT', 'SIGSEGV'])
const TASK = /^:[A-Za-z0-9_.-]+(?::[A-Za-z0-9_.-]+)*$/
const MAX_TASKS = 10
const invalid = () => {
  throw new Error('invalid_native_build_failure')
}

const closedShape = (value) =>
  Boolean(value) &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join(',') === keys.join(',')
const closedRun = (value) =>
  ['android', 'ios'].includes(value.platform) &&
  ['Debug', 'Release'].includes(value.configuration) &&
  Number.isSafeInteger(value.durationMs) &&
  value.durationMs >= 0 &&
  (value.exitCode === null || Number.isSafeInteger(value.exitCode)) &&
  (value.signal === null || signals.has(value.signal))
const closedCause = (value) =>
  classifications.has(value.classification) &&
  Array.isArray(value.failedTasks) &&
  value.failedTasks.length <= MAX_TASKS &&
  value.failedTasks.every((task) => typeof task === 'string' && TASK.test(task))

/** Validate the whole public record before it is copied. */
export function assertNativeBuildFailure(value) {
  if (!closedShape(value) || !closedRun(value) || !closedCause(value)) invalid()
}

/** The closed record of one failed build; `log` is matched in memory and never copied. */
export function summarizeNativeBuildFailure({
  platform,
  configuration,
  durationMs,
  status,
  signal,
  log,
}) {
  const text = typeof log === 'string' ? log : ''
  const failedTasks = []
  for (const match of text.matchAll(/^> Task (\S+) FAILED\s*$/gm))
    if (
      TASK.test(match[1]) &&
      !failedTasks.includes(match[1]) &&
      failedTasks.length < MAX_TASKS
    )
      failedTasks.push(match[1])
  const killed = signal === 'SIGKILL' || status === 137
  const record = {
    platform,
    configuration,
    durationMs: Math.max(0, Math.round(durationMs)),
    exitCode: Number.isSafeInteger(status) ? status : null,
    signal: signals.has(signal) ? signal : null,
    classification: killed
      ? 'killed'
      : (signatures.find(([, pattern]) => pattern.test(text))?.[0] ?? 'unknown'),
    failedTasks,
  }
  assertNativeBuildFailure(record)
  return record
}
