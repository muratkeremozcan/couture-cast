// Story CC-7.10 D6: a screen budget limit or `known` entry moves only with a recorded decision.
// Cases 7.10-DEC-001..008 from _bmad-output/test-artifacts/test-design-7-10-screen-budget-guard.md;
// 7.10-DEC-009..012 from the CC-7.10 Codex review (#2: raises against the base, decision terms
// that bind rule, scope and ceiling; #8: per-paragraph line counts; #10: AC values as fixtures);
// 7.10-DEC-013..018 from CodeRabbit round 1 (fenced examples, order-free limit decisions,
// per-element values within the limit, base tip decision ids, merge base, --base parsing).
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
  BUDGET_PATH,
  checkScreenBudgetDecisions,
  decisionsSection,
  decisionTerms,
  loadBaseBudget,
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

/**
 * CC-7.10 AC2 and AC3 as a fixture (review #10): the live limits may move under a recorded
 * decision, so no case pins the checked-in file to these values.
 */
const AC_FIXTURE = Object.freeze({
  'targets-above-fold': 7,
  'primary-buttons': 1,
  'chip-rows': 1,
  'nested-cards': 0,
  'paragraph-lines': 2,
  'today-height': 1688,
  'closet-chrome': 160,
  'analytics-only': 0,
})

