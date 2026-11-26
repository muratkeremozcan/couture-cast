#!/usr/bin/env node
// Story CC-7.10 D6 owner: a screen budget limit or `known` entry moves only with a recorded decision.
// Learning path Step 67: Screen budget guard.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-67-screen-budget-guard
//
// Reads packages/utils/src/screen-budget.json and fails when:
// - a limit is above its AC value (CC-7.10 AC2, AC3) without a `limitDecisions` entry allowing
//   it, or the measure's viewport or card size differ from D3 (those have no decision path);
// - a `known` entry is malformed, duplicated, or names a decision that is not recorded under
//   `## Screen budget decisions` in the spec of the story named by its `decidedIn`;
// - a `known` entry is added or raised (higher value, or a new element key), or a limit is
//   raised, citing a decision id the base revision's budget already used, so a raise always
//   needs a new decision. Lowering or deleting needs none (P7). When the base has no budget
//   file, every entry still needs its recorded decision.
//
// The base is `--base <ref>`, else origin/$GITHUB_BASE_REF, else origin/main, taken at its
// merge base with HEAD. In CI an unresolvable base fails; locally it warns and checks without it.
//
// Usage: node scripts/check-screen-budget-decisions.mjs [--base <ref>]
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPOSITORY = fileURLToPath(new URL('../', import.meta.url))
export const BUDGET_PATH = 'packages/utils/src/screen-budget.json'
export const SPEC_DIR = '_bmad-output/implementation-artifacts'
export const DECISIONS_HEADING = '## Screen budget decisions'

/** CC-7.10 AC2 and AC3, as the limits file must hold them unless a decision raises one. */
export const AC_LIMITS = Object.freeze({
  'targets-above-fold': 7,
  'primary-buttons': 1,
  'chip-rows': 1,
  'nested-cards': 0,
  'paragraph-lines': 2,
  'today-height': 1688,
  'closet-chrome': 160,
  'analytics-only': 0,
})

/** D3 measure settings with no decision path: the AC names the viewport, D3 the card size. */
export const PINNED_MEASURE = Object.freeze({
  viewport: Object.freeze({ width: 390, height: 844 }),
  minCardSizePx: 64,
})

export const RULES = Object.freeze(Object.keys(AC_LIMITS))
export const PER_ELEMENT_RULES = Object.freeze([
  'nested-cards',
  'paragraph-lines',
  'analytics-only',
])
export const OWNING_STORIES = Object.freeze(['7.11', '7.13', '7.15', '7.16', '7.17'])

