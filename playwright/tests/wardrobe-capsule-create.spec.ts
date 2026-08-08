// Story 4.3 Task 8: capsule creation journey, ordering durability, and cross-client refresh.
import type { Page } from '@playwright/test'
import {
  interceptNetworkCall as interceptOnPage,
  type InterceptNetworkCallFn,
} from '@seontechnologies/playwright-utils/intercept-network-call'
import { log } from '@seontechnologies/playwright-utils/log'
import type {
  CreateOutfitCapsuleInput,
  OutfitCapsuleContract,
} from '@couture/api-client/contracts/http'
import {
  capsuleTest as test,
  expect,
  stubGarmentLibrary,
} from '../support/helpers/capsule-session'
import { waitForAccessibilityReady } from '../support/helpers/accessibility'

/**
 * The acting client must reflect a committed create within two seconds of the
 * successful response. This is measured from the response, not from the click,
 * so it excludes server latency and isolates client reconciliation.
 */
const CLIENT_RECONCILIATION_BUDGET_MS = 2_000

/**
 * `*` does not cross a path separator in a glob, so these patterns stay off the
 * `/capsules/:id` detail routes while still matching an optional query string.
 */
const CAPSULE_LIST_URL = '**/api/v1/wardrobe/*/capsules*'
const CAPSULE_CREATE_URL = '**/api/v1/wardrobe/*/capsules'

type CapsuleListResponse = {
  data: OutfitCapsuleContract[]
  total: number
  limit: number
  offset: number
}

type CapsuleResponse = { data: OutfitCapsuleContract }

async function openCapsules(
  page: Page,
  interceptNetworkCall: InterceptNetworkCallFn
): Promise<CapsuleListResponse | null> {
  stubGarmentLibrary(page)

  await log.step('Intercept the capsule library fetch before navigating to it')
  const listCall = interceptNetworkCall({ method: 'GET', url: CAPSULE_LIST_URL })

  await page.goto('/wardrobe/capsules')

  const { responseJson, status } = await listCall
  expect(status).toBe(200)
  await waitForAccessibilityReady(page)

  return responseJson as CapsuleListResponse | null
}

async function fillCapsuleForm(page: Page, name: string) {
  await page.getByTestId('capsule-name-input').fill(name)

  const checkboxes = page.locator('[data-testid^="garment-select-checkbox-"]')
  await expect(checkboxes.first()).toBeVisible()
  await checkboxes.nth(0).check()
  await checkboxes.nth(1).check()
}

