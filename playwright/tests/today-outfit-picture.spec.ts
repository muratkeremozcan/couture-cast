// Learning path Step 71: Today's outfit as a picture.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-71-todays-outfit-as-a-picture
// Test design: _bmad-output/test-artifacts/test-design-7-14-todays-outfit-as-picture.md.
import { expect, test } from '../support/fixtures/merged-fixtures'
import {
  FIXED_NOW,
  openFixtureShell,
  waitForShellSettled,
} from '../support/helpers/app-shell'
import {
  installMeter,
  meterNow,
  settleTransition,
  shiftScore,
} from '../support/helpers/layout-shift-meter'
import { serveTodayPhoto } from '../support/helpers/today-outfit-photo'
import { measureWebScreen } from '../support/helpers/screen-budget'

test.use({
  authSessionEnabled: false,
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  locale: 'en-US',
  timezoneId: 'America/Chicago',
})

test.describe('CC-7.14 Today outfit picture @local-lane', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(FIXED_NOW)
  })

  test('[P0] [7.14-PIC-003] the card shows one weather reason and details disclose the eligible offer', async ({
    page,
    interceptNetworkCall,
  }) => {
    const { router } = await openFixtureShell(page, interceptNetworkCall, {
      mode: 'populated',
      screen: 'home',
      todayOffer: {
        partnerId: 'fixture-partner',
        partnerDisplayName: 'Fixture partner',
        offerId: 'fixture-offer',
        offerTitle: 'Warm layer',
        garmentCategory: 'top',
      },
    })
    await page.goto('/')
    await waitForShellSettled(page, router)

    const card = page.getByTestId('today-first-content')
    await expect(card.getByRole('heading', { level: 2 })).toHaveText('Warm-weather look')
    const reason = card.getByTestId('today-outfit-weather-reason')
    await expect(reason).toHaveCount(1)
    await expect(reason).toHaveText(/70\s*°F/)
    const comfort = card.getByText(/comfort note for shell-visual-member/)
    const badge = card.getByTestId('reasoning-badge-warm-layer')
    const offer = card.getByTestId('shop-this-look-block')
    await expect(comfort).toBeHidden()
    await expect(badge).toBeHidden()
    await expect(offer).toHaveCount(0)

    await card.getByTestId('today-outfit-details').click()
    await expect(comfort).toBeVisible()
    await badge.getByText('Warm layer', { exact: true }).click()
    await expect(badge.getByText('A layer helps when it cools down.')).toBeVisible()
    await expect(offer.getByTestId('shop-this-look-disclosure')).toHaveText(
      /paid partnership.*commission/i
    )
    await expect(offer.getByTestId('shop-this-look-cta')).toBeVisible()

    await card.getByTestId('today-outfit-slot-1').click()
    await page.getByTestId('today-outfit-swap-option-1').click()
    await expect(offer).toHaveCount(0)
    await expect(card.getByTestId('share-card-open')).toHaveCount(0)
    await expect(comfort).toBeVisible()
  })

  test('[P0] [7.14-PIC-001/004] a late member photo keeps the picture and control bounds', async ({
    page,
    interceptNetworkCall,
  }) => {
    await installMeter(page)
    const photo = await serveTodayPhoto(page, { hold: true })
    const { router } = await openFixtureShell(page, interceptNetworkCall, {
      mode: 'populated',
      screen: 'home',
      todayPhotoUrl: photo.url,
    })
    const picture = page.getByTestId('today-outfit-picture')
    const firstSlot = picture.getByTestId('today-outfit-slot-0')
    const primary = page.getByTestId('today-primary-action')
    const targets = [picture, firstSlot, primary]
    let before
    let fromMs
    try {
      await page.goto('/', { waitUntil: 'domcontentloaded' })
      await waitForShellSettled(page, router)
      await photo.requested
      await expect(firstSlot.getByTestId('today-outfit-catalog-0')).toBeVisible()
      await expect(primary).toBeVisible()
      before = await Promise.all(targets.map((target) => target.boundingBox()))
      expect(before.every((box) => box && box.width > 0 && box.height > 0)).toBe(true)
      fromMs = await meterNow(page)
    } finally {
      photo.release()
    }
    await expect(firstSlot.getByTestId('today-outfit-photo-0')).toBeVisible()
    await expect(firstSlot.getByTestId('today-outfit-catalog-0')).toBeHidden()
    await expect(picture.getByTestId('today-outfit-catalog-1')).toBeVisible()
    await expect(picture.getByTestId('today-outfit-catalog-2')).toBeVisible()
    const settled = await settleTransition(page, {
      screen: 'home',
      fromMs,
      inflight: router.inflight,
    })
    expect(await Promise.all(targets.map((target) => target.boundingBox()))).toEqual(
      before
    )
    expect(shiftScore(settled.shifts, fromMs)).toBeLessThanOrEqual(0.1)
  })

  test('[P0] [7.14-PIC-002] a failed photo keeps the fallback and each neighboring piece usable', async ({
    page,
    interceptNetworkCall,
  }) => {
    const photo = await serveTodayPhoto(page, { fail: true })
    const { router } = await openFixtureShell(page, interceptNetworkCall, {
      mode: 'populated',
      screen: 'home',
      todayPhotoUrl: photo.url,
    })
    await page.goto('/')
    await waitForShellSettled(page, router)
    await photo.requested
    const first = page.getByTestId('today-outfit-slot-0')
    await expect(first.locator('img')).toHaveCount(0)
    await expect(first.getByTestId('today-outfit-catalog-0')).toBeVisible()
    const next = page.getByTestId('today-outfit-slot-1')
    await next.click()
    await expect(page.getByTestId('today-outfit-swap')).toBeVisible()
    await page.getByTestId('today-outfit-swap-option-0').click()
    await expect(next).toBeFocused()
    await expect(first.getByTestId('today-outfit-catalog-0')).toBeVisible()
  })

  test('[P0] [7.14-PIC-002] the guardian-pending member can open a sample slot with catalog art', async ({
    page,
    interceptNetworkCall,
  }) => {
    const { router } = await openFixtureShell(page, interceptNetworkCall, {
      mode: 'guardian-pending',
      screen: 'home',
    })
    await page.goto('/')
    await waitForShellSettled(page, router)
    const picture = page.getByTestId('today-outfit-picture')
    await expect(picture.getByTestId('today-outfit-catalog-0')).toBeVisible()
    await expect(picture.locator('img')).toHaveCount(0)
    await picture.getByTestId('today-outfit-slot-0').click()
    await expect(page.getByTestId('today-outfit-swap-option-0')).toHaveAttribute(
      'aria-checked',
      'true'
    )
    await expect(page.getByTestId('shop-this-look-block')).toHaveCount(0)
  })

  test('[P0] [7.14-PIC-005] each piece is a 44 px target and opens a focused same-slot Swap', async ({
    page,
    interceptNetworkCall,
  }) => {
    const photo = await serveTodayPhoto(page)
    const { router } = await openFixtureShell(page, interceptNetworkCall, {
      mode: 'populated',
      screen: 'home',
      todayPhotoUrl: photo.url,
    })
    await page.goto('/')
    await waitForShellSettled(page, router)
    const picture = page.getByTestId('today-outfit-picture')
    const slots = picture.getByRole('button', { name: /swap/i })
    await expect(slots).toHaveCount(3)
    const bounds = await Promise.all(
      (await slots.all()).map((slot) => slot.boundingBox())
    )
    for (const box of bounds) {
      expect(box).not.toBeNull()
      if (!box) continue
      expect(box.width).toBeGreaterThanOrEqual(44)
      expect(box.height).toBeGreaterThanOrEqual(44)
    }
    const [top, bottomBounds, shoes] = bounds
    expect(bottomBounds!.x - (top!.x + top!.width)).toBeGreaterThanOrEqual(8)
    expect(shoes!.x - (bottomBounds!.x + bottomBounds!.width)).toBeGreaterThanOrEqual(8)
    expect((await measureWebScreen(page, 'today')).stats.tileTargets).toBe(3)

    const bottom = picture.getByTestId('today-outfit-slot-1')
    const originalName = await bottom.getAttribute('aria-label')
    const swap = page.getByTestId('today-outfit-swap')
    await expect(bottom.getByTestId('today-outfit-catalog-1')).toBeVisible()
    await bottom.click()
    await expect(swap).toBeVisible()
    await swap.getByTestId('today-outfit-swap-option-1').click()
    await expect(swap).toBeHidden()
    await expect(bottom).toBeFocused()
    await expect(bottom).not.toHaveAttribute('aria-label', originalName ?? '')
    await expect(picture.getByTestId('today-outfit-photo-0')).toBeVisible()
    await expect(picture.getByTestId('today-outfit-catalog-2')).toBeVisible()
  })
})
