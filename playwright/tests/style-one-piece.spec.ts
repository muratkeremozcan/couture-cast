import type { Locator, Page } from '@playwright/test'
import type { GarmentItemContract } from '@couture/api-client/contracts/http'
import { expect, test } from '../support/fixtures/merged-fixtures'
import { isNonLocalEnvironment } from '../support/helpers/api-test'
import {
  memberA,
  memberB,
  mockStyleWardrobe,
  photographedGarment,
  switchStyleMember,
} from '../support/helpers/style-one-piece-fixtures'

const openerName = 'Style this piece'

async function openStylePanel(page: Page, id: string) {
  const card = page.getByTestId(`garment-card-${id}`)
  await expect(card.getByTestId('garment-status-ready')).toBeVisible()
  const opener = card.getByTestId('style-piece-open')
  await expect(opener).toHaveAccessibleName(openerName)
  await opener.click()
  const panel = page.getByTestId('style-piece-panel')
  await expect(panel).toBeVisible()
  return panel
}

async function expectPinnedPhoto(look: Locator, url: string) {
  const anchor = look.getByTestId('style-piece-anchor')
  await expect(anchor).toHaveAttribute('src', url)
  await expect(anchor).toHaveJSProperty('naturalWidth', 256)
  await expect(anchor).toHaveAccessibleName('Your piece')
  await expect(look.getByTestId('style-piece-swap-top')).toHaveCount(0)
}

