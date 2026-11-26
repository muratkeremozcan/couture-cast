// Learning path Step 67: Screen budget guard.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-67-screen-budget-guard
// Story CC-7.10 test owner (TEA): 7.10-UNIT-001..012, the verdict, the ratchet, the measure
// config and the analytics allow list. The measure itself needs a layout engine and is proved by
// playwright/tests/screen-budget-rules.spec.ts.
// Test design: _bmad-output/test-artifacts/test-design-7-10-screen-budget-guard.md.
import { describe, expect, it } from 'vitest'
import { colorRoles } from './design-tokens'
import {
  evaluateScreenBudget,
  formatScreenBudgetFailures,
  isAnalyticsRequest,
  screenBudget,
  screenBudgetMeasureConfig,
  SCREEN_BUDGET_OWNING_STORIES,
  SCREEN_BUDGET_PER_ELEMENT_RULES,
  SCREEN_BUDGET_RULES,
  type ScreenBudgetAudit,
  type ScreenBudgetAuditMeasurement,
  type ScreenBudgetKnownViolation,
  type ScreenBudgetRule,
} from './screen-budget'

const AC_LIMITS = {
  'targets-above-fold': 7,
  'primary-buttons': 1,
  'chip-rows': 1,
  'nested-cards': 0,
  'paragraph-lines': 2,
  'today-height': 1688,
  'closet-chrome': 160,
  'analytics-only': 0,
} as const

const els = (count: number, prefix = 'el') =>
  Array.from({ length: count }, (_, i) => ({ key: `${prefix}-${i + 1}` }))

const audit = (
  measurement: ScreenBudgetAuditMeasurement,
  where: Partial<Omit<ScreenBudgetAudit, 'measurement'>> = {}
): ScreenBudgetAudit => ({
  platform: 'web',
  screen: 'today',
  fixture: 'populated',
  ...where,
  measurement,
})

const known = (
  rule: ScreenBudgetRule,
  value: number,
  extra: Partial<ScreenBudgetKnownViolation> = {}
): ScreenBudgetKnownViolation => ({
  platform: 'web',
  screen: 'today',
  fixture: 'populated',
  rule,
  value,
  story: '7.13',
  decision: 'D-KNOWN-7.10',
  decidedIn: '7.10',
  ...extra,
})

const kinds = (result: ReturnType<typeof evaluateScreenBudget>) =>
  result.failures.map((failure) => `${failure.rule}:${failure.kind}`)

/** At the limit and one over, for every rule (7.10-UNIT-001). */
const AT_AND_OVER: Record<
  ScreenBudgetRule,
  [ScreenBudgetAuditMeasurement, ScreenBudgetAuditMeasurement]
> = {
  'targets-above-fold': [{ targetsAboveFold: els(7) }, { targetsAboveFold: els(8) }],
  'primary-buttons': [{ primaryButtons: els(1) }, { primaryButtons: els(2) }],
  'chip-rows': [{ chipRows: els(1) }, { chipRows: els(2) }],
  'nested-cards': [{ nestedCards: [] }, { nestedCards: els(1) }],
  'paragraph-lines': [
    { paragraphs: [{ key: 'p', lines: 2 }] },
    { paragraphs: [{ key: 'p', lines: 3 }] },
  ],
  'today-height': [{ todayHeight: 1688 }, { todayHeight: 1689 }],
  'closet-chrome': [{ closetChrome: 160 }, { closetChrome: 161 }],
  'analytics-only': [{ analyticsOnly: [] }, { analyticsOnly: els(1) }],
}

