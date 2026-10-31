/**
 * Story 6.9 Web Share over the owned UUID runtime: P-SHARE-BYTES, P-SHARE-DISMISS,
 * P-SHARE-TAP-AGAIN, P-SHARE-CAPABILITY-OFF and P-SHARE-REVALIDATE. The Story 6.8 export
 * cases live in `share-card-export.spec.ts`; both read the runtime through
 * `../support/share-card-owned-runtime`.
 */
import fs from 'node:fs'
import path from 'node:path'
import AxeBuilder from '@axe-core/playwright'
import { test, expect } from '../support/fixtures/share-card-fixtures'
import {
  activateFocused,
  downloadedDigest,
  nextDownload,
  ownPhoto,
  previewBytes,
  sha256,
} from '../support/share-card-owned-runtime'
import {
  SHARE_STUB_KEY,
  expectDialogFits,
  openForShare,
  shareEvents,
  sharedFiles,
} from '../support/share-card-web-share'

const shareCopy = (locale = 'en-US') =>
  (
    JSON.parse(
      fs.readFileSync(path.resolve(`apps/web/src/i18n/locales/${locale}.json`), 'utf8')
    ) as {
      shareCard: Record<
        | 'shared'
        | 'sentToApp'
        | 'shareClosed'
        | 'shareTapAgain'
        | 'previewChanged'
        | 'refresh',
        string
      >
    }
  ).shareCard
