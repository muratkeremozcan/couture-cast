// Learning path Step 79: Lookbook with shuffle and pinned pieces.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-79-lookbook-with-shuffle-and-pinned-pieces
import type { Locator } from '@playwright/test'
import { styleProfileResponseSchema } from '@couture/api-client/contracts/http'
import {
  createCompletedOnboardingStateFixture,
  createReadyGarmentFixture,
} from '@couture/api-client/testing/wardrobe-fixtures'
import { getGuestPreviewStrings, SAMPLE_CATALOG, sampleGarmentText } from '@couture/utils'
import { expect, test } from '../support/fixtures/merged-fixtures'
import {
  FIXED_NOW,
  openFixtureShell,
  SHELL_TABS,
  waitForShellSettled,
} from '../support/helpers/app-shell'
import { openLooksFixture } from '../support/helpers/looks-fixtures'

const IDEAS = '/looks?segment=ideas'
const PIECES = /^lookbook-piece-/
const MOODS = /^lookbook-mood-(active|chic|classic|cozy)$/
const CLASSIC_PROFILE = styleProfileResponseSchema.parse({
  data: {
    mood: 'classic',
    palette: 'neutral',
    texture: 'smooth',
    fit: 'fitted',
    avoid: [],
  },
})

function composition(card: Locator) {
  return card.getByTestId(PIECES).evaluateAll((pieces) =>
    pieces.map((piece) => ({
      category: piece.getAttribute('data-testid')!.replace('lookbook-piece-', ''),
      itemId: piece.getAttribute('data-piece-id'),
    }))
  )
}

test.use({
  authSessionEnabled: false,
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  locale: 'en-US',
  timezoneId: 'America/Chicago',
})

