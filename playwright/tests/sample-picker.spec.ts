// Learning path Step 75: Find mini skirts, tights and socks.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-75-find-mini-skirts-tights-and-socks
// Test design: _bmad-output/test-artifacts/test-design-7-18-find-mini-skirts-tights-socks.md.
import {
  createSavedLookInputSchema,
  savedLookListResponseSchema,
  savedLookResponseSchema,
  type SavedLookContract,
} from '@couture/api-client/contracts/http'
import type { Locator, Page } from '@playwright/test'
import type { InterceptNetworkCallFn } from '@seontechnologies/playwright-utils/intercept-network-call'
import { expect, test } from '../support/fixtures/merged-fixtures'
import {
  FIXED_NOW,
  openFixtureShell,
  VISUAL_MEMBER_ID,
  waitForShellSettled,
} from '../support/helpers/app-shell'

const savedLookRoute = '**/api/v1/wardrobe/saved-looks'
const savedLookId = 'sample-picker-saved-look'

function stubSavedLook(interceptNetworkCall: InterceptNetworkCallFn) {
  let saved: SavedLookContract | undefined
  void interceptNetworkCall({
    url: `${savedLookRoute}*`,
    handler: async (route, request) => {
      if (request.method() === 'GET') {
        const query = new URL(request.url()).searchParams
        const data = saved ? [saved] : []
        await route.fulfill({
          json: savedLookListResponseSchema.parse({
            data,
            total: data.length,
            limit: Number(query.get('limit') ?? '50'),
            offset: Number(query.get('offset') ?? '0'),
          }),
        })
        return
      }
      if (request.method() !== 'POST') return route.fallback()
      const input = createSavedLookInputSchema.parse(request.postDataJSON())
      const response = savedLookResponseSchema.parse({
        data: {
          ...input,
          id: savedLookId,
          ownerUserId: VISUAL_MEMBER_ID,
          title: input.title ?? null,
          anchorGarmentId: input.anchorGarmentId ?? null,
          anchorSnapshot: input.anchorSnapshot ?? null,
          collection: input.collection ?? null,
          comfort: input.comfort ?? null,
          swaps: input.swaps ?? {},
          composition: input.composition.map((slot) => ({
            ...slot,
            label: slot.label ?? null,
            missing: false,
            imageAccess: null,
          })),
          availabilityStatus: 'ready',
          missingGarmentIds: [],
          needsReviewReasons: [],
          revision: 0,
          createdAt: FIXED_NOW.toISOString(),
          updatedAt: FIXED_NOW.toISOString(),
        },
      })
      saved = response.data
      await route.fulfill({ status: 201, json: response })
    },
  })
  void interceptNetworkCall({
    method: 'GET',
    url: `${savedLookRoute}/${savedLookId}`,
    handler: async (route) => {
      expect(saved, 'the account detail follows a successful save').toBeDefined()
      await route.fulfill({ json: { data: saved } })
    },
  })
  return () => saved
}

const pieces = {
  skirt: { type: 'skirts', id: 'mini-skirt', name: 'Mini skirt' },
  tights: { type: 'tights', id: 'opaque-tights', name: 'Opaque tights' },
  socks: { type: 'socks', id: 'ribbed-socks', name: 'Ribbed socks' },
} as const

function outfitPiece(outfit: Locator, piece: (typeof pieces)[keyof typeof pieces]) {
  return outfit
    .getByTestId('guest-preview-garment')
    .and(outfit.locator(`[data-garment-id="sample:g:${piece.id}"]`))
}

async function chooseFromPicker(
  page: Page,
  piece: (typeof pieces)[keyof typeof pieces],
  capturePicker?: () => Promise<void>
) {
  await page.getByTestId('guest-preview-browse-wardrobe').click()
  const picker = page.getByTestId('guest-preview-wardrobe')
  await expect(picker.getByTestId('guest-preview-collection-all')).toBeChecked()
  // The category input is visually hidden. Tap the label a member sees.
  await picker
    .locator(`label:has([data-testid="guest-preview-category-${piece.type}"])`)
    .click()
  await expect(picker.getByTestId(`guest-preview-category-${piece.type}`)).toBeChecked()
  const pieceCard = picker.getByRole('button', { name: new RegExp(`^${piece.name}\\b`) })
  if (capturePicker) {
    await pieceCard.scrollIntoViewIfNeeded()
    await capturePicker()
  }
  await pieceCard.click()
  const detail = page.getByTestId('guest-preview-item-detail')
  await expect(page.getByRole('dialog', { name: piece.name })).toBeVisible()
  await expect(detail.getByRole('img')).toBeVisible()
  await detail.getByTestId('guest-preview-use-item').click()
  await expect(outfitPiece(page.getByTestId('guest-preview-outfit'), piece)).toBeVisible()
}

