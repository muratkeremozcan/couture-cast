// Learning path Step 60: Saved looks follow the account.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-60-saved-looks-follow-account
// Learning path Step 61: Import device-saved looks for the same member.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-61-import-device-saved-looks-for-the-same-member
// Story CC-7.12 (Step 69): the Closet saved looks row is gone, so saved looks are read, reopened
// and removed from the Looks Saved tiles and the /looks/saved/ID screen.
import { PrismaClient } from '@prisma/client'
import { interceptNetworkCall as interceptOnPage } from '@seontechnologies/playwright-utils/intercept-network-call'
import {
  createDeterministicIdempotencyKey,
  DEFAULT_SAMPLE_COMFORT,
  stylePieceStorageKey,
} from '@couture/utils'
import {
  capsuleTest as test,
  expect,
  SEEDED_GARMENT_IDS,
} from '../support/helpers/capsule-session'
import { seedWebSession } from '../support/helpers/commerce-session'
import { localE2EAccessToken } from '../support/helpers/local-e2e-token'
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

type SpecPage = Parameters<typeof interceptOnPage>[0]['page']

/** The slot item ids the saved look's own screen lists, in order (CC-7.12 D5). */
function detailSlotOrder(page: SpecPage) {
  return page
    .getByTestId('saved-look-detail')
    .locator('[data-slot-item-id]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-slot-item-id') ?? ''))
}

