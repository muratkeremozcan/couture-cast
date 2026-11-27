// Learning path Step 66: One app shell and visual system.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-66-one-app-shell-and-visual-system
// Learning path Step 71: Today's outfit as a picture.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-71-todays-outfit-as-a-picture
// Story CC-7.9 test owner (TEA): 7.9-VIS-001..008, AC6 and spec D11.
// Test design: _bmad-output/test-artifacts/test-design-7-9-one-app-shell-visual-system.md.
//
// Each tab in light and dark at 390 x 844, against the CC-7.7 populated shell fixtures for one
// fixed member, with a fixed clock, time zone and locale. The structural rules (56 px top bar,
// one page surface, one card level, gold only by role) are proven by name in
// app-shell-visual-system.spec.ts; these snapshots lock everything those rules do not name.
//
// Baselines are Linux Chromium only (`*-chromium-linux.png`) and come from CI, never from a
// laptop: a missing or changed baseline fails the run and the job uploads the new PNG under
// `visual-actuals` in the shard's blob-report artifact. `npm run visual:pull-baselines -- <run>`
// copies them into place for review and commit.
import { expect, test } from '../support/fixtures/merged-fixtures'
import {
  FIXED_NOW,
  openFixtureShell,
  SCHEMES,
  SHELL_SCREENS,
  SHELL_TABS,
  waitForShellSettled,
} from '../support/helpers/app-shell'
import { serveTodayPhoto } from '../support/helpers/today-outfit-photo'

test.use({
  authSessionEnabled: false,
  viewport: { width: 390, height: 844 },
  // 1x keeps each PNG small; the layout is the same as at the 3x the layout-shift spec uses.
  deviceScaleFactor: 1,
  isMobile: true,
  hasTouch: true,
  locale: 'en-US',
  timezoneId: 'America/Chicago',
})

const VIS_ID: Record<string, string> = {
  'home-light': '7.14-VIS-001',
  'closet-light': '7.9-VIS-002',
  'community-light': '7.9-VIS-003',
  'profile-light': '7.9-VIS-004',
  'home-dark': '7.14-VIS-001',
  'closet-dark': '7.9-VIS-006',
  'community-dark': '7.9-VIS-007',
  'profile-dark': '7.9-VIS-008',
  // Story CC-7.11 D1, D8: the Looks tab joins the shell tabs, with its own two baselines.
  'looks-light': '7.11-VIS-001',
  'looks-dark': '7.11-VIS-002',
}

const todayVariants = [
  { name: 'home-empty-closet-light', mode: 'empty-closet', fail: false },
  { name: 'home-missing-photo-light', mode: 'populated', fail: true },
] as const

test.describe('CC-7.9 tab snapshots @local-lane', () => {
  for (const scheme of SCHEMES) {
    for (const screen of SHELL_SCREENS) {
      const name = `${screen}-${scheme}`
      test(`[P1] [${VIS_ID[name]}] ${screen} matches its ${scheme} baseline at 390 x 844`, async ({
        page,
        interceptNetworkCall,
      }) => {
        await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' })
        await page.clock.setFixedTime(FIXED_NOW)
        const photo = screen === 'home' ? await serveTodayPhoto(page) : undefined
        const { router } = await openFixtureShell(page, interceptNetworkCall, {
          mode: 'populated',
          screen,
          todayPhotoUrl: photo?.url,
        })

        await page.goto(SHELL_TABS[screen].path)
        await waitForShellSettled(page, router)
        // A failed session also opens the gate: the snapshot must be the member's screen.
        await expect(page.locator('html')).toHaveAttribute('data-session', 'member')
        await expect(page.getByTestId('app-header')).toBeVisible()
        if (screen === 'home') {
          await expect(page.getByTestId('today-outfit-photo-0')).toBeVisible()
          await expect(page.getByTestId('today-outfit-catalog-1')).toBeVisible()
        }

        await expect(page).toHaveScreenshot(`${name}.png`, {
          animations: 'disabled',
          caret: 'hide',
          maxDiffPixelRatio: 0.01,
        })
        expect(
          router.unknown().filter((request) => request.startsWith('GET ')),
          'reads the shell fixtures do not serve: add them to helpers/shell-fixtures.ts'
        ).toEqual([])
        expect(router.unauthenticated(), 'member reads sent without the bearer').toEqual(
          []
        )
      })
    }
  }

  for (const { name, mode, fail } of todayVariants) {
    test(`[P1] [7.14-VIS-001] ${name} matches its baseline at 390 x 844`, async ({
      page,
      interceptNetworkCall,
    }) => {
      await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' })
      await page.clock.setFixedTime(FIXED_NOW)
      const photo = fail ? await serveTodayPhoto(page, { fail }) : undefined
      const { router } = await openFixtureShell(page, interceptNetworkCall, {
        mode,
        screen: 'home',
        todayPhotoUrl: photo?.url,
      })

      await page.goto('/')
      await waitForShellSettled(page, router)
      await expect(page.locator('html')).toHaveAttribute('data-session', 'member')
      await expect(page.getByTestId('today-outfit-catalog-0')).toBeVisible()
      await expect(page.getByTestId('today-outfit-catalog-1')).toBeVisible()
      await expect(page.getByTestId('today-outfit-catalog-2')).toBeVisible()
      await expect(page.getByTestId('today-outfit-photo-0')).toBeHidden()
      if (fail) {
        await photo?.requested
        await expect(page.getByTestId('home-closet-strip')).toBeVisible()
      } else await expect(page.getByTestId('home-add-garment')).toBeVisible()

      await expect(page).toHaveScreenshot(`${name}.png`, {
        animations: 'disabled',
        caret: 'hide',
        maxDiffPixelRatio: 0.01,
      })
    })
  }
})
