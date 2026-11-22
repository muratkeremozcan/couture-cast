// Learning path Step 60: Saved looks follow the account.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-60-saved-looks-follow-the-account
import { interceptNetworkCall as interceptOnPage } from '@seontechnologies/playwright-utils/intercept-network-call'
import {
  capsuleTest as test,
  expect,
  SEEDED_GARMENT_IDS,
} from '../support/helpers/capsule-session'
import { seedWebSession } from '../support/helpers/commerce-session'
import { wardrobeOnboardingEnvironment } from '../support/helpers/wardrobe-onboarding-session'

const GARMENT_LIST_URL = '**/api/v1/wardrobe/garments'

const ONE_PIXEL_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII='

function stubReadyGarmentWithPhoto(
  page: Parameters<typeof interceptOnPage>[0]['page'],
  garmentId: string
) {
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString()
  void interceptOnPage({
    page,
    method: 'GET',
    url: GARMENT_LIST_URL,
    fulfillResponse: {
      status: 200,
      body: {
        data: [
          {
            id: garmentId,
            status: 'ready',
            category: 'top',
            material: 'cotton',
            comfortRange: 'mild',
            tagsConfirmedAt: new Date().toISOString(),
            fileSizeBytes: 2048,
            mimeType: 'image/png',
            retentionStatus: 'active',
            createdAt: new Date().toISOString(),
            committedAt: new Date().toISOString(),
            imageAccess: {
              url: ONE_PIXEL_PNG,
              expiresAt,
            },
          },
        ],
      },
    },
  })
}

function trackCreatedSavedLookIds(
  page: Parameters<typeof interceptOnPage>[0]['page'],
  createdIds: Set<string>,
  capturedCompositions?: Map<string, string[]>
) {
  page.on('response', async (response) => {
    if (
      response.request().method() === 'POST' &&
      response.url().endsWith('/api/v1/wardrobe/saved-looks') &&
      (response.status() === 200 || response.status() === 201)
    ) {
      try {
        const body = (await response.json()) as {
          data?: {
            id?: string
            composition?: { slotIndex: number; itemId: string }[]
          }
        }
        if (body.data?.id) {
          createdIds.add(body.data.id)
          if (capturedCompositions && Array.isArray(body.data.composition)) {
            const ordered = [...body.data.composition]
              .sort((a, b) => a.slotIndex - b.slotIndex)
              .map((slot) => slot.itemId)
            capturedCompositions.set(body.data.id, ordered)
          }
        }
      } catch {
        // Ignore non-JSON or aborted responses
      }
    }
  })
}

async function cleanupCreatedSavedLooks(
  apiRequest: Parameters<Parameters<typeof test>[2]>[0]['apiRequest'],
  apiBaseUrl: string,
  accessToken: string,
  createdIds: ReadonlySet<string>
) {
  for (const id of createdIds) {
    await apiRequest({
      method: 'DELETE',
      path: `/api/v1/wardrobe/saved-looks/${id}`,
      baseUrl: apiBaseUrl,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'If-Match': '*',
      },
    }).catch(() => undefined)
  }
}

test.use({ authSessionEnabled: false })

