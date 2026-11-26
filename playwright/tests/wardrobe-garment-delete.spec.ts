// Story 7.6 test plan 7.6-E2E-001..004: garment delete on a phone (390x844).
// - E2E-001 drives the real local API and wardrobe worker: an unused piece shows Deleted with
//   Undo, Undo sends no DELETE, a second Delete commits once the 5 second window closes, and a
//   reload proves the piece is gone (risks R1, R2, R8).
// - E2E-002 seeds a piece held by two saved looks (anchor and slot) and one capsule: one prompt
//   names 3 looks, Cancel keeps it, accept deletes at once, saved looks read missing_garment and
//   the capsule reads needs_repair (R8, R11).
// - E2E-003 fails the first DELETE with a 500: the piece returns with Retry, and Retry deletes it
//   at once against the real API (R7).
// - E2E-004 mocks the wardrobe to pin AC3 (same grid scroll, focus on the next card) and runs axe
//   on the confirm dialog and the Deleted notice (R9).
// Learning path Step 64: Garment delete.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-64-garment-delete
import { randomUUID } from 'node:crypto'
import type { Page, Request } from '@playwright/test'
import { PrismaClient } from '@prisma/client'
import {
  garmentListResponseSchema,
  type GarmentWithColor,
} from '@couture/api-client/contracts/http'
import { resolveEnvironmentConfig } from '../config/environments'
import { expect, test } from '../support/fixtures/merged-fixtures'
import { checkA11y, waitForAccessibilityReady } from '../support/helpers/accessibility'
import { buildUniqueId, isNonLocalEnvironment } from '../support/helpers/api-test'
import {
  seedReadyGarment,
  signUpAdultMember,
  type SeededMember,
} from '../support/helpers/ready-garment'
import {
  memberA,
  mockStyleWardrobe,
  photographedGarment,
} from '../support/helpers/style-one-piece-fixtures'
import {
  cleanupWardrobeUserTestData,
  localPlaywrightDatabaseUrl,
} from '../support/helpers/user-test-data'

const environment = resolveEnvironmentConfig('local')
const phone = {
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  serviceWorkers: 'block' as const,
}
/** CC-7.1 `SAVE_FEEDBACK_TIMINGS.statusBarDurationMs`: the Undo window (spec D1). */
const UNDO_WINDOW_MS = 5_000
const GARMENT_URL = (id: string) => `**/api/v1/wardrobe/garments/${id}`
const USAGE_URL = (id: string) => `**/api/v1/wardrobe/garments/${id}/usage`

/** Every DELETE the page sends for one garment, in order, with the time it left the page. */
function recordDeletes(page: Page, garmentId: string) {
  const sent: Request[] = []
  page.on('request', (request) => {
    if (
      request.method() === 'DELETE' &&
      new URL(request.url()).pathname.endsWith(`/wardrobe/garments/${garmentId}`)
    ) {
      sent.push(request)
    }
  })
  return sent
}

/**
 * Stops the installed page clock just ahead of the page's own time, so the Undo window only moves
 * when the test moves it. A running clock spends the window on assertions, and a slow runner can
 * cross the deadline during a check meant to land before it.
 */
async function pauseClock(page: Page) {
  const now = await page.evaluate(() => Date.now())
  await page.clock.pauseAt(now + 1_000)
}

async function signIn(page: Page, member: SeededMember) {
  await page.addInitScript((token) => {
    window.sessionStorage.setItem('couturecast.access-token', token)
  }, member.accessToken)
  await page.setExtraHTTPHeaders({ Authorization: `Bearer ${member.accessToken}` })
}

async function openDetail(page: Page, garmentId: string) {
  await page.getByTestId(`garment-open-${garmentId}`).click()
  await expect(page.getByTestId('garment-detail')).toBeVisible()
}

/** Ready garments written straight to the local test database, as the capsule repair spec does. */
async function seedReadyRows(
  userId: string,
  categories: readonly ('top' | 'bottom' | 'shoes')[]
): Promise<string[]> {
  const rows = categories.map((category) => ({ id: randomUUID(), category }))
  const prisma = new PrismaClient({
    datasourceUrl: localPlaywrightDatabaseUrl().toString(),
  })
  try {
    await prisma.garmentItem.createMany({
      data: rows.map(({ id, category }) => ({
        id,
        user_id: userId,
        object_path: `wardrobe/${userId}/${id}.jpg`,
        mime_type: 'image/jpeg',
        category,
        material: 'cotton',
        comfort_range: 'mild',
        upload_status: 'ready',
        retention_status: 'active',
        tags_confirmed_at: new Date(),
        committed_at: new Date(),
      })),
    })
  } finally {
    await prisma.$disconnect()
  }
  return rows.map(({ id }) => id)
}

