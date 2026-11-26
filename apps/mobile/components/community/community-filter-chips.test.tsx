// Learning path Step 58: Production status and nightly health, production follow-ups.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#production-follow-ups-after-the-project-close
// Learning path Step 38: Community feed by climate band.
// Story 6.1 Task 8 owner: the community feed's sticky filter strip.
//
// The strip is the feed's `mode` query parameter and nothing else, so the values it
// offers are asserted against `CLIMATE_BANDS` itself rather than a copy: the first
// draft shipped invented arctic/subtropical/tropical/hyperarid ids the server never
// had, and every one of them was disabled to hide that they did not work.
import React, { createElement } from 'react'
import { run as runAxe } from 'axe-core'
import type * as ReactNativeModule from 'react-native'
import { render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { CLIMATE_BANDS } from '@couture/utils'
import type { CommunityFeedMode } from '@couture/api-client/contracts/http'

vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US', languageCode: 'en', regionCode: 'US' }],
}))

/**
 * `accessibilityState` is a NATIVE-only prop: react-native-web's `forwardedProps`
 * table carries `aria-selected` and `accessibilitySelected` but no `accessibilityState`,
 * so the object form never reaches the DOM and no DOM assertion can observe it. The
 * recorder renders the REAL `TouchableOpacity`, so the press behaviour, the styling
 * assertions and the axe scan below all still run against the real component.
 */
const touchableSpy = vi.hoisted(() => ({
  props: new Map<string, Record<string, unknown>>(),
  // Filled in from this file's own React below. Importing `react` inside a mock
  // factory instantiates a second copy of it and every hook then reads a null
  // dispatcher.
  createElement: null as unknown as typeof createElement,
}))
vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactNativeModule>()
  const RealTouchable = actual.TouchableOpacity
  function RecordingTouchable(props: Record<string, unknown>) {
    if (typeof props.testID === 'string') {
      touchableSpy.props.set(props.testID, props)
    }
    return touchableSpy.createElement(RealTouchable as never, props)
  }
  return { ...actual, TouchableOpacity: RecordingTouchable }
})

touchableSpy.createElement = createElement

import enUS from '@/assets/locales/en-US.json'
import i18n, { initI18n, supportedLocales } from '@/src/lib/i18n'
import { press } from '@/src/test-utils/press'
import { COMMUNITY_FILTER_MODES, CommunityFilterChips } from './community-filter-chips'

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

function renderChips(
  props: Partial<React.ComponentProps<typeof CommunityFilterChips>> = {}
) {
  const onSelectMode = vi.fn()
  const utils = render(
    <CommunityFilterChips
      selectedMode="auto"
      onSelectMode={onSelectMode}
      viewerBand="temperate_dry"
      {...props}
    />
  )
  return { ...utils, onSelectMode }
}

