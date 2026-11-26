// Story CC-7.10 D6: a screen budget limit or `known` entry moves only with a recorded decision.
// Cases 7.10-DEC-001..008 from _bmad-output/test-artifacts/test-design-7-10-screen-budget-guard.md.
// Learning path Step 67: Screen budget guard.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-67-screen-budget-guard
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  AC_LIMITS,
  BUDGET_PATH,
  checkScreenBudgetDecisions,
  decisionsSection,
  mentionsDecision,
  PER_ELEMENT_RULES,
  RULES,
  SPEC_DIR,
} from './check-screen-budget-decisions.mjs'

const repository = fileURLToPath(new URL('../', import.meta.url))
const script = fileURLToPath(
  new URL('./check-screen-budget-decisions.mjs', import.meta.url)
)
const checkedIn = JSON.parse(fs.readFileSync(path.join(repository, BUDGET_PATH), 'utf8'))

/** The checked-in budget with `known` and `limitDecisions` replaced. */
function budgetWith({ limits = {}, known = [], limitDecisions = [] } = {}) {
  return structuredClone({
    ...checkedIn,
    limits: { ...checkedIn.limits, ...limits },
    known,
    limitDecisions,
  })
}

const SPEC_7_10 = [
  '# Story CC-7.10',
  '',
  '## Screen budget decisions',
  '',
  '- D-KNOWN-7.10 (owner delegated): the measured violations are accepted as known.',
  '',
  '## Design Notes',
  '',
  'Mentions D-LATER-7.10 outside the decisions section.',
  '',
].join('\n')

const SPEC_7_13 = [
  '# Story CC-7.13',
  '',
  'D-LIMIT-7.13 is discussed here, above the section.',
  '',
  '## Screen budget decisions',
  '',
  '- D-TARGETS-7.13 (owner, 2026-12-01): Today may show eight targets.',
  '',
].join('\n')

const roots = []
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

/** A temp repository root holding the two story specs above. */
function specRoot(
  files = {
    'spec-7-10-screen-budget-guard.md': SPEC_7_10,
    'spec-7-13-calm-today.md': SPEC_7_13,
  }
) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'screen-budget-decisions-'))
  roots.push(root)
  fs.mkdirSync(path.join(root, SPEC_DIR), { recursive: true })
  for (const [name, text] of Object.entries(files))
    fs.writeFileSync(path.join(root, SPEC_DIR, name), text)
  return root
}

const check = (budget, base, root = specRoot()) =>
  checkScreenBudgetDecisions({ budget, base, root })

/** A recorded `known` entry: Today on web, populated, over the target limit. */
const knownTargets = (overrides = {}) => ({
  platform: 'web',
  screen: 'today',
  fixture: 'populated',
  rule: 'targets-above-fold',
  value: 9,
  story: '7.13',
  decision: 'D-KNOWN-7.10',
  decidedIn: '7.10',
  ...overrides,
})

const knownParagraphs = (elements, overrides = {}) => ({
  platform: 'web',
  screen: 'today',
  fixture: 'empty',
  rule: 'paragraph-lines',
  value: elements.length,
  elements,
  story: '7.17',
  decision: 'D-KNOWN-7.10',
  decidedIn: '7.10',
  ...overrides,
})

