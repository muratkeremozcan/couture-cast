// Learning path Step 69: Looks tab for saved looks, ideas and plans.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-69-looks-tab-for-saved-looks-ideas-and-plans
// Story CC-7.12 test owner (TEA): the Looks tab's Saved, Ideas and Plan segments at 390 x 664,
// the newest-first grid of saved looks and capsules, its filters, Ideas, the capsules move and
// the Closet row removal (7.12-E2E-001..016, 040..042). Reads come from looks-fixtures.ts, which
// orders and pages like the API, so each order check fails if the page drops `sort`.
// Test design: _bmad-output/test-artifacts/test-design-7-12-looks-tab-saved-looks-ideas-plans.md.
import type { Page } from '@playwright/test'
import { looksIdeas } from '@couture/utils'
import { expect, test } from '../support/fixtures/merged-fixtures'
import { waitForShellSettled } from '../support/helpers/app-shell'
import { FOLD_VIEWPORT, foldBand, visibleInBand } from '../support/helpers/five-tab'
import {
  openLooksFixture,
  type CapsuleSeed,
  type LookSeed,
} from '../support/helpers/looks-fixtures'

// Fixture bearers seed their own session; the signed-out test needs none at all.
test.use({ viewport: FOLD_VIEWPORT, authSessionEnabled: false })

const segment = (page: Page, id: 'saved' | 'ideas' | 'plan') =>
  page.getByTestId(`looks-segment-${id}`)

/** Tile test ids in grid order. */
async function tileIds(page: Page): Promise<string[]> {
  return page
    .getByTestId('looks-saved-grid')
    .locator('[data-testid^="saved-look-card-"], [data-testid^="looks-capsule-card-"]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-testid') ?? ''))
}

const LOOKS: LookSeed[] = [
  { id: 'look-a', created: 10, title: 'Rainy commute' },
  { id: 'look-c', created: 30, title: 'Gallery Sunday', source: 'style_piece' },
]
const CAPSULES: CapsuleSeed[] = [{ id: 'capsule-b', created: 20, name: 'Work week' }]