test.describe('CC-7.22 Member lookbook @local-lane', () => {
  test('[P0] [7.22-IDEAS] an empty closet has one complete look per mood', async ({
    page,
    interceptNetworkCall,
  }, testInfo) => {
    const { router, setScreen } = await openLooksFixture(page, interceptNetworkCall, {
      mode: 'empty-closet',
      storedSession: true,
    })
    void interceptNetworkCall({
      url: '**/api/v1/personalization/style-profile',
      method: 'GET',
      fulfillResponse: { body: CLASSIC_PROFILE },
    })
    await page.clock.setFixedTime(FIXED_NOW)
    await page.goto(IDEAS)
    await waitForShellSettled(page, router)

    const card = page.getByTestId('member-lookbook')
    const moods = ['classic', 'chic', 'active'] as const
    await expect(card).toHaveCount(1)
    await expect(card.getByTestId(MOODS)).toHaveText(['Classic', 'Chic', 'Sporty'])
    await expect(card.getByTestId('lookbook-mood-classic')).toHaveAttribute(
      'aria-pressed',
      'true'
    )

    const row = await card.getByTestId(MOODS).evaluateAll((chips) =>
      chips.map((chip) => {
        const { left, right, top } = chip.getBoundingClientRect()
        return { left, right, top }
      })
    )
    expect(row.map(({ top }) => top)).toEqual(Array(3).fill(row[0]!.top))
    expect(row[0]!.left).toBeGreaterThanOrEqual(0)
    expect(row[2]!.right).toBeLessThanOrEqual(390)
    await testInfo.attach('Looks Ideas at 390px', {
      body: await page.screenshot({ animations: 'disabled' }),
      contentType: 'image/png',
    })

    const looks = new Set<string>()
    for (const mood of moods) {
      const chip = card.getByTestId(`lookbook-mood-${mood}`)
      await chip.click()
      await expect(
        card.locator('[data-testid^="lookbook-mood-"][aria-pressed="true"]')
      ).toHaveCount(1)
      await expect(chip).toHaveAttribute('aria-pressed', 'true')
      await expect(card.getByTestId('looks-idea-card-current')).toHaveCount(1)
      await expect(card.getByTestId('lookbook-weather-reason')).toHaveCount(1)
      await expect(card.getByTestId('lookbook-weather-reason')).toHaveText(/\S/)
      const pieces = await composition(card)
      expect(pieces.map(({ category }) => category)).toContain('shoes')
      expect(
        pieces.some(({ category }) => category === 'dress' || category === 'top')
      ).toBe(true)
      expect(
        pieces.some(({ category }) => category === 'dress' || category === 'bottom')
      ).toBe(true)
      expect(
        pieces.every(({ itemId }) =>
          SAMPLE_CATALOG.garments.some(({ id }) => id === itemId)
        )
      ).toBe(true)
      looks.add(
        pieces
          .map(({ itemId }) => itemId)
          .sort()
          .join(',')
      )
    }
    expect(looks.size).toBe(3)

    for (const screen of ['closet', 'community', 'profile'] as const) {
      setScreen(screen)
      await page.getByTestId(SHELL_TABS[screen].nav).click()
      await expect(page.getByTestId('app-top-bar-title')).toHaveText(
        SHELL_TABS[screen].title
      )
      await waitForShellSettled(page, router)
      await expect(card).toHaveCount(0)
    }
  })

  test('[P0] [7.22-SHUFFLE] reload keeps the exact draft and Reset clears the pin', async ({
    page,
    interceptNetworkCall,
  }) => {
    const { router } = await openLooksFixture(page, interceptNetworkCall, {
      mode: 'empty-closet',
      storedSession: true,
    })
    await page.clock.setFixedTime(FIXED_NOW)
    await page.goto(IDEAS)
    await waitForShellSettled(page, router)

    const card = page.getByTestId('member-lookbook')
    const mood = card.getByTestId('lookbook-mood-active')
    const pin = card.getByTestId('lookbook-pin-shoes')
    await mood.click()
    await expect(mood).toHaveAttribute('aria-pressed', 'true')
    await expect(pin).toHaveAttribute('aria-pressed', 'false')
    const before = await composition(card)
    expect(before.length).toBeGreaterThanOrEqual(3)
    await pin.click()
    await expect(pin).toHaveAttribute('aria-pressed', 'true')
    await card.getByTestId('lookbook-shuffle').click()
    const shuffled = await composition(card)
    expect(shuffled.map(({ category }) => category).sort()).toEqual(
      before.map(({ category }) => category).sort()
    )
    for (const { category, itemId } of before) {
      const after = shuffled.find((piece) => piece.category === category)!.itemId
      if (category === 'shoes') expect(after, category).toBe(itemId)
      else expect(after, category).not.toBe(itemId)
    }

    await page.reload()
    await expect(mood).toHaveAttribute('aria-pressed', 'true')
    await expect(pin).toHaveAttribute('aria-pressed', 'true')
    expect(await composition(card)).toEqual(shuffled)
    await card.getByTestId('lookbook-reset').click()
    await expect(pin).toHaveAttribute('aria-pressed', 'false')
    expect(await composition(card)).toEqual(before)
    await page.reload()
    await expect(pin).toHaveAttribute('aria-pressed', 'false')
    expect(await composition(card)).toEqual(before)
  })

  test('[P0] [7.22-SAVE] one tap saves the visible composition and clears its pins', async ({
    page,
    interceptNetworkCall,
  }) => {
    const fixture = await openLooksFixture(page, interceptNetworkCall, {
      mode: 'empty-closet',
      storedSession: true,
    })
    await page.clock.setFixedTime(FIXED_NOW)
    await page.goto(IDEAS)
    await waitForShellSettled(page, fixture.router)
    const card = page.getByTestId('member-lookbook')
    const pin = card.getByTestId('lookbook-pin-shoes')
    await pin.click()
    await expect(pin).toHaveAttribute('aria-pressed', 'true')
    await card.getByTestId('lookbook-shuffle').click()
    const displayed = await composition(card)
    await card.getByTestId('lookbook-save').click()
    await expect(pin).toHaveAttribute('aria-pressed', 'false')
    expect(await composition(card)).toEqual(displayed)

    const creates = fixture.creates()
    expect(creates).toHaveLength(1)
    const [saved] = creates
    expect(saved).toMatchObject({ source: 'home_sample', weather: 'warm-dry' })
    expect(
      saved!.composition.map(({ category, itemId, kind }) => ({ category, itemId, kind }))
    ).toEqual(displayed.map((piece) => ({ ...piece, kind: 'catalog' })))
    await page.getByTestId('looks-segment-saved').click()
    const savedTile = page.getByTestId('saved-look-card-looks-fixture-created-1')
    await expect(savedTile).toBeVisible()
    await page.reload()
    await savedTile.click()
    const slots = page.getByTestId('saved-look-detail').getByTestId(/^saved-look-slot-/)
    await expect(slots).toHaveCount(displayed.length)
    for (const [index, { itemId }] of displayed.entries()) {
      expect(itemId).toMatch(/^sample:g:/)
      await expect(slots.nth(index)).toHaveAttribute('data-slot-item-id', itemId!)
    }
    expect(fixture.creates()).toHaveLength(1)
  })

  for (const size of [0, 2, 3]) {
    test(`[P0] [7.22-TODAY] Today uses the right outfit for a closet of ${size}`, async ({
      page,
      interceptNetworkCall,
    }) => {
      const { router, setScreen } = await openFixtureShell(page, interceptNetworkCall, {
        mode: 'populated',
        screen: 'home',
        closet: {
          garments: {
            data: (['top', 'bottom', 'shoes'] as const)
              .slice(0, size)
              .map((category, index) =>
                createReadyGarmentFixture({
                  id: `shell-garment-${index + 1}`,
                  category,
                  imageAccess: null,
                })
              ),
          },
          onboarding: {
            data: createCompletedOnboardingStateFixture({ garmentsCapturedCount: size }),
          },
        },
      })
      await page.clock.setFixedTime(FIXED_NOW)
      await page.goto('/')
      await waitForShellSettled(page, router)

      const today = page.getByTestId('today-first-content')
      const sample = today.getByTestId('member-sample-outfit')
      const live = today.getByTestId('home-live-outfit')
      await expect(page.getByTestId('member-lookbook')).toHaveCount(0)
      if (size === 3) {
        await expect(live).toBeVisible()
        await expect(sample).toHaveCount(0)
      } else {
        await expect(sample).toHaveCount(1)
        await expect(sample.getByTestId('today-outfit-weather-reason')).toHaveCount(1)
        await expect(live).toHaveCount(0)
        const todaySlots = await sample
          .getByTestId(/^today-outfit-slot-/)
          .evaluateAll((slots) => slots.map((slot) => slot.getAttribute('aria-label')))
        setScreen('looks')
        await page.getByTestId('bottom-nav-looks').click()
        await page.getByTestId('looks-segment-ideas').click()
        const lookbook = page.getByTestId('member-lookbook')
        await expect(lookbook.getByTestId('lookbook-weather-reason')).toBeVisible()
        const chosen = await composition(lookbook)
        expect(todaySlots).toHaveLength(chosen.length)
        for (const { itemId } of chosen) {
          const garment = SAMPLE_CATALOG.garments.find(({ id }) => id === itemId)!
          const name = sampleGarmentText(garment, getGuestPreviewStrings('en-US')).name
          expect(
            todaySlots.some((label) => label?.endsWith(`: ${name}`)),
            name
          ).toBe(true)
        }
      }
    })
  }
})
