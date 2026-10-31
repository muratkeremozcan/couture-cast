/**
 * Story 6.9 Web Share test doubles for the share-card Playwright specs. Headless engines
 * expose no share sheet, so `shareStub` (an init script) stubs navigator.canShare and
 * navigator.share and records each shared File; `openForShare` opens the own photo's
 * dialog with it installed. `expectDialogFits` measures the dialog with Share beside
 * Download, which the Story 6.8 locale layout case also uses.
 */
import type { BrowserContext, Locator, Page, Route, TestInfo } from '@playwright/test'
import type { InterceptNetworkCallFn } from '@seontechnologies/playwright-utils/intercept-network-call'
import { prepareShareCardInputSchema } from '@couture/api-client/contracts/http'
import { expect } from './fixtures/share-card-fixtures'
import { identify, ownPhoto } from './share-card-owned-runtime'

// The stub reads its configuration from localStorage so a later navigation can change it.
export type ShareStubConfig = {
  canShare: boolean | 'missing'
  outcomes: ('resolve' | 'AbortError' | 'NotAllowedError')[]
}
export type ShareStubWindow = Window &
  typeof globalThis & {
    __shareCardShareFiles?: File[]
    __enableAnalyticsTestHook?: boolean
    __capturedAnalyticsEvents?: { event: string; properties: Record<string, unknown> }[]
  }
export const SHARE_STUB_KEY = 'cc69-share-stub'
export function shareStub(fallback: ShareStubConfig) {
  const target = window as ShareStubWindow
  target.__enableAnalyticsTestHook = true
  const stored = localStorage.getItem('cc69-share-stub')
  const config = stored ? (JSON.parse(stored) as ShareStubConfig) : fallback
  const files: File[] = []
  target.__shareCardShareFiles = files
  Object.defineProperty(navigator, 'canShare', {
    configurable: true,
    value: config.canShare === 'missing' ? undefined : () => config.canShare,
  })
  Object.defineProperty(navigator, 'share', {
    configurable: true,
    value: (data: { files?: File[] }) => {
      files.push(...(data.files ?? []))
      const outcome = config.outcomes.shift() ?? 'resolve'
      return outcome === 'resolve'
        ? Promise.resolve()
        : Promise.reject(new DOMException(outcome, outcome))
    },
  })
}
// Runs in the page: each File the stub received, with its digest.
export function sharedFiles() {
  const files = (window as ShareStubWindow).__shareCardShareFiles ?? []
  return Promise.all(
    files.map(async (file) => ({
      name: file.name,
      type: file.type,
      sha256: Array.from(
        new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())),
        (byte) => byte.toString(16).padStart(2, '0')
      ).join(''),
    }))
  )
}
export const shareEvents = (page: Page) =>
  page.evaluate(() =>
    ((window as ShareStubWindow).__capturedAnalyticsEvents ?? [])
      .filter(({ event }) => event === 'share_card_shared')
      .map(({ properties }) => properties)
  )
// Opens the own photo's dialog with the share stub installed and records each share
// preparation's purpose.
export async function openForShare(
  context: BrowserContext,
  page: Page,
  interceptNetworkCall: InterceptNetworkCallFn,
  config: ShareStubConfig,
  answerShare?: (route: Route) => Promise<void>
) {
  await identify(context)
  await context.addInitScript(shareStub, config)
  const purposes: string[] = []
  const prepareRoute = interceptNetworkCall({
    url: '**/api/v1/share-cards/prepare',
    handler: async (route, request) => {
      const input = prepareShareCardInputSchema.parse(request.postDataJSON())
      purposes.push(input.purpose)
      if (input.purpose === 'share' && answerShare) await answerShare(route)
      else await route.continue()
    },
  })
  const opened = await ownPhoto(page, interceptNetworkCall)
  await prepareRoute
  return { ...opened, purposes, share: opened.dialog.getByTestId('share-card-share') }
}
// The photo dialog (its tallest content, with the privacy help) fits short desktop
// viewports at rest with a loaded preview and in the stale state (the stale alert above
// Refresh, Download and Share disabled): no scroll container in the dialog overflows or
// scrolls on a wheel, the page never scrolls, and the surface, Cancel and Refresh stay
// inside the viewport. At rest Download, Share and Cancel share one row.
export async function expectDialogFits(
  page: Page,
  dialog: Locator,
  info: TestInfo,
  state: 'at-rest' | 'stale'
) {
  const surface = dialog.locator(':scope > div')
  const recovery = dialog.getByTestId('share-card-recovery')
  const box = async (target: Locator) => {
    const found = await target.boundingBox()
    expect(found).not.toBeNull()
    return found!
  }
  for (const [width, height] of [
    [1366, 768],
    [1280, 720],
  ] as const) {
    const size = `${state} ${width}x${height}`
    await page.setViewportSize({ width, height })
    if (state === 'at-rest') {
      await expect(dialog.getByTestId('share-card-preview')).toHaveAttribute(
        'data-loaded',
        'true'
      )
      await expect(dialog.getByTestId('share-card-feedback')).toBeEmpty()
      await expect(recovery).toHaveCount(0)
    } else {
      await expect(dialog.getByRole('alert')).toBeVisible()
      await expect(recovery).toBeVisible()
      await expect(dialog.getByTestId('share-card-save')).toHaveAttribute(
        'aria-disabled',
        'true'
      )
    }
    const pageY = await page.evaluate(() => window.scrollY)
    await surface.hover()
    await page.mouse.wheel(0, 600)
    const scroll = await dialog.evaluate(
      (element) =>
        new Promise<{ scrollers: number; overflow: number; top: number; pageY: number }>(
          (resolve) =>
            requestAnimationFrame(() =>
              requestAnimationFrame(() => {
                const scrollers = [
                  element,
                  ...Array.from(element.querySelectorAll('*')),
                ].filter((node) => /auto|scroll/.test(getComputedStyle(node).overflowY))
                resolve({
                  scrollers: scrollers.length,
                  overflow: Math.max(
                    ...scrollers.map((node) => node.scrollHeight - node.clientHeight)
                  ),
                  top: Math.max(...scrollers.map((node) => node.scrollTop)),
                  pageY: window.scrollY,
                })
              })
            )
        )
    )
    expect(scroll.scrollers, `${size} dialog scroll containers`).toBeGreaterThan(0)
    expect(scroll.overflow, `${size} dialog overflow`).toBeLessThanOrEqual(0)
    expect(scroll.top, `${size} dialog scrollTop after wheel`).toBe(0)
    expect(scroll.pageY, `${size} page scrollY after wheel`).toBe(pageY)
    const outline = await box(surface)
    const save = await box(dialog.getByTestId('share-card-save'))
    const share = await box(dialog.getByTestId('share-card-share'))
    const cancel = await box(dialog.getByTestId('share-card-cancel'))
    expect(outline.y).toBeGreaterThanOrEqual(0)
    expect(outline.y + outline.height).toBeLessThanOrEqual(height)
    expect(cancel.y + cancel.height).toBeLessThanOrEqual(height)
    if (state === 'at-rest') {
      expect(share.y, `${size} Share on Download's row`).toBeCloseTo(save.y, 0)
      expect(cancel.y, `${size} Cancel on Download's row`).toBeCloseTo(save.y, 0)
      expect(save.x).toBeLessThan(share.x)
      expect(share.x).toBeLessThan(cancel.x)
    } else {
      const refresh = await box(recovery)
      expect(refresh.y + refresh.height).toBeLessThanOrEqual(height)
    }
    await page.screenshot({ path: info.outputPath(`${state}-${width}x${height}.png`) })
  }
}