/** Opens a Saved tile and lands on its screen (CC-7.12 D5: `?from=` names the filter). */
async function openSavedTile(page: SpecPage, id: string) {
  await page.getByTestId(`saved-look-card-${id}`).click()
  await expect(page).toHaveURL(new RegExp(`/looks/saved/${id}\\?from=all$`))
  await expect(page.getByTestId('saved-look-detail')).toBeVisible()
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

async function hardDeleteSavedLooksByIdempotencyKeys(
  keys: readonly { userId: string; idempotencyKey: string }[]
): Promise<void> {
  if (!process.env.DATABASE_URL || keys.length === 0) return
  const prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL })
  try {
    await prisma.savedLook.deleteMany({
      where: {
        OR: keys.map(({ userId, idempotencyKey }) => ({
          user_id: userId,
          idempotency_key: idempotencyKey,
        })),
      },
    })
  } finally {
    await prisma.$disconnect()
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
          // Story CC-7.12 D1: Looks opens on Saved in Context 2 (blocked storage), since the
          // member has a saved look; the look is a tile there.
          await secondPage.goto(`${baseURL}/looks`)
          await expect(secondPage.getByTestId('looks-segment-saved')).toHaveAttribute(
            'aria-selected',
            'true'
          )
          const card = secondPage.getByTestId(`saved-look-card-${firstSavedId}`)
          await expect(card).toBeVisible()

          // Verify exact stored composition slot IDs and ordering in Context 2, on the look's
          // own screen (D5).
          await openSavedTile(secondPage, firstSavedId)
          expect(await detailSlotOrder(secondPage)).toEqual(expectedOrder)

          await secondPage.getByTestId('saved-look-reopen').click()
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
          // D5, P10: Remove on the look's screen returns to Saved (the tile's filter) with Undo.
          await secondPage.getByTestId('saved-look-detail-remove').click()
          await expect(secondPage).toHaveURL(/\/looks$/)
          await expect(secondPage.getByTestId('status-bar-action-undo')).toBeVisible()
          await expect(card).toHaveCount(0)

          await secondPage.reload()
          await expect(secondPage.getByTestId('looks-first-content')).toBeVisible()
          await expect(
            secondPage.getByTestId(`saved-look-card-${firstSavedId}`)
          ).toHaveCount(0)
          // A deep link to the removed look reads like a removed one (D5).
          await secondPage.goto(`${baseURL}/looks/saved/${firstSavedId}`)
          await expect(secondPage.getByTestId('saved-look-detail-gone')).toBeVisible()

          // Verify saving and reloading directly inside the storage-blocked context (AC 3 & AC 6).
          // Style this piece still opens from the Closet.
          await secondPage.goto(`${baseURL}/wardrobe`)
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
          // A fresh document load of Looks reads the new look back from the account.
          await secondPage.goto(`${baseURL}/looks`)
          await expect(
            secondPage.getByTestId(`saved-look-card-${secondSavedId}`)
          ).toBeVisible()
          await openSavedTile(secondPage, secondSavedId)
          expect(await detailSlotOrder(secondPage)).toEqual(
            capturedCompositions.get(secondSavedId)
          )
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
    '[P1] saves a Home sample look into the same account list and opens it in exact slot order from Looks Saved @local-lane',
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
        await page.getByTestId('home-edit-sample').click()
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
          // Story CC-7.12 D4: the Today filter holds the Home sample look.
          await secondPage.goto(`${baseURL}/looks?segment=saved&filter=today`)
          const card = secondPage.getByTestId(`saved-look-card-${homeSavedId}`)
          await expect(card).toHaveAttribute(
            'href',
            `/looks/saved/${homeSavedId}?from=today`
          )
          await card.click()
          await expect(secondPage).toHaveURL(
            new RegExp(`/looks/saved/${homeSavedId}\\?from=today$`)
          )
          const detail = secondPage.getByTestId('saved-look-detail')
          await expect(detail).toContainText('From sample idea')
          expect(await detailSlotOrder(secondPage)).toEqual(expectedOrder)
          // Only a Style this piece look reopens in an editor; a Home sample look stays here.
          await expect(secondPage.getByTestId('saved-look-reopen')).toHaveCount(0)

          // P10: Remove returns to the filter the look was opened from, and Undo restores it.
          await secondPage.getByTestId('saved-look-detail-remove').click()
          await expect(secondPage).toHaveURL(/\/looks\?segment=saved&filter=today$/)
          await expect(card).toHaveCount(0)
          await secondPage.getByTestId('status-bar-action-undo').click()
          await expect(card).toBeVisible()
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
      const otherMemberId = 'teen-2'
      const otherMemberToken = localE2EAccessToken(otherMemberId)
      const otherMemberGarmentId = `${otherMemberId}-garment-1`
      const garmentId = SEEDED_GARMENT_IDS[0]
      const createdIds = new Set<string>()
      const otherCreatedIds = new Set<string>()

      // Clean only this test's deterministic keys so repeated runs on a retained database start fresh
      const deterministicImportKeys = [
        {
          userId: ownerId,
          idempotencyKey: createDeterministicIdempotencyKey(
            `legacy-import:v1:home_sample:${ownerId}:sample:l:office-oxford`
          ),
        },
        {
          userId: ownerId,
          idempotencyKey: createDeterministicIdempotencyKey(
            `legacy-import:v1:home_sample:${ownerId}:sample:l:summer-linen`
          ),
        },
        {
          userId: ownerId,
          idempotencyKey: createDeterministicIdempotencyKey(
            `legacy-import:v1:style_piece:${ownerId}:${garmentId}:warm-rainy:sample:l:silk-midi`
          ),
        },
        {
          userId: otherMemberId,
          idempotencyKey: createDeterministicIdempotencyKey(
            `legacy-import:v1:home_sample:${otherMemberId}:sample:l:office-oxford`
          ),
        },
        {
          userId: otherMemberId,
          idempotencyKey: createDeterministicIdempotencyKey(
            `legacy-import:v1:style_piece:${otherMemberId}:${otherMemberGarmentId}:mild-dry:sample:l:office-oxford`
          ),
        },
      ]
      await hardDeleteSavedLooksByIdempotencyKeys(deterministicImportKeys)

      const guestPreviewRaw = JSON.stringify({
        schemaVersion: 1,
        weather: 'mild-dry',
      })
      const otherMemberBookmarksKey = `couturecast.member-sample-bookmarks.${otherMemberId}`
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
        otherMemberId,
        otherMemberGarmentId
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
      // Tampered reference points to a REAL garment owned by teen-2 in Postgres -> API rejects with 404 GARMENT_NOT_FOUND
      const ownTamperedStyleKey = stylePieceStorageKey(ownerId, otherMemberGarmentId)
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
        const importPage = await importContext.newPage()
        await seedWebSession(importPage, capsuleSession.accessToken)
        await importPage.addInitScript(
          (seed) => {
            if (window.location.origin === 'null') return
            window.sessionStorage.setItem(
              'couturecast.access-principal',
              JSON.stringify({ principal: seed.ownerId, member: seed.ownerId })
            )
            window.localStorage.setItem(
              'couturecast.auth-session',
              JSON.stringify({
                user: { id: seed.ownerId },
                expires_at: Math.floor(Date.now() / 1000) + 3600,
              })
            )
            if (!window.sessionStorage.getItem('__cc73_seeded__')) {
              window.sessionStorage.setItem('__cc73_seeded__', '1')
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

        // Story CC-7.12: the Closet no longer reads saved looks, so the import starts from the
        // Looks Saved read. Saved is named in the address: the default segment is chosen on the
        // first read, which may answer before the import lands.
        const savedTiles = importPage.locator('[data-testid^="saved-look-card-"]')
        await importPage.goto(`${baseURL}/looks?segment=saved`)
        await expect.poll(() => createdIds.size).toBe(3)
        await expect.poll(() => postStatuses.includes(404)).toBe(true)

        // The import's change notice refreshes Saved: exactly the three imported looks.
        await expect(savedTiles).toHaveCount(3)
        for (const id of createdIds) {
          await expect(importPage.getByTestId(`saved-look-card-${id}`)).toBeVisible()
        }
        // The unresolvable bookmark is the one tile whose state line reads Needs review (D2).
        await expect(
          savedTiles.and(importPage.getByRole('link', { name: /, Needs review$/ }))
        ).toHaveCount(1)

        // Same-member device keys are removed while guest preview and teen-2 keys remain byte-for-byte intact
        await expect
          .poll(() =>
            importPage.evaluate(
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
          )
          .toEqual({
            ownBookmarks: null,
            ownValidStyle: null,
            ownTamperedStyle: null,
            guestPreview: guestPreviewRaw,
            otherBookmarks: otherMemberBookmarksRaw,
            otherStyle: otherMemberStyleRaw,
          })

        // Reloading settles with the exact same 3 account IDs and zero duplicate imports
        const expectedIds = [...createdIds].sort()
        await importPage.reload()
        await expect(savedTiles).toHaveCount(3)
        for (const id of expectedIds) {
          await expect(importPage.getByTestId(`saved-look-card-${id}`)).toBeVisible()
        }
        const apiListAfterReload = await apiRequest<{ data: { id: string }[] }>({
          method: 'GET',
          path: '/api/v1/wardrobe/saved-looks',
          baseUrl: apiBaseUrl,
          headers: { Authorization: `Bearer ${capsuleSession.accessToken}` },
        })
        expect(apiListAfterReload.status).toBe(200)
        expect(apiListAfterReload.body.data.map((item) => item.id).sort()).toEqual(
          expectedIds
        )

        // Signing in as teen-2 in a fresh tab on the same device (with only teen-2's session initialized)
        // now imports teen-2's previously untouched device looks
        const member2Page = await importContext.newPage()
        await seedWebSession(member2Page, otherMemberToken)
        await member2Page.addInitScript(
          ({ memberId }) => {
            if (window.location.origin === 'null') return
            window.sessionStorage.setItem(
              'couturecast.access-principal',
              JSON.stringify({ principal: memberId, member: memberId })
            )
            window.localStorage.setItem(
              'couturecast.auth-session',
              JSON.stringify({
                user: { id: memberId },
                expires_at: Math.floor(Date.now() / 1000) + 3600,
              })
            )
          },
          { memberId: otherMemberId }
        )
        trackCreatedSavedLookIds(member2Page, otherCreatedIds)
        stubReadyGarmentWithPhoto(member2Page, otherMemberGarmentId)
        await member2Page.goto(`${baseURL}/looks?segment=saved`)
        await expect.poll(() => otherCreatedIds.size).toBe(2)

        await expect
          .poll(() =>
            member2Page.evaluate(
              (keys) => ({
                otherBookmarks: window.localStorage.getItem(keys.otherMemberBookmarksKey),
                otherStyle: window.localStorage.getItem(keys.otherMemberStyleKey),
                guestPreview: window.localStorage.getItem('couturecast.guest-preview.v1'),
              }),
              { otherMemberBookmarksKey, otherMemberStyleKey }
            )
          )
          .toEqual({
            otherBookmarks: null,
            otherStyle: null,
            guestPreview: guestPreviewRaw,
          })
      } finally {
        await importContext.close()
        await cleanupCreatedSavedLooks(
          apiRequest,
          apiBaseUrl,
          capsuleSession.accessToken,
          createdIds
        )
        await cleanupCreatedSavedLooks(
          apiRequest,
          apiBaseUrl,
          otherMemberToken,
          otherCreatedIds
        )
        await hardDeleteSavedLooksByIdempotencyKeys(deterministicImportKeys)
      }
    }
  )
})