test.describe('Saved looks follow the account (CC-7.2)', () => {
  test.describe.configure({ mode: 'serial' })

  test(
    '[P0] saves a Style this piece look with swaps, reopens in exact slot order in a second browser context with blocked storage, saves and reloads there, and removes it @local-lane',
    { annotation: [{ type: 'skipNetworkMonitoring' }] },
    async ({ apiRequest, baseURL, browser, capsuleSession, page }) => {
      const apiBaseUrl = wardrobeOnboardingEnvironment.apiBaseUrl
      const garmentId = SEEDED_GARMENT_IDS[0]
      const createdIds = new Set<string>()
      const capturedCompositions = new Map<string, string[]>()

      try {
        // Context 1: open Wardrobe, open Style this piece, swap shoes, and save the look.
        await page.setViewportSize({ width: 390, height: 844 })
        trackCreatedSavedLookIds(page, createdIds, capturedCompositions)
        stubReadyGarmentWithPhoto(page, garmentId)
        await page.goto('/wardrobe')

        await page.getByTestId('style-piece-open').first().click()
        const dialog = page.getByRole('dialog', { name: 'Style this piece' })
        await expect(dialog).toBeVisible()
        await dialog.getByTestId('style-piece-weather-warm-rainy').click()

        const firstLook = dialog.getByTestId('style-piece-look').first()
        await firstLook.getByTestId('style-piece-swap-shoes').click()
        await firstLook.getByRole('button', { name: 'Loafers' }).click()
        await expect(firstLook).toContainText('Loafers')

        await firstLook.getByTestId('style-piece-save').click()
        await expect(firstLook.getByTestId('style-piece-save')).toHaveAttribute(
          'data-save-state',
          'saved'
        )
        await expect.poll(() => createdIds.size).toBe(1)
        const firstSavedId = Array.from(createdIds)[0]!
        const expectedOrder = capturedCompositions.get(firstSavedId)!
        expect(expectedOrder.length).toBeGreaterThanOrEqual(2)
        expect(expectedOrder[0]).toBe(garmentId)

        // Context 2: separate browser context (second device) with localStorage blocked.
        // Session bearer is re-established on navigation (as after re-authentication when storage is blocked).
        const secondContext = await browser.newContext({
          viewport: { width: 390, height: 844 },
        })
        try {
          await secondContext.addInitScript(() => {
            Object.defineProperty(window, 'localStorage', {
              configurable: true,
              get() {
                throw new DOMException('Storage blocked', 'SecurityError')
              },
            })
          })
          await seedWebSession(secondContext, capsuleSession.accessToken)
          const secondPage = await secondContext.newPage()
          trackCreatedSavedLookIds(secondPage, createdIds, capturedCompositions)
          stubReadyGarmentWithPhoto(secondPage, garmentId)
          await secondPage.goto(`${baseURL}/wardrobe`)

          // Member opens the Saved looks row at the top of Closet in Context 2 (blocked storage).
          const savedLooksRow = secondPage.getByTestId('closet-saved-looks-row')
          await expect(savedLooksRow).toBeVisible()
          await savedLooksRow.click()

          // Verify exact stored composition slot IDs and ordering in Context 2.
          const card = secondPage.getByTestId(`saved-look-card-${firstSavedId}`)
          await expect(card).toBeVisible()
          const renderedOrder = await card
            .locator('[data-slot-item-id]')
            .evaluateAll((els) =>
              els.map((el) => el.getAttribute('data-slot-item-id') ?? '')
            )
          expect(renderedOrder).toEqual(expectedOrder)

          await card.getByTestId('saved-look-reopen').click()
          const reopenedDialog = secondPage.getByRole('dialog', {
            name: 'Style this piece',
          })
          await expect(reopenedDialog).toBeVisible()
          await expect(
            reopenedDialog.getByTestId('style-piece-weather-warm-rainy')
          ).toHaveAttribute('aria-pressed', 'true')
          await expect(
            reopenedDialog.getByTestId('style-piece-look').first()
          ).toContainText('Loafers')

          // Close dialog, remove this specific saved look, reload, and confirm it is gone.
          await reopenedDialog.getByRole('button', { name: 'Close' }).click()
          await expect(reopenedDialog).toBeHidden()
          await card.getByTestId('saved-look-remove').click()
          await expect(card).toBeHidden()

          await secondPage.reload()
          await secondPage.getByTestId('closet-saved-looks-row').click()
          await expect(
            secondPage.getByTestId(`saved-look-card-${firstSavedId}`)
          ).toHaveCount(0)

          // Verify saving and reloading directly inside the storage-blocked context (AC 3 & AC 6).
          await secondPage.getByTestId('style-piece-open').first().click()
          const blockedDialog = secondPage.getByRole('dialog', {
            name: 'Style this piece',
          })
          await expect(blockedDialog).toBeVisible()
          const blockedLook = blockedDialog.getByTestId('style-piece-look').first()
          await blockedLook.getByTestId('style-piece-save').click()
          await expect(blockedLook.getByTestId('style-piece-save')).toHaveAttribute(
            'data-save-state',
            'saved'
          )
          await expect.poll(() => createdIds.size).toBe(2)
          const secondSavedId = Array.from(createdIds)[1]!
          await blockedDialog.getByRole('button', { name: 'Close' }).click()
          await secondPage.reload()
          await secondPage.getByTestId('closet-saved-looks-row').click()
          await expect(
            secondPage.getByTestId(`saved-look-card-${secondSavedId}`)
          ).toBeVisible()
        } finally {
          await secondContext.close()
        }
      } finally {
        await cleanupCreatedSavedLooks(
          apiRequest,
          apiBaseUrl,
          capsuleSession.accessToken,
          createdIds
        )
      }
    }
  )

  test(
    '[P1] saves a Home sample look into the same account list and opens it in exact slot order from Closet Saved looks @local-lane',
    { annotation: [{ type: 'skipNetworkMonitoring' }] },
    async ({ apiRequest, baseURL, browser, capsuleSession, page }) => {
      const apiBaseUrl = wardrobeOnboardingEnvironment.apiBaseUrl
      const createdIds = new Set<string>()
      const capturedCompositions = new Map<string, string[]>()

      try {
        await page.setViewportSize({ width: 390, height: 844 })
        trackCreatedSavedLookIds(page, createdIds, capturedCompositions)
        // Force Home into the member sample outfit path (no location yet) so Save sample is shown.
        void interceptOnPage({
          page,
          method: 'GET',
          url: '**/api/v1/ritual*',
          fulfillResponse: {
            status: 400,
            body: { message: 'No location preferences found for user' },
          },
        })
        await page.goto('/')
        const sampleSave = page.getByTestId('sample-save-look')
        await expect(sampleSave).toBeVisible()
        await sampleSave.click()
        await expect(sampleSave).toHaveAttribute('data-save-state', 'saved')
        await expect.poll(() => createdIds.size).toBe(1)
        const homeSavedId = Array.from(createdIds)[0]!
        const expectedOrder = capturedCompositions.get(homeSavedId)!
        expect(expectedOrder.length).toBeGreaterThanOrEqual(2)

        // Open Closet in a second context with localStorage blocked and verify the Home sample look appears.
        const secondContext = await browser.newContext({
          viewport: { width: 390, height: 844 },
        })
        try {
          await secondContext.addInitScript(() => {
            Object.defineProperty(window, 'localStorage', {
              configurable: true,
              get() {
                throw new DOMException('Storage blocked', 'SecurityError')
              },
            })
          })
          await seedWebSession(secondContext, capsuleSession.accessToken)
          const secondPage = await secondContext.newPage()
          stubReadyGarmentWithPhoto(secondPage, SEEDED_GARMENT_IDS[0])
          await secondPage.goto(`${baseURL}/wardrobe`)

          await secondPage.getByTestId('closet-saved-looks-row').click()
          const card = secondPage.getByTestId(`saved-look-card-${homeSavedId}`)
          await expect(card).toContainText('From sample idea')
          await card.getByTestId('saved-look-reopen').click()

          const modal = secondPage.getByTestId('saved-look-detail-modal')
          await expect(modal).toBeVisible()
          const modalOrder = await modal
            .locator('[data-slot-item-id]')
            .evaluateAll((els) =>
              els.map((el) => el.getAttribute('data-slot-item-id') ?? '')
            )
          expect(modalOrder).toEqual(expectedOrder)

          await secondPage.getByTestId('saved-look-detail-remove').click()
          await expect(card).toHaveCount(0)
        } finally {
          await secondContext.close()
        }
      } finally {
        await cleanupCreatedSavedLooks(
          apiRequest,
          apiBaseUrl,
          capsuleSession.accessToken,
          createdIds
        )
      }
    }
  )
})
