// A failed step skips every later step that has no status condition. When the failed
// step is a check (lint, typecheck, a test, a gate or a report), the later checks never
// run and their results stay hidden until the first failure is fixed. On 2026-10-27 a
// lint failure hid a red deployment-workflows spec for six runs this way.
//
// The rule: once a job has a check that can fail (no continue-on-error), every later
// step states its condition. An independent check uses `!cancelled()`, which still lets
// a cancelled run stop. A step that consumes an earlier step's output adds
// `steps.<id>.outcome == 'success'` for each such step, so a failed prerequisite still
// skips it. Reporting steps keep `always()`. Every `steps.<id>` a condition names must be
// an earlier step of the same job.
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
    String.raw`\bnode --test\b`,
    String.raw`\bnode scripts/ci/node-test-gate\.mjs\b`,
  ].join('|')
)
const CHECK_NAME =
  /^(fail (if|when)|require|check|run playwright|run burn-in)\b|\b(tests|suite|acceptance|proofs?|evaluation|budgets?|smoke|comment)\b/i
const CHECK_ACTION = /^\.\/\.github\/actions\/[\w-]+-comment$/

export function isCheck(step) {
  return (
    CHECK_COMMAND.test(step.run ?? '') ||
    CHECK_NAME.test(step.name ?? '') ||
    CHECK_ACTION.test(step.uses ?? '')
  )
}

const STATUS = /!\s*cancelled\(\)|\balways\(\)/
const label = (step, index) => step.name ?? step.uses ?? `step ${index + 1}`

/** Every condition that breaks the rule, as `job: step: reason`. */
export function conditionViolations(workflow) {
  const violations = []
  for (const [job, definition] of Object.entries(workflow?.jobs ?? {})) {
    const steps = definition?.steps ?? []
    const first = steps.findIndex((step) => isCheck(step) && !step['continue-on-error'])
    const earlier = new Set()
    for (const [index, step] of steps.entries()) {
      const condition = String(step.if ?? '')
      if (first !== -1 && index > first && !STATUS.test(condition))
        violations.push(
          `${job}: ${label(step, index)}: implicit success() after a check that can fail`
        )
      for (const [, id] of condition.matchAll(/\bsteps\.([A-Za-z0-9_-]+)\./g))
        if (!earlier.has(id))
          violations.push(
            `${job}: ${label(step, index)}: names steps.${id}, which is not an earlier step`
          )
      if (step.id) earlier.add(step.id)
    }
  }
  return violations
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

const PREREQUISITE = /^steps\.[A-Za-z0-9_-]+\.outcome == 'success'$/
const PLATFORM = /^matrix\.platform == '[a-z]+'$/
const NOT_CANCELLED = /^!\s*cancelled\(\)$/

/** The expression inside `${{ }}` and any parentheses that enclose all of it. */
function bare(expression) {
  let text = String(expression)
    .trim()
    .replace(/^\$\{\{([\s\S]*)\}\}$/, '$1')
    .trim()
  while (text.startsWith('(') && closingParen(text) === text.length - 1)
    text = text.slice(1, -1).trim()
  return text
}
function closingParen(text) {
  let depth = 0
  for (const [index, character] of [...text].entries()) {
    depth += character === '(' ? 1 : character === ')' ? -1 : 0
    if (depth === 0) return index
  }
  return -1
}

/** Splits on a top-level `&&` or `||`, outside parentheses and quoted strings. */
export function splitTopLevel(expression, operator) {
  if (!operator) return [expression]
  const parts = []
  let depth = 0
  let quoted = false
  let start = 0
  for (let index = 0; index < expression.length; index++) {
    const character = expression[index]
    if (character === "'") quoted = !quoted
    if (quoted) continue
    if (character === '(') depth++
    if (character === ')') depth--
    if (depth === 0 && expression.startsWith(operator, index)) {
      parts.push(expression.slice(start, index).trim())
      start = index + operator.length
      index += operator.length - 1
    }
  }
  parts.push(expression.slice(start).trim())
  return parts
}

function approvedClause(clause) {
  const text = bare(clause)
  if (NOT_CANCELLED.test(text) || PREREQUISITE.test(text) || PLATFORM.test(text))
    return true
  const branches = splitTopLevel(text, '||')
  // A per-platform choice of prerequisites: each branch names its platform and
  // otherwise only earlier steps that must have succeeded.
  return (
    branches.length > 1 &&
    branches.every((branch) => {
      const terms = splitTopLevel(bare(branch), '&&').map(bare)
      return (
        terms.some((term) => PLATFORM.test(term)) &&
        terms.every((term) => PLATFORM.test(term) || PREREQUISITE.test(term))
      )
    })
  )
}

/**
 * True when a step condition can only skip the step because the run was cancelled,
 * a named earlier prerequisite failed, or the matrix row is another platform. No
 * condition at all is the implicit success() that follows an earlier failure.
 */
export function isExplicitPrerequisiteCondition(condition) {
  if (condition === undefined || condition === null) return true
  if (typeof condition !== 'string' || !condition.trim()) return false
  return splitTopLevel(bare(condition), '&&').every(approvedClause)
}