/** The checked-in budget's lists and selectors, with AC limits, `known` and decisions given. */
function budgetWith({ limits = {}, known = [], limitDecisions = [] } = {}) {
  return structuredClone({
    ...checkedIn,
    limits: { ...AC_FIXTURE, ...limits },
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
  '- D-KNOWN-7.10: `rule=targets-above-fold scope=web/today/* max=9`',
  '- D-KNOWN-7.10: `rule=targets-above-fold scope=native/today/populated max=9`',
  '- D-KNOWN-7.10: `rule=paragraph-lines scope=web/today/* max=2 lines=4`',
  '- D-PROSE-7.10: a prose line after the id names no term.',
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
  '- D-TARGETS-7.13: `rule=targets-above-fold scope=limit max=8`',
  '- D-RESTORE-7.13 (owner, 2026-12-02): the target limit returns to seven.',
  '- D-RESTORE-7.13: `rule=targets-above-fold scope=limit max=7`',
  '- D-TODAY-7.13: `rule=targets-above-fold scope=web/today/* max=10`',
  '- D-LINES-7.13: `rule=paragraph-lines scope=web/today/empty max=2 lines=6`',
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

/** A paragraph-lines entry; each element is a key (3 lines) or `[key, lines]`. */
const knownParagraphs = (elements, overrides = {}) => ({
  platform: 'web',
  screen: 'today',
  fixture: 'empty',
  rule: 'paragraph-lines',
  value: elements.length,
  elements: elements.map((element) =>
    Array.isArray(element)
      ? { key: element[0], lines: element[1] }
      : { key: element, lines: 3 }
  ),
  story: '7.17',
  decision: 'D-KNOWN-7.10',
  decidedIn: '7.10',
  ...overrides,
})

describe('check-screen-budget-decisions', () => {
  test('7.10-DEC-001 limits at the AC values and no known change pass', () => {
    assert.deepEqual(check(budgetWith(), budgetWith()), [])
    assert.deepEqual(check(budgetWith(), null), [])
    const base = budgetWith({ known: [knownTargets()] })
    assert.deepEqual(check(budgetWith({ known: [knownTargets()] }), base), [])
  })

  // Every checked-in entry and limit sits within its recorded decision terms. The base-relative
  // half (a raise needs a new decision) runs in the PR gate against the merge base: a working
  // tree that adds entries under this story's own decision is clean there and not against HEAD.
  test('7.10-DEC-001 the checked-in budget is clean with no base', () => {
    assert.deepEqual(checkScreenBudgetDecisions({ budget: checkedIn, base: null }), [])
    const env = { ...process.env }
    delete env.CI
    const result = spawnSync(
      process.execPath,
      [script, '--base', 'refs/heads/no-such-screen-budget-base'],
      { cwd: repository, encoding: 'utf8', env }
    )
    assert.equal(result.status, 0, result.stderr)
    assert.match(
      result.stderr,
      /base revision refs\/heads\/no-such-screen-budget-base not found/
    )
    assert.match(result.stdout, /check-screen-budget-decisions: clean \(base: none\)/)
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
      'limits.targets-above-fold 8 (base 7, AC 7): raised from 7 without a limitDecisions entry allowing it',
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
      /^limits\.today-height 1800 \(base 1688, AC 1688\): raised from 1688 without/
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
      `limits.targets-above-fold 8 (base 7, AC 7): decision D-LIMIT-7.13 is not recorded under "## Screen budget decisions" in ${SPEC_DIR}/spec-7-13-calm-today.md`,
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
      `limits.chip-rows 2 (base 1, AC 1): ${SPEC_DIR}/spec-7-13-calm-today.md has no "## Screen budget decisions" section`,
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
    // Raising it again under the decision the base already used needs a new one, and its
    // recorded ceiling of 8 does not stretch to 9.
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
      `limits.targets-above-fold 9 (base 8, AC 7): limit 9 is above the max 8 of D-TARGETS-7.13 "rule=targets-above-fold scope=limit max=8" (${SPEC_DIR}/spec-7-13-calm-today.md)`,
      'limits.targets-above-fold 9 (base 8, AC 7): raised or added under decision D-TARGETS-7.13, which the base already used; record a new decision',
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
          knownParagraphs(['a'], { fixture: 'guardian-pending', elements: ['a'] }),
          knownParagraphs([['a', 2]], { screen: 'closet' }),
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
      'known[6] web today guardian-pending paragraph-lines: a paragraph-lines entry lists each paragraph as { "key": ..., "lines": <measured lines> }',
      'known[7] web closet empty paragraph-lines: paragraph a has 2 lines, within the limit 2, so it is not a violation',
      `known[7] web closet empty paragraph-lines: decision D-KNOWN-7.10 records no term for rule paragraph-lines scope web/closet/empty (${SPEC_DIR}/spec-7-10-screen-budget-guard.md)`,
      'known[8] web today guardian-pending targets-above-fold: only per-element rules list elements',
      'known[9] native today populated targets-above-fold: decision must be an id like D-KNOWN-7.10, got known',
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
      known: [knownTargets({ value: 8 }), knownParagraphs([['home-tagline', 3]])],
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
    const terms = decisionTerms(section).get('D-KNOWN-7.10') ?? []
    assert.ok(terms.length > 0, 'D-KNOWN-7.10 records its terms')
    // Every term-shaped line under the heading parses, so none is silently skipped.
    const termShaped = section
      .split('\n')
      .filter((line) => /^- D-KNOWN-7\.10: /.test(line))
    assert.equal(terms.length, termShaped.length)
    assert.deepEqual(
      terms.filter((term) => term.problem),
      [],
      'every D-KNOWN-7.10 term parses'
    )
    assert.equal(mentionsDecision('- D-KNOWN-7.10 (owner)', 'D-KNOWN-7.1'), false)
    assert.equal(mentionsDecision('- D-KNOWN-7.10-B', 'D-KNOWN-7.10'), false)
    assert.equal(mentionsDecision('see D-KNOWN-7.10.', 'D-KNOWN-7.10'), true)
  })

  test('7.10-DEC-009 a limit lowered on the base and raised back fails without a new decision', () => {
    const lowered = budgetWith({ limits: { 'targets-above-fold': 6 } })
    // Back at the AC value, but above the base: still an increase.
    assert.deepEqual(check(budgetWith(), lowered), [
      'limits.targets-above-fold 7 (base 6, AC 7): raised from 6 without a limitDecisions entry allowing it',
    ])
    const restored = budgetWith({
      limitDecisions: [
        {
          limit: 'targets-above-fold',
          value: 7,
          decision: 'D-RESTORE-7.13',
          decidedIn: '7.13',
        },
      ],
    })
    assert.deepEqual(check(restored, lowered), [])
    // A decision the base already cites cannot carry the raise.
    const reused = budgetWith({
      limits: { 'targets-above-fold': 6 },
      limitDecisions: restored.limitDecisions,
    })
    assert.deepEqual(check(restored, reused), [
      'limits.targets-above-fold 7 (base 6, AC 7): raised or added under decision D-RESTORE-7.13, which the base already used; record a new decision',
    ])
  })

  test('7.10-DEC-010 a decision term authorizes only its rule, scope and ceiling', () => {
    const spec = `${SPEC_DIR}/spec-7-13-calm-today.md`
    // A limit term does not authorize another rule's limit.
    const otherRule = check(
      budgetWith({
        limits: { 'chip-rows': 2 },
        limitDecisions: [
          { limit: 'chip-rows', value: 2, decision: 'D-TARGETS-7.13', decidedIn: '7.13' },
        ],
      }),
      budgetWith()
    )
    assert.deepEqual(otherRule, [
      `limits.chip-rows 2 (base 1, AC 1): decision D-TARGETS-7.13 records no term for rule chip-rows scope limit (${spec})`,
    ])
    // The JSON's own limitDecisions value cannot lift the recorded ceiling.
    const higher = check(
      budgetWith({
        limits: { 'targets-above-fold': 9 },
        limitDecisions: [
          {
            limit: 'targets-above-fold',
            value: 9,
            decision: 'D-TARGETS-7.13',
            decidedIn: '7.13',
          },
        ],
      }),
      budgetWith()
    )
    assert.deepEqual(higher, [
      `limits.targets-above-fold 9 (base 7, AC 7): limit 9 is above the max 8 of D-TARGETS-7.13 "rule=targets-above-fold scope=limit max=8" (${spec})`,
    ])
    // A known-entry term covers its scope up to its max, and nothing else.
    const today = (overrides) =>
      knownTargets({ decision: 'D-TODAY-7.13', decidedIn: '7.13', ...overrides })
    assert.deepEqual(
      check(budgetWith({ known: [today({ value: 10 })] }), budgetWith()),
      []
    )
    assert.deepEqual(
      check(
        budgetWith({
          known: [
            today({ value: 11 }),
            today({ platform: 'native' }),
            today({ rule: 'primary-buttons', value: 2 }),
          ],
        }),
        budgetWith()
      ),
      [
        `known[0] web today populated targets-above-fold: value 11 is above the max 10 of D-TODAY-7.13 "rule=targets-above-fold scope=web/today/* max=10" (${spec})`,
        `known[1] native today populated targets-above-fold: decision D-TODAY-7.13 records no term for rule targets-above-fold scope native/today/populated (${spec})`,
        `known[2] web today populated primary-buttons: decision D-TODAY-7.13 records no term for rule primary-buttons scope web/today/populated (${spec})`,
      ]
    )
    // A limit term never covers a known entry, nor a known-entry term a limit.
    assert.deepEqual(
      check(
        budgetWith({
          known: [knownTargets({ decision: 'D-TARGETS-7.13', decidedIn: '7.13' })],
        }),
        budgetWith()
      ),
      [
        `known[0] web today populated targets-above-fold: decision D-TARGETS-7.13 records no term for rule targets-above-fold scope web/today/populated (${spec})`,
      ]
    )
    // An unchanged entry must still sit within its decision's terms.
    const outside = budgetWith({ known: [knownTargets({ value: 10 })] })
    assert.deepEqual(check(outside, outside), [
      `known[0] web today populated targets-above-fold: value 10 is above the max 9 of D-KNOWN-7.10 "rule=targets-above-fold scope=web/today/* max=9" (${SPEC_DIR}/spec-7-10-screen-budget-guard.md)`,
    ])
  })

  test('7.10-DEC-011 a known paragraph that gains lines needs a new decision within its lines', () => {
    const base = budgetWith({ known: [knownParagraphs([['home-hero-copy', 3]])] })
    // Same key, more lines: an increase, even with the count unchanged.
    assert.deepEqual(
      check(budgetWith({ known: [knownParagraphs([['home-hero-copy', 4]])] }), base),
      [
        'known[0] web today empty paragraph-lines: raised or added under decision D-KNOWN-7.10, which the base already used; record a new decision',
      ]
    )
    // Above the recorded lines ceiling, under the base's decision or a new one.
    assert.deepEqual(
      check(budgetWith({ known: [knownParagraphs([['home-hero-copy', 5]])] }), null),
      [
        `known[0] web today empty paragraph-lines: a paragraph of 5 lines is above the lines 4 of D-KNOWN-7.10 "rule=paragraph-lines scope=web/today/* max=2 lines=4" (${SPEC_DIR}/spec-7-10-screen-budget-guard.md)`,
      ]
    )
    const decided = (lines) =>
      budgetWith({
        known: [
          knownParagraphs([['home-hero-copy', lines]], {
            decision: 'D-LINES-7.13',
            decidedIn: '7.13',
          }),
        ],
      })
    assert.deepEqual(check(decided(6), base), [])
    assert.equal(check(decided(7), base).length, 1)
    // Fewer lines is a decrease and needs no decision.
    assert.deepEqual(
      check(budgetWith({ known: [knownParagraphs([['home-hero-copy', 3]])] }), base),
      []
    )
    // Recording the count of a base entry in the old string shape migrates it.
    const stringShaped = budgetWith({
      known: [{ ...knownParagraphs(['home-hero-copy']), elements: ['home-hero-copy'] }],
    })
    assert.deepEqual(
      check(
        budgetWith({ known: [knownParagraphs([['home-hero-copy', 4]])] }),
        stringShaped
      ),
      []
    )
  })

  test('7.10-DEC-012 decision terms parse strictly and a decision needs at least one', () => {
    const section = [
      '- D-A-7.13 (owner): prose names the id but no term.',
      '- D-A-7.13: prose after a colon is not a term either.',
      '- D-B-7.13: `rule=chip-rows scope=web/*/* max=2`',
      '- D-B-7.13: rule=nested-cards scope=native/profile/empty max=1',
      '- D-B-7.13: `rule=analytics-only scope=*/today/* max=3` (a note after the term)',
      '- D-C-7.13: `rule=paragraph-lines scope=web/today/* max=1`',
      '- D-D-7.13: `rule=chip-rows scope=web/today max=2`',
      '- D-E-7.13: `rule=chips scope=limit max=2`',
      '- D-F-7.13: `rule=chip-rows scope=limit max=two`',
      '- D-G-7.13: `rule=chip-rows scope=limit max=2 lines=3`',
      '- D-H-7.13: `rule=chip-rows scope=limit max=2 owner=me`',
    ].join('\n')
    const terms = decisionTerms(section)
    assert.equal(terms.has('D-A-7.13'), false)
    assert.deepEqual(
      terms.get('D-B-7.13').map(({ rule, scope, max }) => ({ rule, scope, max })),
      [
        { rule: 'chip-rows', scope: ['web', '*', '*'], max: 2 },
        { rule: 'nested-cards', scope: ['native', 'profile', 'empty'], max: 1 },
        { rule: 'analytics-only', scope: ['*', 'today', '*'], max: 3 },
      ]
    )
    const problem = (id) => terms.get(id)[0].problem
    assert.equal(problem('D-C-7.13'), 'a paragraph-lines term records lines')
    assert.equal(
      problem('D-D-7.13'),
      'scope must be limit or <platform>/<screen>/<fixture>'
    )
    assert.equal(problem('D-E-7.13'), 'unknown rule chips')
    assert.equal(problem('D-F-7.13'), 'max must be a whole number')
    assert.equal(problem('D-G-7.13'), 'a limit term takes no lines')
    assert.equal(problem('D-H-7.13'), 'unknown field(s) owner')

    const root = specRoot({
      'spec-7-10-screen-budget-guard.md': SPEC_7_10,
      'spec-7-13-calm-today.md': `# Story CC-7.13\n\n## Screen budget decisions\n\n${section}\n`,
    })
    const cite = (decision) =>
      check(
        budgetWith({ known: [knownTargets({ decision, decidedIn: '7.13' })] }),
        null,
        root
      )
    const spec = `${SPEC_DIR}/spec-7-13-calm-today.md`
    assert.deepEqual(cite('D-A-7.13'), [
      `known[0] web today populated targets-above-fold: decision D-A-7.13 in ${spec} records no term line ("- D-A-7.13: \`rule=<rule> scope=<platform>/<screen>/<fixture> max=<value>\`")`,
    ])
    assert.deepEqual(cite('D-E-7.13'), [
      `known[0] web today populated targets-above-fold: decision D-E-7.13 term "rule=chips scope=limit max=2" in ${spec}: unknown rule chips`,
    ])
    // A prose line after a decision id is ignored by the term parser.
    assert.equal(decisionTerms(SPEC_7_10).has('D-PROSE-7.10'), false)
  })
  test('7.10-DEC-013 a decision shown in a fenced block or an HTML comment is not recorded', () => {
    const spec = `${SPEC_DIR}/spec-7-13-calm-today.md`
    const fenced = [
      '# Story CC-7.13',
      '',
      '## Screen budget decisions',
      '',
      'The term format, as an example:',
      '',
      '```md',
      '- D-FENCE-7.13: `rule=targets-above-fold scope=web/today/* max=10`',
      '## Not a heading inside the fence',
      '```',
      '',
      '~~~',
      '- D-TILDE-7.13: `rule=targets-above-fold scope=web/today/* max=10`',
      '~~~',
      '',
      '<!--',
      '- D-COMMENT-7.13: `rule=targets-above-fold scope=web/today/* max=10`',
      '-->',
      '',
      '- D-REAL-7.13: `rule=targets-above-fold scope=web/today/* max=10`',
      '',
      '## Design Notes',
      '',
    ].join('\n')
    const root = specRoot({ 'spec-7-13-calm-today.md': fenced })
    const cite = (decision) =>
      check(
        budgetWith({ known: [knownTargets({ decision, decidedIn: '7.13' })] }),
        null,
        root
      )
    for (const id of ['D-FENCE-7.13', 'D-TILDE-7.13', 'D-COMMENT-7.13'])
      assert.deepEqual(cite(id), [
        `known[0] web today populated targets-above-fold: decision ${id} is not recorded under "## Screen budget decisions" in ${spec}`,
      ])
    // A heading inside a fence does not end the section, so the term after it still counts.
    assert.deepEqual(cite('D-REAL-7.13'), [])
    assert.deepEqual([...decisionTerms(fenced).keys()], ['D-REAL-7.13'])
    // An unclosed fence hides the rest of the document.
    const unclosed =
      '## Screen budget decisions\n\n```\n- D-OPEN-7.13: `rule=chip-rows scope=limit max=2`\n'
    assert.equal(decisionTerms(decisionsSection(unclosed)).has('D-OPEN-7.13'), false)
    // A line with an inline code span of three backticks is text, not a fence.
    const inline =
      '## Screen budget decisions\n\n```inline``` is prose\n- D-AFTER-7.13: `rule=chip-rows scope=limit max=2`\n'
    assert.equal(decisionTerms(decisionsSection(inline)).has('D-AFTER-7.13'), true)
  })

  test('7.10-DEC-014 a limit raise passes when any applicable limit decision allows it, in any order', () => {
    const root = specRoot({
      'spec-7-13-calm-today.md': [
        '# Story CC-7.13',
        '',
        '## Screen budget decisions',
        '',
        '- D-TARGETS-7.13: `rule=targets-above-fold scope=limit max=8`',
        '- D-NINE-7.13: `rule=targets-above-fold scope=limit max=9`',
        '',
      ].join('\n'),
    })
    const old = {
      limit: 'targets-above-fold',
      value: 10,
      decision: 'D-TARGETS-7.13',
      decidedIn: '7.13',
    }
    const nine = {
      limit: 'targets-above-fold',
      value: 9,
      decision: 'D-NINE-7.13',
      decidedIn: '7.13',
    }
    const base = budgetWith({
      limits: { 'targets-above-fold': 8 },
      limitDecisions: [old],
    })
    const raised = (limitDecisions) =>
      checkScreenBudgetDecisions({
        budget: budgetWith({ limits: { 'targets-above-fold': 9 }, limitDecisions }),
        base,
        root,
      })
    assert.deepEqual(raised([old, nine]), [])
    assert.deepEqual(raised([nine, old]), [])
    // With no passing candidate, each candidate's problems are reported.
    const spec = `${SPEC_DIR}/spec-7-13-calm-today.md`
    assert.deepEqual(raised([old]), [
      `limits.targets-above-fold 9 (base 8, AC 7): limit 9 is above the max 8 of D-TARGETS-7.13 "rule=targets-above-fold scope=limit max=8" (${spec})`,
      'limits.targets-above-fold 9 (base 8, AC 7): raised or added under decision D-TARGETS-7.13, which the base already used; record a new decision',
    ])
  })

  test('7.10-DEC-015 a per-element known entry within its raised limit is not a violation', () => {
    const root = specRoot({
      'spec-7-13-calm-today.md': [
        '# Story CC-7.13',
        '',
        '## Screen budget decisions',
        '',
        '- D-CARDS-7.13: `rule=nested-cards scope=limit max=1`',
        '- D-CARDS-7.13: `rule=nested-cards scope=web/today/* max=2`',
        '- D-CARDS-7.13: `rule=analytics-only scope=limit max=1`',
        '- D-CARDS-7.13: `rule=analytics-only scope=web/today/* max=2`',
        '',
      ].join('\n'),
    })
    const limitDecisions = ['nested-cards', 'analytics-only'].map((limit) => ({
      limit,
      value: 1,
      decision: 'D-CARDS-7.13',
      decidedIn: '7.13',
    }))
    const entry = (rule, elements) =>
      knownTargets({
        rule,
        value: elements.length,
        elements,
        story: '7.13',
        decision: 'D-CARDS-7.13',
        decidedIn: '7.13',
      })
    const checkKnown = (known) =>
      checkScreenBudgetDecisions({
        budget: budgetWith({
          limits: { 'nested-cards': 1, 'analytics-only': 1 },
          limitDecisions,
          known,
        }),
        base: null,
        root,
      })
    assert.deepEqual(
      checkKnown([entry('nested-cards', ['card-a']), entry('analytics-only', ['tap-a'])]),
      [
        'known[0] web today populated nested-cards: value 1 is within the limit 1, so it is not a violation',
        'known[1] web today populated analytics-only: value 1 is within the limit 1, so it is not a violation',
      ]
    )
    assert.deepEqual(
      checkKnown([
        entry('nested-cards', ['card-a', 'card-b']),
        entry('analytics-only', ['tap-a', 'tap-b']),
      ]),
      []
    )
  })

  test('7.10-DEC-016 a decision the base branch cited after the fork point cannot carry a raise', () => {
    const root = specRoot()
    const cite = { decision: 'D-TODAY-7.13', decidedIn: '7.13' }
    const budget = budgetWith({ known: [knownTargets(cite)] })
    const base = budgetWith()
    const baseTip = budgetWith({ known: [knownTargets({ ...cite, fixture: 'empty' })] })
    assert.deepEqual(checkScreenBudgetDecisions({ budget, base, root }), [])
    assert.deepEqual(checkScreenBudgetDecisions({ budget, base, baseTip, root }), [
      'known[0] web today populated targets-above-fold: raised or added under decision D-TODAY-7.13, which the base already used; record a new decision',
    ])
    // Raises still compare with the merge base: a value the tip lowered after the fork point
    // is unchanged here, so it raises nothing.
    const kept = budgetWith({ known: [knownTargets()] })
    const lowered = budgetWith({ known: [knownTargets({ value: 8 })] })
    assert.deepEqual(
      checkScreenBudgetDecisions({ budget: kept, base: kept, baseTip: lowered, root }),
      []
    )
  })

  test('7.10-DEC-017 the base budget comes from the merge base, never the tip in its place', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'screen-budget-base-'))
    roots.push(root)
    const env = {
      ...process.env,
      GIT_AUTHOR_NAME: 'screen budget test',
      GIT_AUTHOR_EMAIL: 'screen-budget@example.test',
      GIT_COMMITTER_NAME: 'screen budget test',
      GIT_COMMITTER_EMAIL: 'screen-budget@example.test',
      GIT_INDEX_FILE: path.join(root, 'test-index'),
    }
    const git = (args, input) => {
      const result = spawnSync('git', ['-c', 'commit.gpgsign=false', ...args], {
        cwd: root,
        encoding: 'utf8',
        env,
        input,
      })
      assert.equal(result.status, 0, result.stderr)
      return result.stdout.trim()
    }
    git(['init', '--quiet'])
    // Plumbing only: no hooks run in the throwaway repository.
    const commit = (budget, parents = []) => {
      fs.rmSync(env.GIT_INDEX_FILE, { force: true })
      const blob = git(['hash-object', '-w', '--stdin'], JSON.stringify(budget))
      git(['update-index', '--add', '--cacheinfo', `100644,${blob},${BUDGET_PATH}`])
      const tree = git(['write-tree'])
      return git([
        'commit-tree',
        tree,
        ...parents.flatMap((parent) => ['-p', parent]),
        '-m',
        'budget',
      ])
    }
    const fork = commit(budgetWith({ known: [knownTargets()] }))
    const tip = commit(
      budgetWith({
        known: [knownTargets({ decision: 'D-TIP-7.13', decidedIn: '7.13' })],
      }),
      [fork]
    )
    const head = commit(budgetWith(), [fork])
    const unrelated = commit(budgetWith({ known: [knownTargets({ value: 12 })] }))
    git(['update-ref', 'refs/heads/main', tip])
    git(['update-ref', 'refs/heads/unrelated', unrelated])
    git(['update-ref', 'refs/heads/feature', head])
    git(['symbolic-ref', 'HEAD', 'refs/heads/feature'])

    const loaded = loadBaseBudget({ root, ref: 'refs/heads/main' })
    assert.equal(loaded.description, `refs/heads/main at ${fork.slice(0, 12)}`)
    assert.equal(loaded.budget.known[0].decision, 'D-KNOWN-7.10')
    assert.equal(loaded.tip.known[0].decision, 'D-TIP-7.13')
    assert.throws(
      () => loadBaseBudget({ root, ref: 'refs/heads/unrelated' }),
      /no merge base between HEAD and refs\/heads\/unrelated/
    )
  })

  test('7.10-DEC-018 --base without a ref exits 2 instead of using the default base', () => {
    for (const args of [['--base'], ['--base', ''], ['--base', '--base']]) {
      const result = spawnSync(process.execPath, [script, ...args], {
        cwd: repository,
        encoding: 'utf8',
      })
      assert.equal(result.status, 2, `${args.join(' ')}: ${result.stderr}`)
      assert.match(result.stderr, /--base needs a ref/)
    }
  })
})