test.describe('CC-7.12 Looks segments and default @local-lane', () => {
  test('[P0] [7.12-E2E-002] segments are tabs in order; switching replaces history so one back leaves Looks', async ({
    page,
    interceptNetworkCall,
  }) => {
    const { router } = await openLooksFixture(page, interceptNetworkCall, {
      looks: LOOKS,
    })
    await page.goto('/wardrobe')
    await page.getByTestId('bottom-nav-looks').click()
    await expect(page).toHaveURL(/\/looks(\?|$)/)
    await waitForShellSettled(page, router)

    const tabs = page.getByTestId('looks-segments').getByRole('tab')
    await expect(tabs).toHaveText(['Saved', 'Ideas', 'Plan'])
    await expect(segment(page, 'saved')).toHaveAttribute('aria-selected', 'true')
    await expect(segment(page, 'ideas')).toHaveAttribute('aria-selected', 'false')

    await segment(page, 'ideas').click()
    await expect(page).toHaveURL(/\/looks\?segment=ideas/)
    await expect(segment(page, 'ideas')).toHaveAttribute('aria-selected', 'true')
    await segment(page, 'plan').click()
    await expect(page).toHaveURL(/\/looks\?segment=plan/)
    // Keyboard: the ARIA tabs pattern moves and selects with the arrows.
    await segment(page, 'plan').press('ArrowLeft')
    await expect(segment(page, 'ideas')).toBeFocused()
    await expect(page).toHaveURL(/\/looks\?segment=ideas/)

    // Three segment changes, no new entries: one back returns to Closet.
    await page.goBack()
    await expect(page).toHaveURL(/\/wardrobe$/)
  })

  const defaults: {
    name: string
    looks: LookSeed[]
    capsules: CapsuleSeed[]
    expected: 'saved' | 'ideas'
  }[] = [
    { name: 'one saved look', looks: [LOOKS[0]!], capsules: [], expected: 'saved' },
    { name: 'only a capsule', looks: [], capsules: CAPSULES, expected: 'saved' },
    { name: 'nothing saved', looks: [], capsules: [], expected: 'ideas' },
  ]
  for (const row of defaults) {
    test(`[P0] [7.12-E2E-003] ${row.name}: Looks opens on ${row.expected}`, async ({
      page,
      interceptNetworkCall,
    }) => {
      const { router } = await openLooksFixture(page, interceptNetworkCall, {
        looks: row.looks,
        capsules: row.capsules,
      })
      await page.goto('/looks')
      await waitForShellSettled(page, router)

      await expect(segment(page, row.expected)).toHaveAttribute('aria-selected', 'true')
      if (row.expected === 'ideas') {
        await expect(page.getByTestId('looks-ideas-empty-line')).toHaveText(
          'Save a look to see it here'
        )
      } else {
        await expect(page.getByTestId('looks-saved-grid')).toBeVisible()
      }
    })
  }

  test(
    '[P0] [7.12-E2E-003] a failed saved looks read opens Saved with its retry, not Ideas (P1)',
    {
      // The 503 is the scenario; every other read still answers from the fixture.
      annotation: [{ type: 'skipNetworkMonitoring' }],
    },
    async ({ page, interceptNetworkCall }) => {
      const { router } = await openLooksFixture(page, interceptNetworkCall, {
        looks: LOOKS,
        failLooksRead: true,
      })
      await page.goto('/looks')
      await waitForShellSettled(page, router)

      await expect(segment(page, 'saved')).toHaveAttribute('aria-selected', 'true')
      await expect(page.getByTestId('saved-looks-retry')).toBeVisible()
    }
  )

  test('[P0] [7.12-E2E-004] no flash: a member with looks never sees Ideas selected while the reads are out (P1)', async ({
    page,
    interceptNetworkCall,
  }) => {
    const fixture = await openLooksFixture(page, interceptNetworkCall, {
      looks: LOOKS,
      capsules: CAPSULES,
    })
    // Record every segment that is ever selected, from the first paint.
    await page.addInitScript(() => {
      const seen: string[] = []
      ;(window as unknown as { __looksSegments: string[] }).__looksSegments = seen
      new MutationObserver(() => {
        const nodes = Array.from(
          document.querySelectorAll<HTMLElement>('[role="tab"][aria-selected="true"]')
        )
        for (const node of nodes) {
          const id = node.getAttribute('data-testid') ?? ''
          if (id.startsWith('looks-segment-') && seen.at(-1) !== id) seen.push(id)
        }
      }).observe(document, { subtree: true, childList: true, attributes: true })
    })
    const release = fixture.hold('capsules')
    await page.goto('/looks')
    await expect
      .poll(() => fixture.listReads().some((read) => read.startsWith('capsules')))
      .toBe(true)
    // The looks page answered, the capsules page is held: the gate holds the segments back.
    await expect(page.getByTestId('looks-segments')).toHaveCount(0)
    release()
    await waitForShellSettled(page, fixture.router)

    await expect(segment(page, 'saved')).toHaveAttribute('aria-selected', 'true')
    expect(
      await page.evaluate(
        () => (window as unknown as { __looksSegments: string[] }).__looksSegments
      )
    ).toEqual(['looks-segment-saved'])
  })
})

test.describe('CC-7.12 each segment opens within the fold @local-lane', () => {
  for (const mode of ['populated', 'empty'] as const) {
    for (const id of ['saved', 'ideas', 'plan'] as const) {
      test.describe(`${id}, ${mode}`, () => {
        // Codex round 3 #4: only Plan expects the free preview's exact Premium-required 403;
        // Saved and Ideas keep every planner error fatal.
        if (id === 'plan') test.use({ allowPremiumPlannerRefusal: true })
        test(`[P0] [7.12-E2E-001] ${id}, ${mode}: first content inside the fold at 390 x 664`, async ({
          page,
          interceptNetworkCall,
        }) => {
          const { router } = await openLooksFixture(page, interceptNetworkCall, {
            looks: mode === 'populated' ? LOOKS : [],
            capsules: mode === 'populated' ? CAPSULES : [],
            ...(id === 'plan' ? { planner: 'free' as const } : {}),
          })
          await page.goto(`/looks?segment=${id}`)
          await waitForShellSettled(page, router)

          const band = await foldBand(page)
          const first = page.getByTestId('looks-first-content')
          await expect(first).toBeVisible()
          const { box } = await visibleInBand(first, band)
          expect(box.y, 'first content starts below the top bar').toBeGreaterThanOrEqual(
            band.top - 1
          )

          // The first thing a member reads in each segment sits wholly inside the band.
          const probe =
            id === 'saved'
              ? mode === 'populated'
                ? page.getByTestId('saved-look-card-look-c')
                : page.getByTestId('looks-filter-empty')
              : id === 'ideas'
                ? page.locator('[data-testid^="looks-idea-card-"]').first()
                : page.getByTestId('plan-upgrade')
          const probeBox = (await probe.boundingBox())!
          expect(probeBox, `${id} first item`).not.toBeNull()
          expect(
            probeBox.y + probeBox.height,
            `${id} first item bottom`
          ).toBeLessThanOrEqual(band.bottom + 1)
        })
      })
    }
  }
})