test.describe('Style this piece on a phone', () => {
  test.use({
    authSessionEnabled: false,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    serviceWorkers: 'block',
  })

  test.beforeEach(({ baseURL }, testInfo) => {
    test.skip(isNonLocalEnvironment(testInfo), 'Uses synthetic loopback-only fixtures.')
    expect(new URL(baseURL!).hostname).toMatch(/^(?:127\.0\.0\.1|localhost|\[::1\])$/)
  })

  test('styles the selected photo in three rain-ready looks and reopens a saved swap', async ({
    baseURL,
    page,
    interceptNetworkCall,
  }) => {
    // Put another equally eligible top first so a default-first photo fails the test.
    const other = photographedGarment(baseURL!, 'style-piece-other-top')
    const garment = photographedGarment(baseURL!, 'style-piece-top')
    const photo = garment.imageAccess!.url
    const writes = await mockStyleWardrobe(page, baseURL!, interceptNetworkCall, {
      [memberA]: [other, garment],
    })

    await page.goto('/wardrobe')
    await expect(
      page.getByTestId(`garment-card-${garment.id}`).getByRole('img', {
        name: 'Uploaded garment',
      })
    ).toHaveAttribute('src', photo)
    const panel = await openStylePanel(page, garment.id)
    await expect(
      panel.getByRole('group', { name: 'Example weather', exact: true })
    ).toBeVisible()
    await expect(panel.getByTestId('style-piece-look')).toHaveCount(3)
    await expect(panel.getByText('Rain shell', { exact: true })).toHaveCount(0)

    const rain = panel.getByTestId('style-piece-weather-warm-rainy')
    await expect(rain).toHaveAccessibleName('Warm and rainy')
    await rain.click()

    const looks = panel.getByTestId('style-piece-look')
    await expect(looks).toHaveCount(3)
    // These bottoms distinguish the three complete rainy recipes for a mild top.
    for (const label of ['Midi skirt', 'Chinos', 'Linen trousers']) {
      const look = looks.filter({ has: page.getByText(label, { exact: true }) })
      await expect(look).toHaveCount(1)
      await expect(look.getByText('Rain shell', { exact: true })).toBeVisible()
      await expect(look.getByTestId('style-piece-swap-bottom')).toBeVisible()
      await expect(look.getByTestId('style-piece-swap-shoes')).toBeVisible()
      await expectPinnedPhoto(look, photo)
    }
    for (const index of [1, 2, 3]) {
      await expect(
        panel.getByRole('heading', { name: `Look ${index}`, exact: true })
      ).toBeVisible()
    }
    await expect(panel.getByText('Your piece', { exact: true }).first()).toBeVisible()
    await expect(panel.getByText('Example pieces', { exact: true }).first()).toBeVisible()

    const edited = looks.filter({ has: page.getByText('Midi skirt', { exact: true }) })
    await expect(edited.getByText('White sneakers', { exact: true })).toBeVisible()
    await edited.getByTestId('style-piece-swap-shoes').click()
    const loafers = edited.getByTestId('style-piece-option-sample:g:loafers')
    await expect(loafers).toHaveAccessibleName(/Loafers/)
    await loafers.click()
    await expect(edited.getByText('Loafers', { exact: true })).toBeVisible()
    await expect(edited.getByText('White sneakers', { exact: true })).toHaveCount(0)
    await expectPinnedPhoto(edited, photo)

    await edited.getByRole('button', { name: 'Save look', exact: true }).click()
    const savedLooks = panel.getByRole('region', {
      name: 'Saved on this device',
      exact: true,
    })
    const reopen = savedLooks.getByTestId('style-piece-reopen')
    await expect(reopen).toHaveAccessibleName(/^Open saved look\b.*Warm and rainy/)
    const savedData = await page.evaluate(() =>
      Object.keys(localStorage)
        .filter((key) => key.startsWith('couturecast.style-piece.'))
        .map((key) => localStorage.getItem(key))
    )
    expect(savedData).toHaveLength(1)
    expect(JSON.parse(savedData[0] ?? 'null') as unknown).toEqual([
      {
        lookId: 'sample:l:silk-midi',
        weather: 'warm-rainy',
        swaps: { shoes: 'sample:g:loafers' },
      },
    ])

    await page.reload()
    await openStylePanel(page, garment.id)
    await expect(rain).toHaveAttribute('aria-pressed', 'false')
    await reopen.click()
    await expect(rain).toHaveAttribute('aria-pressed', 'true')
    await expect(edited.getByText('Loafers', { exact: true })).toBeVisible()
    await expect(edited.getByText('Rain shell', { exact: true })).toBeVisible()
    await expectPinnedPhoto(edited, photo)

    const remove = savedLooks.getByTestId('style-piece-remove')
    await expect(remove).toHaveAccessibleName(/^Remove saved look\b/)
    await remove.click()
    await expect(reopen).toHaveCount(0)
    await page.reload()
    await openStylePanel(page, garment.id)
    await expect(panel.getByTestId('style-piece-save').first()).toBeEnabled()
    await expect(reopen).toHaveCount(0)
    expect(writes, 'Wardrobe styling is local to this device').toEqual([])
  })

  test('keeps the edited card and keyboard focus when two swaps duplicate another look', async ({
    baseURL,
    page,
    interceptNetworkCall,
  }) => {
    const garment = photographedGarment(baseURL!, 'style-piece-duplicate')
    await mockStyleWardrobe(page, baseURL!, interceptNetworkCall, {
      [memberA]: [garment],
    })
    await page.goto('/wardrobe')
    const panel = await openStylePanel(page, garment.id)
    const looks = panel.getByTestId('style-piece-look')
    const first = looks.filter({
      has: page.getByRole('heading', { name: 'Look 1', exact: true }),
    })
    const second = looks.filter({
      has: page.getByRole('heading', { name: 'Look 2', exact: true }),
    })
    await expect(first.getByText('Pleated skirt', { exact: true })).toBeVisible()
    await expect(first.getByText('Ankle boots', { exact: true })).toBeVisible()
    await expect(second.getByText('Dark jeans', { exact: true })).toBeVisible()
    await expect(second.getByText('Loafers', { exact: true })).toBeVisible()

    // The visual numbering can change after deduplication. Keep the actual card nodes.
    const originalFirst = await first.elementHandle()
    const originalSecond = await second.elementHandle()
    await second.getByTestId('style-piece-swap-bottom').press('Enter')
    await second.getByTestId('style-piece-option-sample:g:pleated-skirt').press('Enter')
    await expect(second.getByText('Pleated skirt', { exact: true })).toBeVisible()
    await expect(second.getByTestId('style-piece-swap-bottom')).toBeFocused()
    await second.getByTestId('style-piece-swap-shoes').press('Enter')
    const duplicate = second.getByTestId('style-piece-option-sample:g:ankle-boots')
    await expect(duplicate).toBeVisible()
    await duplicate.press('Enter')

    const matching = looks
      .filter({ has: page.getByText('Pleated skirt', { exact: true }) })
      .filter({ has: page.getByText('Ankle boots', { exact: true }) })
    await expect(matching).toHaveCount(1)
    await expect(matching.getByTestId('style-piece-swap-shoes')).toBeFocused()
    expect(
      await page.evaluate(
        ([oldFirst, oldSecond]) => ({
          firstConnected: oldFirst?.isConnected,
          secondConnected: oldSecond?.isConnected,
          secondOwnsFocus: oldSecond?.contains(document.activeElement),
        }),
        [originalFirst, originalSecond]
      )
    ).toEqual({ firstConnected: false, secondConnected: true, secondOwnsFocus: true })
    await expectPinnedPhoto(matching, garment.imageAccess!.url)
  })

  for (const failure of ['expiry', 'image decode failure'] as const) {
    test(`keeps keyboard focus in the dialog after photo ${failure}`, async ({
      baseURL,
      page,
      interceptNetworkCall,
    }) => {
      const expiryMs = 120_000
      const now = Date.now()
      const garment = photographedGarment(baseURL!, 'style-piece-loses-photo')
      if (failure === 'expiry') {
        await page.clock.install({ time: now })
        garment.imageAccess!.expiresAt = new Date(now + expiryMs).toISOString()
      }
      await mockStyleWardrobe(page, baseURL!, interceptNetworkCall, {
        [memberA]: [garment],
      })
      await page.goto('/wardrobe')
      const panel = await openStylePanel(page, garment.id)
      const firstLook = panel.getByTestId('style-piece-look').first()
      await expectPinnedPhoto(firstLook, garment.imageAccess!.url)
      const control = firstLook.getByTestId('style-piece-swap-shoes')
      await control.focus()
      await expect(control).toBeFocused()

      if (failure === 'expiry') {
        await page.clock.fastForward(expiryMs + 1)
      } else {
        // Invalid PNG bytes trigger the browser's image decode error.
        await firstLook
          .getByTestId('style-piece-anchor')
          .evaluate((image: HTMLImageElement) => {
            image.src = 'data:image/png;base64,AA=='
          })
      }

      const dialog = page.getByRole('dialog', { name: openerName, exact: true })
      const unavailable = dialog.getByTestId('style-piece-unavailable')
      await expect(unavailable).toHaveText(/your photo is unavailable/i)
      await expect(unavailable).toHaveAttribute('tabindex', '-1')
      await expect(unavailable).toBeFocused()
      await expect(dialog.getByTestId('style-piece-anchor')).toHaveCount(0)
      for (const key of ['Tab', 'Tab', 'Tab', 'Shift+Tab']) {
        await page.keyboard.press(key)
        await expect(dialog.and(page.locator(':focus-within'))).toBeVisible()
      }
    })
  }

  test('shows the empty closet without a styling entry point', async ({
    baseURL,
    page,
    interceptNetworkCall,
  }) => {
    await mockStyleWardrobe(page, baseURL!, interceptNetworkCall, { [memberA]: [] })
    await page.goto('/wardrobe')
    await expect(
      page.getByRole('heading', { name: 'No garments added yet' })
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: '+ Add Garment', exact: true })
    ).toBeVisible()
    await expect(page.getByTestId('style-piece-open')).toHaveCount(0)
    await expect(page.getByTestId('style-piece-panel')).toHaveCount(0)
  })

  test('explains unknown rain protection and lets the owner change the weather', async ({
    baseURL,
    page,
    interceptNetworkCall,
  }) => {
    const garment = photographedGarment(baseURL!, 'style-piece-jacket', {
      category: 'outerwear',
      material: 'wool',
    })
    await mockStyleWardrobe(page, baseURL!, interceptNetworkCall, {
      [memberA]: [garment],
    })
    await page.goto('/wardrobe')
    const panel = await openStylePanel(page, garment.id)
    const looks = panel.getByTestId('style-piece-look')
    await expect(looks.first()).toBeVisible()

    await panel.getByTestId('style-piece-weather-warm-rainy').click()
    await expect(panel.getByText(/can handle wind or rain/i)).toBeVisible()
    await expect(looks).toHaveCount(0)
    await expect(panel.getByTestId('style-piece-save')).toHaveCount(0)

    await panel.getByTestId('style-piece-weather-mild-dry').click()
    await expect(looks.first().getByTestId('style-piece-anchor')).toHaveAttribute(
      'src',
      garment.imageAccess!.url
    )
    await expect(panel.getByText(/can handle wind or rain/i)).toHaveCount(0)
    await page
      .getByRole('dialog', { name: openerName, exact: true })
      .getByRole('button', { name: 'Close', exact: true })
      .click()
    await expect(panel).toHaveCount(0)
    await expect(page.getByTestId('style-piece-open')).toBeFocused()
  })

  test('refreshes an expired photo and drops styling after the garment leaves inventory', async ({
    baseURL,
    page,
    interceptNetworkCall,
  }) => {
    const processing = photographedGarment(baseURL!, 'style-piece-processing', {
      status: 'processing',
      tagsConfirmedAt: null,
      imageAccess: null,
    })
    const unknown = photographedGarment(baseURL!, 'style-piece-no-photo', {
      imageAccess: null,
    })
    const ready = photographedGarment(baseURL!, 'style-piece-expired')
    const expired = {
      ...ready,
      imageAccess: {
        url: `${ready.imageAccess!.url}?version=expired`,
        expiresAt: '2000-01-01T00:00:00.000Z',
      },
    }
    const garments = [processing, unknown, expired]
    await mockStyleWardrobe(page, baseURL!, interceptNetworkCall, { [memberA]: garments })

    await page.goto('/wardrobe')
    for (const garment of garments) {
      await expect(page.getByTestId(`garment-card-${garment.id}`)).toBeVisible()
    }
    await expect(page.getByTestId('style-piece-open')).toHaveCount(0)

    const expiredCard = page.getByTestId(`garment-card-${expired.id}`)
    const refresh = expiredCard.getByTestId('style-piece-refresh')
    await expect(refresh).toHaveAccessibleName('Refresh photo')
    // The list still contains the same garment ID. The simulated list refresh supplies
    // a new photo URL, just as the signed inventory response would.
    garments.splice(garments.indexOf(expired), 1, ready)
    await refresh.click()
    await expect(refresh).toHaveCount(0)
    await expect(expiredCard.getByTestId('style-piece-open')).toBeFocused()
    const panel = await openStylePanel(page, ready.id)
    await expectPinnedPhoto(
      panel.getByTestId('style-piece-look').first(),
      ready.imageAccess!.url
    )
    await panel
      .getByTestId('style-piece-look')
      .first()
      .getByTestId('style-piece-save')
      .click()
    await expect(panel.getByTestId('style-piece-reopen')).toHaveCount(1)

    garments.splice(garments.indexOf(ready), 1)
    await page.reload()
    await expect(page.getByTestId(`garment-card-${processing.id}`)).toBeVisible()
    await expect(expiredCard).toHaveCount(0)
    await expect(page.getByTestId('style-piece-open')).toHaveCount(0)
    await expect(page.getByTestId('style-piece-reopen')).toHaveCount(0)
  })

  test('drops the prior photo and saved looks after a verified account switch', async ({
    baseURL,
    page,
    interceptNetworkCall,
  }) => {
    const prior = photographedGarment(baseURL!, 'style-piece-shared-id')
    const current = {
      ...prior,
      imageAccess: { ...prior.imageAccess!, url: `${prior.imageAccess!.url}?owner=b` },
    }
    await mockStyleWardrobe(page, baseURL!, interceptNetworkCall, {
      [memberA]: [prior],
      [memberB]: [current],
    })
    await page.goto('/wardrobe')

    const panel = await openStylePanel(page, prior.id)
    await panel
      .getByTestId('style-piece-look')
      .first()
      .getByTestId('style-piece-save')
      .click()
    const saved = panel.getByTestId('style-piece-reopen')
    await expect(saved).toHaveCount(1)

    await switchStyleMember(page, memberB)
    const inventoryPhoto = page.getByTestId(`garment-card-${current.id}`).getByRole('img')
    await expect(inventoryPhoto).toHaveAttribute('src', current.imageAccess.url)
    await expect(panel).toHaveCount(0)
    await openStylePanel(page, current.id)
    await expect(panel.getByTestId('style-piece-anchor')).toHaveCount(3)
    for (const look of await panel.getByTestId('style-piece-look').all()) {
      await expectPinnedPhoto(look, current.imageAccess.url)
    }
    await expect(panel.getByTestId('style-piece-save').first()).toBeEnabled()
    await expect(saved).toHaveCount(0)

    await switchStyleMember(page, memberA)
    await expect(inventoryPhoto).toHaveAttribute('src', prior.imageAccess!.url)
    await expect(panel).toHaveCount(0)
    await openStylePanel(page, prior.id)
    await expect(saved).toHaveCount(1)
  })

  for (const trigger of ['open', 'resume', 'periodic', 'save', 'reopen'] as const) {
    test(`revalidates deleted inventory on ${trigger} while the signed URL is still valid`, async ({
      baseURL,
      page,
      interceptNetworkCall,
    }) => {
      const garment = photographedGarment(baseURL!, 'style-piece-deleted')
      const inventory = { [memberA]: [garment] }
      if (trigger === 'periodic') await page.clock.install()
      await mockStyleWardrobe(page, baseURL!, interceptNetworkCall, inventory)
      await page.goto('/wardrobe')
      const card = page.getByTestId(`garment-card-${garment.id}`)
      const opener = card.getByTestId('style-piece-open')
      await expect(opener).toBeEnabled()

      // Hold the server's empty reply to inspect the UI while the inventory check is in flight.
      const whileCheckingInventory = async (
        act: () => Promise<void>,
        check: () => Promise<void>
      ) => {
        let release!: () => void
        const reply = new Promise<void>((resolve) => {
          release = resolve
        })
        const read = interceptNetworkCall({
          method: 'GET',
          url: '**/api/v1/wardrobe/garments',
          timeout: 5_000,
          handler: async (route) => {
            await reply
            await route.fulfill({ json: { data: [] } })
          },
        })
        try {
          await act()
          await read
          await check()
        } finally {
          release()
        }
      }

      if (trigger === 'open') {
        inventory[memberA] = []
        await whileCheckingInventory(
          () => opener.click(),
          async () => {
            await page.evaluate(
              () =>
                new Promise<void>((resolve) => {
                  requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
                })
            )
            await expect(page.getByTestId('style-piece-anchor')).toHaveCount(0)
          }
        )
        await expect(card).toHaveCount(0)
        await expect(page.getByTestId('style-piece-anchor')).toHaveCount(0)
        return
      }

      const panel = await openStylePanel(page, garment.id)
      const first = panel.getByTestId('style-piece-look').first()
      await expectPinnedPhoto(first, garment.imageAccess!.url)
      const save = first.getByTestId('style-piece-save')
      const reopen = panel.getByTestId('style-piece-reopen')
      if (trigger === 'reopen') {
        await save.click()
        await expect(reopen).toBeVisible()
      }
      const deviceRecipes = () =>
        page.evaluate(() =>
          Object.keys(localStorage)
            .filter((key) => key.startsWith('couturecast.style-piece.'))
            .map((key) => localStorage.getItem(key))
        )
      const prior = await deviceRecipes()

      if (trigger === 'resume') {
        await page.evaluate(() =>
          window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))
        )
        await expect(panel.getByRole('status')).toHaveText('Checking your photo…')
        await expect(panel.getByTestId('style-piece-anchor')).toHaveCount(0)
      }
      inventory[memberA] = []

      if (trigger === 'resume') {
        await page.evaluate(() =>
          window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
        )
      } else if (trigger === 'periodic') {
        await page.clock.fastForward(5 * 60_000)
      } else {
        await whileCheckingInventory(
          () => (trigger === 'save' ? save : reopen).click(),
          async () => expect(await deviceRecipes()).toEqual(prior)
        )
      }

      await expect(panel.getByTestId('style-piece-unavailable')).toBeVisible()
      await expect(panel.getByTestId('style-piece-anchor')).toHaveCount(0)
      await expect(panel.getByTestId('style-piece-save')).toHaveCount(0)
      await expect(reopen).toHaveCount(0)
      expect(await deviceRecipes()).toEqual(prior)
    })
  }

  test('refreshes a ready garment whose signing response is empty', async ({
    baseURL,
    page,
    interceptNetworkCall,
  }) => {
    const garment = photographedGarment(baseURL!, 'style-piece-no-signature')
    const inventory: Record<string, GarmentItemContract[]> = {
      [memberA]: [{ ...garment, imageAccess: null }],
    }
    await mockStyleWardrobe(page, baseURL!, interceptNetworkCall, inventory)
    await page.goto('/wardrobe')
    const card = page.getByTestId(`garment-card-${garment.id}`)
    const refresh = card.getByTestId('style-piece-refresh')
    await expect(refresh).toHaveAccessibleName(/Refresh/)
    inventory[memberA] = [garment]
    await refresh.click()
    const panel = await openStylePanel(page, garment.id)
    await expectPinnedPhoto(
      panel.getByTestId('style-piece-look').first(),
      garment.imageAccess!.url
    )
  })

  test('recovers an edited draft after a decoded photo fails and the signed URL is renewed', async ({
    baseURL,
    page,
    interceptNetworkCall,
  }) => {
    const garment = photographedGarment(baseURL!, 'style-piece-photo-renewal')
    const photo = garment.imageAccess!.url
    const replacement = {
      ...garment,
      imageAccess: { ...garment.imageAccess!, url: `${photo}?signed=renewed` },
    }
    const inventory = { [memberA]: [garment] }
    await mockStyleWardrobe(page, baseURL!, interceptNetworkCall, inventory)
    await page.goto('/wardrobe')
    const panel = await openStylePanel(page, garment.id)
    const rain = panel.getByTestId('style-piece-weather-warm-rainy')
    await rain.click()
    const edited = panel
      .getByTestId('style-piece-look')
      .filter({ has: page.getByText('Midi skirt', { exact: true }) })
    await edited.getByTestId('style-piece-swap-shoes').click()
    await edited.getByTestId('style-piece-option-sample:g:loafers').click()
    await expect(edited.getByText('Loafers', { exact: true })).toBeVisible()
    await expectPinnedPhoto(edited, photo)

    await edited.getByTestId('style-piece-anchor').evaluate((image: HTMLImageElement) => {
      image.src = 'data:image/png;base64,AA=='
    })
    await expect(panel.getByTestId('style-piece-unavailable')).toBeFocused()
    const refresh = panel.getByTestId('style-piece-refresh')
    await expect(refresh).toHaveAccessibleName(/Refresh/)
    inventory[memberA] = [{ ...garment, imageAccess: null }]
    const nullSignature = interceptNetworkCall({
      method: 'GET',
      url: '**/api/v1/wardrobe/garments',
    })
    await refresh.click()
    expect((await nullSignature).responseJson).toMatchObject({
      data: [{ id: garment.id, imageAccess: null }],
    })
    await expect(edited.getByTestId('style-piece-anchor')).toHaveCount(0)
    await expect(refresh).toBeEnabled()

    inventory[memberA] = [replacement]
    await refresh.click()
    await expect(rain).toHaveAttribute('aria-pressed', 'true')
    await expect(edited.getByText('Loafers', { exact: true })).toBeVisible()
    await expectPinnedPhoto(edited, replacement.imageAccess.url)
  })

  for (const mode of ['available', 'missing', 'rejected'] as const) {
    test(`preserves saved recipes when Web Locks is ${mode}`, async ({
      baseURL,
      page,
      interceptNetworkCall,
      recurse,
    }) => {
      if (mode !== 'available') {
        await page.addInitScript((lockMode) => {
          if (lockMode === 'missing') {
            Object.defineProperty(navigator, 'locks', { value: undefined })
            return
          }
          const manager = navigator.locks
          const request = manager.request.bind(manager)
          Object.defineProperty(manager, 'request', {
            value: new Proxy(request, {
              apply(target, thisArg: unknown, args: unknown[]) {
                const [name] = args
                if (
                  typeof name === 'string' &&
                  name.startsWith('couturecast.style-piece.')
                ) {
                  document.documentElement.dataset.styleTestLockRejected = name
                  return Promise.reject(new Error('Synthetic lock denial'))
                }
                return Reflect.apply(target, thisArg, args) as unknown
              },
            }),
          })
        }, mode)
      }

      const garment = photographedGarment(baseURL!, 'style-piece-lock-test')
      await mockStyleWardrobe(page, baseURL!, interceptNetworkCall, {
        [memberA]: [garment],
      })
      await page.goto('/wardrobe')
      const panel = await openStylePanel(page, garment.id)
      const looks = panel.getByTestId('style-piece-look')
      const saved = panel.getByTestId('style-piece-reopen')
      await looks.nth(0).getByTestId('style-piece-save').click()
      await expect(saved).toHaveCount(1)
      const key = await page.evaluate(() =>
        Object.keys(localStorage).find((name) =>
          name.startsWith('couturecast.style-piece.')
        )
      )
      expect(key).toBeTruthy()

      if (mode === 'available') {
        await page.evaluate(
          (name) =>
            new Promise<void>((held, reject) => {
              void navigator.locks
                .request(
                  name,
                  () =>
                    new Promise<void>((release) => {
                      window.addEventListener('style-test-release', () => release(), {
                        once: true,
                      })
                      held()
                    })
                )
                .catch(reject)
            }),
          key!
        )
      }
      try {
        await looks.nth(1).getByTestId('style-piece-save').click()
        if (mode === 'available') {
          await recurse(
            () =>
              page.evaluate(
                async (name) =>
                  (await navigator.locks.query()).pending?.some(
                    (lock) => lock.name === name
                  ) ?? false,
                key!
              ),
            (pending) => pending,
            { timeout: 5_000 }
          )
          await expect(saved).toHaveCount(1)
        } else if (mode === 'rejected') {
          await expect(page.locator('html')).toHaveAttribute(
            'data-style-test-lock-rejected',
            key!
          )
        }
      } finally {
        if (mode === 'available') {
          await page.evaluate(() => window.dispatchEvent(new Event('style-test-release')))
        }
      }
      await expect(saved).toHaveCount(2)
      await page.reload()
      await openStylePanel(page, garment.id)
      await expect(saved).toHaveCount(2)
    })
  }
})
