// A failed step skips every later step that has no status condition. When the failed
// step is a check (lint, typecheck, a test, a gate or a report), the later checks never
// run and their results stay hidden until the first failure is fixed. On 2026-10-27 a
// lint failure hid a red deployment-workflows spec for six runs this way.
//
// The rule: once a job has a check that can fail (no continue-on-error), every later
// step up to the job's last check carries `!cancelled()` or `always()`. Setup steps in
// that range need it too, because the checks after them depend on them. `!cancelled()`
// still lets a cancelled run stop.
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { parse } from 'yaml'

const CHECK_COMMAND = new RegExp(
  [
    String.raw`\bnpm (run )?test\b`,
    String.raw`\bnpm run (lint|typecheck|test[\w:-]*|check:[\w:-]+|optic:(lint|diff))\b`,
    String.raw`\bvitest\b`,
    String.raw`\bplaywright test\b`,
    String.raw`\bxcodebuild\b[^\n]*\btest\b`,
    String.raw`\bgit diff --exit-code\b`,
    String.raw`\bscripts/ci/check-[\w-]+\.sh\b`,
    String.raw`\bscripts/ci/share-card-header-semantics\.sh\b`,
    String.raw`\brun-story68-native\.mjs (proof|matrix)\b`,
  ].join('|')
)
const CHECK_NAME =
  /^(fail (if|when)|require|check|run playwright|run burn-in)\b|\b(tests|suite|acceptance|proofs?|evaluation|budgets?|smoke|comment)\b/i
const CHECK_ACTION = /^\.\/\.github\/actions\/[\w-]+-comment$/

/**
 * Steps this rule does not own. `node --test` steps are gated by their own change, and
 * the KVM step keeps its existing condition.
 */
export function exempt(step) {
  return (
    /\bnode --test\b/.test(step.run ?? '') ||
    /^Enable and verify Android hardware acceleration\b/.test(step.name ?? '')
  )
}

export function isCheck(step) {
  if (exempt(step)) return false
  return (
    CHECK_COMMAND.test(step.run ?? '') ||
    CHECK_NAME.test(step.name ?? '') ||
    CHECK_ACTION.test(step.uses ?? '')
  )
}

export function runsAfterFailure(step) {
  return /!\s*cancelled\(\)|\balways\(\)/.test(String(step.if ?? ''))
}

const label = (step, index) => step.name ?? step.uses ?? `step ${index + 1}`

/** Every step a preceding failed check would silently skip, as `job: step`. */
export function shadowedSteps(workflow) {
  const shadowed = []
  for (const [job, definition] of Object.entries(workflow?.jobs ?? {})) {
    const steps = definition?.steps ?? []
    const first = steps.findIndex((step) => isCheck(step) && !step['continue-on-error'])
    if (first === -1) continue
    const last = steps.findLastIndex((step) => isCheck(step))
    for (let index = first + 1; index <= last; index++) {
      const step = steps[index]
      if (exempt(step) || runsAfterFailure(step)) continue
      shadowed.push(`${job}: ${label(step, index)}`)
    }
  }
  return shadowed
}

/** Workflows that run on pull requests directly or are called by one. */
export function requiredWorkflows(directory) {
  return readdirSync(directory)
    .filter((file) => file.endsWith('.yml'))
    .sort()
    .map((file) => ({
      file,
      workflow: parse(readFileSync(path.join(directory, file), 'utf8')),
    }))
    .filter(({ workflow }) => {
      const on = workflow?.on
      const events =
        typeof on === 'string' ? [on] : Array.isArray(on) ? on : Object.keys(on ?? {})
      return events.some((event) =>
        ['pull_request', 'pull_request_target', 'workflow_call'].includes(event)
      )
    })
}