const STORY_ID = /^\d+\.\d+[a-z]?$/
const DECISION_ID = /^D-[A-Z0-9][A-Z0-9.-]*$/

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The text under `## Screen budget decisions`, up to the next level-2 heading. */
export function decisionsSection(markdown) {
  const lines = markdown.split(/\r?\n/)
  const start = lines.findIndex((line) => line.trim() === DECISIONS_HEADING)
  if (start === -1) return null
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((line) => /^##\s/.test(line))
  return (end === -1 ? rest : rest.slice(0, end)).join('\n')
}

/** Whether `id` appears as a whole token in `text` (`D-X-7.1` does not match `D-X-7.10`). */
export function mentionsDecision(text, id) {
  return new RegExp(`(?<![\\w.-])${escape(id)}(?![\\w-]|\\.\\d)`).test(text)
}

/** The spec file of story `7.13`: `<specDir>/spec-7-13-*.md`. */
export function findStorySpec(story, { root = REPOSITORY, specDir = SPEC_DIR } = {}) {
  const prefix = `spec-${story.replace(/\./g, '-')}-`
  const expected = `${specDir}/${prefix}*.md`
  const directory = path.join(root, specDir)
  const matches = fs.existsSync(directory)
    ? fs
        .readdirSync(directory)
        .filter((name) => name.startsWith(prefix) && name.endsWith('.md'))
    : []
  if (matches.length !== 1) return { expected, path: null, matches }
  const relative = `${specDir}/${matches[0]}`
  return {
    expected,
    path: relative,
    matches,
    text: fs.readFileSync(path.join(root, relative), 'utf8'),
  }
}

const knownKey = (entry) =>
  [entry.platform, entry.screen, entry.fixture, entry.rule].join(' ')

/** Keys in `a` beyond those in `b`, counting repeats. */
function extraKeys(a, b) {
  const remaining = new Map()
  for (const key of b) remaining.set(key, (remaining.get(key) ?? 0) + 1)
  return a.filter((key) => {
    const count = remaining.get(key) ?? 0
    if (count > 0) remaining.set(key, count - 1)
    return count === 0
  })
}

function decisionIds(budget) {
  if (!budget) return new Set()
  return new Set(
    [...(budget.known ?? []), ...(budget.limitDecisions ?? [])]
      .map((entry) => entry?.decision)
      .filter((id) => typeof id === 'string')
  )
}

/** Problems with a decision citation: well formed, in its story's spec, under the heading. */
function decisionProblem(decision, decidedIn, lookupSpec) {
  if (typeof decision !== 'string' || !DECISION_ID.test(decision))
    return `decision must be an id like D-KNOWN-7.10, got ${decision}`
  if (typeof decidedIn !== 'string' || !STORY_ID.test(decidedIn))
    return `decidedIn must be a story like 7.10, got ${decidedIn}`
  const spec = lookupSpec(decidedIn)
  if (!spec.path)
    return spec.matches.length
      ? `story ${decidedIn} has ${spec.matches.length} spec files matching ${spec.expected}`
      : `story ${decidedIn} spec file not found: ${spec.expected}`
  const section = decisionsSection(spec.text)
  if (section === null) return `${spec.path} has no "${DECISIONS_HEADING}" section`
  if (!mentionsDecision(section, decision))
    return `decision ${decision} is not recorded under "${DECISIONS_HEADING}" in ${spec.path}`
  return null
}

function measureProblems(measure) {
  const problems = []
  const { width, height } = PINNED_MEASURE.viewport
  if (measure?.viewport?.width !== width || measure?.viewport?.height !== height)
    problems.push(`measure.viewport must be ${width} x ${height} (CC-7.10 AC1)`)
  if (measure?.minCardSizePx !== PINNED_MEASURE.minCardSizePx)
    problems.push(`measure.minCardSizePx must be ${PINNED_MEASURE.minCardSizePx} (D3)`)
  return problems
}

function limitProblems(budget, base, context) {
  const problems = []
  const limits = budget.limits ?? {}
  for (const name of Object.keys(limits))
    if (!RULES.includes(name)) problems.push(`limits.${name} is not a screen budget rule`)
  if (!Array.isArray(budget.limitDecisions))
    problems.push('limitDecisions must be a list')
  const limitDecisions = Array.isArray(budget.limitDecisions) ? budget.limitDecisions : []
  for (const rule of RULES) {
    const value = limits[rule]
    if (!Number.isInteger(value) || value < 0) {
      problems.push(`limits.${rule} must be a whole number of 0 or more, got ${value}`)
      continue
    }
    if (value <= AC_LIMITS[rule]) continue
    const what = `limits.${rule} ${value} (AC ${AC_LIMITS[rule]})`
    const decision = limitDecisions.find(
      (entry) => entry?.limit === rule && Number(entry.value) >= value
    )
    if (!decision) {
      problems.push(
        `${what}: above the AC value without a limitDecisions entry allowing it`
      )
      continue
    }
    const raised = value > (base?.limits?.[rule] ?? AC_LIMITS[rule])
    problems.push(...context.citation(what, decision, raised))
  }
  return problems
}

/** Shape problems of one known entry, or a single "unknown ..." problem. */
function knownShapeProblems(entry, budget) {
  const unknown = []
  if (!(budget.platforms ?? []).includes(entry?.platform))
    unknown.push(`platform ${entry?.platform}`)
  if (!(budget.screens ?? []).includes(entry?.screen))
    unknown.push(`screen ${entry?.screen}`)
  if (!(budget.fixtures ?? []).includes(entry?.fixture))
    unknown.push(`fixture ${entry?.fixture}`)
  if (!RULES.includes(entry?.rule)) unknown.push(`rule ${entry?.rule}`)
  if (!OWNING_STORIES.includes(entry?.story))
    unknown.push(`story ${entry?.story} (owning stories: ${OWNING_STORIES.join(', ')})`)
  return unknown.length ? [`unknown ${unknown.join(', ')}`] : []
}

function knownValueProblems(entry, limits) {
  if (!Number.isInteger(entry.value) || entry.value < 0)
    return [`value must be a whole number, got ${entry.value}`]
  if (PER_ELEMENT_RULES.includes(entry.rule)) {
    const { elements } = entry
    if (
      !Array.isArray(elements) ||
      elements.some((key) => typeof key !== 'string' || !key)
    )
      return ['a per-element rule lists its element keys in elements']
    if (elements.length !== entry.value || entry.value === 0)
      return [
        `value ${entry.value} must equal the ${elements.length} element key(s) and be 1 or more`,
      ]
    return []
  }
  const problems = []
  if (entry.elements !== undefined) problems.push('only per-element rules list elements')
  const limit = limits[entry.rule]
  if (Number.isInteger(limit) && entry.value <= limit)
    problems.push(
      `value ${entry.value} is within the limit ${limit}, so it is not a violation`
    )
  return problems
}

/** Whether `entry` adds to or raises its base entry (`before`, undefined when new). */
function raisesKnown(entry, before) {
  if (!before || entry.value > before.value) return true
  if (!PER_ELEMENT_RULES.includes(entry.rule) || !Array.isArray(entry.elements))
    return false
  return (
    extraKeys(entry.elements, Array.isArray(before.elements) ? before.elements : [])
      .length > 0
  )
}

function knownProblems(budget, base, context) {
  if (!Array.isArray(budget.known)) return ['known must be a list']
  const problems = []
  const baseKnown = new Map((base?.known ?? []).map((entry) => [knownKey(entry), entry]))
  const seen = new Set()
  budget.known.forEach((entry, index) => {
    const what = `known[${index}] ${knownKey(entry ?? {})}`
    const shape = knownShapeProblems(entry, budget)
    if (shape.length) {
      problems.push(...shape.map((problem) => `${what}: ${problem}`))
      return
    }
    const key = knownKey(entry)
    if (seen.has(key)) problems.push(`${what}: duplicate entry`)
    seen.add(key)
    problems.push(
      ...knownValueProblems(entry, budget.limits ?? {}).map(
        (problem) => `${what}: ${problem}`
      )
    )
    problems.push(
      ...context.citation(what, entry, raisesKnown(entry, baseKnown.get(key)))
    )
  })
  return problems
}

/**
 * Every problem with `budget` against its base. `base` is the base revision's budget, or null
 * when the base has none. Spec files are read from `root`/`specDir`.
 */
export function checkScreenBudgetDecisions({
  budget,
  base = null,
  root = REPOSITORY,
  specDir = SPEC_DIR,
}) {
  const specs = new Map()
  const lookupSpec = (story) => {
    if (!specs.has(story)) specs.set(story, findStorySpec(story, { root, specDir }))
    return specs.get(story)
  }
  const baseIds = decisionIds(base)
  const context = {
    /** A cited decision must be recorded; a raise must cite one the base did not use. */
    citation(what, { decision, decidedIn }, raised) {
      const problem = decisionProblem(decision, decidedIn, lookupSpec)
      if (problem) return [`${what}: ${problem}`]
      if (raised && baseIds.has(decision))
        return [
          `${what}: raised or added under decision ${decision}, which the base already used;` +
            ' record a new decision',
        ]
      return []
    },
  }
  return [
    ...measureProblems(budget.measure),
    ...limitProblems(budget, base, context),
    ...knownProblems(budget, base, context),
  ]
}

const git = (args, root) =>
  spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })

