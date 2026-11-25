// Learning path Step 65: Signed-in shell without flashes.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-65-signed-in-shell-without-flashes
// Story CC-7.7 test owner (TEA): 7.7-E2E-001..008, AC1 to AC5 and spec D1 to D5, D7.
// Test design: _bmad-output/test-artifacts/test-design-7-7-signed-in-shell-without-flashes.md.
// Owner walk 2026-11-21: Home cold load at phone width scored 0.574 with the signed-out sample
// outfit replaced by the member's. This is the PR-gate budget that keeps it fixed: Chromium at
// 390 x 844, every tab cold and in a scripted tab switch, against fixed empty, populated and
// delayed responses (helpers/shell-fixtures.ts). The meter (helpers/layout-shift-meter.ts) sums
// every layout-shift entry, the ones after input included, over the whole transition; above 0.1
// fails and names what moved. The production measurement is the .prod.spec.ts beside this file.
import { randomUUID } from 'node:crypto'
import type { Page } from '@playwright/test'
import type { InterceptNetworkCallFn } from '@seontechnologies/playwright-utils/intercept-network-call'
import { recurse } from '@seontechnologies/playwright-utils/recurse'
import { expect, test } from '../support/fixtures/merged-fixtures'
import { seedWebSession } from '../support/helpers/commerce-session'
import {
  describeShifts,
  firstRectMove,
  installMeter,
  meterNow,
  readMeter,
  settleTransition,
  shiftScore,
  SHELL_METER_CONFIG,
  sightings,
  sightingsBeforeReady,
  textSightings,
  type MeterSnapshot,
} from '../support/helpers/layout-shift-meter'
import { localE2EAccessToken } from '../support/helpers/local-e2e-token'
import {
  closeCommunitySocket,
  createShellRouter,
  DELAY_MS,
  ownerMarker,
  type ShellMode,
  type ShellScreen,
} from '../support/helpers/shell-fixtures'

const BUDGET = 0.1

test.use({
  authSessionEnabled: false,
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
})

const TABS: Record<ShellScreen, { path: string; nav: string }> = {
  home: { path: '/', nav: 'bottom-nav-home' },
  closet: { path: '/wardrobe', nav: 'bottom-nav-wardrobe' },
  community: { path: '/community', nav: 'bottom-nav-community' },
  profile: { path: '/settings', nav: 'bottom-nav-settings' },
}
const SCREENS = Object.keys(TABS) as ShellScreen[]
const SIGNED_OUT_CONTENT = [
  'home-demo-outfit',
  'guest-preview-entry',
  'landing-sign-in',
  'landing-sign-up',
]

async function openShell(
  page: Page,
  interceptNetworkCall: InterceptNetworkCallFn,
  options: {
    mode: ShellMode
    screen: ShellScreen
    signedIn: boolean
    memberId?: string
    /** Members whose Home outfit text the meter watches for in every frame. */
    watchMembers?: string[]
  }
) {
  const memberId = options.memberId ?? `shell-${randomUUID()}`
  let active = options.screen
  const router = createShellRouter({ mode: options.mode, screen: () => active, memberId })
  // Declared before navigation: every read the tabs make is served from here.
  void interceptNetworkCall({ url: '**/api/v1/**', handler: router.handler })
  await closeCommunitySocket(page)
  await installMeter(page, {
    ...SHELL_METER_CONFIG,
    watchText: options.watchMembers?.map(ownerMarker),
  })
  if (options.signedIn) await seedWebSession(page, localE2EAccessToken(memberId))
  return {
    router,
    memberId,
    setScreen: (screen: ShellScreen) => {
      active = screen
    },
  }
}

function expectWithinBudget(snapshot: MeterSnapshot, fromMs: number, label: string) {
  const score = shiftScore(snapshot.shifts, fromMs)
  expect(
    score,
    `${label}: shift score ${score.toFixed(4)} over ${BUDGET}\n` +
      describeShifts(snapshot.shifts, fromMs).join('\n')
  ).toBeLessThanOrEqual(BUDGET)
}

