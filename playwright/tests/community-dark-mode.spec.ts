// Learning path Step 58: Production status and nightly health, production follow-ups.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#production-follow-ups-after-the-project-close
// Story CC-7.12 (Step 69): the locked planner's Get Premium became the Plan segment's free
// preview with one Upgrade, so 3.6-E2E-016 measures that Upgrade and the preview's text.
//
// Production feedback 2026-11-19: the lookbook on /community stayed white under a dark system
// setting while Wardrobe and Moderation follow it, the "Community inspirations" label repeated
// the "Latest looks" heading, and the notifications link floated alone between the chips and the
// feed. The lookbook now reads surface tokens with dark values for the Default system, and the
// feed's actions (New post and a bell for members, Sign in for guests) sit in the heading row.
import { type Locator, type Page } from '@playwright/test'
import { hexToChannels, premiumPalettes } from '@couture/utils'
import enUS from '../../apps/web/src/i18n/locales/en-US.json'
import es419 from '../../apps/web/src/i18n/locales/es-419.json'
import frFR from '../../apps/web/src/i18n/locales/fr-FR.json'
import { checkA11y, contrastRatio } from '../support/helpers/accessibility'
import { rgbOf, roleRgb } from '../support/helpers/app-shell'
import {
  focusBackdrop,
  focusRing,
  inkCoverage,
  inkOfText,
  paletteCardColors,
  paletteCardSurface,
  placeholderContrastFailures,
  resolved,
  textContrastFailures,
  surfacePixel,
} from '../support/helpers/painted-contrast'
import { resolveApiBaseUrl } from '../support/helpers/api-test'
import {
  COMMUNITY_FEED_PATH,
  communityTest as test,
  completedCommunityFeed,
  expect,
  expectCommunityFeedLoaded,
  loadCommunityFixture,
  publishCommunityLook,
  waitForTerminalAuthorState,
} from '../support/helpers/community-session'

// Story CC-7.9 D2 and D7: the one page surface is the `page` role, read from the token source.
const DARK_SURFACE = roleRgb('dark', 'page')
const LIGHT_SURFACE = roleRgb('light', 'page')

const heading = (page: Page) =>
  page
    .getByTestId('app-header')
    .getByRole('heading', { name: enUS.nav.community, exact: true })

/**
 * The page surface Community sits on and the color its heading is drawn in. Story CC-7.9 D7: the
 * inset lookbook card (`.lookbook-body`) is gone and `main` paints nothing, so the surface is the
 * one `data-surface="page"` around it. A missing surface or heading is refused, never read as ''.
 */
async function surfaceAndInk(page: Page) {
  const read = await page.getByTestId('community-page').evaluate((section) => {
    const surface = section.closest('[data-surface="page"]')
    const title = document.querySelector('[data-testid="app-header"] h1')
    if (!surface || !title)
      return { missing: !surface ? 'page surface' : 'Community title' }
    return {
      surface: getComputedStyle(surface).backgroundColor,
      ink: getComputedStyle(title).color,
      scheme: window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light',
    }
  })
  if ('missing' in read) throw new Error(`Community has no ${read.missing}`)
  return read
}

/**
 * An action sits in the heading row: its vertical middle falls inside the heading's box and it
 * starts right of the heading. Both boxes are read in one frame and polled, because a notice
 * arriving above the nav moves the whole row between two separate reads.
 */
async function expectInHeadingRow(page: Page, action: Locator) {
  const title = heading(page)
  await expect
    .poll(async () => {
      const handle = await action.elementHandle()
      return title.evaluate((h, el) => {
        if (!el) return 'action missing'
        const t = h.getBoundingClientRect()
        const a = el.getBoundingClientRect()
        const middle = a.top + a.height / 2
        if (middle < t.top || middle > t.bottom)
          return `middle ${middle} outside ${t.top}..${t.bottom}`
        if (a.left <= t.right) return `starts at ${a.left}, heading ends at ${t.right}`
        return 'in row'
      }, handle)
    })
    .toBe('in row')
}

