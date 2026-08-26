// Learning path Step 36: Colour palette, beauty and accessory advisor.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-36-colour-palette-beauty-and-accessory-advisor
// Story 5.4 Task 2/3: every ADVISOR_RULES swatchHex passes meetsWcagAA()
// against the surface it renders on, exactly as 5.3's Decision 2/3 required
// for the premium theme accents (which found two of three failing the
// small-text floor -- a demonstrated hazard on this codebase, not
// hypothetical caution).
import { meetsWcagAA } from '@couture/utils'
import { describe, expect, it } from 'vitest'
import {
  ADVISOR_RULES,
  ADVISOR_RULES_VERSION,
  ADVISOR_SWATCH_CARD_BACKGROUND,
  listAdvisorRuleEntries,
  resolveAdvisorRuleEntry,
} from '../src/contracts/http'

describe('ADVISOR_RULES', () => {
  it('5.4-CON-001 is a versioned, non-empty rule table', () => {
    expect(ADVISOR_RULES_VERSION).toBe('palette-advisor-v1')
    expect(listAdvisorRuleEntries().length).toBeGreaterThan(0)
  })

  it('5.4-CON-002 gives every entry a stable, namespaced itemKey and a locale labelKey, never an English shade name', () => {
    for (const entry of listAdvisorRuleEntries()) {
      expect(entry.itemKey).toMatch(/^advisor:(foundation|blush|jewelry|bag|eyewear):/)
      expect(entry.labelKey).toMatch(/^commerce\.premium\.palette\.shades\./)
      // The rule table is data, not prose: a labelKey never looks like an
      // English word a component could render directly without translation.
      expect(entry.labelKey).not.toMatch(/[A-Z]/)
    }
  })

  it('5.4-CON-003 has no duplicate itemKey across the whole table', () => {
    const itemKeys = listAdvisorRuleEntries().map((entry) => entry.itemKey)
    expect(new Set(itemKeys).size).toBe(itemKeys.length)
  })

  it('5.4-CON-004 resolves a known itemKey and returns undefined for a retired one', () => {
    const [firstEntry] = listAdvisorRuleEntries()
    expect(firstEntry).toBeDefined()
    expect(resolveAdvisorRuleEntry(firstEntry!.itemKey)).toEqual(firstEntry)
    expect(resolveAdvisorRuleEntry('advisor:foundation:retired-version')).toBeUndefined()
  })

  it.each(
    listAdvisorRuleEntries().map((entry) => [entry.itemKey, entry.swatchHex] as const)
  )(
    '5.4-CON-030 %s swatchHex %s passes meetsWcagAA against the advisor card background',
    (itemKey, swatchHex) => {
      expect(
        meetsWcagAA(swatchHex, ADVISOR_SWATCH_CARD_BACKGROUND, { largeText: true })
      ).toBe(true)
    }
  )

  it('5.4-CON-031 the table is frozen, so a (undertone, depth) lookup cannot drift at runtime', () => {
    expect(Object.isFrozen(ADVISOR_RULES)).toBe(true)
  })

  it('5.4-CON-005 the same (undertone, depth) always resolves to the same entry', () => {
    const first = ADVISOR_RULES.warm.foundation.withDepth.medium
    const second = ADVISOR_RULES.warm.foundation.withDepth.medium
    expect(first).toEqual(second)
  })
})