test.describe('CC-7.12 Saved grid, order and state lines @local-lane', () => {
  test('[P0] [7.12-E2E-010] newest first across looks and capsules, read with sort=created_desc', async ({
    page,
    interceptNetworkCall,
  }) => {
    const fixture = await openLooksFixture(page, interceptNetworkCall, {
      looks: LOOKS,
      capsules: CAPSULES,
    })
    await page.goto('/looks?segment=saved')
    await waitForShellSettled(page, fixture.router)

    expect(await tileIds(page)).toEqual([
      'saved-look-card-look-c',
      'looks-capsule-card-capsule-b',
      'saved-look-card-look-a',
    ])
    for (const read of fixture.listReads()) expect(read).toContain('sort=created_desc')
  })

  test('[P0] [7.12-E2E-010] Load more keeps the global order across 60 looks and 3 capsules', async ({
    page,
    interceptNetworkCall,
  }) => {
    // Seed ids out of time order so an id sort cannot pass for a time sort.
    const looks: LookSeed[] = Array.from({ length: 60 }, (_, index) => ({
      id: `look-${String(59 - index).padStart(2, '0')}`,
      created: index * 2,
    }))
    const capsules: CapsuleSeed[] = [
      { id: 'capsule-new', created: 119, name: 'Newest capsule' },
      { id: 'capsule-mid', created: 41, name: 'Middle capsule' },
      { id: 'capsule-old', created: 1, name: 'Oldest capsule' },
    ]
    const fixture = await openLooksFixture(page, interceptNetworkCall, {
      looks,
      capsules,
    })
    await page.goto('/looks?segment=saved')
    await waitForShellSettled(page, fixture.router)

    const expected = [
      ...looks.map((look) => ({ id: `saved-look-card-${look.id}`, at: look.created })),
      ...capsules.map((capsule) => ({
        id: `looks-capsule-card-${capsule.id}`,
        at: capsule.created,
      })),
    ]
      .sort((a, b) => b.at - a.at)
      .map((entry) => entry.id)

    const firstPage = await tileIds(page)
    expect(firstPage.length).toBeGreaterThan(0)
    expect(firstPage, 'first page is a prefix of the global order').toEqual(
      expected.slice(0, firstPage.length)
    )
    // capsule-old is older than look 50's page boundary, so it waits for the next page.
    expect(firstPage).not.toContain('looks-capsule-card-capsule-old')

    await page.getByTestId('saved-looks-load-more').click()
    await expect.poll(() => tileIds(page)).toEqual(expected)
    await expect(page.getByTestId('saved-looks-load-more')).toHaveCount(0)
  })

  test('[P0] [7.12-E2E-011] each tile shows its name and one state line', async ({
    page,
    interceptNetworkCall,
  }) => {
    const { router } = await openLooksFixture(page, interceptNetworkCall, {
      looks: [
        { id: 'look-missing', created: 40, title: 'Missing one', missing: 1 },
        { id: 'look-missing-2', created: 35, title: 'Missing two', missing: 2 },
        { id: 'look-review', created: 30, title: 'Changed tags', needsReview: true },
        { id: 'look-ready', created: 20, title: 'All here' },
      ],
      capsules: [{ id: 'capsule-gap', created: 10, name: 'Gap capsule', unavailable: 1 }],
    })
    await page.goto('/looks?segment=saved')
    await waitForShellSettled(page, router)

    const expectations: [string, string, RegExp][] = [
      ['saved-look-card-look-missing', 'Missing one', /^1 piece missing$/],
      ['saved-look-card-look-missing-2', 'Missing two', /^2 pieces missing$/],
      ['saved-look-card-look-review', 'Changed tags', /^Needs review$/],
      ['saved-look-card-look-ready', 'All here', /^Saved Nov 20$/],
      ['looks-capsule-card-capsule-gap', 'Gap capsule', /^1 piece missing$/],
    ]
    for (const [testId, name, line] of expectations) {
      const tile = page.getByTestId(testId)
      await expect(tile).toContainText(name)
      // P8: one link whose name is the look name and its state line; pictures are decorative.
      await expect(tile).toHaveRole('link')
      const label = (await tile.getAttribute('aria-label')) ?? ''
      expect(label.startsWith(`${name}, `), `${testId} label`).toBe(true)
      expect(label.slice(name.length + 2)).toMatch(line)
      await expect(tile.locator('img:not([alt=""])')).toHaveCount(0)
      const box = (await tile.boundingBox())!
      expect(box.height).toBeGreaterThanOrEqual(44)
      expect(box.width).toBeGreaterThanOrEqual(44)
    }
  })

  test('[P0] [7.12-E2E-012] a look tile opens its saved look; a capsule tile opens the manager on that capsule', async ({
    page,
    interceptNetworkCall,
  }) => {
    const { router } = await openLooksFixture(page, interceptNetworkCall, {
      looks: LOOKS,
      capsules: CAPSULES,
    })
    await page.goto('/looks?segment=saved')
    await waitForShellSettled(page, router)

    await page.getByTestId('saved-look-card-look-c').click()
    await expect(page).toHaveURL(/\/looks\/saved\/look-c(\?|$)/)
    await expect(page.getByTestId('app-top-bar-title')).toHaveText('Gallery Sunday')
    await page.getByTestId('app-top-bar-back').click()
    await expect(page).toHaveURL(/\/looks\?segment=saved/)

    await page.getByTestId('looks-capsule-card-capsule-b').click()
    await expect(page).toHaveURL(/\/looks\/capsules\?capsule=capsule-b$/)
    await expect(page.getByTestId('app-top-bar-title')).toHaveText('Outfit capsules')
    // A client navigation (no reload) still reads the capsule param and focuses its card.
    await expect(page.getByTestId('capsule-card-capsule-b')).toBeFocused()
  })

  test('[P0] [7.12-E2E-013] filters read one list each and never show the previous filter tiles', async ({
    page,
    interceptNetworkCall,
  }) => {
    const fixture = await openLooksFixture(page, interceptNetworkCall, {
      looks: [
        { id: 'home-1', created: 50, title: 'Today one' },
        { id: 'home-2', created: 30, title: 'Today two' },
        { id: 'piece-1', created: 40, title: 'Style piece', source: 'style_piece' },
      ],
      capsules: CAPSULES,
    })
    await page.goto('/looks?segment=saved')
    await waitForShellSettled(page, fixture.router)
    await expect(page.getByTestId('looks-filter-all')).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(await tileIds(page)).toHaveLength(4)

    // Today: home samples only, read from the server by source (P2), no capsule read.
    let before = fixture.listReads().length
    await page.getByTestId('looks-filter-today').click()
    await expect(page).toHaveURL(/filter=today/)
    await expect(page.getByTestId('looks-filter-today')).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    await expect
      .poll(() => tileIds(page))
      .toEqual(['saved-look-card-home-1', 'saved-look-card-home-2'])
    const todayReads = fixture.listReads().slice(before)
    expect(todayReads.every((read) => read.startsWith('saved-looks?'))).toBe(true)
    expect(todayReads.every((read) => read.includes('source=home_sample'))).toBe(true)

    // Capsules: with the capsule read held, no saved look tile may show (T1).
    const release = fixture.hold('capsules')
    before = fixture.listReads().length
    await page.getByTestId('looks-filter-capsules').click()
    await expect(page).toHaveURL(/filter=capsules/)
    await expect.poll(() => fixture.listReads().length).toBeGreaterThan(before)
    await expect(page.locator('[data-testid^="saved-look-card-"]')).toHaveCount(0)
    // While the new filter read is out, Saved shows its loading line and no dead Load more.
    await expect(
      page.getByTestId('looks-first-content').getByTestId('looks-feed-loading')
    ).toBeVisible()
    await expect(page.getByTestId('saved-looks-load-more')).toHaveCount(0)
    release()
    await expect.poll(() => tileIds(page)).toEqual(['looks-capsule-card-capsule-b'])
    expect(
      fixture
        .listReads()
        .slice(before)
        .every((read) => read.startsWith('capsules?'))
    ).toBe(true)
    await expect(page.getByTestId('looks-manage-capsules')).toBeVisible()
    await page.getByTestId('looks-manage-capsules').click()
    await expect(page).toHaveURL(/\/looks\/capsules$/)
  })

  test('[P1] [7.12-E2E-013] an empty filter reads one line', async ({
    page,
    interceptNetworkCall,
  }) => {
    const { router } = await openLooksFixture(page, interceptNetworkCall, {
      looks: [{ id: 'piece-1', created: 40, source: 'style_piece' }],
    })
    await page.goto('/looks?segment=saved&filter=today')
    await waitForShellSettled(page, router)
    await expect(page.getByTestId('looks-filter-empty')).toHaveText(
      'No looks from Today yet'
    )

    await page.getByTestId('looks-filter-capsules').click()
    await expect(page.getByTestId('looks-filter-empty')).toHaveText('No capsules yet')
    await expect(page.getByTestId('looks-manage-capsules')).toBeVisible()
  })
})