describe('CC-7.10 evaluateScreenBudget', () => {
  it.each(SCREEN_BUDGET_RULES)(
    '[P0] [7.10-UNIT-001] %s passes at its limit and fails one over',
    (rule) => {
      const [at, over] = AT_AND_OVER[rule]
      const pass = evaluateScreenBudget(audit(at), AC_LIMITS, [])
      expect(pass.passed).toBe(true)
      expect(pass.measures).toEqual([
        expect.objectContaining({ rule, limit: AC_LIMITS[rule], violation: false }),
      ])
      const fail = evaluateScreenBudget(audit(over), AC_LIMITS, [])
      expect(fail.passed).toBe(false)
      expect(kinds(fail)).toEqual([`${rule}:new`])
    }
  )

  it('[P0] [7.10-UNIT-002] a failure names platform, screen, fixture, rule, value, limit and element', () => {
    const result = evaluateScreenBudget(
      audit(
        {
          primaryButtons: [
            { key: 'closet-add' },
            { key: 'button "Save"', detail: 'gold' },
          ],
        },
        { platform: 'native', screen: 'closet', fixture: 'guardian-pending' }
      ),
      AC_LIMITS,
      []
    )
    expect(formatScreenBudgetFailures(result)).toBe(
      'native closet (guardian-pending) primary-buttons: 2 > 1: closet-add, button "Save" (gold)'
    )
    expect(result.measures[0]?.elements).toEqual(['closet-add', 'button "Save" (gold)'])
  })

  it('[P1] [7.10-UNIT-002b] px rules and paragraphs say their unit', () => {
    const result = evaluateScreenBudget(
      audit({
        todayHeight: 3701,
        paragraphs: [{ key: 'hero', lines: 4, detail: '4 lines' }],
      }),
      AC_LIMITS,
      []
    )
    expect(formatScreenBudgetFailures(result).split('\n')).toEqual([
      'web today (populated) paragraph-lines: 1 paragraph(s) over 2 lines: hero (4 lines)',
      'web today (populated) today-height: 3701 px > 1688 px',
    ])
  })

  it('[P0] [7.10-UNIT-003] a violation in known with the same value passes', () => {
    const result = evaluateScreenBudget(audit({ chipRows: els(2) }), AC_LIMITS, [
      known('chip-rows', 2),
    ])
    expect(result.passed).toBe(true)
    expect(result.measures[0]).toEqual(
      expect.objectContaining({ rule: 'chip-rows', value: 2, violation: true })
    )
  })

  it('[P0] [7.10-UNIT-004] a value above known fails as worse', () => {
    const result = evaluateScreenBudget(audit({ targetsAboveFold: els(9) }), AC_LIMITS, [
      known('targets-above-fold', 8),
    ])
    expect(kinds(result)).toEqual(['targets-above-fold:worse'])
    expect(formatScreenBudgetFailures(result)).toContain('9 > 7, above known 8')
  })

  it('[P0] [7.10-UNIT-005] a value below known fails as lower; within the limit fails as fixed', () => {
    const lower = evaluateScreenBudget(audit({ todayHeight: 3000 }), AC_LIMITS, [
      known('today-height', 3701),
    ])
    expect(kinds(lower)).toEqual(['today-height:lower'])
    expect(formatScreenBudgetFailures(lower)).toContain('lower the known value to 3000')
    const fixed = evaluateScreenBudget(audit({ chipRows: els(1) }), AC_LIMITS, [
      known('chip-rows', 2),
    ])
    expect(kinds(fixed)).toEqual(['chip-rows:fixed'])
    expect(formatScreenBudgetFailures(fixed)).toContain(
      'known 2 (story 7.13) no longer reproduces (measured 1, limit 1): delete it from known'
    )
  })

  it.each(SCREEN_BUDGET_PER_ELEMENT_RULES)(
    '[P0] [7.10-UNIT-006] %s: a new element key fails even at the known count',
    (rule) => {
      const measurement: ScreenBudgetAuditMeasurement =
        rule === 'paragraph-lines'
          ? { paragraphs: [{ key: 'p-new', lines: 3 }] }
          : rule === 'nested-cards'
            ? { nestedCards: [{ key: 'p-new' }] }
            : { analyticsOnly: [{ key: 'p-new' }] }
      const result = evaluateScreenBudget(audit(measurement), AC_LIMITS, [
        known(rule, 1, { elements: ['p-old'] }),
      ])
      expect(kinds(result)).toEqual([`${rule}:new-element`, `${rule}:missing-element`])
      expect(formatScreenBudgetFailures(result)).toContain(
        'not in known (story 7.13): p-new'
      )
      expect(formatScreenBudgetFailures(result)).toContain(
        'known element(s) no longer reproduce: p-old'
      )
    }
  )

  it('[P1] [7.10-UNIT-007] a known key that no longer reproduces fails alone; repeats count', () => {
    const gone = evaluateScreenBudget(
      audit({ analyticsOnly: [{ key: 'a' }] }),
      AC_LIMITS,
      [known('analytics-only', 2, { elements: ['a', 'b'] })]
    )
    expect(kinds(gone)).toEqual(['analytics-only:missing-element'])
    expect(formatScreenBudgetFailures(gone)).toContain('lower the known value to 1')
    const repeated = evaluateScreenBudget(
      audit({ nestedCards: [{ key: 'inner' }, { key: 'inner' }] }),
      AC_LIMITS,
      [known('nested-cards', 1, { elements: ['inner'] })]
    )
    expect(kinds(repeated)).toEqual(['nested-cards:new-element'])
    const noKeys = evaluateScreenBudget(
      audit({ nestedCards: [{ key: 'inner' }] }),
      AC_LIMITS,
      [known('nested-cards', 1)]
    )
    expect(kinds(noKeys)).toEqual(['nested-cards:new-element'])
    const same = evaluateScreenBudget(
      audit({ nestedCards: [{ key: 'inner' }] }),
      AC_LIMITS,
      [known('nested-cards', 1, { elements: ['inner'] })]
    )
    expect(same.passed).toBe(true)
  })

  it('[P1] [7.10-UNIT-008] known entries match only their platform, screen, fixture and rule', () => {
    const measurement = { chipRows: els(2) }
    for (const other of [
      { platform: 'native' as const },
      { screen: 'closet' as const },
      { fixture: 'empty' as const },
      { rule: 'primary-buttons' as const },
    ]) {
      const result = evaluateScreenBudget(audit(measurement), AC_LIMITS, [
        known('chip-rows', 2, other),
      ])
      expect(kinds(result)).toEqual(['chip-rows:new'])
    }
  })

  it('[P1] [7.10-UNIT-008b] only measured rules are judged, and measure errors fail', () => {
    const result = evaluateScreenBudget(
      audit({ errors: ['token primary did not resolve (x)'] }),
      AC_LIMITS,
      [known('chip-rows', 2)]
    )
    expect(result.measures).toEqual([])
    expect(result.failures).toEqual([
      {
        rule: 'measure',
        kind: 'error',
        message: 'web today (populated) measure: token primary did not resolve (x)',
      },
    ])
  })

  it('[P1] [7.10-UNIT-008c] defaults read the checked-in limits and known list', () => {
    const result = evaluateScreenBudget(audit({ primaryButtons: els(1) }))
    expect(result.measures[0]?.limit).toBe(screenBudget.limits['primary-buttons'])
  })
})

