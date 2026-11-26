// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
// Story CC-7.11 test owner (TEA): 7.11-E2E-040..048, overlays close with X (or the layer's back
// arrow), Escape, browser back and a touch swipe down, return focus to the opener, and keep
// history and the parent screen intact. Stacked layers: accessible-modal.stack.test.tsx.
// Native twin: apps/mobile/components/edge-to-edge-modal.test.tsx.
// Test design: _bmad-output/test-artifacts/test-design-7-11-five-tab-navigation-back-pattern.md.
import type { CDPSession, Locator, Page } from '@playwright/test'
import { expect, test } from '../support/fixtures/merged-fixtures'
import {
  openFixtureShell,
  SHELL_TABS,
  waitForShellSettled,
} from '../support/helpers/app-shell'
import { FOLD_VIEWPORT } from '../support/helpers/five-tab'
import type { ShellScreen } from '../support/helpers/shell-fixtures'

test.use({
  authSessionEnabled: false,
  viewport: FOLD_VIEWPORT,
  isMobile: true,
  hasTouch: true,
})

type Overlay = {
  name: string
  screen: ShellScreen
  /** The parent's gate read, which closing must not fetch again. */
  parentRead: string
  opener: (page: Page) => Locator
  /** X for a dialog; the top bar back arrow for a full-height layer (D12). */
  close: (dialog: Locator) => Locator
}

const OVERLAYS: Overlay[] = [
  {
    name: 'garment capture',
    screen: 'closet',
    parentRead: 'garments',
    opener: (page) => page.getByTestId('app-header').getByTestId('garment-capture-open'),
    close: (dialog) => dialog.getByRole('button', { name: 'Close' }),
  },
  {
    name: 'post detail layer',
    screen: 'community',
    parentRead: 'community-feed',
    opener: (page) => page.getByTestId('lookbook-open-shell-look-1'),
    close: (dialog) => dialog.getByTestId('app-top-bar-back'),
  },
  {
    name: 'saved look layer',
    screen: 'looks',
    parentRead: 'saved-looks',
    opener: (page) => page.getByTestId('saved-look-reopen').first(),
    close: (dialog) => dialog.getByTestId('app-top-bar-back'),
  },
]

async function openParent(
  page: Page,
  interceptNetworkCall: Parameters<typeof openFixtureShell>[1],
  screen: ShellScreen
) {
  const shell = await openFixtureShell(page, interceptNetworkCall, {
    mode: 'populated',
    screen,
  })
  await page.goto(SHELL_TABS[screen].path)
  await waitForShellSettled(page, shell.router)
  // A full navigation or remount would drop this marker and the typed state.
  await page.evaluate(() => {
    ;(window as unknown as { __ccSameDocument: boolean }).__ccSameDocument = true
  })
  return shell
}

async function openOverlay(page: Page, overlay: Overlay) {
  const opener = overlay.opener(page)
  await opener.click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  return { opener, dialog }
}

const sameDocument = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __ccSameDocument?: boolean }).__ccSameDocument
  )

/** P3: a real touch drag. Chromium turns CDP touch input into Touch and Pointer Events. */
async function touchDrag(
  cdp: CDPSession,
  from: { x: number; y: number },
  delta: { x: number; y: number }
) {
  const steps = 8
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: from.x, y: from.y }],
  })
  for (let step = 1; step <= steps; step += 1)
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        { x: from.x + (delta.x * step) / steps, y: from.y + (delta.y * step) / steps },
      ],
    })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}

async function handleCenter(dialog: Locator) {
  const box = await dialog.getByTestId('layer-swipe-handle').boundingBox()
  expect(box, 'swipe handle').not.toBeNull()
  return { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 }
}

test.describe('CC-7.11 overlays close and return focus @local-lane', () => {
  for (const overlay of OVERLAYS) {
    test(`[P0] [7.11-E2E-040/041] ${overlay.name}: X or back arrow closes, Escape closes, focus back on the opener`, async ({
      page,
      interceptNetworkCall,
    }) => {
      await openParent(page, interceptNetworkCall, overlay.screen)

      const first = await openOverlay(page, overlay)
      await overlay.close(first.dialog).click()
      await expect(first.dialog).toHaveCount(0)
      await expect(first.opener).toBeFocused()

      const second = await openOverlay(page, overlay)
      await page.keyboard.press('Escape')
      await expect(second.dialog).toHaveCount(0)
      await expect(second.opener).toBeFocused()
    })

    test(`[P0] [7.11-E2E-042] ${overlay.name}: browser back closes it, URL unchanged, no reload, no refetch`, async ({
      page,
      interceptNetworkCall,
    }) => {
      const { router } = await openParent(page, interceptNetworkCall, overlay.screen)
      const url = page.url()
      const { opener, dialog } = await openOverlay(page, overlay)
      expect(page.url(), 'opening adds no new URL').toBe(url)
      const reads = router.calls(overlay.parentRead)

      await page.goBack()
      await expect(dialog).toHaveCount(0)
      expect(page.url()).toBe(url)
      await expect(opener).toBeFocused()
      expect(await sameDocument(page), 'same document').toBe(true)
      expect(
        router.calls(overlay.parentRead),
        `${overlay.parentRead} not read again`
      ).toBe(reads)
    })

    test(`[P1] [7.11-E2E-043] ${overlay.name}: closing consumes its history entry`, async ({
      page,
      interceptNetworkCall,
    }) => {
      // Arrive from Today through the tab bar, so one browser back after closing leaves the tab.
      const { router, setScreen } = await openFixtureShell(page, interceptNetworkCall, {
        mode: 'populated',
        screen: 'home',
      })
      await page.goto(SHELL_TABS.home.path)
      await waitForShellSettled(page, router)
      setScreen(overlay.screen)
      await page.getByTestId(SHELL_TABS[overlay.screen].nav).click()
      await waitForShellSettled(page, router)
      const url = page.url()

      const { dialog } = await openOverlay(page, overlay)
      await overlay.close(dialog).click()
      await expect(dialog).toHaveCount(0)
      expect(page.url()).toBe(url)

      // history.length still counts the consumed entry as a forward entry, so the proof is
      // where one back lands. Were the layer's entry left behind, this back would land on the same URL.
      setScreen('home')
      await page.goBack()
      await expect(page).toHaveURL(/\/$/)
      await expect(page.getByTestId('bottom-nav-home')).toHaveAttribute(
        'aria-current',
        'page'
      )
    })
  }
})