test.describe('CC-7.12 Ideas @local-lane', () => {
  test('[P0] [7.12-E2E-014] Ideas shows every sample look as a picture tile with no control', async ({
    page,
    interceptNetworkCall,
  }) => {
    const { router } = await openLooksFixture(page, interceptNetworkCall, {
      looks: LOOKS,
    })
    await page.goto('/looks?segment=ideas')
    await waitForShellSettled(page, router)

    const ideas = looksIdeas()
    const tiles = page.locator('[data-testid^="looks-idea-card-"]')
    await expect(tiles).toHaveCount(ideas.length)
    await expect(tiles.first()).toHaveAttribute(
      'data-testid',
      `looks-idea-card-${ideas[0]!.look.id}`
    )
    // Until CC-7.22 Ideas holds no dead control.
    await expect(
      page.getByTestId('looks-ideas-grid').locator('button, a, [role="button"]')
    ).toHaveCount(0)
    // A member with saved looks gets no empty line on Ideas.
    await expect(page.getByTestId('looks-ideas-empty-line')).toHaveCount(0)
  })

  test('[P0] [7.12-E2E-015] signed out: Looks opens on Ideas and sends no saved look or capsule read', async ({
    page,
  }) => {
    const reads: string[] = []
    page.on('request', (request) => {
      if (/\/api\/v1\/wardrobe\/(saved-looks|[^/]+\/capsules)/.test(request.url()))
        reads.push(request.url())
    })
    await page.goto('/looks')
    await expect(segment(page, 'ideas')).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByTestId('looks-ideas-empty-line')).toBeVisible()

    await segment(page, 'saved').click()
    await expect(page.getByTestId('looks-first-content')).toBeVisible()
    await expect(page.getByTestId('looks-sign-in')).toHaveAttribute('href', '/signin')
    await segment(page, 'plan').click()
    await expect(page.getByTestId('plan-free-preview')).toBeVisible()
    expect(reads).toEqual([])
  })
})