const realTest = test.extend<{ member: SeededMember }>({
  member: async ({ apiRequest }, use, testInfo) => {
    const member = await signUpAdultMember(
      apiRequest,
      environment.apiBaseUrl,
      `${buildUniqueId('garment-delete', testInfo)}@example.test`
    )
    try {
      await use(member)
    } finally {
      await cleanupWardrobeUserTestData(
        apiRequest,
        member.accessToken,
        member.userId,
        environment.apiBaseUrl
      )
    }
  },
})

realTest.describe('Garment delete against the local API', () => {
  realTest.use({ authSessionEnabled: false, ...phone })

  realTest.beforeEach(({}, testInfo) => {
    realTest.skip(
      isNonLocalEnvironment(testInfo),
      'Seeds garments in the local stack and signs in with the local E2E token.'
    )
  })

  realTest(
    '[P0] [7.6-E2E-001] deletes an unused piece with Undo, then commits after the window',
    async ({ apiRequest, interceptNetworkCall, member, page }) => {
      const auth = { Authorization: `Bearer ${member.accessToken}` }
      const garment = await realTest.step('Seed a ready top through the worker', () =>
        seedReadyGarment(apiRequest, environment.apiBaseUrl, member, {
          category: 'top',
          material: 'cotton',
          comfortRange: 'mild',
        })
      )
      const listedIds = async () => {
        const response = await apiRequest({
          method: 'GET',
          path: '/api/v1/wardrobe/garments',
          baseUrl: environment.apiBaseUrl,
          headers: auth,
        })
        expect(response.status).toBe(200)
        return garmentListResponseSchema.parse(response.body).data.map((item) => item.id)
      }
      const deletes = recordDeletes(page, garment.id)
      const card = page.getByTestId(`garment-card-${garment.id}`)
      const statusBar = page.getByTestId('status-feedback-bar')

      await realTest.step(
        'Delete shows Deleted with Undo and sends nothing yet',
        async () => {
          // The page clock drives the Undo window, so no test step waits on real time.
          await page.clock.install()
          await signIn(page, member)
          await page.goto('/wardrobe')
          await waitForAccessibilityReady(page)
          await openDetail(page, garment.id)
          const usage = interceptNetworkCall({
            method: 'GET',
            url: USAGE_URL(garment.id),
          })
          await pauseClock(page)
          await page.getByTestId('garment-delete').click()
          const { status, responseJson } = await usage
          expect(status).toBe(200)
          expect(responseJson).toEqual({
            garmentId: garment.id,
            savedLookCount: 0,
            capsuleCount: 0,
          })
          // An unused piece never asks.
          await expect(page.getByTestId('garment-delete-confirm')).toHaveCount(0)
          await expect(page.getByTestId('garment-detail')).toHaveCount(0)
          await expect(card).toHaveCount(0)
          await expect(statusBar).toContainText('Deleted')
          await expect(page.getByTestId('status-bar-action-undo')).toBeVisible()
          expect(deletes).toHaveLength(0)
        }
      )

      await realTest.step('Undo inside the window brings the piece back', async () => {
        await page.getByTestId('status-bar-action-undo').click()
        await expect(card).toBeVisible()
        await expect(statusBar).toContainText('Undone')
        // Run past the whole window: Undo must have cancelled the commit, not delayed it.
        await page.clock.fastForward(UNDO_WINDOW_MS + 1_000)
        expect(deletes).toHaveLength(0)
        expect(await listedIds()).toContain(garment.id)
        await page.clock.resume()
      })

      await realTest.step('Delete again commits once the window closes', async () => {
        await openDetail(page, garment.id)
        const removal = interceptNetworkCall({
          method: 'DELETE',
          url: GARMENT_URL(garment.id),
        })
        await pauseClock(page)
        await page.getByTestId('garment-delete').click()
        await expect(card).toHaveCount(0)
        await expect(statusBar).toContainText('Deleted')
        // Just short of the window nothing has left; the window's end sends exactly one.
        await page.clock.fastForward(UNDO_WINDOW_MS - 100)
        expect(deletes).toHaveLength(0)
        await page.clock.fastForward(200)
        expect((await removal).status).toBe(204)
        expect(deletes).toHaveLength(1)
        await page.clock.resume()
      })

      await realTest.step(
        'Reload: the piece is gone from the closet and the API',
        async () => {
          await page.reload()
          await waitForAccessibilityReady(page)
          await expect(page.getByTestId(/^garment-card-/)).toHaveCount(0)
          expect(await listedIds()).not.toContain(garment.id)
          expect(deletes).toHaveLength(1)
        }
      )
    }
  )

  realTest(
    '[P0] [7.6-E2E-002] asks once for a piece in use, then saved looks and the capsule follow',
    async ({ apiRequest, interceptNetworkCall, member, page }) => {
      const auth = { Authorization: `Bearer ${member.accessToken}` }
      const [top, bottom] = await seedReadyRows(member.userId, ['top', 'bottom'])
      const topId = top!
      const bottomId = bottom!

      const savedLookIds = await realTest.step(
        'The top anchors one saved look and is a slot in another; one capsule holds it',
        async () => {
          const save = async (anchor: string, anchorCategory: 'top' | 'bottom') => {
            const response = await apiRequest<{ data: { id: string } }>({
              method: 'POST',
              path: '/api/v1/wardrobe/saved-looks',
              baseUrl: environment.apiBaseUrl,
              headers: { ...auth, 'Idempotency-Key': randomUUID() },
              body: {
                source: 'style_piece',
                lookId: `delete-${randomUUID().slice(0, 8)}`,
                weather: 'mild',
                anchorGarmentId: anchor,
                anchorSnapshot: {
                  garmentId: anchor,
                  category: anchorCategory,
                  comfortRange: 'mild',
                },
                composition: [
                  { slotIndex: 0, category: 'top', kind: 'garment', itemId: topId },
                  { slotIndex: 1, category: 'bottom', kind: 'garment', itemId: bottomId },
                ],
              },
            })
            expect(response.status).toBe(201)
            return response.body.data.id
          }
          const ids = [await save(topId, 'top'), await save(bottomId, 'bottom')]
          const capsule = await apiRequest<{ data: { id: string } }>({
            method: 'POST',
            path: `/api/v1/wardrobe/${member.userId}/capsules`,
            baseUrl: environment.apiBaseUrl,
            headers: auth,
            body: {
              name: 'Delete keeps me',
              occasions: ['work'],
              garmentIds: [topId, bottomId],
              isFavorite: false,
            },
          })
          expect(capsule.status).toBe(201)
          return { looks: ids, capsuleId: capsule.body.data.id }
        }
      )

      const deletes = recordDeletes(page, topId)
      const confirm = page.getByTestId('garment-delete-confirm')

      await realTest.step(
        'One prompt names 3 looks; Cancel keeps the piece',
        async () => {
          await signIn(page, member)
          await page.goto('/wardrobe')
          await waitForAccessibilityReady(page)
          await openDetail(page, topId)
          await page.getByTestId('garment-delete').click()
          await expect(confirm).toBeVisible()
          await expect(page.getByTestId('garment-delete-confirm-count')).toHaveText(
            'Delete this piece? It is in 3 looks.'
          )
          await page.getByTestId('garment-delete-cancel').click()
          await expect(confirm).toHaveCount(0)
          await expect(page.getByTestId('garment-detail')).toBeVisible()
          expect(deletes).toHaveLength(0)
        }
      )

      await realTest.step('Accept deletes at once with no Undo', async () => {
        await page.getByTestId('garment-delete').click()
        await expect(confirm).toBeVisible()
        const removal = interceptNetworkCall({
          method: 'DELETE',
          url: GARMENT_URL(topId),
          // A confirmed delete never waits for an Undo window.
          timeout: UNDO_WINDOW_MS - 1_000,
        })
        await page.getByTestId('garment-delete-confirm-accept').click()
        expect((await removal).status).toBe(204)
        await expect(page.getByTestId(`garment-card-${topId}`)).toHaveCount(0)
        await expect(page.getByTestId('status-feedback-bar')).toContainText('Deleted')
        await expect(page.getByTestId('status-bar-action-undo')).toHaveCount(0)
        expect(deletes).toHaveLength(1)
      })

      await realTest.step(
        'Saved looks show the missing piece; the capsule needs repair',
        async () => {
          const looks = await apiRequest<{
            data: { id: string; availabilityStatus: string }[]
          }>({
            method: 'GET',
            path: '/api/v1/wardrobe/saved-looks',
            baseUrl: environment.apiBaseUrl,
            headers: auth,
          })
          expect(looks.status).toBe(200)
          const statuses = Object.fromEntries(
            looks.body.data.map((look) => [look.id, look.availabilityStatus])
          )
          expect(statuses).toEqual({
            [savedLookIds.looks[0]!]: 'missing_garment',
            [savedLookIds.looks[1]!]: 'missing_garment',
          })

          const capsule = await apiRequest<{ data: { availabilityStatus: string } }>({
            method: 'GET',
            path: `/api/v1/wardrobe/${member.userId}/capsules/${savedLookIds.capsuleId}`,
            baseUrl: environment.apiBaseUrl,
            headers: auth,
          })
          expect(capsule.status).toBe(200)
          expect(capsule.body.data.availabilityStatus).toBe('needs_repair')

          await page.reload()
          await page.getByTestId('closet-saved-looks-row').click()
          const slot = page
            .getByTestId(`saved-look-card-${savedLookIds.looks[1]!}`)
            .locator(`[data-slot-item-id="${topId}"]`)
          await expect(slot).toContainText('Missing piece')
        }
      )
    }
  )

  realTest(
    '[P1] [7.6-E2E-003] a failed delete returns the piece, and Retry deletes it at once',
    {
      // The first DELETE answers 500 on purpose; the test asserts every DELETE and its status.
      annotation: [{ type: 'skipNetworkMonitoring', description: 'injected DELETE 500' }],
    },
    async ({ apiRequest, interceptNetworkCall, member, page }) => {
      const [garmentId] = await seedReadyRows(member.userId, ['shoes'])
      const id = garmentId!
      const card = page.getByTestId(`garment-card-${id}`)
      const deletes = recordDeletes(page, id)

      // The first DELETE answers 500 without reaching the API; every later one is real.
      let failed = false
      void interceptNetworkCall({
        method: 'DELETE',
        url: GARMENT_URL(id),
        handler: async (route) => {
          if (failed) {
            await route.fallback()
            return
          }
          failed = true
          await route.fulfill({ status: 500, json: { message: 'Internal server error' } })
        },
      })

      await realTest.step('The commit fails: the piece returns with Retry', async () => {
        await page.clock.install()
        await signIn(page, member)
        await page.goto('/wardrobe')
        await waitForAccessibilityReady(page)
        await openDetail(page, id)
        // Paused, the window cannot end (and the failure restore the card) before the hidden
        // check; the clock stays paused so the Retry notice cannot expire either.
        await pauseClock(page)
        await page.getByTestId('garment-delete').click()
        await expect(card).toHaveCount(0)
        await page.clock.fastForward(UNDO_WINDOW_MS + 100)
        await expect(page.getByTestId('status-bar-action-retry')).toBeVisible()
        await expect(card).toBeVisible()
        await expect(page.getByTestId('status-feedback-bar')).toContainText(
          'Could not delete this piece.'
        )
        expect(deletes).toHaveLength(1)
      })

      await realTest.step(
        'Retry sends one DELETE at once and the piece leaves',
        async () => {
          const retried = interceptNetworkCall({
            method: 'DELETE',
            url: GARMENT_URL(id),
            // Retry never opens a second Undo window (D6, Q4).
            timeout: UNDO_WINDOW_MS - 1_000,
          })
          await page.getByTestId('status-bar-action-retry').click()
          expect((await retried).status).toBe(204)
          await expect(card).toHaveCount(0)
          await expect(page.getByTestId('status-feedback-bar')).toContainText('Deleted')
          expect(deletes).toHaveLength(2)
        }
      )

      await realTest.step('Reload: still gone', async () => {
        await page.clock.resume()
        await page.reload()
        await waitForAccessibilityReady(page)
        await expect(page.getByTestId(`garment-card-${id}`)).toHaveCount(0)
        const response = await apiRequest({
          method: 'GET',
          path: '/api/v1/wardrobe/garments',
          baseUrl: environment.apiBaseUrl,
          headers: { Authorization: `Bearer ${member.accessToken}` },
        })
        expect(
          garmentListResponseSchema.parse(response.body).data.map((item) => item.id)
        ).not.toContain(id)
      })
    }
  )
})

