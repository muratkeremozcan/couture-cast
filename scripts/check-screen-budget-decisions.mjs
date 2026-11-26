#!/usr/bin/env node
// Story CC-7.10 D6 owner: a screen budget limit or `known` entry moves only with a recorded decision.
// Learning path Step 67: Screen budget guard.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-67-screen-budget-guard
//
// Reads packages/utils/src/screen-budget.json and fails when:
// - the measure's viewport or card size differ from D3 (those have no decision path);
// - a limit is raised above its merge-base value (the AC value when the base has no file), or
//   sits above its AC value, without a `limitDecisions` entry allowing it;
// - a `known` entry is malformed or duplicated;
// - a cited decision is not recorded as a term line under `## Screen budget decisions` in the
//   spec of the story named by its `decidedIn`, or the JSON value falls outside every term the
//   decision records. A term binds a rule, a scope and a ceiling (review #2):
//     - D-ID: `rule=<rule> scope=<platform>/<screen>/<fixture> max=<value> [lines=<value>]`
//     - D-ID: `rule=<rule> scope=limit max=<value>`
//   Any scope segment may be `*`. `max` caps a known value (or the limit), `lines` caps every
//   paragraph of a `paragraph-lines` entry and is required there. One decision may record
//   several terms; a line whose text after `D-ID:` does not start with `rule=` is prose, and a
//   line inside a fenced code block or an HTML comment is neither a term nor a mention;
// - an increase against the base (a raised limit, an added `known` entry, a raised known value,
//   a new element key, a known paragraph with more lines) cites a decision id the base
//   revision's budget, or the base branch's tip, already used, so every increase needs a new
//   decision. Lowering or deleting needs none (P7). When the base has no budget file, every entry
//   still needs its recorded decision and its terms.
//
// The base is `--base <ref>`, else origin/$GITHUB_BASE_REF, else origin/main, taken at its
// merge base with HEAD; raises are measured against the merge base. In CI a base that cannot be
// found, or that shares no merge base with HEAD, fails; locally it warns and checks without it.
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

/**
 * CC-7.10 AC2 and AC3: the reference for a limit when the base has no budget file, and the
 * values above which a limit needs a `limitDecisions` entry.
 */
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
/**
 * `- D-ID: rule=...`, the term body optionally in backticks so Markdown keeps `*` as is; text
 * after the closing backtick is a note.
 */
const TERM_LINE =
  /^\s*[-*]\s+(D-[A-Z0-9][A-Z0-9.-]*):\s+(?:`(rule=[^`]*)`.*|(rule=.*?))\s*$/
const WHOLE_NUMBER = /^\d+$/

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const FENCE = /^ {0,3}(`{3,}|~{3,})/

/**
 * The document's lines with fenced code blocks and HTML comments blanked, so an example shown
 * in a fence or a comment is neither a heading nor a decision (CodeRabbit r1). A fence closes
 * with a run of its own character at least as long, and an unclosed one runs to the end, as in
 * CommonMark.
 */
function renderedLines(markdown) {
  const lines = markdown.replace(/<!--[\s\S]*?(?:-->|$)/g, (comment) =>
    comment.replace(/[^\n]/g, '')
  )
  let fence = null
  return lines.split(/\r?\n/).map((line) => {
    const marker = FENCE.exec(line)?.[1]
    if (fence) {
      const closes =
        marker &&
        marker[0] === fence[0] &&
        marker.length >= fence.length &&
        !line.trim().slice(marker.length).trim()
      if (closes) fence = null
      return ''
    }
    if (
      marker &&
      !(marker[0] === '`' && line.trim().slice(marker.length).includes('`'))
    ) {
      fence = marker
      return ''
    }
    return line
  })
}

/**
 * The text under `## Screen budget decisions`, up to the next level-2 heading, outside fenced
 * code blocks and HTML comments.
 */
