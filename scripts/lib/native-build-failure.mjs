// Step 58 step 5 owner: searchable owner anchor
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
  ['native', /CMake Error|ninja: build stopped|clang\S*: error:|\bld: error:/],
  // xcodebuild: a Swift compiler error, a failed script phase (the React Native bundle, Hermes,
  // Expo's configure scripts) and xcodebuild refusing to start (no destination, bad scheme).
  // The path may hold spaces: CocoaPods generates Swift under `Pods/Target Support Files/`.
  ['swift', /^[^\n]*\.swift:\d+:\d+: error:/m],
  ['scriptphase', /Command PhaseScriptExecution failed with a nonzero exit code/],
  ['xcodebuild', /^xcodebuild: error:/m],
]
const classifications = new Set([...signatures.map(([id]) => id), 'killed', 'unknown'])
const signals = new Set(['SIGKILL', 'SIGTERM', 'SIGINT', 'SIGABRT', 'SIGSEGV'])
// Project and task names; the task alone may carry a bounded bracket qualifier, the ABI of a
// native task (`:app:buildCMakeDebug[arm64-v8a]`).
const TASK = /^(?::[A-Za-z0-9_.-]+)+(?:\[[A-Za-z0-9_.-]{1,40}\])?$/
// An xcodebuild failed command as `<command>@<target>`, read from the list xcodebuild prints after
// "The following build commands failed:" (`\tPhaseScriptExecution ... (in target 'hermes-engine'
// from project 'Pods')`). Nightly run 44298434117 failed its iOS Release build with exit 65 and an
// empty record: the task list only knew Gradle's `> Task ... FAILED` lines.
const XCODE_TASK = /^[A-Z][A-Za-z]{1,40}@[A-Za-z0-9_.+-]{1,60}$/
const XCODE_FAILED = /^The following build commands failed:$/
// xcodebuild escapes the spaces of a multi-word command name (`SwiftDriver\ Compilation\
// Requirements`); the words are joined into one identifier, and a name past the bound is dropped.
const XCODE_ENTRY =
  /^\s+([A-Z][A-Za-z]*(?:\\ [A-Za-z]+)*)\s.*\(in target '([^']+)' from project '[^']+'\)\s*$/
// The list ends at its `(N failures)` footer, or at the first line that is not an indented entry.
const XCODE_LIST_END = /^\(\d+ failures?\)$/
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
  value.failedTasks.every(
    (task) => typeof task === 'string' && (TASK.test(task) || XCODE_TASK.test(task))
  )

/** Validate the whole public record before it is copied. */
export function assertNativeBuildFailure(value) {
  if (!closedShape(value) || !closedRun(value) || !closedCause(value)) invalid()
}

/** Gradle's failed task paths, then xcodebuild's listed failed commands, at most ten. */
function failedTaskNames(text) {
  const names = [
    ...[...text.matchAll(/^> Task (\S+) FAILED\s*$/gm)]
      .map((match) => match[1])
      .filter((task) => TASK.test(task)),
  ]
  const lines = text.split('\n')
  const listed = lines.findIndex((line) => XCODE_FAILED.test(line.trim()))
  if (listed > -1)
    for (const line of lines.slice(listed + 1)) {
      if (XCODE_LIST_END.test(line.trim()) || !/^\s/.test(line)) break
      // An entry with no target (`Building workspace ... with scheme ...`) is skipped, not an end.
      const entry = XCODE_ENTRY.exec(line)
      if (!entry) continue
      const task = `${entry[1].replaceAll('\\ ', '')}@${entry[2]}`
      if (XCODE_TASK.test(task)) names.push(task)
    }
  return [...new Set(names)].slice(0, MAX_TASKS)
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
  const failedTasks = failedTaskNames(text)
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