test.use({
  authSessionEnabled: false,
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  locale: 'en-US',
})

test.describe('CC-7.18 sample picker @local-lane', () => {
  for (const { temperature, weather, label, from, to } of [
    {
      temperature: 'mild',
      weather: 'mild-dry',
      label: 'Mild and dry',
      from: pieces.tights,
      to: pieces.socks,
    },
    {
      temperature: 'cool',
      weather: 'cool-windy',
      label: 'Cool and windy',
      from: pieces.socks,
      to: pieces.tights,
    },
  ] as const) {
    test(`[P0] [7.18-PICK-001/SAVE-001/SWAP-001] finds sample pieces and reopens the edited look in ${label} weather`, async ({
      page,
      interceptNetworkCall,
    }, testInfo) => {
      await page.clock.setFixedTime(FIXED_NOW)
      const { router, setScreen } = await openFixtureShell(page, interceptNetworkCall, {
        mode: 'empty',
        screen: 'home',
      })
      const saved = stubSavedLook(interceptNetworkCall)
      await page.goto('/')
      await waitForShellSettled(page, router)
      await page.getByTestId('style-day-open').click()
      const choice = page.getByTestId(`style-day-temperature-${temperature}`)
      await choice.click()
      await expect(choice).toHaveAttribute('aria-pressed', 'true')
      const sample = page.getByTestId('member-sample-outfit')
      await sample.getByTestId('home-edit-sample').click()
      const outfit = sample.getByTestId('guest-preview-outfit')
      await expect(outfit.getByTestId('guest-preview-weather-chip')).toHaveText(label)

      const attachScreen = async (name: string) => {
        await testInfo.attach(name, {
          body: await page.screenshot({ animations: 'disabled' }),
          contentType: 'image/png',
        })
      }
      await chooseFromPicker(
        page,
        pieces.skirt,
        weather === 'mild-dry' ? () => attachScreen('sample-picker-phone') : undefined
      )
      await chooseFromPicker(page, from)
      const swaps = page.getByRole('dialog')
      const trigger = outfitPiece(outfit, from).getByTestId(
        'guest-preview-swap-accessory'
      )
      await trigger.click()
      const current = swaps.getByTestId(`guest-preview-swap-option-${from.id}`)
      await expect(current).toBeChecked()
      await expect(
        swaps
          .getByRole('group', {
            name: to.type === 'tights' ? 'Tights' : 'Socks',
            exact: true,
          })
          .getByTestId(`guest-preview-swap-option-${to.id}`)
      ).toBeVisible()
      await expect(
        swaps
          .getByRole('group', { name: 'Scarves', exact: true })
          .getByTestId('guest-preview-swap-option-wool-scarf')
      ).toBeVisible()
      await expect(swaps.getByRole('radio').first()).toHaveAttribute(
        'data-testid',
        `guest-preview-swap-option-${from.id}`
      )
      const exact = weather === 'mild-dry' ? to.id : 'wool-scarf'
      const nearby = weather === 'mild-dry' ? 'wool-scarf' : to.id
      await expect(
        swaps
          .getByRole('group', { name: 'Best for this weather', exact: true })
          .getByTestId(`guest-preview-swap-option-${exact}`)
      ).toBeVisible()
      await expect(
        swaps
          .getByRole('group', { name: 'Also works', exact: true })
          .getByTestId(`guest-preview-swap-option-${nearby}`)
      ).toBeVisible()
      const optionIds = await swaps
        .getByRole('radio')
        .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-testid')))
      expect(optionIds).toContain(`guest-preview-swap-option-${nearby}`)
      expect(optionIds.indexOf(`guest-preview-swap-option-${exact}`)).toBeGreaterThan(0)
      expect(optionIds.indexOf(`guest-preview-swap-option-${exact}`)).toBeLessThan(
        optionIds.indexOf(`guest-preview-swap-option-${nearby}`)
      )
      if (weather === 'mild-dry') await attachScreen('sample-swap-phone')
      await current.press('Space')
      await expect(swaps).toBeHidden()
      await expect(trigger).toBeFocused()
      await expect(outfitPiece(outfit, from)).toBeVisible()

      await trigger.click()
      await swaps.getByTestId(`guest-preview-swap-option-${to.id}`).click()
      await expect(swaps).toBeHidden()
      await expect(outfitPiece(outfit, to)).toBeVisible()
      await expect(outfitPiece(outfit, from)).toHaveCount(0)
      await expect(outfitPiece(outfit, pieces.skirt)).toBeVisible()

      const announcement = page
        .getByTestId('save-feedback-announcer')
        .getByText('Piece swapped.', { exact: true })
      // The live region replaces its message node when it announces an identical message again.
      await announcement.evaluate((node) =>
        node.setAttribute('data-original-announcement', 'true')
      )
      const newTrigger = outfitPiece(outfit, to).getByTestId(
        'guest-preview-swap-accessory'
      )
      await newTrigger.click()
      await swaps.getByTestId(`guest-preview-swap-option-${to.id}`).press('Enter')
      await expect(swaps).toBeHidden()
      await expect(announcement).toHaveAttribute('data-original-announcement', 'true')
      await page.getByTestId('status-bar-action-undo').click()
      await expect(outfitPiece(outfit, from)).toBeVisible()
      await expect(outfitPiece(outfit, to)).toHaveCount(0)
      await trigger.click()
      await swaps.getByTestId(`guest-preview-swap-option-${to.id}`).click()
      await expect(outfitPiece(outfit, to)).toBeVisible()

      await sample.getByTestId('sample-save-look').click()
      await expect(page.getByTestId('status-bar-action-view')).toBeVisible()
      const payload = saved()
      expect(payload).toMatchObject({
        source: 'home_sample',
        collection: 'all',
        weather,
        composition: expect.arrayContaining([
          expect.objectContaining({ kind: 'catalog', itemId: 'sample:g:mini-skirt' }),
          expect.objectContaining({ kind: 'catalog', itemId: `sample:g:${to.id}` }),
        ]),
      })

      setScreen('looks')
      await page.getByTestId('bottom-nav-looks').click()
      await expect(page.getByTestId('looks-segment-saved')).toHaveAttribute(
        'aria-selected',
        'true'
      )
      await page.getByTestId(`saved-look-card-${savedLookId}`).click()
      await expect(page).toHaveURL(`/looks/saved/${savedLookId}?from=all`)
      const detail = page.getByTestId('saved-look-detail')
      await expect(detail.getByText(pieces.skirt.name, { exact: true })).toBeVisible()
      await expect(detail.getByText(to.name, { exact: true })).toBeVisible()
      await expect(detail.getByText(from.name, { exact: true })).toHaveCount(0)
      await expect
        .poll(async () =>
          detail
            .getByTestId(/^saved-look-slot-/)
            .evaluateAll((slots) =>
              slots.map((slot) => slot.getAttribute('data-slot-item-id'))
            )
        )
        .toEqual(payload?.composition.map((slot) => slot.itemId))
    })
  }

  test('[P0] [7.18-SAVE-002] changing the collection lets a member save the same outfit again', async ({
    page,
    interceptNetworkCall,
  }) => {
    await page.clock.setFixedTime(FIXED_NOW)
    const { router } = await openFixtureShell(page, interceptNetworkCall, {
      mode: 'empty',
      screen: 'home',
    })
    const saved = stubSavedLook(interceptNetworkCall)
    await page.goto('/')
    await waitForShellSettled(page, router)
    const sample = page.getByTestId('member-sample-outfit')
    await sample.getByTestId('home-edit-sample').click()
    const outfit = sample.getByTestId('guest-preview-outfit')
    await expect(outfit).toHaveAttribute('data-look-id', 'sample:l:office-oxford')
    const save = sample.getByTestId('sample-save-look')
    await save.click()
    await expect(save).toHaveAttribute('data-save-state', 'saved')
    expect(saved()).toMatchObject({ collection: 'all' })
    const firstComposition = saved()?.composition

    await sample.getByTestId('guest-preview-browse-wardrobe').click()
    const picker = page.getByTestId('guest-preview-wardrobe')
    await picker
      .locator('label:has([data-testid="guest-preview-collection-menswear"])')
      .click()
    await expect(picker.getByTestId('guest-preview-collection-menswear')).toBeChecked()
    await page.getByRole('dialog').getByTestId('app-top-bar-back').click()
    await expect(outfit).toHaveAttribute('data-look-id', 'sample:l:office-oxford')
    await expect(save).toHaveAttribute('data-save-state', 'idle')
    await save.click()
    await expect(save).toHaveAttribute('data-save-state', 'saved')
    expect(saved()).toMatchObject({
      collection: 'menswear',
      composition: firstComposition,
    })
  })
})