// Runs in the page: resolves after two animation frames, so a state update queued by a
// response that already arrived has rendered.
const afterTwoFrames = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  )
test('P-SHARE-BYTES: the shared File is the previewed PNG and one handed_off event is captured', async ({
  context,
  page,
  interceptNetworkCall,
}, info) => {
  const { dialog, preview, share, purposes } = await openForShare(
    context,
    page,
    interceptNetworkCall,
    { canShare: true, outcomes: ['resolve'] }
  )
  await expectDialogFits(page, dialog, info, 'at-rest')
  const digest = await preview.getAttribute('data-sha256')
  expect(sha256(await previewBytes(preview))).toBe(digest)
  await expect(share).toBeEnabled()
  await share.click()
  await expect(dialog.getByRole('status')).toHaveText(shareCopy().sentToApp)
  await expect(share).toBeFocused()
  expect(await page.evaluate(sharedFiles)).toEqual([
    { name: 'couturecast-card.png', type: 'image/png', sha256: digest },
  ])
  expect(purposes).toEqual(['preview', 'share'])
  await expect.poll(() => shareEvents(page)).toHaveLength(1)
  expect(await shareEvents(page)).toEqual([
    {
      client: 'web',
      target: 'unknown',
      outcome: 'handed_off',
      duration_ms: expect.any(Number),
      locale: 'en-US',
    },
  ])
  await expect(dialog.getByText(shareCopy().shared, { exact: true })).toHaveCount(0)
})
test('P-SHARE-DISMISS: a closed share sheet keeps the preview, watermark and Download', async ({
  context,
  page,
  interceptNetworkCall,
}) => {
  const { dialog, preview, share } = await openForShare(
    context,
    page,
    interceptNetworkCall,
    { canShare: true, outcomes: ['AbortError'] }
  )
  const digest = await preview.getAttribute('data-sha256')
  await activateFocused(share)
  await expect(dialog.getByRole('status')).toHaveText(shareCopy().shareClosed)
  await expect(share).toBeFocused()
  await expect(dialog.getByRole('alert')).toHaveCount(0)
  await expect(preview).toHaveAttribute('data-sha256', digest!)
  await expect(preview).toHaveAttribute('data-loaded', 'true')
  await expect(dialog.getByRole('checkbox')).toBeChecked()
  await expect(dialog.getByTestId('share-card-save')).toBeEnabled()
  await expect.poll(() => shareEvents(page)).toHaveLength(1)
  expect(await shareEvents(page)).toEqual([
    {
      client: 'web',
      target: 'none',
      outcome: 'dismissed',
      duration_ms: expect.any(Number),
      locale: 'en-US',
    },
  ])
})
test('P-SHARE-TAP-AGAIN: an expired activation asks for one more tap that shares the same bytes without a new preparation', async ({
  context,
  page,
  interceptNetworkCall,
}) => {
  const { dialog, preview, share, purposes } = await openForShare(
    context,
    page,
    interceptNetworkCall,
    { canShare: true, outcomes: ['NotAllowedError', 'resolve'] }
  )
  const digest = await preview.getAttribute('data-sha256')
  await share.click()
  await expect(dialog.getByRole('status')).toHaveText(shareCopy().shareTapAgain)
  // The polite prompt is visible too; the status region alone is screen-reader only.
  await expect(
    dialog.locator('p[aria-hidden="true"]', { hasText: shareCopy().shareTapAgain })
  ).toBeVisible()
  await expect(dialog.getByRole('alert')).toHaveCount(0)
  await expect(share).toBeFocused()
  expect(
    (
      await new AxeBuilder({ page })
        .include('[aria-labelledby="share-card-title"]')
        .analyze()
    ).violations
  ).toEqual([])
  await share.click()
  await expect(dialog.getByRole('status')).toHaveText(shareCopy().sentToApp)
  const files = await page.evaluate(sharedFiles)
  expect(files.map((file) => file.sha256)).toEqual([digest, digest])
  expect(purposes).toEqual(['preview', 'share'])
  await expect.poll(() => shareEvents(page)).toHaveLength(2)
  expect((await shareEvents(page)).map(({ outcome }) => outcome)).toEqual([
    'failed',
    'handed_off',
  ])
})
test('P-SHARE-CAPABILITY-OFF: no Share control when the capability is absent or canShare is missing, and Download still works', async ({
  context,
  page,
  interceptNetworkCall,
}, info) => {
  // playwright-utils deviation: interceptNetworkCall resolves on the first match, and
  // this route must answer every capability read for the first page.
  let absent = true
  let reads = 0
  await page.route('**/api/v1/share-cards/capabilities', (route) => {
    reads += 1
    return absent
      ? route.fulfill({ status: 404, json: { statusCode: 404, message: 'Not Found' } })
      : route.continue()
  })
  // Observed before the dialog opens, so the absence below is asserted only after the
  // 404 reached the page and the frames that render its answer have run.
  const capabilityAnswer = interceptNetworkCall({
    method: 'GET',
    url: '**/api/v1/share-cards/capabilities',
  })
  const first = await openForShare(context, page, interceptNetworkCall, {
    canShare: true,
    outcomes: [],
  })
  expect((await capabilityAnswer).status).toBe(404)
  await page.evaluate(afterTwoFrames)
  expect(reads).toBe(1)
  await expect(first.dialog.getByTestId('share-card-save')).toBeEnabled()
  await expect(first.share).toHaveCount(0)
  await page.keyboard.press('Escape')
  absent = false
  await page.evaluate(
    ([key, config]) => localStorage.setItem(key, JSON.stringify(config)),
    [SHARE_STUB_KEY, { canShare: 'missing', outcomes: [] }] as const
  )
  const { dialog, preview } = await ownPhoto(page, interceptNetworkCall)
  await expect(dialog.getByTestId('share-card-save')).toBeEnabled()
  await expect(dialog.getByTestId('share-card-share')).toHaveCount(0)
  // Without canShare the dialog never asks for the capability.
  expect(reads).toBe(1)
  const downloaded = nextDownload(page)
  await dialog.getByTestId('share-card-save').click()
  const download = await downloaded
  expect(await downloadedDigest(download, info.outputPath('capability-off.png'))).toBe(
    await preview.getAttribute('data-sha256')
  )
  expect(await page.evaluate(sharedFiles)).toEqual([])
  expect(await shareEvents(page)).toEqual([])
})
test('P-SHARE-REVALIDATE: a share preparation conflict takes the stale path and never hands off', async ({
  context,
  page,
  interceptNetworkCall,
}, info) => {
  let conflict = true
  const { dialog, preview, share, purposes } = await openForShare(
    context,
    page,
    interceptNetworkCall,
    { canShare: true, outcomes: ['resolve'] },
    async (route) => {
      if (!conflict) return route.continue()
      conflict = false
      await route.fulfill({
        status: 409,
        json: { code: 'preview_changed', statusCode: 409, message: 'preview_changed' },
      })
    }
  )
  const digest = await preview.getAttribute('data-sha256')
  // The shortest desktop size: the stale alert and Refresh line overflow the dialog.
  await page.setViewportSize({ width: 1280, height: 720 })
  await activateFocused(share)
  await expect(dialog.getByRole('alert')).toHaveText(shareCopy().previewChanged)
  const recovery = dialog.getByTestId('share-card-recovery')
  await expect(recovery).toHaveText(shareCopy().refresh)
  await expect(recovery).toBeFocused()
  // WCAG 2.4.11: the newly focused Refresh is scrolled fully into the viewport and into
  // the dialog's visible scroll area.
  await expect(recovery).toBeInViewport({ ratio: 1 })
  const surface = dialog.locator(':scope > div')
  await expect
    .poll(async () => {
      const visible = await surface.evaluate((element) => {
        const rect = element.getBoundingClientRect()
        const top = rect.top + element.clientTop
        return { top, bottom: top + element.clientHeight }
      })
      const box = await recovery.boundingBox()
      return box !== null && box.y >= visible.top && box.y + box.height <= visible.bottom
    }, 'Refresh inside the dialog scroll area')
    .toBe(true)
  await page.screenshot({ path: info.outputPath('stale-1280x720.png') })
  await expect(preview).toHaveAttribute('data-sha256', digest!)
  await expect(share).toHaveAttribute('aria-disabled', 'true')
  await expect(dialog.getByTestId('share-card-save')).toHaveAttribute(
    'aria-disabled',
    'true'
  )
  expect(await page.evaluate(sharedFiles)).toEqual([])
  await expect.poll(() => shareEvents(page)).toHaveLength(1)
  expect((await shareEvents(page))[0]).toMatchObject({
    outcome: 'failed',
    target: 'none',
  })
  await activateFocused(recovery)
  await expect(preview).toHaveAttribute('data-loaded', 'true')
  await expect(share).toBeEnabled()
  await share.click()
  await expect(dialog.getByRole('status')).toHaveText(shareCopy().sentToApp)
  expect(purposes).toEqual(['preview', 'share', 'preview', 'share'])
})