/** AC2: the header and tab bar hold their position over the whole transition. */
function expectShellStill(snapshot: MeterSnapshot, fromMs: number, label: string) {
  for (const key of ['header', 'nav'] as const) {
    expect(
      firstRectMove(snapshot.frames, key, fromMs),
      `${label}: ${key} moved`
    ).toBeNull()
  }
}

function expectUnknownReadsNone(router: ReturnType<typeof createShellRouter>) {
  expect(
    router.unknown().filter((request) => request.startsWith('GET ')),
    'reads this spec does not stub: add them to helpers/shell-fixtures.ts'
  ).toEqual([])
}

const firstReadyAt = (snapshot: MeterSnapshot, screen: ShellScreen, fromMs: number) =>
  snapshot.frames.find((frame) => frame.t >= fromMs && frame.ready.includes(screen))?.t ??
  null

test.describe('7.7 signed-in shell layout shift at 390 x 844 @local-lane', () => {
  for (const mode of ['empty', 'populated', 'delayed'] as const) {
    for (const screen of SCREENS) {
      test(`[P0] 7.7-E2E-001/003/004 member ${screen} cold load, ${mode}: within ${BUDGET}, shell still, no signed-out content`, async ({
        page,
        interceptNetworkCall,
      }) => {
        const { router } = await openShell(page, interceptNetworkCall, {
          mode,
          screen,
          signedIn: true,
        })

        await page.goto(TABS[screen].path)
        if (mode === 'delayed') {
          // D1: while the reads are pending the body is a busy placeholder (DELAY_MS still runs).
          await expect(page.getByTestId('screen-placeholder').first()).toBeVisible()
          await expect(page.getByTestId('screen-placeholder').first()).toHaveAttribute(
            'aria-busy',
            'true'
          )
        }
        const snapshot = await settleTransition(page, {
          screen,
          fromMs: 0,
          inflight: router.inflight,
        })

        expectWithinBudget(snapshot, 0, `${screen} ${mode}`)
        expectShellStill(snapshot, 0, `${screen} ${mode}`)
        // AC1, D2: a member never sees signed-out content, before or after the screen is ready.
        expect(sightings(snapshot.frames, SIGNED_OUT_CONTENT, 0)).toEqual({})
        // D2: the sample outfit only after the ritual read settled without an outfit.
        expect(
          sightingsBeforeReady(snapshot.frames, ['member-sample-outfit'], screen, 0)
        ).toEqual({})
        const readyAt = firstReadyAt(snapshot, screen, 0)!
        // D3: once the body is revealed it stays revealed, and the placeholder is gone.
        const afterReady = snapshot.frames.filter((frame) => frame.t >= readyAt)
        expect(afterReady.every((frame) => frame.ready.includes(screen))).toBe(true)
        expect(sightings(afterReady, ['screen-placeholder'], readyAt)).toEqual({})
        if (mode === 'delayed') {
          // D1: the neutral placeholder holds the space while the reads are pending.
          expect(sightings(snapshot.frames, ['screen-placeholder'], 0)).toHaveProperty(
            'screen-placeholder'
          )
          expect(readyAt).toBeGreaterThanOrEqual(DELAY_MS)
        }
        if (screen === 'home') {
          const own = page.getByTestId('home-live-outfit')
          const sample = page.getByTestId('member-sample-outfit')
          if (mode === 'empty') {
            await expect(sample).toBeVisible()
            expect(sightings(snapshot.frames, ['home-live-outfit'], 0)).toEqual({})
          } else {
            await expect(own).toBeVisible()
            expect(sightings(snapshot.frames, ['member-sample-outfit'], 0)).toEqual({})
          }
        }
        expectUnknownReadsNone(router)
      })
    }
  }

  test('[P0] 7.7-E2E-001 member home cold load, ritual 503: sample and Retry in place, within budget', async ({
    page,
    interceptNetworkCall,
  }) => {
    test.info().annotations.push({
      type: 'skipNetworkMonitoring',
      description: 'The ritual read answers 503 on purpose (I/O matrix "Ritual fails").',
    })
    const { router } = await openShell(page, interceptNetworkCall, {
      mode: 'ritual-503',
      screen: 'home',
      signedIn: true,
    })

    await page.goto('/')
    const snapshot = await settleTransition(page, {
      screen: 'home',
      fromMs: 0,
      inflight: router.inflight,
    })

    expectWithinBudget(snapshot, 0, 'home ritual-503')
    expectShellStill(snapshot, 0, 'home ritual-503')
    expect(sightings(snapshot.frames, SIGNED_OUT_CONTENT, 0)).toEqual({})
    // The gate never hides the error and its Retry once the read settled.
    await expect(page.getByTestId('home-outfit-retry')).toBeVisible()
    expect(
      sightingsBeforeReady(snapshot.frames, ['member-sample-outfit'], 'home', 0)
    ).toEqual({})
  })

  for (const screen of SCREENS) {
    test(`[P0] 7.7-E2E-002 signed-out ${screen} cold load: within ${BUDGET}, no placeholder`, async ({
      page,
      interceptNetworkCall,
    }) => {
      const { router } = await openShell(page, interceptNetworkCall, {
        mode: 'populated',
        screen,
        signedIn: false,
      })

      await page.goto(TABS[screen].path)
      const snapshot = await settleTransition(page, {
        screen,
        fromMs: 0,
        inflight: router.inflight,
      })

      expectWithinBudget(snapshot, 0, `signed-out ${screen}`)
      expectShellStill(snapshot, 0, `signed-out ${screen}`)
      // D1: under data-session=none the signed-out page renders as before, with no placeholder.
      expect(sightings(snapshot.frames, ['screen-placeholder'], 0)).toEqual({})
      if (screen === 'home')
        await expect(page.getByTestId('landing-sign-in')).toBeVisible()
    })
  }

  // Closet and Profile are left out: every read they make on mount is a gate read (D3 as built),
  // so nothing lands late there.
  for (const screen of ['home', 'community'] as const) {
    test(`[P1] 7.7-E2E-005 member ${screen}: late sections land after the first tap without moving content`, async ({
      page,
      interceptNetworkCall,
    }) => {
      const { router } = await openShell(page, interceptNetworkCall, {
        mode: 'late',
        screen,
        signedIn: true,
      })
      await page.goto(TABS[screen].path)
      await expect(
        page.locator(`[data-testid="screen-gate"][data-screen="${screen}"]`)
      ).toHaveAttribute('data-ready', 'true')

      // The first tap: on the header's title text, which is no control (the Community header
      // starts with a link, so a corner tap would navigate).
      const pendingAtTap = router.inflight()
      const tappedAt = await meterNow(page)
      await page.getByTestId('app-header').locator('h1, p').first().click()
      const snapshot = await settleTransition(page, {
        screen,
        fromMs: tappedAt,
        inflight: router.inflight,
      })

      // AC3: the late reads (every read outside this gate, DELAY_MS late) were still pending at
      // the tap, so their sections landed after it.
      expect(pendingAtTap, 'no read was still pending at the tap').toBeGreaterThan(0)
      const afterTap = shiftScore(snapshot.shifts, tappedAt)
      expect(
        afterTap,
        `content moved after the first tap:\n${describeShifts(snapshot.shifts, tappedAt).join('\n')}`
      ).toBe(0)
      expectUnknownReadsNone(router)
    })
  }

  for (const mode of ['empty', 'populated', 'delayed'] as const) {
    test(`[P0] 7.7-E2E-006 member tab switches Home > Closet > Community > Profile > Home, ${mode}: each within ${BUDGET}`, async ({
      page,
      interceptNetworkCall,
    }) => {
      test.setTimeout(150_000)
      const { router, setScreen } = await openShell(page, interceptNetworkCall, {
        mode,
        screen: 'home',
        signedIn: true,
      })
      await page.goto('/')
      await settleTransition(page, {
        screen: 'home',
        fromMs: 0,
        inflight: router.inflight,
      })
      // A full navigation would start a new document and a new meter: the marker proves each
      // switch stayed in this document, where the meter keeps counting.
      await page.evaluate(() => {
        ;(window as unknown as { __ccSameDocument: boolean }).__ccSameDocument = true
      })

      const route: ShellScreen[] = ['closet', 'community', 'profile', 'home']
      let previous: ShellScreen = 'home'
      for (const screen of route) {
        setScreen(screen)
        const tappedAt = await meterNow(page)
        await page.getByTestId(TABS[screen].nav).click()
        const snapshot = await settleTransition(page, {
          screen,
          fromMs: tappedAt,
          inflight: router.inflight,
        })
        const label = `${previous} > ${screen} (${mode})`

        expect(
          await page.evaluate(
            () => (window as unknown as { __ccSameDocument?: boolean }).__ccSameDocument
          ),
          `${label}: the tab link reloaded the page`
        ).toBe(true)
        expectWithinBudget(snapshot, tappedAt, label)
        // The tab bar never moves; the header is measured from the destination's first frame,
        // because each tab keeps its own header until CC-7.9 unifies them.
        expect(
          firstRectMove(snapshot.frames, 'nav', tappedAt),
          `${label}: tab bar moved`
        ).toBeNull()
        const arrivedAt =
          snapshot.frames.find(
            (frame) => frame.present.includes(screen) && !frame.present.includes(previous)
          )?.t ?? tappedAt
        expect(
          firstRectMove(snapshot.frames, 'header', arrivedAt),
          `${label}: header moved`
        ).toBeNull()
        expect(sightings(snapshot.frames, SIGNED_OUT_CONTENT, tappedAt)).toEqual({})
        if (screen === 'home') {
          // AC4: the return to a visited tab shows its last content at once, no placeholder.
          expect(sightings(snapshot.frames, ['screen-placeholder'], tappedAt)).toEqual({})
        }
        previous = screen
      }
      expectUnknownReadsNone(router)
    })
  }

  test('[P0] 7.7-E2E-007 positive control: a block inserted above the content scores above the budget', async ({
    page,
    interceptNetworkCall,
  }) => {
    const { router } = await openShell(page, interceptNetworkCall, {
      mode: 'populated',
      screen: 'home',
      signedIn: true,
    })
    await page.goto('/')
    await settleTransition(page, { screen: 'home', fromMs: 0, inflight: router.inflight })

    const insertedAt = await meterNow(page)
    await page.evaluate(() => {
      const block = document.createElement('div')
      block.style.height = '300px'
      document
        .querySelector('[data-testid="screen-gate"][data-screen="home"]')!
        .prepend(block)
    })
    const snapshot = await recurse(
      () => readMeter(page, insertedAt),
      (current) => shiftScore(current.shifts, insertedAt) > 0,
      { timeout: 5000, interval: 100, log: false }
    )

    // Without this the budget above could pass because the meter sees nothing.
    expect(shiftScore(snapshot.shifts, insertedAt)).toBeGreaterThan(BUDGET)
  })

  test('[P0] 7.7-E2E-008 tab return: Closet comes back at its scroll offset in the first frame and refreshes in place', async ({
    page,
    interceptNetworkCall,
  }) => {
    test.setTimeout(90_000)
    const { router, setScreen } = await openShell(page, interceptNetworkCall, {
      mode: 'populated',
      screen: 'closet',
      signedIn: true,
    })
    await page.goto('/wardrobe')
    await settleTransition(page, {
      screen: 'closet',
      fromMs: 0,
      inflight: router.inflight,
    })
    await page.evaluate(() => window.scrollTo(0, 600))
    await recurse(
      () => page.evaluate(() => window.scrollY),
      (scrollY) => scrollY === 600,
      { timeout: 5000, interval: 50, log: false }
    )

    setScreen('community')
    const leftAt = await meterNow(page)
    await page.getByTestId(TABS.community.nav).click()
    await settleTransition(page, {
      screen: 'community',
      fromMs: leftAt,
      inflight: router.inflight,
    })
    const garmentReads = router.calls('garments')

    setScreen('closet')
    const returnedAt = await meterNow(page)
    await page.getByTestId(TABS.closet.nav).click()
    const snapshot = await settleTransition(page, {
      screen: 'closet',
      fromMs: returnedAt,
      inflight: router.inflight,
    })

    const firstFrame = snapshot.frames.find(
      (frame) => frame.present.includes('closet') && !frame.present.includes('community')
    )
    expect(firstFrame, 'Closet never rendered').toBeDefined()
    // AC4, D5: the first Closet frame is the remembered one: ready, at the old offset.
    expect(firstFrame!.ready).toContain('closet')
    expect(Math.abs(firstFrame!.scrollY - 600)).toBeLessThanOrEqual(1)
    expect(sightings(snapshot.frames, ['screen-placeholder'], returnedAt)).toEqual({})
    expectWithinBudget(snapshot, returnedAt, 'community > closet return')
    // Refreshed in place: the inventory read ran again behind the remembered grid.
    expect(router.calls('garments')).toBeGreaterThan(garmentReads)
    await expect(page.getByTestId('garment-card-shell-garment-1')).toBeAttached()
    expectUnknownReadsNone(router)
  })

  for (const path of ['sign-out-then-sign-in', 'bearer-swap'] as const) {
    test(`[P0] 7.7-E2E-009 owner change in one document (${path}): member B never sees member A content`, async ({
      page,
      interceptNetworkCall,
    }) => {
      test.setTimeout(90_000)
      const memberA = `shell-a-${randomUUID()}`
      const memberB = `shell-b-${randomUUID()}`
      const { router, setScreen } = await openShell(page, interceptNetworkCall, {
        mode: 'populated',
        screen: 'home',
        signedIn: true,
        memberId: memberA,
        watchMembers: [memberA, memberB],
      })
      const go = async (screen: ShellScreen) => {
        setScreen(screen)
        const tappedAt = await meterNow(page)
        await page.getByTestId(TABS[screen].nav).click()
        return settleTransition(page, {
          screen,
          fromMs: tappedAt,
          inflight: router.inflight,
        })
      }
      await page.goto('/')
      await settleTransition(page, {
        screen: 'home',
        fromMs: 0,
        inflight: router.inflight,
      })
      // Member A's Home is on screen and remembered (D5) once Closet takes over.
      await expect(page.getByTestId('home-live-outfit')).toContainText(
        ownerMarker(memberA)
      )
      await go('closet')

      if (path === 'sign-out-then-sign-in') {
        await go('home')
        await page.getByTestId('landing-sign-out').click()
      }
      // Member B signs in inside the same document: the app's own session event, no reload.
      // From here on member A's content may not appear in any frame.
      const switchedAt = await meterNow(page)
      await page.evaluate(
        ({ token }) => {
          window.sessionStorage.setItem('couturecast.access-token', token)
          window.dispatchEvent(new Event('couture:session'))
        },
        { token: localE2EAccessToken(memberB) }
      )
      if (path === 'sign-out-then-sign-in') await go('closet')
      const homeAt = await meterNow(page)
      const snapshot = await go('home')

      // D5 privacy: no frame after the switch shows member A's outfit.
      expect(
        textSightings(snapshot.frames, [ownerMarker(memberA)], switchedAt),
        'member A content shown after the owner changed'
      ).toEqual({})
      // The remembered Home was dropped: B's Home opens through the gate, not at once.
      const firstHome = snapshot.frames.find(
        (frame) => frame.t >= homeAt && frame.present.includes('home')
      )
      expect(
        firstHome?.ready ?? [],
        'Home opened from a remembered snapshot'
      ).not.toContain('home')
      await expect(page.getByTestId('home-live-outfit')).toContainText(
        ownerMarker(memberB)
      )
      expect(sightings(snapshot.frames, SIGNED_OUT_CONTENT, homeAt)).toEqual({})
    })
  }
})
