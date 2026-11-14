// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// Story 6.15 F-00i: the text layout probe fixture renders only when the probe flag was inlined
// at bundle time, and then holds the healthy label and its one-line hidden-overflow mutant.
import { render } from 'vitest-browser-react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import TextClipFixtureRoute from '@/app/text-clip-fixture'

vi.mock('expo-router', () => ({ Stack: { Screen: () => null } }))

const label = 'Show watermark on the card\nCard preview below'

describe('text clip fixture route', () => {
  const previous = process.env.EXPO_PUBLIC_TEXT_LAYOUT_PROBE
  afterEach(() => {
    if (previous === undefined) delete process.env.EXPO_PUBLIC_TEXT_LAYOUT_PROBE
    else process.env.EXPO_PUBLIC_TEXT_LAYOUT_PROBE = previous
  })

  for (const flag of [undefined, '0', 'true']) {
    it(`renders nothing when the probe flag is ${String(flag)}`, async () => {
      if (flag === undefined) delete process.env.EXPO_PUBLIC_TEXT_LAYOUT_PROBE
      else process.env.EXPO_PUBLIC_TEXT_LAYOUT_PROBE = flag
      const view = await render(<TextClipFixtureRoute />)
      expect(view.container.innerHTML).toBe('')
    })
  }

  it('renders the healthy label and its clipped mutant with the probe flag', async () => {
    process.env.EXPO_PUBLIC_TEXT_LAYOUT_PROBE = '1'
    const view = await render(<TextClipFixtureRoute />)
    const healthy = view.container.querySelector<HTMLElement>(
      '[data-testid="text-clip-healthy"]'
    )
    const mutant = view.container.querySelector<HTMLElement>(
      '[data-testid="text-clip-mutant"]'
    )
    if (!healthy || !mutant) throw new Error('fixture labels missing')
    // Both keep the whole two-line text for accessibility.
    expect(healthy.textContent).toBe(label)
    expect(mutant.textContent).toBe(label)
    const healthyBox = healthy.parentElement!.getBoundingClientRect()
    const mutantBox = mutant.parentElement!
    expect(getComputedStyle(mutantBox).overflow).toBe('hidden')
    expect(mutantBox.getBoundingClientRect().height).toBe(22)
    // The mutant label keeps its two-line height; its container cuts it to one line.
    expect(mutant.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
    expect(healthyBox.height).toBeGreaterThanOrEqual(44)
  })
})