test.describe('CC-7.12 capsules move and Closet row removal @local-lane', () => {
  test('[P0] [7.12-E2E-040] /wardrobe/capsules redirects on the server to Looks with Capsules, query kept', async ({
    page,
    interceptNetworkCall,
  }) => {
    for (const [from, to] of [
      ['/wardrobe/capsules', '/looks?segment=saved&filter=capsules'],
      ['/wardrobe/capsules?x=1', '/looks?segment=saved&filter=capsules&x=1'],
    ] as const) {
      const response = await page.request.get(from, { maxRedirects: 0 })
      expect([307, 308], `${from} status`).toContain(response.status())
      const location = new URL(response.headers()['location']!, 'http://localhost')
      const target = new URL(to, 'http://localhost')
      expect(location.pathname).toBe(target.pathname)
      expect(Object.fromEntries(location.searchParams)).toEqual(
        Object.fromEntries(target.searchParams)
      )
    }

    const { router } = await openLooksFixture(page, interceptNetworkCall, {
      capsules: CAPSULES,
    })
    await page.goto('/wardrobe/capsules')
    await expect(page).toHaveURL(/\/looks\?.*filter=capsules/)
    await waitForShellSettled(page, router)
    await expect(page.getByTestId('looks-filter-capsules')).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    await expect(page.getByTestId('looks-capsule-card-capsule-b')).toBeVisible()
  })

  test('[P1] [7.12-E2E-041] the capsule manager lives at /looks/capsules with back to the Capsules filter', async ({
    page,
    interceptNetworkCall,
  }) => {
    const { router } = await openLooksFixture(page, interceptNetworkCall, {
      capsules: CAPSULES,
    })
    await page.goto('/looks/capsules')
    // The manager renders no screen gate; its top bar and the fixture reads settle it.
    await expect(page.getByTestId('app-top-bar-title')).toHaveText('Outfit capsules')
    await expect.poll(() => router.inflight()).toBe(0)
    await expect(page.getByTestId('bottom-nav-looks')).toHaveAttribute(
      'aria-current',
      'page'
    )
    // Direct entry: back replaces to the parent address.
    await page.getByTestId('app-top-bar-back').click()
    await expect(page).toHaveURL(/\/looks\?segment=saved&filter=capsules$/)
  })

  test(
    '[P1] [7.12-E2E-042] an unknown or hostile capsule id scrolls nowhere and breaks nothing (P7)',
    // The one-capsule read answers 404 for each id by design; every other error still fails.
    { annotation: [{ type: 'skipNetworkMonitoring' }] },
    async ({ page, interceptNetworkCall }) => {
      const errors: string[] = []
      const httpErrors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      page.on('response', (response) => {
        if (response.status() < 400) return
        const { pathname } = new URL(response.url())
        httpErrors.push(`${response.request().method()} ${response.status()} ${pathname}`)
      })
      const fixture = await openLooksFixture(page, interceptNetworkCall, {
        capsules: CAPSULES,
      })
      const ids = ['missing-capsule', '"]\';alert(1)//', 'a b']
      const refusalFor = (id: string) =>
        `/api/v1/wardrobe/${fixture.memberId}/capsules/${encodeURIComponent(id)}`
      for (const id of ids) {
        // Codex round 3 #5: each navigation must itself answer the 404 for its own id.
        const refused = page.waitForResponse(
          (response) =>
            response.status() === 404 &&
            response.request().method() === 'GET' &&
            new URL(response.url()).pathname === refusalFor(id)
        )
        await page.goto(`/looks/capsules?capsule=${encodeURIComponent(id)}`)
        await refused
        await expect(page.getByTestId('app-top-bar-title')).toHaveText('Outfit capsules')
        await expect.poll(() => fixture.router.inflight()).toBe(0)
        expect(await page.evaluate(() => window.scrollY)).toBe(0)
        // The known capsule still lists; nothing is focused or pinned for an unknown id.
        await expect(page.getByTestId('capsule-card-capsule-b')).toBeVisible()
        await expect(page.getByTestId('capsule-card-capsule-b')).not.toBeFocused()
      }
      expect(errors).toEqual([])
      // Each navigation answers a 404 for its own id on the fixture member (a list refresh may
      // read it again), and nothing else errs (P7: the id is read by equality, URL-encoded).
      expect([...new Set(httpErrors)].sort()).toEqual(
        ids.map((id) => `GET 404 ${refusalFor(id)}`).sort()
      )
    }
  )

  test('[P0] [7.12-E2E-016] Closet shows no saved looks row for a member with saved looks', async ({
    page,
    interceptNetworkCall,
  }) => {
    const { router, setScreen } = await openLooksFixture(page, interceptNetworkCall, {
      looks: LOOKS,
    })
    setScreen('closet')
    await page.goto('/wardrobe')
    await waitForShellSettled(page, router)
    await expect(page.getByTestId('closet-garment-grid')).toBeVisible()
    await expect(page.getByTestId('closet-saved-looks-row')).toHaveCount(0)
    await expect(page.locator('[data-testid^="saved-look-card-"]')).toHaveCount(0)
  })
})