test.describe('CC-7.11 swipe down closes a layer @local-lane', () => {
  // CDP touch input is Chromium's; the suite's projects are Chromium.
  test.skip(({ browserName }) => browserName !== 'chromium', 'CDP touch input')

  for (const overlay of OVERLAYS) {
    test(`[P0] [7.11-E2E-046] ${overlay.name}: touch drag down 100 px on the header closes it, focus on the opener`, async ({
      page,
      interceptNetworkCall,
    }) => {
      await openParent(page, interceptNetworkCall, overlay.screen)
      const cdp = await page.context().newCDPSession(page)
      const { opener, dialog } = await openOverlay(page, overlay)

      await touchDrag(cdp, await handleCenter(dialog), { x: 0, y: 100 })
      await expect(dialog).toHaveCount(0)
      await expect(opener).toBeFocused()
    })
  }

  test('[P1] [Codex 7.11 #6] a drag down that starts in the layer body at its top closes it, focus on the opener', async ({
    page,
    interceptNetworkCall,
  }) => {
    const overlay = OVERLAYS[1]!
    await openParent(page, interceptNetworkCall, overlay.screen)
    const cdp = await page.context().newCDPSession(page)
    const { opener, dialog } = await openOverlay(page, overlay)
    const body = dialog.getByTestId('layer-body')
    expect(await body.evaluate((node) => node.scrollTop)).toBe(0)

    const box = (await body.boundingBox())!
    await touchDrag(cdp, { x: box.x + box.width / 2, y: box.y + 40 }, { x: 0, y: 120 })
    await expect(dialog).toHaveCount(0)
    await expect(opener).toBeFocused()
  })

  test('[P1] [7.11-E2E-047] short, sideways and upward drags do not close', async ({
    page,
    interceptNetworkCall,
  }) => {
    const overlay = OVERLAYS[1]!
    await openParent(page, interceptNetworkCall, overlay.screen)
    const cdp = await page.context().newCDPSession(page)
    const { dialog } = await openOverlay(page, overlay)

    for (const delta of [
      { x: 0, y: 60 },
      { x: 120, y: 30 },
      { x: 0, y: -100 },
    ]) {
      await touchDrag(cdp, await handleCenter(dialog), delta)
      await expect(dialog, `drag ${JSON.stringify(delta)} keeps it open`).toBeVisible()
    }
  })

  test('[P1] [7.11-E2E-048] a mouse drag never closes; a drag inside a scrolled body scrolls', async ({
    page,
    interceptNetworkCall,
  }) => {
    const overlay = OVERLAYS[1]!
    await openParent(page, interceptNetworkCall, overlay.screen)
    const cdp = await page.context().newCDPSession(page)
    const { dialog } = await openOverlay(page, overlay)

    const handle = await handleCenter(dialog)
    await page.mouse.move(handle.x, handle.y)
    await page.mouse.down()
    await page.mouse.move(handle.x, handle.y + 150, { steps: 10 })
    await page.mouse.up()
    await expect(dialog, 'mouse drag keeps it open').toBeVisible()

    // Make the layer's body scroll (a spacer keeps this independent of fixture length), scroll
    // it down, then drag down inside it: the body scrolls, the layer stays.
    const body = dialog.getByTestId('layer-body')
    await body.evaluate((node) => {
      const spacer = document.createElement('div')
      spacer.style.height = '2000px'
      node.appendChild(spacer)
      node.scrollTo(0, 400)
    })
    await expect.poll(() => body.evaluate((node) => node.scrollTop)).toBeGreaterThan(0)
    const box = (await body.boundingBox())!
    await touchDrag(
      cdp,
      { x: box.x + box.width / 2, y: box.y + box.height / 2 },
      { x: 0, y: 120 }
    )
    await expect(dialog, 'drag inside a scrolled body keeps it open').toBeVisible()
  })
})
