// Learning path Step 41: Curated reactions.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-41-curated-reactions
// Learning path Step 42: Screened threaded comments.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-42-screened-threaded-comments
import { selectCommunityClimate } from '../support/helpers/community-ui'
import type { Locator, Page } from '@playwright/test'
import { contrastRatio } from '@couture/utils'
import { log } from '@seontechnologies/playwright-utils/log'
import { checkA11y } from '../support/helpers/accessibility'
import { focusBackdrop, focusRing } from '../support/helpers/painted-contrast'
import {
  completedCommunityFeed,
  communityTest as test,
  expect,
} from '../support/helpers/community-session'

const labels = ['Applaud', 'Love', 'Inspired'] as const
/** A computed `rgb()`/`rgba()` color as the hex `@couture/utils` contrastRatio takes. */
const hex = (rgb: string) =>
  '#' +
  (rgb.match(/\d+/g) ?? [])
    .slice(0, 3)
    .map((part) => Number(part).toString(16).padStart(2, '0'))
    .join('')
const emojis = ['👏', '❤️', '✨'] as const
// Story CC-7.11 D12: post detail is a full-height layer whose header is the top bar with back,
// in place of the X that read "Close this look".
const modalHeaderClose = (page: Page) =>
  page.getByRole('dialog').getByTestId('app-top-bar-back')
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
  test.beforeEach(({ interceptNetworkCall }) => {
    void interceptNetworkCall({
      url: '**/api/v1/events/poll**',
      fulfillResponse: {
        status: 200,
        body: { events: [], nextSince: new Date(0).toISOString() },
      },
    })
  })

  test('[P1] preserves feed order when a highlighted card enters the loaded page', async ({
    page,
    communitySession,
  }) => {
    expect(communitySession.userId).toBeTruthy()
    const firstFeed = completedCommunityFeed(page)
    await page.goto('/community')
    expect((await firstFeed).status).toBe(200)
    await expect(page.getByTestId('community-card-grid')).toHaveAttribute(
      'aria-busy',
      'false'
    )
    const allFeed = completedCommunityFeed(page, 'all')
    await selectCommunityClimate(page, 'all')
    const body = (await allFeed).responseJson as { data: { items: { id: string }[] } }
    // A seeded look past the first card. Looks other workers publish lead this
    // feed too and are deleted when their test ends, so one of those picked
    // here could be gone by the deep link and resolve as an invalid link.
    const target = body.data.items
      .slice(1)
      .find((post) => /^(seed-spotlight|lookbook)-/.test(post.id))!.id
    await page.goto(`/?source=notification&type=community&cardId=${target}`)
    await expect(page.getByTestId(`lookbook-card-${target}`)).toHaveAttribute(
      'data-highlighted',
      'true'
    )
    await expect(page.getByTestId('community-card-grid')).toHaveAttribute(
      'aria-busy',
      'false'
    )
    const refreshed = completedCommunityFeed(page, 'all')
    await selectCommunityClimate(page, 'all')
    const accepted = (await refreshed).responseJson as {
      data: { items: { id: string }[] }
    }
    await expect(page.getByTestId('community-card-grid')).toHaveAttribute(
      'aria-busy',
      'false'
    )
    await expect(
      page.getByTestId('community-card-grid').getByRole('article')
    ).toHaveCount(accepted.data.items.length)
    expect(
      await page
        .getByTestId('community-card-grid')
        .getByRole('article')
        .evaluateAll((cards) => cards.map((card) => card.getAttribute('data-testid')))
    ).toEqual(accepted.data.items.map((post) => `lookbook-card-${post.id}`))
  })

  test('[P1] adds with the keyboard, replaces, persists after reload, and retracts', async ({
    page,
    communitySession,
  }) => {
    expect(communitySession.userId).toBeTruthy()
    await log.step('Load the community feed through the real API')
    const initialFeed = completedCommunityFeed(page)
    await page.goto('/community')
    expect((await initialFeed).status).toBe(200)
    await expect(page.getByTestId('community-card-grid')).toHaveAttribute(
      'aria-busy',
      'false'
    )
    const allFeed = completedCommunityFeed(page, 'all')
    await selectCommunityClimate(page, 'all')
    expect((await allFeed).status).toBe(200)
    await expect(page.getByTestId('community-card-grid')).toHaveAttribute(
      'aria-busy',
      'false'
    )
    const controls = page
      .getByTestId('lookbook-card-lookbook-5')
      .getByTestId('community-reactions-lookbook-5')
    await expect(controls).toBeVisible()
    const applause = controls.getByRole('button', { name: /^Applaud,/ })
    const love = controls.getByRole('button', { name: /^Love,/ })
    const initial = await visibleCounts(controls)
    const added = initial.counts.map((count, index) => count + (index === 0 ? 1 : 0))
    const replaced = initial.counts.map((count, index) => count + (index === 1 ? 1 : 0))
    await log.step('React with the keyboard and confirm the saved state')
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
    await modalHeaderClose(page).click()
    await expect(page.getByRole('dialog')).not.toBeVisible()
    await expect(love).toHaveAttribute('aria-pressed', 'true')
    await expect(applause).toHaveAttribute('aria-pressed', 'false')
    const reloadedFeed = completedCommunityFeed(page)
    await page.reload()
    expect((await reloadedFeed).status).toBe(200)
    await expect(page.getByTestId('community-card-grid')).toHaveAttribute(
      'aria-busy',
      'false'
    )
    const reloadedAllFeed = completedCommunityFeed(page, 'all')
    await selectCommunityClimate(page, 'all')
    expect((await reloadedAllFeed).status).toBe(200)
    await expect(page.getByTestId('community-card-grid')).toHaveAttribute(
      'aria-busy',
      'false'
    )
    await expect(love).toHaveAttribute('aria-pressed', 'true')
    await expectCounts(controls, replaced, initial.total + 1)
    await page.getByTestId('lookbook-open-lookbook-5').click()
    await expectCounts(detailControls, replaced, initial.total + 1)
    await detailControls.getByRole('button', { name: /^Love,/ }).click()
    await expectCounts(detailControls, initial.counts, initial.total)
    await expectCounts(controls, initial.counts, initial.total)
    await modalHeaderClose(page).click()
    await expect(page.getByRole('dialog')).not.toBeVisible()
    await expect(love).toHaveAttribute('aria-pressed', 'false')
    await page.screenshot({
      path: 'playwright/artifacts/community-reactions.png',
      fullPage: true,
    })
  })

  test('[P1] keeps counts after network failure and retries the same intent', async ({
    page,
    communitySession,
    interceptNetworkCall,
  }) => {
    expect(communitySession.userId).toBeTruthy()
    await log.step('Load the community feed through the real API')
    const initialFeed = completedCommunityFeed(page)
    await page.goto('/community')
    expect((await initialFeed).status).toBe(200)
    await expect(page.getByTestId('community-card-grid')).toHaveAttribute(
      'aria-busy',
      'false'
    )
    const allFeed = completedCommunityFeed(page, 'all')
    await selectCommunityClimate(page, 'all')
    expect((await allFeed).status).toBe(200)
    await expect(page.getByTestId('community-card-grid')).toHaveAttribute(
      'aria-busy',
      'false'
    )
    const controls = page.getByTestId('community-reactions-lookbook-5')
    const applause = controls.getByRole('button', { name: /^Applaud,/ })
    await expect(applause).toHaveAttribute('aria-pressed', 'false')
    let failFirst = true
    // The utility's handler supports aborts; following attempts use the real backend.
    const failedMutation = interceptNetworkCall({
      method: 'PUT',
      url: '**/api/v1/community/posts/lookbook-5/reaction',
      handler: async (route) => {
        if (failFirst) {
          failFirst = false
          await route.abort('connectionfailed')
        } else {
          await route.continue()
        }
      },
    })
    await applause.click()
    const { requestJson: firstBody } = await failedMutation
    await expect(controls.getByRole('button', { name: 'Retry reaction' })).toBeVisible()
    await expect(applause).toHaveAttribute('aria-pressed', 'false')
    await log.step('Retry the original reaction intent through the real API')
    const retry = interceptNetworkCall({
      method: 'PUT',
      url: '**/api/v1/community/posts/lookbook-5/reaction',
    })
    await controls.getByRole('button', { name: 'Retry reaction' }).click()
    const retriedMutation = await retry
    expect(retriedMutation.status).toBe(200)
    expect(retriedMutation.requestJson).toEqual(firstBody)
    await expect(applause).toHaveAttribute('aria-pressed', 'true')
    await applause.click()
    await expect(applause).toHaveAttribute('aria-pressed', 'false')
  })
  test('[P1] preserves highlighted focus, announces in detail, and contrasts in every theme', async ({
    page,
    communitySession,
  }) => {
    expect(communitySession.userId).toBeTruthy()
    await log.step('Load the community feed through the real API')
    const initialFeed = completedCommunityFeed(page)
    await page.goto('/?source=notification&type=community&cardId=lookbook-5')
    expect((await initialFeed).status).toBe(200)
    await expect(page.getByTestId('community-card-grid')).toHaveAttribute(
      'aria-busy',
      'false'
    )
    const card = page.getByTestId('lookbook-card-lookbook-5')
    await expect(card).toBeFocused()
    const controls = card.getByTestId('community-reactions-lookbook-5')
    const applause = controls.getByRole('button', { name: /^Applaud,/ })
    await log.step('React with the keyboard and confirm the saved state')
    await applause.focus()
    await page.keyboard.press('Space')
    await expect(applause).toHaveAttribute('aria-pressed', 'true')
    // The save settles before any ring is measured: while it is out the controls are aria-busy
    // and show a pending line, and that line leaving between the probe's bare and focused shots
    // made the first case (default light) compare two different layouts (CI 7c284e60).
    await expect(controls).toHaveAttribute('aria-busy', 'false')
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
        await expect(applause).toBeFocused()
        const label = `${theme} ${colorScheme}`
        const colors = await applause.evaluate((button) => {
          const style = getComputedStyle(button)
          return {
            text: style.color,
            background: style.backgroundColor,
            focus: style.outlineColor,
            focusVisible: button.matches(':focus-visible'),
            inCard: button.closest('[data-surface="card"]') !== null,
          }
        })
        expect(colors.focusVisible, label).toBe(true)
        // Story CC-7.9 D7: the `data-focus-surface` hook is gone; the reaction sits in a card
        // (`data-surface="card"`) and its ring is drawn over whatever that card paints behind it.
        expect(colors.inCard, label).toBe(true)
        const backdrop = await focusBackdrop(applause)
        expect(
          contrastRatio(hex(colors.text), hex(colors.background)),
          label
        ).toBeGreaterThanOrEqual(4.5)
        // Story CC-7.9 D3: the `focusEssential` outline holds 3:1 on the palette card surface.
        expect(
          contrastRatio(hex(colors.focus), hex(backdrop.color)),
          `${label} on ${backdrop.node}`
        ).toBeGreaterThanOrEqual(3)
        // Painted: the pixels focus changes around the button, each at 3:1 against what was there.
        const ring = await focusRing(applause, async () => {
          await applause.focus()
          await expect(applause).toBeFocused()
        })
        // WCAG 2.4.13: the 3:1 change covers at least a 2 CSS px perimeter of the button.
        expect(ring!.qualifying, label).toBeGreaterThanOrEqual(ring!.required!)
      }
    }
    await page.getByTestId('lookbook-open-lookbook-5').click()
    const detail = page.getByTestId('community-detail')
    await detail.getByRole('button', { name: /^Love,/ }).click()
    await expect(page.getByTestId('community-detail-feedback')).toHaveText(
      'Reaction saved.'
    )
    await checkA11y(page)
    await modalHeaderClose(page).click()
    await expect(page.getByRole('dialog')).not.toBeVisible()
    await controls.getByRole('button', { name: /^Love,/ }).click()
    await expect(controls.getByRole('button', { name: /^Love,/ })).toHaveAttribute(
      'aria-pressed',
      'false'
    )
  })

  test('[P2] passes the default community feed accessibility audit', async ({
    page,
    communitySession,
  }) => {
    expect(communitySession.userId).toBeTruthy()
    await log.step('Load the community feed through the real API')
    const initialFeed = completedCommunityFeed(page)
    await page.goto('/community')
    expect((await initialFeed).status).toBe(200)
    await expect(page.getByTestId('community-card-grid')).toHaveAttribute(
      'aria-busy',
      'false'
    )
    await expect(page.getByTestId('community-climate-filter')).toBeVisible()
    await checkA11y(page)
  })
})
