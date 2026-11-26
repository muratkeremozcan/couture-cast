// Story 7.5 test plan 7.5-E2E-001..003: garment detail and tag edit on a phone (390x844).
// - E2E-001 drives the real local API and wardrobe worker: open a ready garment, edit its tags,
//   Done, Saved, Undo, reload, and read the persisted tags back on the detail, the grid and the
//   API. The photo alt is color plus category from the server's colorFamily.
// - E2E-002 mocks the wardrobe reads to pin the "Blue top" alt text and each failure state.
// - E2E-003 runs axe on the detail and the open editor.
// Learning path Step 63: Garment detail and tag edit.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-63-garment-detail-and-tag-edit
import type { Page } from '@playwright/test'
import {
  garmentListWithColorResponseSchema,
  type GarmentWithColor,
} from '@couture/api-client/contracts/http'
import { formatGarmentAlt } from '@couture/utils'
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
import { cleanupWardrobeUserTestData } from '../support/helpers/user-test-data'

const environment = resolveEnvironmentConfig('local')
const phone = {
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  serviceWorkers: 'block' as const,
}

// CC-7.9 D6: the detail's back control is the shared top bar's, outside the detail itself.
const topBarBack = (page: Page) =>
  page.getByTestId('app-header').getByTestId('app-top-bar-back')

async function openDetail(page: Page, garmentId: string, name: string) {
  const open = page.getByTestId(`garment-open-${garmentId}`)
  await expect(open).toHaveAccessibleName(name)
  await open.click()
  const detail = page.getByTestId('garment-detail')
  await expect(detail).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`[?&]garment=${garmentId}(?:&|$)`))
  return detail
}

async function expectTags(
  page: Page,
  tags: { category: string; material: string; comfort: string }
) {
  await expect(page.getByTestId('garment-detail-category')).toHaveText(tags.category)
  await expect(page.getByTestId('garment-detail-material')).toHaveText(tags.material)
  await expect(page.getByTestId('garment-detail-comfort')).toHaveText(tags.comfort)
}