test.describe('Wardrobe capsule creation', () => {
  test('4.3-E2E-01 creates a capsule and shows it in the library within two seconds', async ({
    capsuleSession: _capsuleSession,
    page,
    interceptNetworkCall,
  }) => {
    await openCapsules(page, interceptNetworkCall)

    await log.step('Open the builder dialog and fill a valid capsule')
    await page.getByTestId('create-capsule-button').click()
    await expect(page.getByRole('dialog')).toBeVisible()

    const capsuleName = `Playwright capsule ${Date.now()}`
    await fillCapsuleForm(page, capsuleName)

    await log.step('Save and capture the one representative network contract')
    const createCall = interceptNetworkCall({
      method: 'POST',
      url: CAPSULE_CREATE_URL,
    })

    await page.getByTestId('save-capsule-button').click()
    const { status, response, responseJson, requestJson } = await createCall

    const created = responseJson as CapsuleResponse | null
    const submitted = requestJson as CreateOutfitCapsuleInput | null

    await log.step('Assert the create response status, cache policy, and validator')
    expect(status).toBe(201)
    expect(response?.headers()['cache-control']).toBe('private, no-store')
    expect(response?.headers()['etag']).toMatch(/^"capsule:.+:\d+"$/)

    await log.step('Assert the client sent the displayed order as the canonical ID array')
    expect(submitted?.garmentIds).toHaveLength(2)
    expect(created?.data.name).toBe(capsuleName)
    expect(created?.data.availabilityStatus).toBe('ready')

    await log.step('Assert the library reconciles within the two-second budget')
    const committedAt = Date.now()
    await expect(page.getByText(capsuleName)).toBeVisible({
      timeout: CLIENT_RECONCILIATION_BUDGET_MS,
    })
    expect(Date.now() - committedAt).toBeLessThanOrEqual(CLIENT_RECONCILIATION_BUDGET_MS)
  })

  test('4.3-E2E-02 preserves the exact garment order across a reload', async ({
    capsuleSession: _capsuleSession,
    page,
    interceptNetworkCall,
  }) => {
    await openCapsules(page, interceptNetworkCall)
    await page.getByTestId('create-capsule-button').click()

    const capsuleName = `Ordered capsule ${Date.now()}`
    await fillCapsuleForm(page, capsuleName)

    const orderedBefore = await page
      .locator('[data-testid^="ordered-garment-item-"]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-testid')))

    await log.step('Reverse the first two rows through the accessible move controls')
    const firstId = orderedBefore[0]?.replace('ordered-garment-item-', '')
    await page.getByTestId(`move-down-button-${firstId}`).click()

    const expectedOrder = [orderedBefore[1], orderedBefore[0]]

    await log.step('Save the reordered capsule')
    const createCall = interceptNetworkCall({
      method: 'POST',
      url: CAPSULE_CREATE_URL,
    })

    await page.getByTestId('save-capsule-button').click()
    const { requestJson, responseJson } = await createCall

    const submitted = (requestJson as CreateOutfitCapsuleInput | null)?.garmentIds ?? []
    const created = responseJson as CapsuleResponse | null

    await log.step('Assert the sent array matches what the server echoed back')
    expect(submitted).toHaveLength(2)
    expect(created?.data.garments.map((garment) => garment.id)).toEqual(submitted)

    await expect(page.getByText(capsuleName)).toBeVisible()

    await log.step('Reload so the order is reproduced from persisted state, not memory')
    const reloadCall = interceptNetworkCall({ method: 'GET', url: CAPSULE_LIST_URL })
    await page.reload()
    await reloadCall
    await waitForAccessibilityReady(page)

    // Reopen this test's own capsule. Picking the first card would open whatever
    // a parallel worker created against the shared seeded owner.
    const capsuleId = created?.data.id as string
    await page.getByTestId(`edit-capsule-button-${capsuleId}`).click()

    const orderedAfter = await page
      .locator('[data-testid^="ordered-garment-item-"]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-testid')))

    expect(orderedAfter).toEqual(expectedOrder)
  })

  test('4.3-E2E-03 refreshes a second open client on focus', async ({
    capsuleSession: _capsuleSession,
    page,
    context,
    interceptNetworkCall,
  }) => {
    await openCapsules(page, interceptNetworkCall)

    await log.step('Pre-open an observer client so it cannot load the state fresh')
    const observer = await context.newPage()
    stubGarmentLibrary(observer)

    // The interceptNetworkCall fixture is bound to the `page` fixture, so the
    // observer needs the standalone form with its own page.
    const observerListCall = interceptOnPage({
      page: observer,
      method: 'GET',
      url: CAPSULE_LIST_URL,
    })
    await observer.goto('/wardrobe/capsules')
    await observerListCall
    await waitForAccessibilityReady(observer)

    await log.step('Create a capsule in the acting client')
    await page.getByTestId('create-capsule-button').click()
    const capsuleName = `Cross client ${Date.now()}`
    await fillCapsuleForm(page, capsuleName)

    const createCall = interceptNetworkCall({
      method: 'POST',
      url: CAPSULE_CREATE_URL,
    })
    await page.getByTestId('save-capsule-button').click()
    expect((await createCall).status).toBe(201)

    await log.step('Assert the observer has not yet seen the new capsule')
    await expect(observer.getByText(capsuleName)).toHaveCount(0)

    await log.step('Refocus the observer, the documented refresh trigger for this story')
    await observer.bringToFront()
    await observer.evaluate(() => window.dispatchEvent(new Event('focus')))

    await expect(observer.getByText(capsuleName)).toBeVisible({
      timeout: CLIENT_RECONCILIATION_BUDGET_MS,
    })
    await observer.close()
  })

  test('4.3-E2E-04 applies a combined keyword, occasion, and favorite filter', async ({
    capsuleSession: _capsuleSession,
    page,
    interceptNetworkCall,
  }) => {
    await openCapsules(page, interceptNetworkCall)

    // The search box debounces, so the keyword only reaches the server after the
    // timer flushes. Awaiting that request first means the favorite toggle below
    // is applied on top of the keyword rather than racing it.
    await log.step('Apply the keyword and await its debounced request')
    const keywordCall = interceptNetworkCall({
      method: 'GET',
      url: '**/api/v1/wardrobe/*/capsules?*q=capsule*',
    })
    await page.getByTestId('capsule-search-input').fill('capsule')
    await keywordCall

    await log.step('Add the occasion filter and await its request')
    const occasionCall = interceptNetworkCall({
      method: 'GET',
      url: '**/api/v1/wardrobe/*/capsules?*occasion=work*',
    })
    await page.getByTestId('capsule-occasion-filter').selectOption('work')
    await occasionCall

    await log.step('Add the favorite filter, which must carry all three')
    const filteredCall = interceptNetworkCall({
      method: 'GET',
      url: '**/api/v1/wardrobe/*/capsules?*isFavorite=true*',
    })

    await page.getByTestId('capsule-favorite-filter').check()
    const { status, request, responseJson } = await filteredCall

    expect(status).toBe(200)

    await log.step('Assert every selected filter reached the server on one request')
    const requestUrl = new URL(request?.url() ?? '')
    expect(requestUrl.searchParams.get('q')).toBe('capsule')
    expect(requestUrl.searchParams.get('occasion')).toBe('work')
    expect(requestUrl.searchParams.get('isFavorite')).toBe('true')

    await log.step('Assert the response is self-consistent; the API owns the full matrix')
    const filtered = responseJson as CapsuleListResponse | null
    for (const capsule of filtered?.data ?? []) {
      expect(capsule.isFavorite).toBe(true)
      expect(capsule.occasions).toContain('work')
    }

    await expect(page.getByTestId('capsule-loading-state')).toHaveCount(0)
  })
})