test.describe('Community lookbook under the system color scheme (production follow-up)', () => {
  test.beforeEach(({ interceptNetworkCall }) => {
    void interceptNetworkCall({
      url: '**/api/v1/events/poll**',
      fulfillResponse: {
        status: 200,
        body: { events: [], nextSince: new Date(0).toISOString() },
      },
    })
  })

  test('3.6-E2E-009: a signed-out reader under a dark system setting gets a dark lookbook with a readable Sign in link', async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/community')
    await expect(heading(page)).toBeVisible()

    const { surface, ink, scheme } = await surfaceAndInk(page)
    expect(scheme).toBe('dark')
    expect(surface).toBe(DARK_SURFACE)
    expect(contrastRatio(ink, surface)).toBeGreaterThanOrEqual(4.5)

    const signIn = page.getByTestId('community-page').getByRole('link', {
      name: enUS.community.notifications.signin,
      exact: true,
    })
    await expect(signIn).toBeVisible()
    await expect(signIn).toHaveAttribute('href', '/signin')
    await expect(page.getByTestId('create-post-button')).toHaveCount(0)
    // The label that repeated the heading is gone from the page.
    await expect(page.getByText('Community inspirations')).toHaveCount(0)

    await checkA11y(page)
  })

  test('3.6-E2E-010: a member under a dark system setting gets Post in the heading row and a named notifications link', async ({
    page,
    communitySession,
  }) => {
    expect(communitySession.userId).toBeTruthy()
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.setViewportSize({ width: 1280, height: 900 })
    const feed = completedCommunityFeed(page)
    await page.goto('/community')
    expect((await feed).status).toBe(200)
    await expectCommunityFeedLoaded(page)

    const { surface, ink } = await surfaceAndInk(page)
    expect(surface).toBe(DARK_SURFACE)
    expect(contrastRatio(ink, surface)).toBeGreaterThanOrEqual(4.5)

    const bell = page.getByTestId('community-page').getByRole('link', {
      name: enUS.community.notifications.title,
      exact: true,
    })
    await expect(bell).toBeVisible()
    await expect(bell).toHaveAttribute('href', '/notification-settings')
    // The bell is an icon: its glyph is the only thing that tells a sighted member what it is, so
    // it meets the 3:1 non-text contrast on the surface it sits on.
    const glyph = await bell.evaluate((link) => getComputedStyle(link).color)
    expect(contrastRatio(glyph, surface)).toBeGreaterThanOrEqual(3)

    const newPost = page.getByTestId('app-header').getByRole('button', {
      name: enUS.community.calm.post,
      exact: true,
    })
    await expect(newPost).toBeVisible()
    await expectInHeadingRow(page, newPost)
    // One of each: the actions are not rendered a second time outside the heading row.
    await expect(
      page.getByRole('link', { name: enUS.community.notifications.title })
    ).toHaveCount(1)
    await expect(page.getByTestId('create-post-button')).toHaveCount(1)
    await expect(page.getByText('Community inspirations')).toHaveCount(0)

    await checkA11y(page)
  })

  test('3.6-E2E-011: a light system setting keeps the light lookbook, and a premium palette turns to its dark variant under a dark one', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.emulateMedia({ colorScheme: 'light' })
    await page.goto('/community')
    await expect(heading(page)).toBeVisible()
    const light = await surfaceAndInk(page)
    expect(light.scheme).toBe('light')
    expect(light.surface).toBe(LIGHT_SURFACE)
    expect(contrastRatio(light.ink, light.surface)).toBeGreaterThanOrEqual(4.5)
    await checkA11y(page)

    // Story CC-7.9 D5: a premium palette follows the system setting too. Under a dark one the
    // page stays the dark `page` role (D7) and each palette's card turns to its dark variant, its
    // own card text readable on it; the light variant would be a light card on a dark page.
    await page.emulateMedia({ colorScheme: 'dark' })
    expect((await surfaceAndInk(page)).surface).toBe(DARK_SURFACE)
    for (const palette of PREMIUM_PALETTES) {
      await setPalette(page, palette)
      expect((await surfaceAndInk(page)).surface, palette).toBe(DARK_SURFACE)
      const card = await paletteCardColors(page)
      expect(card.surface, palette).toBe(
        rgbOf(hexToChannels(premiumPalettes[palette].dark.cardBg))
      )
      expect(card.surface, palette).not.toBe(
        rgbOf(hexToChannels(premiumPalettes[palette].light.cardBg))
      )
      expect(contrastRatio(card.ink, card.surface), palette).toBeGreaterThanOrEqual(4.5)
      // Painted, not only declared: a run of the palette's card text on its card surface.
      expect(await textContrastFailures(await paletteProbe(page)), palette).toEqual([])
    }
  })
})