const realTest = test.extend<{ member: SeededMember }>({
  member: async ({ apiRequest }, use, testInfo) => {
    const member = await signUpAdultMember(
      apiRequest,
      environment.apiBaseUrl,
      `${buildUniqueId('garment-detail', testInfo)}@example.test`
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

realTest.describe('Garment detail and tag edit against the local API', () => {
  realTest.use({ authSessionEnabled: false, ...phone })

  realTest.beforeEach(({}, testInfo) => {
    realTest.skip(
      isNonLocalEnvironment(testInfo),
      'Seeds garments through the local wardrobe worker and signs in with the local E2E token.'
    )
  })

  realTest(
    '[P0] [7.5-E2E-001] edits tags with Saved and Undo, and the change survives a reload',
    async ({ apiRequest, interceptNetworkCall, member, page }) => {
      const auth = { Authorization: `Bearer ${member.accessToken}` }
      const garment = await realTest.step('Seed a ready top', () =>
        seedReadyGarment(apiRequest, environment.apiBaseUrl, member, {
          category: 'top',
          material: 'cotton',
          comfortRange: 'mild',
        })
      )

      const readBack = async () => {
        const response = await apiRequest({
          method: 'GET',
          path: '/api/v1/wardrobe/garments',
          baseUrl: environment.apiBaseUrl,
          headers: { ...auth, 'x-couture-garment-color': '1' },
        })
        expect(response.status).toBe(200)
        const [stored] = garmentListWithColorResponseSchema
          .parse(response.body)
          .data.filter((item) => item.id === garment.id)
        expect(stored).toBeDefined()
        return stored!
      }
      // The oracle for the alt text is the color the server classified for this photo.
      const { colorFamily } = await readBack()
      const topAlt = formatGarmentAlt('en-US', { colorFamily, category: 'top' })

      await realTest.step('Open the garment from the closet grid', async () => {
        await page.addInitScript((token) => {
          window.sessionStorage.setItem('couturecast.access-token', token)
        }, member.accessToken)
        await page.setExtraHTTPHeaders(auth)
        await page.goto('/wardrobe')
        await waitForAccessibilityReady(page)
        const detail = await openDetail(page, garment.id, topAlt)
        const photo = detail.getByRole('img', { name: topAlt })
        await expect(photo).toBeVisible()
        // A decoded photo, not a broken image or the placeholder (Codex P2.5).
        await expect(photo).toHaveJSProperty('tagName', 'IMG')
        await expect
          .poll(() => photo.evaluate((img: HTMLImageElement) => img.naturalWidth))
          .toBeGreaterThan(0)
        // CC-7.9 D6: Back is the shared top bar control
        await expect(topBarBack(page)).toBeVisible()
        await expect(topBarBack(page)).toHaveAccessibleName('Back')
        await expect(detail.getByTestId('style-piece-open')).toBeVisible()
        await expectTags(page, { category: 'Top', material: 'Cotton', comfort: 'Mild' })
      })

      await realTest.step('Edit material and comfort, then Done', async () => {
        await page.getByTestId('garment-edit-tags').click()
        await page.getByTestId('garment-tag-option-material-wool').click()
        await page.getByTestId('garment-tag-option-comfort-cold').click()
        const save = interceptNetworkCall({
          method: 'PATCH',
          url: `**/api/v1/wardrobe/garments/${garment.id}/tags`,
        })
        await page.getByTestId('garment-tag-done').click()
        const { status, requestJson } = await save
        expect(status).toBe(200)
        // Done names the tags the editor opened with, so a newer edit is never overwritten.
        expect(requestJson).toEqual({
          category: 'top',
          material: 'wool',
          comfortRange: 'cold',
          expected: { category: 'top', material: 'cotton', comfortRange: 'mild' },
        })
        await expect(page.getByTestId('status-feedback-bar')).toContainText('Saved')
        await expectTags(page, { category: 'Top', material: 'Wool', comfort: 'Cold' })
      })

      await realTest.step('Undo a second edit back to the saved tags', async () => {
        await page.getByTestId('garment-edit-tags').click()
        await page.getByTestId('garment-tag-option-comfort-hot').click()
        const save = interceptNetworkCall({
          method: 'PATCH',
          url: `**/api/v1/wardrobe/garments/${garment.id}/tags`,
        })
        await page.getByTestId('garment-tag-done').click()
        expect((await save).status).toBe(200)
        await expectTags(page, { category: 'Top', material: 'Wool', comfort: 'Hot' })

        const undo = interceptNetworkCall({
          method: 'PATCH',
          url: `**/api/v1/wardrobe/garments/${garment.id}/tags`,
        })
        await page.getByTestId('status-bar-action-undo').click()
        const { status, requestJson } = await undo
        expect(status).toBe(200)
        // Undo restores the tags before this save and names the tags this save wrote.
        expect(requestJson).toEqual({
          category: 'top',
          material: 'wool',
          comfortRange: 'cold',
          expected: { category: 'top', material: 'wool', comfortRange: 'hot' },
        })
        await expect(page.getByTestId('status-feedback-bar')).toContainText(
          'Change undone.'
        )
        await expectTags(page, { category: 'Top', material: 'Wool', comfort: 'Cold' })
      })

      await realTest.step(
        'Reload reopens the detail with the persisted tags',
        async () => {
          await page.reload()
          await expect(page.getByTestId('garment-detail')).toBeVisible()
          await expectTags(page, { category: 'Top', material: 'Wool', comfort: 'Cold' })
          expect(await readBack()).toMatchObject({
            category: 'top',
            material: 'wool',
            comfortRange: 'cold',
            colorFamily,
          })
        }
      )

      await realTest.step('Back shows the grid with the new tags', async () => {
        // CC-7.9 D6: Back is the shared top bar control
        await topBarBack(page).click()
        await expect(page.getByTestId('garment-detail')).toHaveCount(0)
        await expect(page).not.toHaveURL(/[?&]garment=/)
        const card = page.getByTestId(`garment-card-${garment.id}`)
        await expect(card.getByTestId('garment-card-label')).toContainText('Wool')
        await expect(page.getByTestId(`garment-open-${garment.id}`)).toBeFocused()
      })
    }
  )
})

test.describe('Garment detail states on a phone (mocked wardrobe)', () => {
  test.use({ authSessionEnabled: false, ...phone })

  test.beforeEach(({ baseURL }, testInfo) => {
    test.skip(isNonLocalEnvironment(testInfo), 'Uses synthetic loopback-only fixtures.')
    expect(new URL(baseURL!).hostname).toMatch(/^(?:127\.0\.0\.1|localhost|\[::1\])$/)
  })

  async function mockCloset(
    page: Page,
    baseURL: string,
    interceptNetworkCall: Parameters<typeof mockStyleWardrobe>[2],
    // Extra cards give the phone grid real scroll height for the back-navigation checks.
    extraCards = 0
  ) {
    const blueTop: GarmentWithColor = {
      ...photographedGarment(baseURL, 'detail-blue-top'),
      colorFamily: 'blue',
    }
    const others: GarmentWithColor[] = Array.from({ length: extraCards }, (_, index) => ({
      ...photographedGarment(baseURL, `detail-extra-${index + 1}`),
      colorFamily: 'gray',
    }))
    // The mock reads this record on every request, so a test can change what is stored.
    const inventory = { [memberA]: [...others, blueTop] }
    const writes = await mockStyleWardrobe(page, baseURL, interceptNetworkCall, inventory)
    return { blueTop, writes, inventory }
  }

  test('[P1] [7.5-E2E-002] names the photo "Blue top" and says "No changes" without a request', async ({
    baseURL,
    interceptNetworkCall,
    page,
  }) => {
    const { blueTop, writes } = await mockCloset(page, baseURL!, interceptNetworkCall)
    await page.goto('/wardrobe')

    await expect(
      page
        .getByTestId(`garment-card-${blueTop.id}`)
        .getByRole('img', { name: 'Blue top' })
    ).toBeVisible()
    const detail = await openDetail(page, blueTop.id, 'Blue top')
    await expect(detail.getByRole('img', { name: 'Blue top' })).toHaveJSProperty(
      'naturalWidth',
      256
    )
    await expect(detail.getByRole('heading', { name: 'Blue top' })).toBeVisible()

    await page.getByTestId('garment-edit-tags').click()
    await page.getByTestId('garment-tag-done').click()
    await expect(page.getByTestId('status-feedback-bar')).toContainText('No changes')
    expect(writes).toEqual([])
  })

  // The refused PATCH is the state under test, so the network error monitor stays off here.
  test(
    '[P1] [7.5-E2E-002] a concurrent update keeps the draft, shows the stored tags and retries against them',
    { annotation: [{ type: 'skipNetworkMonitoring' }] },
    async ({ baseURL, interceptNetworkCall, page }) => {
      const { blueTop, inventory } = await mockCloset(
        page,
        baseURL!,
        interceptNetworkCall
      )
      // Another device stores linen while this editor is open on cotton.
      const stored: GarmentWithColor = { ...blueTop, material: 'linen' }
      const patches: unknown[] = []
      await page.route(
        `**/api/v1/wardrobe/garments/${blueTop.id}/tags`,
        async (route) => {
          if (route.request().method() !== 'PATCH') return route.fallback()
          const body: unknown = route.request().postDataJSON()
          patches.push(body)
          if (patches.length === 1) {
            return route.fulfill({
              status: 409,
              json: { statusCode: 409, message: 'GARMENT_TAGS_CHANGED' },
            })
          }
          const saved: GarmentWithColor = { ...stored, material: 'wool' }
          inventory[memberA] = [saved]
          return route.fulfill({ status: 200, json: { data: saved } })
        }
      )
      await page.goto('/wardrobe')
      await openDetail(page, blueTop.id, 'Blue top')

      await page.getByTestId('garment-edit-tags').click()
      await page.getByTestId('garment-tag-option-material-wool').click()
      inventory[memberA] = [stored]
      const reread = page.waitForRequest(
        (request) =>
          request.method() === 'GET' &&
          new URL(request.url()).pathname === '/api/v1/wardrobe/garments'
      )
      await page.getByTestId('garment-tag-done').click()
      await reread

      await expect(page.getByTestId('garment-tag-error')).toHaveText(
        'This piece changed on another device. Check the tags and try again.'
      )
      await expect(page.getByTestId('garment-tag-option-material-wool')).toHaveAttribute(
        'aria-pressed',
        'true'
      )
      // The tag rows show what the re-read found; the editor keeps the member's draft.
      await expect(page.getByTestId('garment-detail-material')).toHaveText('Linen')
      expect(patches[0]).toMatchObject({
        material: 'wool',
        expected: { category: 'top', material: 'cotton', comfortRange: 'mild' },
      })

      // Done again is a deliberate retry against the stored tags, so it saves.
      await page.getByTestId('garment-tag-done').click()
      await expect(page.getByTestId('status-feedback-bar')).toContainText('Saved')
      expect(patches).toHaveLength(2)
      expect(patches[1]).toMatchObject({
        category: 'top',
        material: 'wool',
        comfortRange: 'mild',
        expected: { category: 'top', material: 'linen', comfortRange: 'mild' },
      })
      await expect(page.getByTestId('garment-detail-material')).toHaveText('Wool')
      await expect(page.getByTestId('garment-tag-error')).toHaveCount(0)
    }
  )

  test(
    '[P1] [7.5-E2E-002] shows a guardian block in its own words and keeps the draft',
    { annotation: [{ type: 'skipNetworkMonitoring' }] },
    async ({ baseURL, interceptNetworkCall, page }) => {
      const { blueTop } = await mockCloset(page, baseURL!, interceptNetworkCall)
      const refused = interceptNetworkCall({
        method: 'PATCH',
        url: `**/api/v1/wardrobe/garments/${blueTop.id}/tags`,
        fulfillResponse: {
          status: 403,
          body: { statusCode: 403, message: 'GUARDIAN_CONSENT_REQUIRED' },
        },
      })
      await page.goto('/wardrobe')
      await openDetail(page, blueTop.id, 'Blue top')

      await page.getByTestId('garment-edit-tags').click()
      await page.getByTestId('garment-tag-option-material-wool').click()
      await page.getByTestId('garment-tag-done').click()
      expect((await refused).status).toBe(403)

      await expect(page.getByTestId('garment-tag-error')).toHaveText(
        'A guardian has to approve closet changes first.'
      )
      await expect(page.getByTestId('garment-tag-option-material-wool')).toHaveAttribute(
        'aria-pressed',
        'true'
      )
      await expect(page.getByTestId('garment-detail-material')).toHaveText('Cotton')
    }
  )

  test('[P1] [7.5-E2E-002] a dropped connection reads as offline and keeps the draft', async ({
    baseURL,
    interceptNetworkCall,
    page,
  }) => {
    const { blueTop } = await mockCloset(page, baseURL!, interceptNetworkCall)
    await page.goto('/wardrobe')
    await openDetail(page, blueTop.id, 'Blue top')
    // No PATCH handler: the wardrobe mock aborts every unhandled API write.
    await page.getByTestId('garment-edit-tags').click()
    await page.getByTestId('garment-tag-option-comfort-cold').click()
    await page.getByTestId('garment-tag-done').click()

    await expect(page.getByTestId('garment-tag-error')).toHaveAttribute(
      'data-failure',
      'offline'
    )
    await expect(page.getByTestId('garment-tag-option-comfort-cold')).toHaveAttribute(
      'aria-pressed',
      'true'
    )
  })

  test('[P1] [7.5-E2E-002] Style this piece opens from the detail', async ({
    baseURL,
    interceptNetworkCall,
    page,
  }) => {
    const { blueTop } = await mockCloset(page, baseURL!, interceptNetworkCall)
    await page.goto('/wardrobe')
    const detail = await openDetail(page, blueTop.id, 'Blue top')

    await detail.getByTestId('style-piece-open').click()

    const panel = page.getByTestId('style-piece-panel')
    await expect(panel).toBeVisible()
    await expect(panel.getByTestId('style-piece-look')).toHaveCount(3)
  })

  test('[P1] [7.5-E2E-001] back returns to the grid at the same scroll with focus on the card', async ({
    baseURL,
    interceptNetworkCall,
    page,
  }) => {
    // The opened card is the last of 12, well below the fold at 390x844.
    const { blueTop } = await mockCloset(page, baseURL!, interceptNetworkCall, 11)
    await page.goto('/wardrobe')
    const open = page.getByTestId(`garment-open-${blueTop.id}`)
    await open.scrollIntoViewIfNeeded()
    const gridScroll = await page.evaluate(() => window.scrollY)
    expect(gridScroll).toBeGreaterThan(400)

    await openDetail(page, blueTop.id, 'Blue top')
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)

    // CC-7.9 D6: Back is the shared top bar control
    await topBarBack(page).click()
    await expect(page.getByTestId('garment-detail')).toHaveCount(0)
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(gridScroll)
    await expect(open).toBeFocused()

    // Browser Back from the detail lands in the same place.
    await openDetail(page, blueTop.id, 'Blue top')
    await page.goBack()
    await expect(page.getByTestId('garment-detail')).toHaveCount(0)
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(gridScroll)
  })

  test('[P2] [7.5-E2E-001] browser Back and Forward keep the top bar Back control on history', async ({
    baseURL,
    interceptNetworkCall,
    page,
  }) => {
    const { blueTop } = await mockCloset(page, baseURL!, interceptNetworkCall)
    await page.goto('/wardrobe')
    const entries = await page.evaluate(() => history.length)

    await openDetail(page, blueTop.id, 'Blue top')
    await page.goBack()
    await expect(page.getByTestId('garment-detail')).toHaveCount(0)
    await page.goForward()
    await expect(page.getByTestId('garment-detail')).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`[?&]garment=${blueTop.id}(?:&|$)`))

    // The top bar Back control steps back through history: it adds no grid entry, so Forward
    // still reaches the detail.
    // CC-7.9 D6: Back is the shared top bar control
    await topBarBack(page).click()
    await expect(page.getByTestId('garment-detail')).toHaveCount(0)
    await expect(page).not.toHaveURL(/[?&]garment=/)
    expect(await page.evaluate(() => history.length)).toBe(entries + 1)
    await page.goForward()
    await expect(page.getByTestId('garment-detail')).toBeVisible()
  })

  test('[P1] [7.5-E2E-002] renews a photo link that is about to expire when the detail opens', async ({
    baseURL,
    interceptNetworkCall,
    page,
  }) => {
    const expiring: GarmentWithColor = {
      ...photographedGarment(baseURL!, 'detail-expiring-top'),
      imageAccess: {
        url: new URL('/style-piece-fixture-photo/detail-expiring-top', baseURL).href,
        expiresAt: new Date(Date.now() + 30_000).toISOString(),
      },
      colorFamily: 'blue',
    }
    const inventory = { [memberA]: [expiring] }
    await mockStyleWardrobe(page, baseURL!, interceptNetworkCall, inventory)
    let listReads = 0
    page.on('request', (request) => {
      if (
        request.method() === 'GET' &&
        new URL(request.url()).pathname === '/api/v1/wardrobe/garments'
      )
        listReads += 1
    })
    await page.goto('/wardrobe')
    await expect(page.getByTestId(`garment-open-${expiring.id}`)).toBeVisible()
    const readsBeforeOpen = listReads
    // The next read hands out a fresh lease for the same photo.
    const renewedUrl = new URL(
      '/style-piece-fixture-photo/detail-expiring-top-renewed',
      baseURL
    ).href
    inventory[memberA] = [
      {
        ...expiring,
        imageAccess: { url: renewedUrl, expiresAt: '2099-12-31T00:00:00.000Z' },
      },
    ]

    await openDetail(page, expiring.id, 'Blue top')

    await expect.poll(() => listReads).toBe(readsBeforeOpen + 1)
    const photo = page.getByTestId('garment-detail-photo')
    await expect(photo).toHaveAttribute('src', renewedUrl)
    await expect(photo).toHaveAccessibleName('Blue top')
    await expect(photo).toHaveJSProperty('naturalWidth', 256)
  })

  test('[P1] [7.5-E2E-003] the detail and the open editor pass axe', async ({
    baseURL,
    interceptNetworkCall,
    page,
  }) => {
    const { blueTop } = await mockCloset(page, baseURL!, interceptNetworkCall)
    await page.goto('/wardrobe')
    await openDetail(page, blueTop.id, 'Blue top')
    await checkA11y(page)

    await page.getByTestId('garment-edit-tags').click()
    await expect(page.getByTestId('garment-tag-editor')).toBeVisible()
    await checkA11y(page)

    // The back control and the tag choices are reachable and operable by keyboard.
    // CC-7.9 D6: Back is the shared top bar control
    const back = topBarBack(page)
    await back.focus()
    await expect(back).toBeFocused()
    const wool = page.getByTestId('garment-tag-option-material-wool')
    await wool.focus()
    await page.keyboard.press('Enter')
    await expect(wool).toHaveAttribute('aria-pressed', 'true')
  })
})