export function decisionsSection(markdown) {
  const lines = renderedLines(markdown)
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

/**
 * The decision terms recorded in a decisions section, by decision id. Each term is
 * `{ rule, scope, max, lines, problem }`: `scope` is `'limit'` or `[platform, screen, fixture]`,
 * `problem` names what is malformed (the term then covers nothing).
 */
export function decisionTerms(section) {
  const terms = new Map()
  for (const line of renderedLines(section)) {
    const match = TERM_LINE.exec(line)
    if (!match) continue
    const [, id, quoted, bare] = match
    const body = quoted ?? bare
    const fields = Object.fromEntries(
      body
        .trim()
        .split(/\s+/)
        .map((token) => {
          const at = token.indexOf('=')
          return at === -1 ? [token, ''] : [token.slice(0, at), token.slice(at + 1)]
        })
    )
    const term = { text: body.trim(), ...parseTerm(fields) }
    terms.set(id, [...(terms.get(id) ?? []), term])
  }
  return terms
}

function parseTerm(fields) {
  const extra = Object.keys(fields).filter(
    (name) => !['rule', 'scope', 'max', 'lines'].includes(name)
  )
  if (extra.length) return { problem: `unknown field(s) ${extra.join(', ')}` }
  if (!RULES.includes(fields.rule)) return { problem: `unknown rule ${fields.rule}` }
  if (!WHOLE_NUMBER.test(fields.max ?? ''))
    return { problem: 'max must be a whole number' }
  if (fields.lines !== undefined && !WHOLE_NUMBER.test(fields.lines))
    return { problem: 'lines must be a whole number' }
  const term = {
    rule: fields.rule,
    max: Number(fields.max),
    lines: fields.lines === undefined ? undefined : Number(fields.lines),
  }
  const scope = parseScope(fields.scope, term)
  return scope.problem ? scope : { ...term, scope: scope.scope }
}

/** A term's `{ scope }` (`'limit'` or `[platform, screen, fixture]`), or its `{ problem }`. */
function parseScope(text, term) {
  if (text === 'limit')
    return term.lines === undefined
      ? { scope: 'limit' }
      : { problem: 'a limit term takes no lines' }
  const scope = (text ?? '').split('/')
  if (scope.length !== 3 || scope.some((part) => !part))
    return { problem: 'scope must be limit or <platform>/<screen>/<fixture>' }
  if (isParagraphRule(term.rule) && term.lines === undefined)
    return { problem: 'a paragraph-lines term records lines' }
  if (!isParagraphRule(term.rule) && term.lines !== undefined)
    return { problem: 'only a paragraph-lines term records lines' }
  return { scope }
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

const isParagraphRule = (rule) => rule === 'paragraph-lines'

/** A known entry's element keys, whatever its rule's element shape. */
const elementKeys = (entry) =>
  (Array.isArray(entry?.elements) ? entry.elements : []).map((element) =>
    typeof element === 'string' ? element : element?.key
  )

/** A paragraph-lines entry's `[key, lines]` pairs (lines undefined in the old string shape). */
const paragraphLines = (entry) =>
  (Array.isArray(entry?.elements) ? entry.elements : []).map((element) =>
    typeof element === 'string' ? [element, undefined] : [element?.key, element?.lines]
  )

/** The decision ids `budgets` cite in `known` and `limitDecisions`. */
function decisionIds(...budgets) {
  return new Set(
    budgets
      .flatMap((budget) => [...(budget?.known ?? []), ...(budget?.limitDecisions ?? [])])
      .map((entry) => entry?.decision)
      .filter((id) => typeof id === 'string')
  )
}

/**
 * A decision citation's recorded terms, or the problem with it: well formed, in its story's
 * spec, under the heading, with at least one term line.
 */
function decisionRecord(decision, decidedIn, lookupSpec) {
  if (typeof decision !== 'string' || !DECISION_ID.test(decision))
    return { problem: `decision must be an id like D-KNOWN-7.10, got ${decision}` }
  if (typeof decidedIn !== 'string' || !STORY_ID.test(decidedIn))
    return { problem: `decidedIn must be a story like 7.10, got ${decidedIn}` }
  const spec = lookupSpec(decidedIn)
  if (!spec.path)
    return {
      problem: spec.matches.length
        ? `story ${decidedIn} has ${spec.matches.length} spec files matching ${spec.expected}`
        : `story ${decidedIn} spec file not found: ${spec.expected}`,
    }
  const section = decisionsSection(spec.text)
  if (section === null)
    return { problem: `${spec.path} has no "${DECISIONS_HEADING}" section` }
  if (!mentionsDecision(section, decision))
    return {
      problem: `decision ${decision} is not recorded under "${DECISIONS_HEADING}" in ${spec.path}`,
    }
  const terms = decisionTerms(section).get(decision) ?? []
  if (!terms.length)
    return {
      problem:
        `decision ${decision} in ${spec.path} records no term line ` +
        `("- ${decision}: \`rule=<rule> scope=<platform>/<screen>/<fixture> max=<value>\`")`,
    }
  const malformed = terms.find((term) => term.problem)
  if (malformed)
    return {
      problem: `decision ${decision} term "${malformed.text}" in ${spec.path}: ${malformed.problem}`,
    }
  return { terms, path: spec.path }
}

const scopeMatches = (scope, entry) =>
  Array.isArray(scope) &&
  [entry.platform, entry.screen, entry.fixture].every(
    (value, index) => scope[index] === '*' || scope[index] === value
  )

const termText = (decision, term) => `${decision} "${term.text}"`

/** Whether a recorded term covers a known entry; the problem when none does. */
function knownCoverage(entry, decision, terms) {
  const scoped = terms.filter(
    (term) => term.rule === entry.rule && scopeMatches(term.scope, entry)
  )
  if (!scoped.length)
    return (
      `decision ${decision} records no term for rule ${entry.rule} scope ` +
      `${entry.platform}/${entry.screen}/${entry.fixture}`
    )
  const within = scoped.find((term) => {
    if (entry.value > term.max) return false
    if (!isParagraphRule(entry.rule)) return true
    // A malformed count is reported by the entry's value check.
    return paragraphLines(entry).every(
      ([, lines]) => !Number.isInteger(lines) || lines <= term.lines
    )
  })
  if (within) return null
  const term = scoped[0]
  if (entry.value > term.max)
    return `value ${entry.value} is above the max ${term.max} of ${termText(decision, term)}`
  const longest = Math.max(
    ...paragraphLines(entry)
      .map(([, lines]) => lines)
      .filter(Number.isInteger)
  )
  return `a paragraph of ${longest} lines is above the lines ${term.lines} of ${termText(decision, term)}`
}

/** Whether a recorded `scope=limit` term covers a limit value; the problem when none does. */
function limitCoverage(rule, value, decision, terms) {
  const scoped = terms.filter((term) => term.rule === rule && term.scope === 'limit')
  if (!scoped.length)
    return `decision ${decision} records no term for rule ${rule} scope limit`
  if (scoped.some((term) => value <= term.max)) return null
  return `limit ${value} is above the max ${scoped[0].max} of ${termText(decision, scoped[0])}`
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

/** A limit's reference: its merge-base value, else the AC value when the base has none. */
function baseLimit(base, rule) {
  const value = base?.limits?.[rule]
  return Number.isInteger(value) && value >= 0 ? value : AC_LIMITS[rule]
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
    const before = baseLimit(base, rule)
    // Review #2: every raise against the base needs a decision, a raise back to the AC value
    // after a story lowered the limit included.
    const raised = value > before
    if (!raised && value <= AC_LIMITS[rule]) continue
    const what = `limits.${rule} ${value} (base ${before}, AC ${AC_LIMITS[rule]})`
    const candidates = limitDecisions.filter(
      (entry) => entry?.limit === rule && Number(entry.value) >= value
    )
    if (!candidates.length) {
      problems.push(
        `${what}: ${raised ? `raised from ${before}` : 'above the AC value'} without a` +
          ' limitDecisions entry allowing it'
      )
      continue
    }
    // Any entry that passes allows the limit, whatever the order: an older entry with a higher
    // JSON ceiling does not hide the new decision that allows the raise (CodeRabbit r1).
    const verdicts = candidates.map((decision) =>
      context.citation(what, decision, raised, (id, terms) =>
        limitCoverage(rule, value, id, terms)
      )
    )
    if (verdicts.some((verdict) => verdict.length === 0)) continue
    problems.push(...verdicts.flat())
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

function withinLimit(entry, limits) {
  const limit = limits[entry.rule]
  return Number.isInteger(limit) && entry.value <= limit
    ? [`value ${entry.value} is within the limit ${limit}, so it is not a violation`]
    : []
}

function knownValueProblems(entry, limits) {
  if (!Number.isInteger(entry.value) || entry.value < 0)
    return [`value must be a whole number, got ${entry.value}`]
  if (PER_ELEMENT_RULES.includes(entry.rule)) {
    const { elements } = entry
    if (isParagraphRule(entry.rule)) {
      const lineLimit = limits['paragraph-lines']
      if (
        !Array.isArray(elements) ||
        elements.some(
          (element) =>
            typeof element?.key !== 'string' ||
            !element.key ||
            !Number.isInteger(element.lines)
        )
      )
        return [
          'a paragraph-lines entry lists each paragraph as { "key": ..., "lines": <measured lines> }',
        ]
      const short = elements.find((element) => element.lines <= lineLimit)
      if (short)
        return [
          `paragraph ${short.key} has ${short.lines} lines, within the limit ${lineLimit}, so it is not a violation`,
        ]
    } else if (
      !Array.isArray(elements) ||
      elements.some((key) => typeof key !== 'string' || !key)
    )
      return ['a per-element rule lists its element keys in elements']
    if (elements.length !== entry.value || entry.value === 0)
      return [
        `value ${entry.value} must equal the ${elements.length} element key(s) and be 1 or more`,
      ]
    // A paragraph-lines limit counts lines, not paragraphs; each paragraph's lines are checked
    // above. The other per-element rules count elements, so the value must exceed the limit as
    // the audit's violation does (CodeRabbit r1).
    return isParagraphRule(entry.rule) ? [] : withinLimit(entry, limits)
  }
  return [
    ...(entry.elements !== undefined ? ['only per-element rules list elements'] : []),
    ...withinLimit(entry, limits),
  ]
}

/** Whether a paragraph-lines entry gives a known paragraph more lines than its base entry. */
function raisesLines(entry, before) {
  const byKey = (pairs) => {
    const groups = new Map()
    for (const [key, lines] of pairs) groups.set(key, [...(groups.get(key) ?? []), lines])
    for (const group of groups.values()) group.sort((a, b) => (b ?? -1) - (a ?? -1))
    return groups
  }
  const recorded = byKey(paragraphLines(before))
  for (const [key, counts] of byKey(paragraphLines(entry))) {
    const previous = recorded.get(key) ?? []
    // A new repeat of a key is a raise. A base paragraph in the old string shape records no
    // count, so recording its count migrates the entry and raises nothing.
    if (counts.length > previous.length) return true
    if (
      counts.some(
        (lines, index) => previous[index] !== undefined && lines > previous[index]
      )
    )
      return true
  }
  return false
}

/** Whether `entry` adds to or raises its base entry (`before`, undefined when new). */
function raisesKnown(entry, before) {
  if (!before || entry.value > before.value) return true
  if (!PER_ELEMENT_RULES.includes(entry.rule) || !Array.isArray(entry.elements))
    return false
  if (extraKeys(elementKeys(entry), elementKeys(before)).length > 0) return true
  return isParagraphRule(entry.rule) && raisesLines(entry, before)
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
      ...context.citation(
        what,
        entry,
        raisesKnown(entry, baseKnown.get(key)),
        (id, terms) => knownCoverage(entry, id, terms)
      )
    )
  })
  return problems
}

/**
 * Every problem with `budget` against its base. `base` is the merge-base budget, or null when
 * the base has none; raises are measured against it. `baseTip` is the base branch's budget at
 * its tip: a decision it cites, added after the fork point, is used too, so a raise cannot
 * re-cite it (CodeRabbit r1). Spec files are read from `root`/`specDir`.
 */
export function checkScreenBudgetDecisions({
  budget,
  base = null,
  baseTip = null,
  root = REPOSITORY,
  specDir = SPEC_DIR,
}) {
  const specs = new Map()
  const lookupSpec = (story) => {
    if (!specs.has(story)) specs.set(story, findStorySpec(story, { root, specDir }))
    return specs.get(story)
  }
  const baseIds = decisionIds(base, baseTip)
  const context = {
    /**
     * A cited decision must be recorded with a term that covers the value (`covers` returns the
     * problem when none does); a raise must cite one the base did not use.
     */
    citation(what, { decision, decidedIn }, raised, covers) {
      const record = decisionRecord(decision, decidedIn, lookupSpec)
      if (record.problem) return [`${what}: ${record.problem}`]
      const problems = []
      const uncovered = covers(decision, record.terms)
      if (uncovered) problems.push(`${what}: ${uncovered} (${record.path})`)
      if (raised && baseIds.has(decision))
        problems.push(
          `${what}: raised or added under decision ${decision}, which the base already used;` +
            ' record a new decision'
        )
      return problems
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

/** The budget file at `revision`, or null when that revision has none. */
function budgetAt(revision, root) {
  const shown = git(['show', `${revision}:${BUDGET_PATH}`], root)
  return shown.status === 0 ? JSON.parse(shown.stdout) : null
}

/**
 * The base budgets: `{ budget, tip, description }`. `budget` is the file at the merge base of
 * HEAD and the base ref, `tip` the file at the ref itself; each is null when that revision has
 * none. Throws when the ref cannot be found or shares no merge base with HEAD (a shallow or
 * unrelated history): the tip is not a merge base, so it never stands in for one (CodeRabbit r1).
 */
export function loadBaseBudget({ root = REPOSITORY, ref } = {}) {
  const wanted =
    ref ??
    (process.env.GITHUB_BASE_REF
      ? `origin/${process.env.GITHUB_BASE_REF}`
      : 'origin/main')
  const commit = git(['rev-parse', '--verify', '--quiet', `${wanted}^{commit}`], root)
  if (commit.status !== 0) throw new Error(`base revision ${wanted} not found`)
  const tipRevision = commit.stdout.trim()
  const mergeBase = git(['merge-base', 'HEAD', tipRevision], root)
  if (mergeBase.status !== 0) throw new Error(`no merge base between HEAD and ${wanted}`)
  const revision = mergeBase.stdout.trim()
  const description = `${wanted} at ${revision.slice(0, 12)}`
  const budget = budgetAt(revision, root)
  return {
    budget,
    tip: budgetAt(tipRevision, root),
    description: budget ? description : `${description} (no budget file)`,
  }
}

function main(argv) {
  let ref
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--base') {
      const value = argv[index + 1]
      // A missing ref would silently fall back to the default base.
      if (!value || value.startsWith('-')) {
        console.error('check-screen-budget-decisions: --base needs a ref')
        return 2
      }
      ref = value
      index += 1
    } else {
      console.error(`check-screen-budget-decisions: unknown argument ${argv[index]}`)
      return 2
    }
  }
  const budget = JSON.parse(fs.readFileSync(path.join(REPOSITORY, BUDGET_PATH), 'utf8'))
  let base = null
  let baseTip = null
  let description = 'none'
  try {
    ;({ budget: base, tip: baseTip, description } = loadBaseBudget({ ref }))
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
  const problems = checkScreenBudgetDecisions({ budget, base, baseTip })
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