/* Codex review 31 regression checks; colors are measured as painted (support/helpers/painted-contrast.ts). */
const PREMIUM_PALETTES = ['jewel_radiance', 'autumn_umber', 'winter_metallic'] as const

const setPalette = (page: Page, palette: string | null) =>
  page.evaluate((value) => {
    if (value) document.documentElement.setAttribute('data-theme', value)
    else document.documentElement.removeAttribute('data-theme')
  }, palette)

/**
 * A card-sized run of text painted only from the palette tokens (`--cc-theme-card-bg` under
 * `--cc-theme-card-text`), at the top of Community's main column, so the palette pairing is
 * measured as painted on a reader who has no card on screen (Story CC-7.9 D5).
 */
async function paletteProbe(page: Page) {
  await page.getByTestId('community-page').evaluate((main) => {
    if (main.querySelector('[data-testid="tea-palette-probe"]')) return
    const probe = document.createElement('div')
    probe.dataset.testid = 'tea-palette-probe'
    probe.setAttribute(
      'style',
      'padding:16px;font-size:14px;background:rgb(var(--cc-theme-card-bg));color:rgb(var(--cc-theme-card-text))'
    )
    probe.textContent = 'Synthetic palette card text'
    main.prepend(probe)
  })
  return page.getByTestId('tea-palette-probe')
}

const MERLOT_LIGHT = 'rgb(122, 31, 45)'
const MERLOT_DARK = 'rgb(240, 163, 174)'

function authorStateRow(id: string, status: string, moderationReason: string | null) {
  return {
    id,
    caption: `Synthetic ${status} look`,
    altText: null,
    climateBand: null,
    imageAccess: null,
    createdAt: new Date().toISOString(),
    publishedAt: null,
    status,
    challengeId: null,
    moderationReason,
  }
}

