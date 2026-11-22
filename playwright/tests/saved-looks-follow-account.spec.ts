// Learning path Step 60: Saved looks follow the account.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-60-saved-looks-follow-account
// Learning path Step 61: Import device-saved looks for the same member.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-61-import-device-saved-looks-for-the-same-member
import { interceptNetworkCall as interceptOnPage } from '@seontechnologies/playwright-utils/intercept-network-call'
import { DEFAULT_SAMPLE_COMFORT, stylePieceStorageKey } from '@couture/utils'
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

  test(
    '[P0] imports pre-CC-7.2 device-saved looks for the same member once per source id, puts unresolved looks into Needs review, rejects tampered garment references, and leaves guest or another member device keys untouched (CC-7.3) @local-lane',
    { annotation: [{ type: 'skipNetworkMonitoring' }] },
    async ({ apiRequest, baseURL, browser, capsuleSession }) => {
      const apiBaseUrl = wardrobeOnboardingEnvironment.apiBaseUrl
      const ownerId = capsuleSession.ownerUserId
      const garmentId = SEEDED_GARMENT_IDS[0]
      const createdIds = new Set<string>()

      const guestPreviewRaw = JSON.stringify({
        schemaVersion: 1,
        weather: 'mild-dry',
      })
      const otherMemberBookmarksKey = 'couturecast.member-sample-bookmarks.other-member-2'
      const otherMemberBookmarksRaw = JSON.stringify([
        {
          lookId: 'sample:l:office-oxford',
          weather: 'mild-dry',
          collection: 'all',
          comfort: DEFAULT_SAMPLE_COMFORT,
          swaps: {},
        },
      ])
      const otherMemberStyleKey = stylePieceStorageKey(
        'other-member-2',
        'other-garment-2'
      )
      const otherMemberStyleRaw = JSON.stringify([
        {
          lookId: 'sample:l:office-oxford',
          weather: 'mild-dry',
          swaps: {},
        },
      ])

      const ownBookmarksKey = `couturecast.member-sample-bookmarks.${ownerId}`
      const ownBookmarksRaw = JSON.stringify([
        {
          lookId: 'sample:l:office-oxford',
          weather: 'mild-dry',
          collection: 'all',
          comfort: DEFAULT_SAMPLE_COMFORT,
          swaps: { shoes: 'sample:g:white-sneakers' },
        },
        {
          // Unresolvable bookmark: summer-linen does not resolve in cool-windy -> enters Needs review
          lookId: 'sample:l:summer-linen',
          weather: 'cool-windy',
          collection: 'all',
          comfort: DEFAULT_SAMPLE_COMFORT,
          swaps: {},
        },
      ])
      const ownValidStyleKey = stylePieceStorageKey(ownerId, garmentId)
      const ownValidStyleRaw = JSON.stringify([
        {
          lookId: 'sample:l:silk-midi',
          weather: 'warm-rainy',
          swaps: { shoes: 'sample:g:loafers' },
        },
      ])
      const ownTamperedStyleKey = stylePieceStorageKey(
        ownerId,
        'tampered-unowned-garment-999'
      )
      const ownTamperedStyleRaw = JSON.stringify([
        {
          lookId: 'sample:l:office-oxford',
          weather: 'mild-dry',
          swaps: {},
        },
      ])

      const importContext = await browser.newContext({
        viewport: { width: 390, height: 844 },
      })

      try {
        await seedWebSession(importContext, capsuleSession.accessToken)
        await importContext.addInitScript(
          (seed) => {
            if (window.location.origin === 'null') return
            window.sessionStorage.setItem(
              'couturecast.access-principal',
              JSON.stringify({ principal: seed.ownerId, member: seed.ownerId })
            )
            window.localStorage.setItem(
              'couturecast.auth-session',
              JSON.stringify({ user: { id: seed.ownerId } })
            )
            window.localStorage.setItem(
              'couturecast.guest-preview.v1',
              seed.guestPreviewRaw
            )
            window.localStorage.setItem(
              seed.otherMemberBookmarksKey,
              seed.otherMemberBookmarksRaw
            )
            window.localStorage.setItem(
              seed.otherMemberStyleKey,
              seed.otherMemberStyleRaw
            )
            if (!window.sessionStorage.getItem('__cc73_seeded__')) {
              window.sessionStorage.setItem('__cc73_seeded__', '1')
              window.localStorage.setItem(seed.ownBookmarksKey, seed.ownBookmarksRaw)
              window.localStorage.setItem(seed.ownValidStyleKey, seed.ownValidStyleRaw)
              window.localStorage.setItem(
                seed.ownTamperedStyleKey,
                seed.ownTamperedStyleRaw
              )
            }
          },
          {
            ownerId,
            guestPreviewRaw,
            otherMemberBookmarksKey,
            otherMemberBookmarksRaw,
            otherMemberStyleKey,
            otherMemberStyleRaw,
            ownBookmarksKey,
            ownBookmarksRaw,
            ownValidStyleKey,
            ownValidStyleRaw,
            ownTamperedStyleKey,
            ownTamperedStyleRaw,
          }
        )

        const importPage = await importContext.newPage()
        const postStatuses: number[] = []
        importPage.on('response', (response) => {
          if (
            response.request().method() === 'POST' &&
            response.url().endsWith('/api/v1/wardrobe/saved-looks')
          ) {
            postStatuses.push(response.status())
          }
        })
        trackCreatedSavedLookIds(importPage, createdIds)
        stubReadyGarmentWithPhoto(importPage, garmentId)

        await importPage.goto(`${baseURL}/wardrobe`)
        await expect.poll(() => createdIds.size).toBe(3)
        expect(postStatuses).toContain(404)

        const savedLooksRow = importPage.getByTestId('closet-saved-looks-row')
        await expect(savedLooksRow).toBeVisible()
        await savedLooksRow.click()

        for (const id of createdIds) {
          await expect(importPage.getByTestId(`saved-look-card-${id}`)).toBeVisible()
        }
        await expect(importPage.getByTestId('saved-look-needs-review')).toBeVisible()

        // Same-member device keys are removed while guest preview and other member keys remain intact
        const storageSnapshot = await importPage.evaluate(
          (keys) => ({
            ownBookmarks: window.localStorage.getItem(keys.ownBookmarksKey),
            ownValidStyle: window.localStorage.getItem(keys.ownValidStyleKey),
            ownTamperedStyle: window.localStorage.getItem(keys.ownTamperedStyleKey),
            guestPreview: window.localStorage.getItem('couturecast.guest-preview.v1'),
            otherBookmarks: window.localStorage.getItem(keys.otherMemberBookmarksKey),
            otherStyle: window.localStorage.getItem(keys.otherMemberStyleKey),
          }),
          {
            ownBookmarksKey,
            ownValidStyleKey,
            ownTamperedStyleKey,
            otherMemberBookmarksKey,
            otherMemberStyleKey,
          }
        )
        expect(storageSnapshot).toEqual({
          ownBookmarks: null,
          ownValidStyle: null,
          ownTamperedStyle: null,
          guestPreview: guestPreviewRaw,
          otherBookmarks: otherMemberBookmarksRaw,
          otherStyle: otherMemberStyleRaw,
        })

        // Reloading produces zero duplicate imports
        await importPage.reload()
        await importPage.getByTestId('closet-saved-looks-row').click()
        expect(createdIds.size).toBe(3)
      } finally {
        await importContext.close()
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
