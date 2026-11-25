// Learning path Step 65: Signed-in shell without flashes.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-65-signed-in-shell-without-flashes
// Story CC-7.7 test owner (TEA): 7.7-E2E-010, AC5 and spec D8 (production rebaseline).
// Test design: _bmad-output/test-artifacts/test-design-7-7-signed-in-shell-without-flashes.md.
// The PR gate measures the shell against fixed responses (signed-in-shell-layout-shift.spec.ts);
// this measures production with real data at 390 x 844, as a signed-out visitor and as the
// production synthetic member. Read-only: every non-GET request is aborted before it leaves the
// browser, so a measurement never writes to the member's account (owner rule 2026-11-20).
// Baseline before this story, main 11c26918: signed-out Home 0, Closet 0.1157, Community 0.0018,
// Profile 0.51; member Home 0.574 at 500 px on 2026-11-21.
import type { Browser, BrowserContext } from '@playwright/test'
import { isProdEnvironment, projectMetadata } from '../support/helpers/api-test'
import {
  describeShifts,
  installMeter,
  settleTransition,
  shiftScore,
  sightings,
  sightingsBeforeReady,
  trackInflight,
} from '../support/helpers/layout-shift-meter'
import {
  assertTrustedProdOrigins,
  prodMemberStorageState,
  type ProdSyntheticMember,
} from '../support/helpers/prod-synthetic-member'
import { expect, test } from '../support/fixtures/prod-member-fixture'

const BUDGET = 0.1
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }
const TABS = [
  { screen: 'home', path: '/' },
  { screen: 'closet', path: '/wardrobe' },
  { screen: 'community', path: '/community' },
  { screen: 'profile', path: '/settings' },
] as const
const SIGNED_OUT_CONTENT = [
  'home-demo-outfit',
  'guest-preview-entry',
  'landing-sign-in',
  'landing-sign-up',
]

async function readOnlyContext(
  browser: Browser,
  webBaseUrl: string,
  member: ProdSyntheticMember | null
): Promise<BrowserContext> {
  const context = await browser.newContext({
    ...PHONE,
    baseURL: webBaseUrl,
    ...(member ? { storageState: prodMemberStorageState(member, webBaseUrl) } : {}),
  })
  // Deviation from interceptNetworkCall: that fixture binds to the default page, and each case
  // here needs its own context for its storage. This stubs nothing; it refuses writes.
  await context.route('**/*', (route) =>
    route.request().method() === 'GET' ? route.fallback() : route.abort()
  )
  return context
}

async function measureColdLoad(context: BrowserContext, tab: (typeof TABS)[number]) {
  const page = await context.newPage()
  await installMeter(page)
  const inflight = trackInflight(page, (url) => new URL(url).pathname.startsWith('/api/'))
  await page.goto(tab.path)
  const snapshot = await settleTransition(page, {
    screen: tab.screen,
    fromMs: 0,
    inflight,
    quietMs: 2000,
  })
  // A ready gate alone does not prove who loaded (a failed session opens it too, Codex P2-10).
  const session = await page.locator('html').getAttribute('data-session')
  await page.close()
  return { snapshot, session }
}

test.describe('7.7-E2E-010 production shell layout shift at 390 x 844', () => {
  for (const tab of TABS) {
    test(`[P1] signed-out ${tab.screen} cold load stays within ${BUDGET}`, async ({
      browser,
    }, testInfo) => {
      test.skip(
        !isProdEnvironment(testInfo),
        'Production measurement: runs in the Prod E2E lane only.'
      )
      const { baseUrl: webBaseUrl, apiBaseUrl } = projectMetadata(testInfo)
      assertTrustedProdOrigins(webBaseUrl!, apiBaseUrl!)
      const context = await readOnlyContext(browser, webBaseUrl!, null)
      try {
        const { snapshot, session } = await measureColdLoad(context, tab)
        const score = shiftScore(snapshot.shifts, 0)
        await testInfo.attach(`signed-out-${tab.screen}-score`, {
          body: JSON.stringify(
            { score, shifts: describeShifts(snapshot.shifts, 0) },
            null,
            2
          ),
          contentType: 'application/json',
        })

        expect(
          snapshot.frames.some((frame) => frame.visible.includes('screen-placeholder')),
          'a signed-out visitor never sees the member placeholder'
        ).toBe(false)
        expect(session).toBe('none')
        expect(score, describeShifts(snapshot.shifts, 0).join('\n')).toBeLessThanOrEqual(
          BUDGET
        )
      } finally {
        await context.close()
      }
    })

    test(`[P0] member ${tab.screen} cold load shows no signed-out content and stays within ${BUDGET}`, async ({
      browser,
      prodMember,
    }, testInfo) => {
      test.skip(
        !prodMember,
        'The synthetic member exists only in the production project.'
      )
      const { baseUrl: webBaseUrl, apiBaseUrl } = projectMetadata(testInfo)
      assertTrustedProdOrigins(webBaseUrl!, apiBaseUrl!)
      const context = await readOnlyContext(browser, webBaseUrl!, prodMember)
      try {
        const { snapshot, session } = await measureColdLoad(context, tab)
        const score = shiftScore(snapshot.shifts, 0)
        await testInfo.attach(`member-${tab.screen}-score`, {
          body: JSON.stringify(
            { score, shifts: describeShifts(snapshot.shifts, 0) },
            null,
            2
          ),
          contentType: 'application/json',
        })

        expect(session, 'the stored session resolved to the member').toBe('member')
        expect(
          sightings(snapshot.frames, SIGNED_OUT_CONTENT, 0),
          'a member never sees signed-out content, before or after the screen is ready'
        ).toEqual({})
        expect(
          sightingsBeforeReady(snapshot.frames, ['member-sample-outfit'], tab.screen, 0),
          'the member sample outfit appears only after the ritual read settles'
        ).toEqual({})
        expect(score, describeShifts(snapshot.shifts, 0).join('\n')).toBeLessThanOrEqual(
          BUDGET
        )
      } finally {
        await context.close()
      }
    })
  }
})