describe('CC-7.10 screen-budget.json', () => {
  const combination: Record<ScreenBudgetRule, readonly string[] | null> = {
    'targets-above-fold': null,
    'primary-buttons': null,
    'chip-rows': null,
    'nested-cards': null,
    'paragraph-lines': null,
    'today-height': ['today'],
    'closet-chrome': ['closet'],
    'analytics-only': ['today'],
  }

  // Codex #10: the live limits are governed by scripts/check-screen-budget-decisions.mjs (a
  // raise needs a recorded decision, a stricter cap needs none), so this checks only that each
  // live limit is at or under its AC value or under a decision's ceiling; the AC values stay the
  // evaluator fixtures above.
  it('[P0] [7.10-UNIT-009] every rule has a limit at or under the AC value or a recorded ceiling', () => {
    for (const rule of SCREEN_BUDGET_RULES) {
      const limit = screenBudget.limits[rule]
      expect(Number.isInteger(limit) && limit >= 0, `${rule} limit`).toBe(true)
      const ceiling = Math.max(
        AC_LIMITS[rule],
        ...screenBudget.limitDecisions
          .filter((decision) => decision.limit === rule)
          .map((decision) => decision.value)
      )
      expect(limit, `${rule}: above the AC value with no decision`).toBeLessThanOrEqual(
        ceiling
      )
    }
    expect(Object.keys(screenBudget.limits).sort()).toEqual(
      [...SCREEN_BUDGET_RULES].sort()
    )
  })

  it('[P0] [7.10-UNIT-009b] every known entry is a violation some audit can reproduce and owns a story and decision', () => {
    const seen = new Set<string>()
    for (const entry of screenBudget.known) {
      const id = `${entry.platform} ${entry.screen} ${entry.fixture} ${entry.rule}`
      expect(seen.has(id), `duplicate known entry ${id}`).toBe(false)
      seen.add(id)
      expect(screenBudget.platforms, id).toContain(entry.platform)
      expect(screenBudget.screens, id).toContain(entry.screen)
      expect(screenBudget.fixtures, id).toContain(entry.fixture)
      expect(SCREEN_BUDGET_RULES, id).toContain(entry.rule)
      const screens = combination[entry.rule]
      if (screens)
        expect(screens, `${id}: rule is not measured on this screen`).toContain(
          entry.screen
        )
      expect(entry.value, `${id}: a known value is over its limit`).toBeGreaterThan(
        entry.rule === 'paragraph-lines' ? 0 : screenBudget.limits[entry.rule]
      )
      expect(SCREEN_BUDGET_OWNING_STORIES, id).toContain(entry.story)
      expect(entry.decision, id).toMatch(/^D-[A-Z0-9.-]+$/)
      expect(entry.decidedIn, id).toMatch(/^7\.\d+$/)
      if ((SCREEN_BUDGET_PER_ELEMENT_RULES as readonly string[]).includes(entry.rule))
        expect(entry.elements ?? [], `${id}: one key per counted element`).toHaveLength(
          entry.value
        )
      else expect(entry.elements, `${id}: count rules list no elements`).toBeUndefined()
    }
  })

  it('[P1] [7.10-UNIT-009c] every platform names tab bar, tile and screen selectors', () => {
    for (const platform of screenBudget.platforms) {
      expect(screenBudget.tabBarSelectors[platform].length).toBeGreaterThan(0)
      expect(screenBudget.tileSelectors[platform].length).toBeGreaterThan(0)
      expect(screenBudget.selectors[platform].closetAnchors.length).toBeGreaterThan(0)
    }
    expect(screenBudget.measure).toEqual({
      viewport: { width: 390, height: 844 },
      minCardSizePx: 64,
    })
  })
})

