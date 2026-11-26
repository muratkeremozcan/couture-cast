// Learning path Step 66: One app shell and visual system.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-66-one-app-shell-and-visual-system
// Story CC-7.9 test owner (TEA): 7.9-E2E-009, Wardrobe strings from the catalogs in de-DE (spec
// D9). Split from app-shell-visual-system.spec.ts so the burn-in shards spread the suite.
// Test design: _bmad-output/test-artifacts/test-design-7-9-one-app-shell-visual-system.md.
import enUS from '../../apps/web/src/i18n/locales/en-US.json'
import deDE from '../../apps/web/src/i18n/locales/de-DE.json'
import { expect, test } from '../support/fixtures/merged-fixtures'
import { openFixtureShell } from '../support/helpers/app-shell'

test.use({
  authSessionEnabled: false,
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
})

/** Hard-coded English on Wardrobe and capsules at the 812cadce baseline (spec D9). */
const BASELINE_ENGLISH = [
  'Your Digital Closet',
  'Wardrobe Hub',
  '+ Add Garment',
  'Snap or Import Garment',
  'Outfit capsules',
  'Needs tags',
  'Photograph or upload clothing items to power personalized weather guidance.',
  'Curate and manage your custom outfit combinations.',
  'Filter by occasion',
  'Loading outfit capsules…',
  'Casual',
  'Evening',
  'Formal',
  'Outdoor',
  'Travel',
]

const flatten = (value: unknown, prefix = ''): Record<string, string> =>
  typeof value === 'string'
    ? { [prefix]: value }
    : Object.entries(value as Record<string, unknown>).reduce<Record<string, string>>(
        (all, [key, child]) => ({
          ...all,
          ...flatten(child, prefix ? `${prefix}.${key}` : key),
        }),
        {}
      )

test.describe('CC-7.9 Wardrobe strings from the catalogs @local-lane', () => {
  test.use({ locale: 'de-DE' })

  for (const screen of [
    { name: 'Wardrobe', path: '/wardrobe' },
    { name: 'capsules', path: '/wardrobe/capsules' },
  ]) {
    test(`[P1] [7.9-E2E-009] ${screen.name} in de-DE shows no English`, async ({
      page,
      interceptNetworkCall,
    }) => {
      await openFixtureShell(page, interceptNetworkCall, {
        mode: 'populated',
        screen: 'closet',
      })
      await page.goto(screen.path)
      await expect(page.getByTestId('app-header')).toBeVisible()
      await expect(page.locator('html')).toHaveAttribute('lang', /^de/)
      // The opened gate keeps its hidden placeholder in the DOM; only a visible busy node counts.
      await expect(page.locator('main [aria-busy="true"]:visible')).toHaveCount(0)

      const texts = await page.evaluate(() => {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
        const seen = new Set<string>()
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const parent = node.parentElement
          if (!parent || parent.closest('script, style, [aria-hidden="true"]')) continue
          const rect = parent.getBoundingClientRect()
          if (rect.width === 0 || rect.height === 0) continue
          const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim()
          if (text) seen.add(text)
        }
        for (const element of Array.from(
          document.querySelectorAll('[aria-label], [placeholder]')
        ))
          for (const name of ['aria-label', 'placeholder'])
            if (element.getAttribute(name)) seen.add(element.getAttribute(name)!.trim())
        return [...seen]
      })

      const en = flatten(enUS)
      const de = flatten(deDE)
      const untranslated = new Set(
        Object.entries(en)
          .filter(([key, value]) => de[key] !== value && value.length > 3)
          .map(([, value]) => value)
      )
      expect(
        texts.filter((text) => BASELINE_ENGLISH.includes(text)),
        'hard-coded English from before CC-7.9'
      ).toEqual([])
      expect(
        texts.filter((text) => untranslated.has(text)),
        'en-US catalog text where de-DE has its own'
      ).toEqual([])
    })
  }

  test('[P1] [7.9-E2E-009] the top bar back control is named from the de-DE catalog', async ({
    page,
    interceptNetworkCall,
  }) => {
    await openFixtureShell(page, interceptNetworkCall, {
      mode: 'populated',
      screen: 'closet',
    })
    await page.goto('/wardrobe/capsules')
    await expect(
      page.getByTestId('app-header').getByTestId('app-top-bar-back')
    ).toHaveAccessibleName(deDE.shell.back)
  })
})
