import type { Locator } from '@playwright/test'
import { contrastRatio } from '@couture/utils'
import { checkA11y } from '../support/helpers/accessibility'
import { communityTest as test, expect } from '../support/helpers/community-session'

const labels = ['Applaud', 'Love', 'Inspired'] as const
const emojis = ['👏', '❤️', '✨'] as const
async function visibleCounts(controls: Locator) {
  const counts = await Promise.all(
    labels.map(async (label) => {
      const text = await controls
        .getByRole('button', { name: new RegExp(`^${label},`) })
        .locator('span')
        .innerText()
      return Number(text.match(/\d+/)![0])
    })
  )
  const total = Number((await controls.locator('p').first().innerText()).match(/\d+/)![0])
  return { counts, total }
}
async function expectCounts(controls: Locator, counts: number[], total: number) {
  for (const [index, label] of labels.entries()) {
    const button = controls.getByRole('button', {
      name: `${label}, ${counts[index]}`,
      includeHidden: true,
    })
    await expect(button.locator('span')).toHaveText(`${emojis[index]} ${counts[index]}`)
  }
  await expect(controls.locator('p').first()).toHaveText(
    new RegExp(`^${total} reactions?$`)
  )
}

test.describe('Story 6.3 curated reactions', () => {
  // Count snapshots share one seeded post across these journeys.
  test.describe.configure({ mode: 'serial' })
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/events/poll**', async (route) =>
      route.fulfill({ json: { events: [], nextSince: new Date(0).toISOString() } })
    )
  })

  test('adds with the keyboard, replaces, persists after reload, and retracts', async ({
    page,
    communitySession,
  }) => {
    expect(communitySession.userId).toBeTruthy()
    await page.goto('/')
    await page.getByTestId('community-filter-all').click()
    const controls = page
      .getByTestId('lookbook-card-lookbook-5')
      .getByTestId('community-reactions-lookbook-5')
    await expect(controls).toBeVisible()
    const applause = controls.getByRole('button', { name: /^Applaud,/ })
    const love = controls.getByRole('button', { name: /^Love,/ })
    const initial = await visibleCounts(controls)
    const added = initial.counts.map((count, index) => count + (index === 0 ? 1 : 0))
    const replaced = initial.counts.map((count, index) => count + (index === 1 ? 1 : 0))
    await applause.focus()
    await page.keyboard.press('Space')
    await expect(applause).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('community-live-region')).toHaveText('Reaction saved.')
    await expectCounts(controls, added, initial.total + 1)
    await page.getByTestId('lookbook-open-lookbook-5').click()
    const detail = page.getByTestId('community-detail')
    const detailControls = detail.getByTestId('community-reactions-lookbook-5')
    await expectCounts(detailControls, added, initial.total + 1)
    await detailControls.getByRole('button', { name: /^Love,/ }).click()
    await expectCounts(detailControls, replaced, initial.total + 1)
    await expectCounts(controls, replaced, initial.total + 1)
    await page.getByRole('button', { name: 'Close this look' }).click()
    await expect(love).toHaveAttribute('aria-pressed', 'true')
    await expect(applause).toHaveAttribute('aria-pressed', 'false')
    await page.reload()
    await page.getByTestId('community-filter-all').click()
    await expect(love).toHaveAttribute('aria-pressed', 'true')
    await expectCounts(controls, replaced, initial.total + 1)
    await page.getByTestId('lookbook-open-lookbook-5').click()
    await expectCounts(detailControls, replaced, initial.total + 1)
    await detailControls.getByRole('button', { name: /^Love,/ }).click()
    await expectCounts(detailControls, initial.counts, initial.total)
    await expectCounts(controls, initial.counts, initial.total)
    await page.getByRole('button', { name: 'Close this look' }).click()
    await expect(love).toHaveAttribute('aria-pressed', 'false')
    await checkA11y(page)
    // The ritual should fit its content while the independently scrolling feed grows.
    const ritual = await page
      .getByRole('region', { name: 'Hero Ritual Canvas' })
      .boundingBox()
    const community = await page
      .getByRole('region', { name: 'Community section' })
      .boundingBox()
    expect(ritual?.height).toBeLessThan((community?.height ?? 0) - 100)
    await page.screenshot({
      path: 'playwright/artifacts/community-reactions.png',
      fullPage: true,
    })
  })

  test('keeps counts after network failure and retries the same intent', async ({
    page,
    communitySession,
  }) => {
    expect(communitySession.userId).toBeTruthy()
    await page.goto('/')
    await page.getByTestId('community-filter-all').click()
    const controls = page.getByTestId('community-reactions-lookbook-5')
    const applause = controls.getByRole('button', { name: /^Applaud,/ })
    await expect(applause).toHaveAttribute('aria-pressed', 'false')
    let firstBody: unknown
    await page.route(
      '**/api/v1/community/posts/lookbook-5/reaction',
      async (route) => {
        firstBody = route.request().postDataJSON() as unknown
        await route.abort('connectionfailed')
        await page.unroute('**/api/v1/community/posts/lookbook-5/reaction')
      },
      { times: 1 }
    )
    await applause.click()
    await expect(controls.getByRole('button', { name: 'Retry reaction' })).toBeVisible()
    await expect(applause).toHaveAttribute('aria-pressed', 'false')
    const retry = page.waitForRequest(
      (request) =>
        request.method() === 'PUT' && request.url().endsWith('/lookbook-5/reaction')
    )
    await controls.getByRole('button', { name: 'Retry reaction' }).click()
    expect((await retry).postDataJSON()).toEqual(firstBody)
    await expect(applause).toHaveAttribute('aria-pressed', 'true')
    await applause.click()
    await expect(applause).toHaveAttribute('aria-pressed', 'false')
  })
  test('preserves highlighted focus, announces in detail, and contrasts in every theme', async ({
    page,
    communitySession,
  }) => {
    expect(communitySession.userId).toBeTruthy()
    await page.goto('/?source=notification&type=community&cardId=lookbook-5')
    const card = page.getByTestId('lookbook-card-lookbook-5')
    await expect(card).toBeFocused()
    const controls = card.getByTestId('community-reactions-lookbook-5')
    const applause = controls.getByRole('button', { name: /^Applaud,/ })
    await applause.focus()
    await page.keyboard.press('Space')
    await expect(applause).toHaveAttribute('aria-pressed', 'true')
    await expect(applause).toBeFocused()
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme })
      for (const theme of [
        'default',
        'jewel_radiance',
        'autumn_umber',
        'winter_metallic',
      ]) {
        await page.locator('html').evaluate((element, value) => {
          element.setAttribute('data-theme', value)
        }, theme)
        await applause.focus()
        const colors = await applause.evaluate((button) => {
          const style = getComputedStyle(button)
          const surface = getComputedStyle(button.closest('[data-focus-surface]')!)
          const hex = (rgb: string) =>
            '#' +
            (rgb.match(/\d+/g) ?? [])
              .slice(0, 3)
              .map((part) => Number(part).toString(16).padStart(2, '0'))
              .join('')
          return {
            text: hex(style.color),
            background: hex(style.backgroundColor),
            focus: hex(style.outlineColor),
            surface: hex(surface.backgroundColor),
          }
        })
        expect(contrastRatio(colors.text, colors.background)).toBeGreaterThanOrEqual(4.5)
        expect(contrastRatio(colors.focus, colors.surface)).toBeGreaterThanOrEqual(3)
      }
    }
    await page.getByTestId('lookbook-open-lookbook-5').click()
    const detail = page.getByTestId('community-detail')
    await detail.getByRole('button', { name: /^Love,/ }).click()
    await expect(page.getByTestId('community-detail-feedback')).toHaveText(
      'Reaction saved.'
    )
    await checkA11y(page)
    await page.getByRole('button', { name: 'Close this look' }).click()
    await controls.getByRole('button', { name: /^Love,/ }).click()
    await expect(controls.getByRole('button', { name: /^Love,/ })).toHaveAttribute(
      'aria-pressed',
      'false'
    )
  })
})