/**
 * The base budget: `{ budget, description }`, `budget` null when the base has no file. Throws
 * when the base revision cannot be found.
 */
export function loadBaseBudget({ root = REPOSITORY, ref } = {}) {
  const wanted =
    ref ??
    (process.env.GITHUB_BASE_REF
      ? `origin/${process.env.GITHUB_BASE_REF}`
      : 'origin/main')
  const commit = git(['rev-parse', '--verify', '--quiet', `${wanted}^{commit}`], root)
  if (commit.status !== 0) throw new Error(`base revision ${wanted} not found`)
  const mergeBase = git(['merge-base', 'HEAD', commit.stdout.trim()], root)
  const revision = mergeBase.status === 0 ? mergeBase.stdout.trim() : commit.stdout.trim()
  const description = `${wanted} at ${revision.slice(0, 12)}`
  const shown = git(['show', `${revision}:${BUDGET_PATH}`], root)
  if (shown.status !== 0)
    return { budget: null, description: `${description} (no budget file)` }
  return { budget: JSON.parse(shown.stdout), description }
}

function main(argv) {
  let ref
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--base') {
      ref = argv[index + 1]
      index += 1
    } else {
      console.error(`check-screen-budget-decisions: unknown argument ${argv[index]}`)
      return 2
    }
  }
  const budget = JSON.parse(fs.readFileSync(path.join(REPOSITORY, BUDGET_PATH), 'utf8'))
  let base = null
  let description = 'none'
  try {
    ;({ budget: base, description } = loadBaseBudget({ ref }))
  } catch (error) {
    if (process.env.CI) {
      console.error(
        `check-screen-budget-decisions: ${error.message}; fetch it (fetch-depth: 0)`
      )
      return 1
    }
    console.warn(
      `check-screen-budget-decisions: ${error.message}; every entry needs its recorded decision`
    )
  }
  const problems = checkScreenBudgetDecisions({ budget, base })
  for (const problem of problems) console.error(`${BUDGET_PATH}: ${problem}`)
  if (problems.length) {
    console.error(`\ncheck-screen-budget-decisions: ${problems.length} problem(s)`)
    return 1
  }
  console.log(`check-screen-budget-decisions: clean (base: ${description})`)
  return 0
}

if (
  process.argv[1] &&
  fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = main(process.argv.slice(2))
}