test.describe('Garment delete on a phone (mocked wardrobe)', () => {
  test.use({ authSessionEnabled: false, ...phone })

  test.beforeEach(({ baseURL }, testInfo) => {
    test.skip(isNonLocalEnvironment(testInfo), 'Uses synthetic loopback-only fixtures.')
    expect(new URL(baseURL!).hostname).toMatch(/^(?:127\.0\.0\.1|localhost|\[::1\])$/)
  })

  test('[P1] [7.6-E2E-004] keeps the grid scroll, focuses the next card, and passes axe', async ({
    baseURL,
    interceptNetworkCall,
    page,
  }) => {
    // Story CC-7.11 D4: four 4:3 tiles fit the fold now, so the grid needs more rows for the
    // target to sit below it.
    const cards: GarmentWithColor[] = Array.from({ length: 14 }, (_, index) => ({
      ...photographedGarment(baseURL!, `delete-card-${index + 1}`),
      colorFamily: 'gray',
    }))
    const inventory = { [memberA]: cards }
    await mockStyleWardrobe(page, baseURL!, interceptNetworkCall, inventory)
    // The cards in the order the closet lists them; the target sits low in the grid.
    const target = cards[11]!
    const next = cards[12]!
    const used = cards[12]!
    const usage: Record<string, { savedLookCount: number; capsuleCount: number }> = {
      [used.id]: { savedLookCount: 1, capsuleCount: 1 },
    }
    void interceptNetworkCall({
      url: '**/api/v1/wardrobe/garments/*/usage',
      handler: async (route, request) => {
        const garmentId = new URL(request.url()).pathname.split('/').at(-2)!
        await route.fulfill({
          json: {
            garmentId,
            ...(usage[garmentId] ?? { savedLookCount: 0, capsuleCount: 0 }),
          },
        })
      },
    })
    void interceptNetworkCall({
      method: 'DELETE',
      url: '**/api/v1/wardrobe/garments/*',
      handler: async (route, request) => {
        const garmentId = new URL(request.url()).pathname.split('/').at(-1)
        inventory[memberA] = inventory[memberA].filter((item) => item.id !== garmentId)
        await route.fulfill({ status: 204 })
      },
    })

    await page.goto('/wardrobe')
    await waitForAccessibilityReady(page)
    const targetOpen = page.getByTestId(`garment-open-${target.id}`)
    await targetOpen.scrollIntoViewIfNeeded()
    const scrollBefore = await page.evaluate(() => window.scrollY)
    expect(scrollBefore).toBeGreaterThan(0)

    await test.step('Delete returns to the grid at the same scroll, focus on the next card', async () => {
      await targetOpen.click()
      await expect(page.getByTestId('garment-detail')).toBeVisible()
      await page.getByTestId('garment-delete').click()
      await expect(page.getByTestId(`garment-card-${target.id}`)).toHaveCount(0)
      // D7: focus lands on the next card's first control.
      await expect(
        page.getByTestId(`garment-card-${next.id}`).locator(':focus')
      ).toHaveCount(1)
      await expect
        .poll(async () =>
          Math.abs((await page.evaluate(() => window.scrollY)) - scrollBefore)
        )
        .toBeLessThanOrEqual(2)
      await expect(page.getByTestId('status-feedback-bar')).toContainText('Deleted')
      await checkA11y(page)
    })

    await test.step('The confirm dialog passes axe, and Cancel returns focus to Delete', async () => {
      await page.getByTestId(`garment-open-${used.id}`).click()
      await page.getByTestId('garment-delete').click()
      const confirm = page.getByTestId('garment-delete-confirm')
      await expect(confirm).toBeVisible()
      await expect(page.getByTestId('garment-delete-confirm-count')).toHaveText(
        'Delete this piece? It is in 2 looks.'
      )
      await checkA11y(page)
      await page.keyboard.press('Escape')
      await expect(confirm).toHaveCount(0)
      await expect(page.getByTestId('garment-delete')).toBeFocused()
    })
  })
})