describe('CommunityFilterChips (Story 6.1)', () => {
  beforeAll(async () => {
    await initI18n()
    await i18n.changeLanguage('en-US')
  })

  beforeEach(() => {
    touchableSpy.props.clear()
  })

  it('6.1-MOB-042 offers exactly auto, all and the six real climate bands, none disabled', () => {
    expect(COMMUNITY_FILTER_MODES).toEqual(['auto', 'all', ...CLIMATE_BANDS])

    renderChips()
    expect(
      screen.getByTestId('community-sticky-filter-chips').getAttribute('aria-label')
    ).toBe(enUS.community.filters.label)

    for (const mode of COMMUNITY_FILTER_MODES) {
      const chip = screen.getByTestId(`community-filter-chip-${mode}`)
      expect(chip.getAttribute('aria-disabled')).not.toBe('true')
      expect(touchableSpy.props.get(`community-filter-chip-${mode}`)).toMatchObject({
        accessibilityRole: 'button',
      })
    }
    expect(screen.getByTestId('community-filter-chip-all').textContent).toBe(
      enUS.community.filters.mode.all
    )
    expect(screen.getByTestId('community-filter-chip-temperate_dry').textContent).toBe(
      enUS.community.filters.mode.temperate_dry
    )
  })

  it('6.1-MOB-043 announces which chip is selected and never leans on colour alone', () => {
    renderChips({ selectedMode: 'cold_wet' })

    expect(
      touchableSpy.props.get('community-filter-chip-cold_wet')?.accessibilityState
    ).toEqual({ selected: true })
    expect(
      touchableSpy.props.get('community-filter-chip-auto')?.accessibilityState
    ).toEqual({ selected: false })
    // Story CC-7.10: the same selection reaches the DOM as aria-pressed (a button takes no
    // aria-selected), which the screen budget probe and assistive tech on web read.
    expect(screen.getByTestId('community-filter-chip-cold_wet')).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(screen.getByTestId('community-filter-chip-auto')).toHaveAttribute(
      'aria-pressed',
      'false'
    )

    // Sighted readers get two non-colour cues as well: a doubled border and a
    // bolder label.
    const active = screen.getByTestId('community-filter-chip-cold_wet')
    const inactive = screen.getByTestId('community-filter-chip-auto')
    expect(active.style.borderWidth).toBe('2px')
    expect(inactive.style.borderWidth).toBe('1px')
    expect((active.firstElementChild as HTMLElement).style.fontWeight).toBe('700')
    expect((inactive.firstElementChild as HTMLElement).style.fontWeight).toBe('500')
  })

  it('6.1-MOB-044 folds a resolved viewer band into the auto chip, and copes without one', () => {
    const { rerender, onSelectMode } = renderChips()
    expect(screen.getByTestId('community-filter-chip-auto').textContent).toBe(
      'Your climate: Temperate and dry'
    )

    rerender(
      <CommunityFilterChips
        selectedMode="auto"
        onSelectMode={onSelectMode}
        viewerBand={null}
      />
    )
    expect(screen.getByTestId('community-filter-chip-auto').textContent).toBe(
      enUS.community.filters.mode.auto
    )
  })

  it('6.1-MOB-045 reports the mode that was tapped', () => {
    const { onSelectMode } = renderChips()

    const tapped: CommunityFeedMode[] = ['all', 'warm_wet']
    for (const mode of tapped) {
      press(screen.getByTestId(`community-filter-chip-${mode}`))
    }
    expect(onSelectMode.mock.calls).toEqual(tapped.map((mode) => [mode]))
  })

  it('6.1-MOB-046 has no axe violations', async () => {
    const { container } = renderChips()

    const results = await runAxe(container, {
      runOnly: { type: 'tag', values: AXE_TAGS },
    })

    // Anchors the scan the same way 6.1-MOB-041 does: `violations` is empty for a
    // clean tree and for no tree at all, and `passes` is what separates them.
    expect(results.passes.length, 'axe scanned an empty tree').toBeGreaterThan(0)

    expect(
      results.violations.map((violation) => violation.id),
      JSON.stringify(results.violations, null, 2)
    ).toEqual([])
  })

  /*
   * Production follow-up after the project close (2026-11-19): a tester asked what
   * the "Cold and wet" chip meant. Nothing on the surface said the chips filter
   * looks by the weather they were shared in, so one visible line now sits above
   * the strip. Above, not beside: it is read before the first chip, which is the
   * order a screen reader walks the strip in, and it stays put while the chips
   * scroll horizontally.
   */
  describe('climate filter explainer', () => {
    afterEach(async () => {
      await i18n.changeLanguage('en-US')
    })

    it.each(supportedLocales)(
      '%s shows the explainer above the chip strip',
      async (locale) => {
        expect(
          i18n.exists('community.filters.explainer', { lng: locale }),
          `${locale} community.filters.explainer`
        ).toBe(true)
        await i18n.changeLanguage(locale)
        const explainer = i18n.t('community.filters.explainer')

        renderChips()

        const strip = screen.getByTestId('community-sticky-filter-chips')
        const line = within(strip).getByText(explainer)
        expect(line).toBeVisible()

        const firstChip = within(strip).getByTestId(
          `community-filter-chip-${COMMUNITY_FILTER_MODES[0]}`
        )
        // DOCUMENT_POSITION_FOLLOWING: the first chip comes after the explainer.
        expect(
          line.compareDocumentPosition(firstChip) & Node.DOCUMENT_POSITION_FOLLOWING
        ).toBeTruthy()
      }
    )

    it('keeps the explainer outside the horizontally scrolling chip row', () => {
      const explainer = i18n.t('community.filters.explainer')
      renderChips()

      const firstChip = screen.getByTestId(
        `community-filter-chip-${COMMUNITY_FILTER_MODES[0]}`
      )
      const line = screen.getByText(explainer)
      // The row's scroll container is the chips' nearest common ancestor; the
      // explainer must not be inside it or it scrolls out of view with the chips.
      const lastChip = screen.getByTestId(
        `community-filter-chip-${COMMUNITY_FILTER_MODES[COMMUNITY_FILTER_MODES.length - 1]}`
      )
      let row: HTMLElement | null = firstChip.parentElement
      while (row && !row.contains(lastChip)) row = row.parentElement
      expect(row).not.toBeNull()
      expect(row).not.toContainElement(line)
    })
  })
})