describe('check-screen-budget-decisions', () => {
  test('7.10-DEC-001 limits at the AC values and no known change pass', () => {
    assert.deepEqual(checkedIn.limits, AC_LIMITS)
    assert.deepEqual(check(budgetWith(), budgetWith()), [])
    assert.deepEqual(check(budgetWith(), null), [])
    const base = budgetWith({ known: [knownTargets()] })
    assert.deepEqual(check(budgetWith({ known: [knownTargets()] }), base), [])
  })

  test('7.10-DEC-001 the checked-in budget is clean against HEAD', () => {
    const result = spawnSync(process.execPath, [script, '--base', 'HEAD'], {
      cwd: repository,
      encoding: 'utf8',
    })
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /check-screen-budget-decisions: clean \(base: HEAD/)
  })

  test('7.10-DEC-001 the rule ids match the shared module and the limits file', () => {
    const source = fs.readFileSync(
      path.join(repository, 'packages/utils/src/screen-budget.ts'),
      'utf8'
    )
    const list = (name) => {
      const block = source.match(new RegExp(`export const ${name} = \\[([^\\]]*)\\]`))
      assert.ok(block, `${name} not found in screen-budget.ts`)
      return [...block[1].matchAll(/'([^']+)'/g)].map((match) => match[1])
    }
    assert.deepEqual(list('SCREEN_BUDGET_RULES'), [...RULES])
    assert.deepEqual(list('SCREEN_BUDGET_PER_ELEMENT_RULES'), [...PER_ELEMENT_RULES])
    assert.deepEqual(Object.keys(checkedIn.limits).sort(), [...RULES].sort())
  })

  test('7.10-DEC-002 a limit raised without a decision id fails', () => {
    const problems = check(
      budgetWith({ limits: { 'targets-above-fold': 8 } }),
      budgetWith()
    )
    assert.deepEqual(problems, [
      'limits.targets-above-fold 8 (AC 7): above the AC value without a limitDecisions entry allowing it',
    ])
    const short = check(
      budgetWith({
        limits: { 'today-height': 1800 },
        limitDecisions: [
          {
            limit: 'today-height',
            value: 1700,
            decision: 'D-TARGETS-7.13',
            decidedIn: '7.13',
          },
        ],
      }),
      budgetWith()
    )
    assert.equal(short.length, 1)
    assert.match(
      short[0],
      /^limits\.today-height 1800 \(AC 1688\): above the AC value without/
    )
  })

  test('7.10-DEC-003 a limit raised with an id missing from the story spec section fails', () => {
    const problems = check(
      budgetWith({
        limits: { 'targets-above-fold': 8 },
        limitDecisions: [
          {
            limit: 'targets-above-fold',
            value: 8,
            decision: 'D-LIMIT-7.13',
            decidedIn: '7.13',
          },
        ],
      }),
      budgetWith()
    )
    assert.deepEqual(problems, [
      `limits.targets-above-fold 8 (AC 7): decision D-LIMIT-7.13 is not recorded under "## Screen budget decisions" in ${SPEC_DIR}/spec-7-13-calm-today.md`,
    ])
    const noSection = check(
      budgetWith({
        limits: { 'chip-rows': 2 },
        limitDecisions: [
          { limit: 'chip-rows', value: 2, decision: 'D-CHIPS-7.13', decidedIn: '7.13' },
        ],
      }),
      budgetWith(),
      specRoot({ 'spec-7-13-calm-today.md': '# Story CC-7.13\n\nD-CHIPS-7.13\n' })
    )
    assert.deepEqual(noSection, [
      `limits.chip-rows 2 (AC 1): ${SPEC_DIR}/spec-7-13-calm-today.md has no "## Screen budget decisions" section`,
    ])
  })

  test('7.10-DEC-004 a limit raised with the id under the decisions heading passes', () => {
    const raised = budgetWith({
      limits: { 'targets-above-fold': 8 },
      limitDecisions: [
        {
          limit: 'targets-above-fold',
          value: 8,
          decision: 'D-TARGETS-7.13',
          decidedIn: '7.13',
        },
      ],
    })
    assert.deepEqual(check(raised, budgetWith()), [])
    // Raising it again under the decision the base already used needs a new one.
    const again = budgetWith({
      limits: { 'targets-above-fold': 9 },
      limitDecisions: [
        {
          limit: 'targets-above-fold',
          value: 9,
          decision: 'D-TARGETS-7.13',
          decidedIn: '7.13',
        },
      ],
    })
    assert.deepEqual(check(again, raised), [
      'limits.targets-above-fold 9 (AC 7): raised or added under decision D-TARGETS-7.13, which the base already used; record a new decision',
    ])
  })

  test('7.10-DEC-005 a new known entry or a raised known value without a recorded decision fails', () => {
    const unrecorded = check(
      budgetWith({ known: [knownTargets({ decision: 'D-LATER-7.10' })] }),
      budgetWith()
    )
    assert.deepEqual(unrecorded, [
      `known[0] web today populated targets-above-fold: decision D-LATER-7.10 is not recorded under "## Screen budget decisions" in ${SPEC_DIR}/spec-7-10-screen-budget-guard.md`,
    ])

    const base = budgetWith({ known: [knownTargets({ value: 8 })] })
    assert.deepEqual(check(budgetWith({ known: [knownTargets({ value: 9 })] }), base), [
      'known[0] web today populated targets-above-fold: raised or added under decision D-KNOWN-7.10, which the base already used; record a new decision',
    ])

    const paragraphBase = budgetWith({ known: [knownParagraphs(['home-hero-copy'])] })
    const swapped = budgetWith({ known: [knownParagraphs(['p "A new long paragraph"'])] })
    assert.deepEqual(check(swapped, paragraphBase), [
      'known[0] web today empty paragraph-lines: raised or added under decision D-KNOWN-7.10, which the base already used; record a new decision',
    ])

    // Without a base file every entry still needs its recorded decision.
    assert.deepEqual(check(budgetWith({ known: [knownTargets()] }), null), [])
    assert.equal(
      check(budgetWith({ known: [knownTargets({ decision: 'D-MISSING-7.10' })] }), null)
        .length,
      1
    )
  })

  test('7.10-DEC-005 a malformed known entry fails', () => {
    const problems = check(
      budgetWith({
        known: [
          knownTargets({ story: '7.12', screen: 'looks' }),
          knownTargets({ value: 7 }),
          knownTargets({ fixture: 'empty' }),
          knownTargets({ fixture: 'empty' }),
          knownParagraphs(['a', 'b'], { value: 1 }),
          knownParagraphs([], { value: 0, fixture: 'populated' }),
          knownTargets({ fixture: 'guardian-pending', elements: ['x'] }),
          knownTargets({ platform: 'native', decision: 'known' }),
        ],
      }),
      null
    )
    assert.deepEqual(problems, [
      'known[0] web looks populated targets-above-fold: unknown screen looks, story 7.12 (owning stories: 7.11, 7.13, 7.15, 7.16, 7.17)',
      'known[1] web today populated targets-above-fold: value 7 is within the limit 7, so it is not a violation',
      'known[3] web today empty targets-above-fold: duplicate entry',
      'known[4] web today empty paragraph-lines: value 1 must equal the 2 element key(s) and be 1 or more',
      'known[5] web today populated paragraph-lines: value 0 must equal the 0 element key(s) and be 1 or more',
      'known[6] web today guardian-pending targets-above-fold: only per-element rules list elements',
      'known[7] native today populated targets-above-fold: decision must be an id like D-KNOWN-7.10, got known',
    ])
  })

  test('7.10-DEC-006 a lowered or deleted known entry passes with no new decision', () => {
    const base = budgetWith({
      known: [
        knownTargets({ value: 9 }),
        knownParagraphs(['home-hero-copy', 'home-tagline']),
      ],
    })
    const lowered = budgetWith({
      known: [knownTargets({ value: 8 }), knownParagraphs(['home-tagline'])],
    })
    assert.deepEqual(check(lowered, base), [])
    assert.deepEqual(check(budgetWith({ known: [knownTargets({ value: 9 })] }), base), [])
    assert.deepEqual(check(budgetWith(), base), [])
  })

  test('7.10-DEC-007 a lowered limit passes with no decision', () => {
    assert.deepEqual(
      check(
        budgetWith({ limits: { 'targets-above-fold': 6, 'today-height': 1500 } }),
        budgetWith()
      ),
      []
    )
    // Lowering a raised limit keeps the decision that allowed the higher value.
    const raised = budgetWith({
      limits: { 'targets-above-fold': 9 },
      limitDecisions: [
        {
          limit: 'targets-above-fold',
          value: 9,
          decision: 'D-TARGETS-7.13',
          decidedIn: '7.13',
        },
      ],
    })
    const lowered = budgetWith({
      limits: { 'targets-above-fold': 8 },
      limitDecisions: raised.limitDecisions,
    })
    assert.deepEqual(check(lowered, raised), [])
  })

  test('7.10-DEC-007 pinned measure settings and malformed limits fail', () => {
    const budget = budgetWith({ limits: { 'chip-rows': 1.5, extra: 1 } })
    budget.measure = { viewport: { width: 500, height: 844 }, minCardSizePx: 48 }
    assert.deepEqual(check(budget, null), [
      'measure.viewport must be 390 x 844 (CC-7.10 AC1)',
      'measure.minCardSizePx must be 64 (D3)',
      'limits.extra is not a screen budget rule',
      'limits.chip-rows must be a whole number of 0 or more, got 1.5',
    ])
  })

  test('7.10-DEC-008 a missing story spec file fails naming its path', () => {
    const problems = check(
      budgetWith({
        known: [knownTargets({ decision: 'D-KNOWN-7.99', decidedIn: '7.99' })],
      }),
      null
    )
    assert.deepEqual(problems, [
      `known[0] web today populated targets-above-fold: story 7.99 spec file not found: ${SPEC_DIR}/spec-7-99-*.md`,
    ])
    const twice = check(
      budgetWith({ known: [knownTargets()] }),
      null,
      specRoot({ 'spec-7-10-a.md': SPEC_7_10, 'spec-7-10-b.md': SPEC_7_10 })
    )
    assert.deepEqual(twice, [
      `known[0] web today populated targets-above-fold: story 7.10 has 2 spec files matching ${SPEC_DIR}/spec-7-10-*.md`,
    ])
  })

  test('7.10-DEC-008 the checked-in spec records D-KNOWN-7.10 under its decisions heading', () => {
    const spec = fs.readFileSync(
      path.join(repository, SPEC_DIR, 'spec-7-10-screen-budget-guard.md'),
      'utf8'
    )
    const section = decisionsSection(spec)
    assert.ok(section, 'spec-7-10 has no decisions section')
    assert.ok(mentionsDecision(section, 'D-KNOWN-7.10'))
    assert.equal(mentionsDecision('- D-KNOWN-7.10 (owner)', 'D-KNOWN-7.1'), false)
    assert.equal(mentionsDecision('- D-KNOWN-7.10-B', 'D-KNOWN-7.10'), false)
    assert.equal(mentionsDecision('see D-KNOWN-7.10.', 'D-KNOWN-7.10'), true)
  })
})