test.describe('Community lookbook contrast and fit (Codex review 31)', () => {
  test.beforeEach(({ interceptNetworkCall }) => {
    void interceptNetworkCall({
      url: '**/api/v1/events/poll**',
      fulfillResponse: {
        status: 200,
        body: { events: [], nextSince: new Date(0).toISOString() },
      },
    })
  })

  // The monitor is off: the 503 is the state under test.
  test(
    '3.6-E2E-012: a failed feed read and a flagged post stay readable, and Merlot marks only the flagged state, in both schemes',
    { annotation: [{ type: 'skipNetworkMonitoring' }] },
    async ({ page, communitySession }) => {
      expect(communitySession.userId).toBeTruthy()
      await page.emulateMedia({ colorScheme: 'dark' })
      await page.setViewportSize({ width: 1280, height: 900 })

      // The member's own looks, one flagged and one withdrawn, ride on the real feed answer.
      // Every feed read fails until the banner is measured, so no later read clears it first.
      let failing = true
      await page.route(`**${COMMUNITY_FEED_PATH}*`, async (route) => {
        if (failing) {
          await route.fulfill({ status: 503, json: { message: 'upstream unavailable' } })
          return
        }
        const response = await route.fetch()
        const body = (await response.json()) as { data?: { authorStates?: unknown[] } }
        const target = body.data ?? (body as { authorStates?: unknown[] })
        target.authorStates = [
          authorStateRow(
            'tea-flagged-look',
            'flagged',
            'Nudity detected by automated screening.'
          ),
          authorStateRow('tea-withdrawn-look', 'withdrawn', null),
          ...(target.authorStates ?? []),
        ]
        await route.fulfill({ response, json: body })
      })
      await page.goto('/community')

      const failure = page.getByTestId('community-feed-error')
      await expect(failure).toBeVisible()
      expect(await textContrastFailures(failure)).toEqual([])
      expect((await resolved(failure)).color).toBe(MERLOT_DARK)
      failing = false

      await page.getByTestId('community-feed-retry-button').click()
      const badge = page.getByTestId('status-badge-tea-flagged-look')
      const reason = page.getByTestId('author-state-explanation-tea-flagged-look')
      const withdrawn = page.getByTestId('status-badge-tea-withdrawn-look')
      await expect(badge).toBeVisible()
      await expect(withdrawn).toBeVisible()
      const states = page.getByTestId('community-author-states')

      for (const [scheme, merlot] of [
        ['dark', MERLOT_DARK],
        ['light', MERLOT_LIGHT],
      ] as const) {
        await page.emulateMedia({ colorScheme: scheme })
        expect(await textContrastFailures(states), scheme).toEqual([])
        expect(await resolved(badge), scheme).toEqual({ color: merlot, border: merlot })
        expect((await resolved(reason)).color, scheme).toBe(merlot)
        // Merlot is reserved for the destructive state: a withdrawal stays neutral.
        const neutral = await resolved(withdrawn)
        expect(neutral.color, scheme).not.toBe(merlot)
        expect(neutral.border, scheme).not.toBe(merlot)
      }
    }
  )

  for (const palette of PREMIUM_PALETTES) {
    test(`3.6-E2E-013: the compose and report dialogs use the ${palette} surface and keep every field readable under a dark system setting`, async ({
      page,
      communitySession,
    }) => {
      expect(communitySession.userId).toBeTruthy()
      await page.emulateMedia({ colorScheme: 'dark' })
      await page.setViewportSize({ width: 1280, height: 900 })
      const feed = completedCommunityFeed(page)
      await page.goto('/community')
      expect((await feed).status).toBe(200)
      await expectCommunityFeedLoaded(page)
      await setPalette(page, palette)
      // Story CC-7.9 D5: the member's palette in its dark variant under a dark system setting,
      // as computed on the root from the `--cc-theme-*` tokens. The dialog role sits on the
      // dimming overlay; the panel is its first child, sampled as rendered.
      const paletteSurface = await paletteCardSurface(page)
      expect(paletteSurface).toBe(
        rgbOf(hexToChannels(premiumPalettes[palette].dark.cardBg))
      )
      const panelSurface = (dialog: Locator) =>
        surfacePixel(dialog.locator(':scope > div').first())

      await page.getByTestId('create-post-button').click()
      const compose = page.getByRole('dialog')
      await expect(compose).toBeVisible()
      // Empty first: each field's prompt is read before anything is typed.
      expect(await placeholderContrastFailures(compose)).toEqual([])
      await page.getByTestId('post-title-input').fill('Classy in Camouflage')
      await page.getByTestId('post-alt-text-input').fill('Synthetic plum satin fabric')
      await page
        .getByTestId('post-caption-input')
        .fill('Synthetic caption for a contrast check')
      expect(await panelSurface(compose)).toBe(paletteSurface)
      expect(await textContrastFailures(compose)).toEqual([])
      await page.keyboard.press('Escape')
      await expect(compose).toBeHidden()

      const card = page.getByTestId('community-card-grid').locator('article').first()
      await card.getByTestId('community-card-actions').click()
      await card
        .getByRole('button', { name: enUS.community.card.report, exact: true })
        .click()
      const report = page.getByRole('dialog')
      await expect(report).toBeVisible()
      expect(await placeholderContrastFailures(report)).toEqual([])
      await page.getByTestId('report-reason-select').selectOption('spam')
      await page.getByTestId('report-details-input').fill('Synthetic report detail')
      expect(await panelSurface(report)).toBe(paletteSurface)
      // The closed select is measured on its selected option's text.
      expect(await textContrastFailures(report)).toEqual([])
    })
  }

  // The share dialog opens from a member's own published look: detail, then Share.
  for (const palette of [null, ...PREMIUM_PALETTES]) {
    const name = palette ?? 'Default'
    test(`3.6-E2E-018: the share-card dialog uses the ${name} surface and keeps its text readable under a dark system setting`, async ({
      page,
      request,
      apiRequest,
      recurse,
      communitySession,
    }, testInfo) => {
      expect(communitySession.userId).toBeTruthy()
      const apiBaseUrl = resolveApiBaseUrl(testInfo, {
        fallback: 'http://localhost:4000',
      })
      const published = await publishCommunityLook(request, {
        apiBaseUrl,
        userId: communitySession.userId,
        fixture: loadCommunityFixture('safe-satin-plum-512x512.jpg'),
        altText: 'Synthetic plum satin fabric',
        caption: `Share surface ${name}`,
      })
      const terminal = await waitForTerminalAuthorState(
        { apiRequest, recurse },
        { apiBaseUrl, userId: communitySession.userId, postId: published.postId }
      )
      expect(terminal.status).toBe('published')

      await page.emulateMedia({ colorScheme: 'dark' })
      await page.setViewportSize({ width: 1280, height: 900 })
      const feed = completedCommunityFeed(page)
      await page.goto('/community')
      expect((await feed).status).toBe(200)
      await setPalette(page, palette)
      // Story CC-7.9 D5: the dark variant of the palette (Default included) under a dark setting.
      const cardSurface = await paletteCardSurface(page)
      expect(cardSurface).toBe(
        rgbOf(hexToChannels(premiumPalettes[palette ?? 'default'].dark.cardBg))
      )

      await page
        .locator(`[data-testid$="lookbook-card-${published.postId}"]`)
        .first()
        .getByTestId(`lookbook-open-${published.postId}`)
        .click()
      const detail = page.locator('[aria-labelledby="community-detail-title"]')
      await expect(detail).toBeVisible()
      await detail.getByTestId('share-card-open').click()
      const share = page
        .getByRole('dialog')
        .filter({ has: page.getByTestId('share-card-preview') })
      await expect(share.getByTestId('share-card-preview')).toHaveAttribute(
        'data-loaded',
        'true'
      )
      const panel = share.locator(':scope > div').first()
      expect(await surfacePixel(panel)).toBe(cardSurface)
      // Share and its feedback line need a member web session, which the share-card lane's owned
      // runtime provides; share-card-native-share.spec.ts measures them per palette.
      expect(await textContrastFailures(share.getByTestId('share-card-save'))).toEqual([])
      expect(await textContrastFailures(panel)).toEqual([])
    })
  }

  const NEW_POST: Record<'fr-FR' | 'es-419', string> = {
    'fr-FR': frFR.community.calm.post,
    'es-419': es419.community.calm.post,
  }
  for (const locale of ['fr-FR', 'es-419'] as const) {
    test.describe(`at 320 CSS pixels in ${locale}`, () => {
      test.use({ locale })

      test(`3.6-E2E-014: New post stays entirely on screen for a member in ${locale}`, async ({
        page,
        communitySession,
      }) => {
        expect(communitySession.userId).toBeTruthy()
        await page.setViewportSize({ width: 320, height: 800 })
        const feed = completedCommunityFeed(page)
        await page.goto('/community')
        expect((await feed).status).toBe(200)
        await expect(page.locator('html')).toHaveAttribute('lang', locale)

        const newPost = page.getByTestId('create-post-button')
        await expect(newPost).toHaveText(NEW_POST[locale])
        // One frame: the box sits inside the viewport, and the point at its center is the button.
        const placement = await newPost.evaluate((button) => {
          const box = button.getBoundingClientRect()
          const hit = document.elementFromPoint(
            box.left + box.width / 2,
            box.top + box.height / 2
          )
          return {
            inViewport:
              box.left >= 0 &&
              box.top >= 0 &&
              box.right <= window.innerWidth &&
              box.bottom <= window.innerHeight,
            hitsButton: hit !== null && button.contains(hit),
            scrollWidth: document.documentElement.scrollWidth,
          }
        })
        expect(placement).toEqual({
          inViewport: true,
          hitsButton: true,
          scrollWidth: 320,
        })
      })
    })
  }

  // The monitor is off: the 401 is the refused session under test.
  test(
    '3.6-E2E-015: a refused stored session paints Sign in as visible text',
    { annotation: [{ type: 'skipNetworkMonitoring' }] },
    async ({ page, communitySession }) => {
      expect(communitySession.userId).toBeTruthy()
      await page.setViewportSize({ width: 390, height: 844 })
      const refused = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === COMMUNITY_FEED_PATH &&
          response.status() === 401
      )
      await page.route(`**${COMMUNITY_FEED_PATH}*`, (route) =>
        route.fulfill({ status: 401, json: { message: 'Unauthorized' } })
      )
      await page.goto('/community')
      await refused
      await expect(page.getByTestId('screen-gate')).toHaveAttribute('data-ready', 'true')
      await expect(page.getByTestId('community-feed-signed-out')).toBeVisible()

      const signIn = page.getByTestId('community-page').getByRole('link', {
        name: enUS.community.notifications.signin,
        exact: true,
      })
      await expect(signIn).toBeVisible()
      await expect(signIn).toHaveAttribute('href', '/signin')
      await expect(signIn).toHaveText(enUS.community.notifications.signin)
      await expect(signIn.locator('svg')).toHaveCount(0)
      // Painted, not only present: legibly, and all of it, against an unclipped clone in its font.
      const label = await inkOfText(signIn)
      expect(label!.painted).toBeGreaterThan(20)
      expect(label!.ratio).toBeGreaterThanOrEqual(4.5)
      expect(await inkCoverage(signIn)).toBeGreaterThanOrEqual(0.85)
      expect(await textContrastFailures(signIn)).toEqual([])

      // Negative controls beside the link: the same words visually hidden (sr-only), and full-size
      // but clipped away (clip-path: inset(50%)). Neither paints a pixel of text.
      await signIn.evaluate((link) => {
        const controls: [string, string][] = [
          ['tea-sr-only-control', ''],
          ['tea-clipped-control', 'display:inline-block;clip-path:inset(50%)'],
          [
            'tea-partly-clipped-control',
            'display:inline-block;clip-path:inset(0 78% 0 0)',
          ],
        ]
        for (const [id, css] of controls) {
          const control = document.createElement('span')
          if (!css) control.className = 'sr-only'
          control.setAttribute('style', css)
          control.dataset.testid = id
          control.textContent = link.textContent
          link.parentElement!.append(control)
        }
      })
      const clipped = await inkOfText(page.getByTestId('tea-clipped-control'))
      expect(clipped).not.toBeNull()
      expect(clipped!.painted).toBe(0)
      expect(
        await textContrastFailures(page.getByTestId('tea-clipped-control'))
      ).toHaveLength(1)
      const hidden = await inkOfText(page.getByTestId('tea-sr-only-control'))
      expect(hidden?.painted ?? 0).toBeLessThanOrEqual(1)
      // Most of the words clipped away: legible where painted, but far from all of it.
      expect(
        await inkCoverage(page.getByTestId('tea-partly-clipped-control'))
      ).toBeLessThan(0.5)
    }
  )

  for (const scheme of ['dark', 'light'] as const) {
    for (const palette of [null, ...PREMIUM_PALETTES]) {
      const name = palette ?? 'Default'
      // The monitor is off: a reader without Premium gets 403 from the planner read, the free
      // preview state under test.
      test(
        `3.6-E2E-016: the free Plan preview's Upgrade is readable (${name}, ${scheme} system)`,
        { annotation: [{ type: 'skipNetworkMonitoring' }] },
        async ({ page, communitySession }) => {
          expect(communitySession.userId).toBeTruthy()
          await page.emulateMedia({ colorScheme: scheme })
          await page.setViewportSize({ width: 390, height: 844 })
          await page.goto('/')
          await setPalette(page, palette)

          // Story CC-7.12 D10, D11: Plan week opens the Looks Plan segment, where a reader
          // without Premium sees the sample week with one Upgrade in place of the lock.
          await page.getByRole('link', { name: enUS.home.today.planWeek }).click()
          await expect(page).toHaveURL('/looks?segment=plan')
          const preview = page.getByTestId('plan-free-preview')
          const cta = preview.getByTestId('plan-upgrade')
          await expect(cta).toBeVisible()
          await expect(cta).toHaveText(enUS.looks.freePlan.upgrade)
          expect(await textContrastFailures(cta)).toEqual([])
          expect(await textContrastFailures(preview), 'free preview text').toEqual([])
        }
      )

      test(`3.6-E2E-017: a keyboard-focused bottom tab draws a visible ring (${name}, ${scheme} system)`, async ({
        page,
      }) => {
        await page.emulateMedia({ colorScheme: scheme })
        await page.setViewportSize({ width: 390, height: 844 })
        await page.goto('/community')
        await setPalette(page, palette)

        const nav = page.getByTestId('sticky-bottom-nav')
        // Story CC-7.11 D1: the Home tab (`bottom-nav-home`) reads Today.
        const home = nav.getByRole('link', { name: enUS.nav.today, exact: true })
        // The tab as it looks before focus, then after keyboard focus (so :focus-visible applies).
        const ring = await focusRing(home, async () => {
          await home.focus()
          await page.keyboard.press('Shift+Tab')
          await page.keyboard.press('Tab')
          await expect(home).toBeFocused()
        })
        // Focus changes pixels around the tab, and they reach 3:1 against what was there.
        // WCAG 2.4.13: the 3:1 change covers at least a 2 CSS px perimeter of the link.
        expect(ring!.qualifying).toBeGreaterThanOrEqual(ring!.required!)
        // Story CC-7.9 D3: the ring is the scheme's `focusEssential` outline over the surface the
        // tab bar paints (the `page` role, D7), whatever palette the member chose.
        const outline = await home.evaluate((link) => getComputedStyle(link).outlineColor)
        expect(outline).toBe(roleRgb(scheme, 'focusEssential'))
        const backdrop = await focusBackdrop(home)
        expect(contrastRatio(outline, backdrop.color)).toBeGreaterThanOrEqual(3)
      })
    }
  }
})
