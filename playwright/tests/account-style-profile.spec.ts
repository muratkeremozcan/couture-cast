// Learning path Step 77: Account style profile.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-77-account-style-profile
import {
  styleProfileResponseSchema,
  updateStyleProfileInputSchema,
  type StyleProfile,
  type UpdateStyleProfileInput,
} from '@couture/api-client/contracts/http'
import type { InterceptNetworkCallFn } from '@seontechnologies/playwright-utils/intercept-network-call'
import { expect, test } from '../support/fixtures/merged-fixtures'
import {
  FIXED_NOW,
  openFixtureShell,
  waitForShellSettled,
} from '../support/helpers/app-shell'
import { fixtureOwner } from '../support/helpers/shell-fixtures'

const MEMBER = 'style-profile-member'
const EMPTY_PROFILE: StyleProfile = {
  mood: null,
  palette: null,
  texture: null,
  fit: null,
  avoid: [],
}

function serveStyleProfile(
  interceptNetworkCall: InterceptNetworkCallFn,
  initial = EMPTY_PROFILE
) {
  let profile = initial
  const writes: (UpdateStyleProfileInput | 'clear')[] = []
  void interceptNetworkCall({
    url: '**/api/v1/personalization/style-profile',
    handler: async (route, request) => {
      if (fixtureOwner(request.headers().authorization) !== MEMBER) {
        await route.fulfill({ status: 401, json: { message: 'Unauthorized' } })
        return
      }
      switch (request.method()) {
        case 'GET':
          break
        case 'PATCH': {
          const patch = updateStyleProfileInputSchema.parse(request.postDataJSON())
          writes.push(patch)
          profile = { ...profile, ...patch }
          break
        }
        case 'DELETE':
          writes.push('clear')
          profile = EMPTY_PROFILE
          break
        default:
          await route.fulfill({ status: 405, json: { message: 'Method not allowed' } })
          return
      }
      await route.fulfill({ json: styleProfileResponseSchema.parse({ data: profile }) })
    },
  })
  return writes
}

test.use({
  authSessionEnabled: false,
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  locale: 'en-US',
  timezoneId: 'America/Chicago',
})

