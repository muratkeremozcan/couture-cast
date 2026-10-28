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
      for (const problem of matrixReferenceProblems(
        condition,
        definition?.strategy?.matrix
      ))
        violations.push(`${job}: ${label(step, index)}: ${problem}`)
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

const PREREQUISITE = /^steps\.([A-Za-z0-9_-]+)\.outcome == 'success'$/
const MATRIX = /^matrix\.([A-Za-z0-9_-]+) == '([^']*)'$/
const NOT_CANCELLED = /^!\s*cancelled\(\)$/

function unwrapExpression(expression) {
  return String(expression)
    .trim()
    .replace(/^\$\{\{([\s\S]*)\}\}$/, '$1')
    .trim()
}
function closingParen(text) {
  let depth = 0
  for (const [index, character] of [...text].entries()) {
    depth += character === '(' ? 1 : character === ')' ? -1 : 0
    if (depth === 0) return index
  }
  return -1
}
const enclosed = (text) => text.startsWith('(') && closingParen(text) === text.length - 1
function bare(text) {
  let value = text.trim()
  while (enclosed(value)) value = value.slice(1, -1).trim()
  return value
}

/** Splits on a top-level `&&` or `||`, outside parentheses and quoted strings. */
export function splitTopLevel(expression, operator) {
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

function atom(text) {
  const value = bare(text)
  if (NOT_CANCELLED.test(value)) return { kind: 'notCancelled' }
  const outcome = PREREQUISITE.exec(value)
  if (outcome) return { kind: 'outcome', id: outcome[1] }
  const matrix = MATRIX.exec(value)
  if (matrix) return { kind: 'matrix', key: matrix[1], value: matrix[2] }
  return null
}

// One branch of a per-row choice: exactly one matrix clause and only prerequisites.
function branch(text) {
  const terms = splitTopLevel(bare(text), '&&').map(atom)
  const rows = terms.filter((term) => term?.kind === 'matrix')
  if (terms.some((term) => term?.kind !== 'matrix' && term?.kind !== 'outcome'))
    return null
  if (rows.length !== 1) return null
  return {
    key: rows[0].key,
    value: rows[0].value,
    outcomes: terms.filter((term) => term.kind === 'outcome').map((term) => term.id),
  }
}

function term(text) {
  const simple = atom(text)
  if (simple) return simple
  // A choice must be written as its own parenthesized term.
  if (!enclosed(text.trim())) return null
  const branches = splitTopLevel(bare(text), '||')
  if (branches.length < 2) return null
  const parsed = branches.map(branch)
  if (parsed.some((item) => item === null)) return null
  if (new Set(parsed.map((item) => `${item.key}=${item.value}`)).size !== parsed.length)
    return null
  return { kind: 'choice', branches: parsed }
}

/**
 * The values each matrix key can take in a job: its own array, plus every
 * `include` entry. A key whose values come from an expression accepts any value.
 */
export function matrixDomain(matrix) {
  const domain = new Map()
  if (!matrix || typeof matrix !== 'object') return domain
  const add = (key, value) => {
    if (!domain.has(key)) domain.set(key, new Set())
    domain.get(key)?.add(String(value))
  }
  for (const [key, values] of Object.entries(matrix)) {
    if (key === 'include' || key === 'exclude') continue
    if (Array.isArray(values)) for (const value of values) add(key, value)
    else domain.set(key, null)
  }
  for (const entry of Array.isArray(matrix.include) ? matrix.include : [])
    for (const [key, value] of Object.entries(entry ?? {}))
      if (domain.get(key) !== null) add(key, value)
  return domain
}

/** Every `matrix.<key>` a condition names that the job's matrix cannot produce. */
export function matrixReferenceProblems(condition, matrix) {
  const text = String(condition ?? '')
  const domain = matrixDomain(matrix)
  const problems = []
  for (const [, key] of text.matchAll(/\bmatrix\.([A-Za-z0-9_-]+)/g))
    if (!domain.has(key)) problems.push(`matrix.${key} is not a key of the job matrix`)
  for (const [, key, value] of text.matchAll(
    /\bmatrix\.([A-Za-z0-9_-]+)\s*[!=]=\s*'([^']*)'/g
  )) {
    const values = domain.get(key)
    if (values && !values.has(value))
      problems.push(`matrix.${key} is never '${value}' in the job matrix`)
  }
  return [...new Set(problems)]
}

/**
 * The approved explicit-prerequisite grammar, or null for anything else:
 *   condition := term ('&&' term)*
 *   term      := '!cancelled()' | prerequisite | row | '(' choice ')'
 *   choice    := branch ('||' branch)+, each branch one distinct row clause and
 *                otherwise only prerequisites
 * where prerequisite is `steps.<id>.outcome == 'success'` and row is
 * `matrix.<key> == '<value>'` naming a key and value the job's matrix produces.
 * `&&` binds tighter than `||`, so any top-level `||` (`|| always()`, `|| true`) is
 * outside the grammar.
 */
export function parseApprovedCondition(condition, { matrix } = {}) {
  if (typeof condition !== 'string' || !condition.trim()) return null
  if (matrixReferenceProblems(condition, matrix).length) return null
  const text = unwrapExpression(condition)
  if (splitTopLevel(text, '||').length !== 1) return null
  const terms = splitTopLevel(text, '&&').map(term)
  return terms.some((item) => item === null) ? null : terms
}

/**
 * True when a step condition can only skip the step because the run was cancelled,
 * a named earlier prerequisite failed, or the matrix row is another platform. No
 * condition at all is the implicit success() that follows an earlier failure.
 */
export function isExplicitPrerequisiteCondition(condition, { matrix } = {}) {
  return condition === undefined || condition === null
    ? true
    : parseApprovedCondition(condition, { matrix }) !== null
}

/** Evaluates an approved condition against step outcomes and one matrix row. */
export function evaluateApprovedCondition(
  condition,
  { cancelled = false, outcomes = {}, matrix, row = {}, previousSucceeded = true }
) {
  if (condition === undefined || condition === null)
    return !cancelled && previousSucceeded
  const terms = parseApprovedCondition(condition, { matrix })
  if (!terms) throw new Error(`condition outside the approved grammar: ${condition}`)
  const succeeded = (id) => outcomes[id] === 'success'
  return terms.every((item) => {
    if (item.kind === 'notCancelled') return !cancelled
    if (item.kind === 'outcome') return succeeded(item.id)
    if (item.kind === 'matrix') return String(row[item.key]) === item.value
    return item.branches.some(
      (choice) =>
        String(row[choice.key]) === choice.value && choice.outcomes.every(succeeded)
    )
  })
}
