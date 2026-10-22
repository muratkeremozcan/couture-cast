// Scenario tabs with long localized labels: every label stays on one line inside its tab
// on a 360-point-wide phone, and short labels still spread the tabs across the full row.
import React from 'react'
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ScenarioToggles } from './scenario-toggles'

const labelOverrides = vi.hoisted((): Record<string, string> => ({}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { defaultValue?: string }) =>
      labelOverrides[key] ?? values?.defaultValue ?? key,
  }),
}))

// A 360-point phone; the toggles add their own 16-point side margins.
function renderOnPhone() {
  render(
    <div style={{ width: 360 }}>
      <ScenarioToggles activeScenario="morning" onScenarioChange={() => undefined} />
    </div>
  )
}

function setLabels(morning: string, midday: string, evening: string) {
  Object.assign(labelOverrides, {
    'hero.scenarios.morning': morning,
    'hero.scenarios.midday': midday,
    'hero.scenarios.evening': evening,
  })
}

describe('ScenarioToggles long localized labels', () => {
  afterEach(() => {
    for (const key of Object.keys(labelOverrides)) delete labelOverrides[key]
  })

  // The longest scenario labels across the 10 locales: it-IT, pt-PT and fr-FR.
  it.each([
    ['Pendolarismo mattutino', 'Mezzogiorno', 'Piani serali'],
    ['Percurso da manhã', 'Meio-dia', 'Planos para a noite'],
    ['Trajet du matin', 'Midi', 'Projets de soirée'],
  ])('6.5-MOB-POLISH-08 keeps %s, %s and %s on one line', (morning, midday, evening) => {
    setLabels(morning, midday, evening)
    renderOnPhone()

    for (const label of [morning, midday, evening]) {
      const text = screen.getByText(label)
      const range = document.createRange()
      range.selectNodeContents(text)
      const lineTops = new Set(
        Array.from(range.getClientRects(), (rect: DOMRect) => Math.round(rect.top))
      )
      expect(lineTops.size, `${label} line count`).toBe(1)
      const tab = text.closest('[data-testid^="scenario-toggle-"]')
      if (!tab) throw new Error(`No tab wraps ${label}`)
      const tabRect = tab.getBoundingClientRect()
      const tabStyle = getComputedStyle(tab)
      const textRect = range.getBoundingClientRect()
      expect(textRect.left, `${label} left edge`).toBeGreaterThanOrEqual(
        tabRect.left + parseFloat(tabStyle.paddingLeft)
      )
      expect(textRect.right, `${label} right edge`).toBeLessThanOrEqual(
        tabRect.right - parseFloat(tabStyle.paddingRight)
      )
    }
  })

  it('6.5-MOB-POLISH-09 spreads short labels across the full row', () => {
    setLabels('Morning commute', 'Midday', 'Evening plans')
    renderOnPhone()

    const row = screen.getByTestId('scenario-toggles').getBoundingClientRect()
    const first = screen.getByTestId('scenario-toggle-morning').getBoundingClientRect()
    const last = screen.getByTestId('scenario-toggle-evening').getBoundingClientRect()
    expect(Math.round(first.left)).toBe(Math.round(row.left))
    expect(Math.round(last.right)).toBe(Math.round(row.right))
  })
})