test.describe('CC-7.20 Account style profile @local-lane', () => {
  test('[P0] [7.20-FIRST] a guardian-pending member sees the look while style answers load and can skip all three screens', async ({
    page,
    interceptNetworkCall,
    recurse,
  }, testInfo) => {
    await page.clock.setFixedTime(FIXED_NOW)
    const { router } = await openFixtureShell(page, interceptNetworkCall, {
      mode: 'guardian-pending',
      screen: 'home',
    })
    const release = router.hold('style-profile')
    try {
      await page.goto('/')
      await recurse(
        () => Promise.resolve(router.calls('style-profile')),
        (calls) => calls > 0
      )
      const firstLook = page.getByTestId('today-first-content')
      await expect(firstLook.getByTestId('member-sample-outfit')).toBeVisible()
      await expect(firstLook.getByTestId('home-set-city')).toBeEnabled()
    } finally {
      release()
    }

    const moods = page.getByTestId(/^style-mood-(active|chic|cozy|classic)$/)
    await expect(moods).toHaveCount(4)
    for (const [index, name] of ['Sporty', 'Chic', 'Cozy', 'Classic'].entries()) {
      const option = moods.nth(index)
      await expect(option).toHaveAccessibleName(name)
      await expect(option.locator('svg, img').first()).toBeVisible()
      await expect(option).toHaveAttribute('aria-pressed', 'false')
    }
    const row = await moods.evaluateAll((buttons) =>
      buttons.map((button) => {
        const { x, y, right } = button.getBoundingClientRect()
        return { x, y, right }
      })
    )
    expect(
      Math.max(...row.map(({ y }) => y)) - Math.min(...row.map(({ y }) => y))
    ).toBeLessThanOrEqual(1)
    expect(row[0]!.x).toBeGreaterThanOrEqual(0)
    expect(row[3]!.right).toBeLessThanOrEqual(390)
    expect(row.map(({ x }) => x)).toEqual(row.map(({ x }) => x).sort((a, b) => a - b))

    await moods.first().scrollIntoViewIfNeeded()
    await testInfo.attach('Today mood choices at 390px', {
      body: await page.screenshot({ animations: 'disabled' }),
      contentType: 'image/png',
    })

    await page.getByTestId('style-tune-open').click()
    const skip = page.getByTestId('style-tune-skip')
    const palette = page.getByTestId('style-palette-neutral')
    await expect(palette).toBeVisible()
    await palette.scrollIntoViewIfNeeded()
    await testInfo.attach('Tune my style palette at 390px', {
      body: await page.screenshot({ animations: 'disabled' }),
      contentType: 'image/png',
    })
    await skip.click()
    await expect(page.getByTestId('style-texture-smooth')).toBeVisible()
    await expect(page.getByTestId('style-fit-fitted')).toBeVisible()
    await skip.click()
    await expect(page.getByTestId('style-avoid-mini-skirt')).toBeVisible()
    await skip.click()
    await expect(skip).toBeHidden()
    await expect(page.getByTestId('today-first-content')).toBeVisible()
    expect(
      router.unknown().filter((request) => request.endsWith('/style-profile'))
    ).toEqual([])
  })

  test('[P0] [7.20-TUNE] saves each completed screen and reopens and clears the account answers in Profile', async ({
    page,
    interceptNetworkCall,
    recurse,
  }) => {
    await page.clock.setFixedTime(FIXED_NOW)
    const { setScreen } = await openFixtureShell(page, interceptNetworkCall, {
      mode: 'empty',
      screen: 'home',
      memberId: MEMBER,
    })
    const writes = serveStyleProfile(interceptNetworkCall)
    await page.goto('/')
    await expect(page.getByTestId('member-sample-outfit')).toBeVisible()
    const mood = page.getByTestId('style-mood-chic')
    await mood.click()
    await expect(mood).toHaveAttribute('aria-pressed', 'true')
    await recurse(
      () => Promise.resolve(writes.length),
      (count) => count === 1
    )
    expect(writes).toEqual([{ mood: 'chic' }])

    const open = page.getByTestId('style-tune-open')
    const next = page.getByTestId('style-tune-next')
    const skip = page.getByTestId('style-tune-skip')
    const palette = page.getByTestId('style-palette-colorful')
    const avoid = page.getByTestId('style-avoid-mini-skirt')
    await open.click()
    await expect(palette).toHaveAccessibleName('Colorful')
    await palette.click()
    await expect(palette).toHaveAttribute('aria-pressed', 'true')
    await next.click()
    await expect(page.getByTestId('style-texture-smooth')).toBeVisible()
    expect(writes).toEqual([{ mood: 'chic' }, { palette: 'colorful' }])
    await skip.click()
    await expect(avoid).toHaveAccessibleName('Mini skirt')
    await expect(avoid.locator('svg, img').first()).toBeVisible()
    expect(writes).toHaveLength(2)
    await avoid.click()
    await expect(avoid).toHaveAttribute('aria-pressed', 'true')
    await next.click()
    await expect(next).toBeHidden()
    expect(writes).toEqual([
      { mood: 'chic' },
      { palette: 'colorful' },
      { avoid: ['mini-skirt'] },
    ])

    setScreen('profile')
    await page.getByTestId('bottom-nav-settings').click()
    await page.getByTestId('profile-style-row').click()
    await expect(page).toHaveURL(/\/settings\/style$/)
    await page.reload()
    await expect(mood).toHaveAttribute('aria-pressed', 'true')
    await open.click()
    await expect(palette).toHaveAttribute('aria-pressed', 'true')
    await skip.click()
    await skip.click()
    await expect(avoid).toHaveAttribute('aria-pressed', 'true')
    await skip.click()

    await page.getByTestId('style-profile-clear').click()
    await expect(mood).toHaveAttribute('aria-pressed', 'false')
    expect(writes).toHaveLength(4)
    expect(writes.at(-1)).toBe('clear')
    await page.reload()
    await expect(mood).toHaveAttribute('aria-pressed', 'false')
    await open.click()
    await expect(palette).toHaveAttribute('aria-pressed', 'false')
    await skip.click()
    await skip.click()
    await expect(avoid).toHaveAttribute('aria-pressed', 'false')
  })

  test('[P1] [7.20-DAY] Today and Looks share a day override that expires at local midnight', async ({
    page,
    interceptNetworkCall,
  }) => {
    await page.clock.setFixedTime(new Date('2026-11-21T05:50:00Z'))
    const { router, setScreen } = await openFixtureShell(page, interceptNetworkCall, {
      mode: 'populated',
      screen: 'home',
      memberId: MEMBER,
    })
    const writes = serveStyleProfile(interceptNetworkCall, {
      ...EMPTY_PROFILE,
      mood: 'chic',
    })
    await page.goto('/')
    await waitForShellSettled(page, router)
    await expect(page.getByTestId('today-primary-action')).toBeVisible()
    await expect(page.getByTestId('member-sample-outfit')).toBeHidden()

    const open = page.getByTestId('style-day-open')
    const cool = page.getByTestId('style-day-temperature-cool')
    const sporty = page.getByTestId('style-day-mood-active')
    const cozy = page.getByTestId('style-day-mood-cozy')
    await expect(page.getByTestId('style-tune-open')).toBeHidden()
    await open.click()
    await expect(page.getByTestId('style-tune-open')).toBeVisible()
    await cool.click()
    await sporty.click()
    await expect(cool).toHaveAttribute('aria-pressed', 'true')
    await expect(sporty).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('member-sample-label')).toHaveText(
      'Sample look for today'
    )
    await expect(page.getByTestId('weather-header')).toBeVisible()

    setScreen('looks')
    await page.getByTestId('bottom-nav-looks').click()
    await page.getByTestId('looks-segment-ideas').click()
    await expect(page.getByTestId('lookbook-mood-active')).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    await open.click()
    await expect(cool).toHaveAttribute('aria-pressed', 'true')
    await expect(sporty).toHaveCount(0)
    await page.getByTestId('style-day-reset').click()
    await expect(cool).toHaveAttribute('aria-pressed', 'false')

    setScreen('home')
    await page.getByTestId('bottom-nav-home').click()
    await open.click()
    await expect(sporty).toHaveAttribute('aria-pressed', 'false')
    await cool.click()
    await cozy.click()
    await expect(cozy).toHaveAttribute('aria-pressed', 'true')
    await page.clock.setFixedTime(new Date('2026-11-21T06:01:00Z'))

    setScreen('looks')
    await page.getByTestId('bottom-nav-looks').click()
    await page.getByTestId('looks-segment-ideas').click()
    await open.click()
    await expect(cool).toHaveAttribute('aria-pressed', 'false')

    setScreen('home')
    await page.getByTestId('bottom-nav-home').click()
    await expect(page.getByTestId('today-primary-action')).toBeVisible()
    await expect(page.getByTestId('member-sample-outfit')).toBeHidden()
    await open.click()
    await expect(cozy).toHaveAttribute('aria-pressed', 'false')

    setScreen('profile')
    await page.getByTestId('bottom-nav-settings').click()
    await page.getByTestId('profile-style-row').click()
    await expect(page.getByTestId('style-mood-chic')).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(writes).toEqual([])
  })
})