describe('CC-7.10 screenBudgetMeasureConfig', () => {
  it('[P0] [7.10-UNIT-011] web reads the live CSS variables; Today asks for the document height', () => {
    const config = screenBudgetMeasureConfig('web', 'today')
    expect(config.tokens).toEqual(
      expect.objectContaining({
        primary: 'rgb(var(--cc-primary))',
        card: 'rgb(var(--cc-card))',
        cardMuted: 'rgb(var(--cc-card-muted))',
      })
    )
    expect(config.tokens.cardShadow).not.toBe('')
    expect(config.todayHeight).toEqual({
      selector: screenBudget.selectors.web.todayHeight,
    })
    expect(config.closetChrome).toBeUndefined()
    expect(config.tabBarSelectors).toEqual(screenBudget.tabBarSelectors.web)
    expect(config.tileSelectors).toEqual(screenBudget.tileSelectors.web)
    expect(config.viewport).toEqual({ width: 390, height: 844 })
  })

  it('[P0] [7.10-UNIT-011b] native paints the role values of the scheme; Closet asks for its anchors', () => {
    const light = screenBudgetMeasureConfig('native', 'closet')
    expect(light.tokens.primary).toBe(colorRoles.light.primary)
    expect(light.tokens.card).toBe(colorRoles.light.card)
    expect(light.tokens.cardMuted).toBe(colorRoles.light.cardMuted)
    expect(light.tokens.cardShadow).toMatch(/^0px \d+px [\d.]+px /)
    expect(light.closetChrome).toEqual({
      anchors: screenBudget.selectors.native.closetAnchors,
    })
    expect(light.todayHeight).toBeUndefined()
    const dark = screenBudgetMeasureConfig('native', 'community', { scheme: 'dark' })
    expect(dark.tokens.primary).toBe(colorRoles.dark.primary)
    expect(dark.todayHeight).toBeUndefined()
    expect(dark.closetChrome).toBeUndefined()
  })

  it('[P2] [7.10-UNIT-011c] a passed budget file replaces the checked-in one', () => {
    const budget = {
      ...screenBudget,
      measure: { viewport: { width: 320, height: 640 }, minCardSizePx: 48 },
    }
    const config = screenBudgetMeasureConfig('web', 'profile', { budget })
    expect(config.viewport).toEqual({ width: 320, height: 640 })
    expect(config.minCardSizePx).toBe(48)
  })
})

describe('CC-7.10 isAnalyticsRequest', () => {
  const page = 'https://app.example.test/'

  it.each([
    ['https://app.example.test/ingest/e/?ip=1', true],
    ['/ingest/decide', true],
    ['https://us.i.posthog.com/e/', true],
    ['https://otel.example.test/v1/traces', true],
    ['https://otel.example.test/v1/logs', true],
    ['https://otel.example.test/v1/metrics', true],
    ['https://other.example.test/ingest/e/', false],
    ['https://app.example.test/api/v1/ritual', false],
    ['https://app.example.test/ingestion', false],
    ['https://posthog.com.evil.test/e/', false],
  ])('[P0] [7.10-UNIT-010] %s is analytics: %s', (url, expected) => {
    expect(isAnalyticsRequest(url, page)).toBe(expected)
  })

  it('[P1] [7.10-UNIT-010b] an unparsable page URL is never analytics; an empty entry matches nothing', () => {
    expect(isAnalyticsRequest('/ingest/e', 'not a url')).toBe(false)
    expect(isAnalyticsRequest('https://app.example.test/x', page, [{}])).toBe(false)
    expect(
      isAnalyticsRequest('https://cdn.example.test/a.b/x', page, [{ path: '/a.b/*' }])
    ).toBe(true)
    expect(
      isAnalyticsRequest('https://cdn.example.test/aXb/x', page, [{ path: '/a.b/*' }])
    ).toBe(false)
  })
})
