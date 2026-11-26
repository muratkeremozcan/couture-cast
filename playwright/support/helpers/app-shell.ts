// Learning path Step 66: One app shell and visual system.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-66-one-app-shell-and-visual-system
// Story CC-7.9 test owner (TEA). Test design:
// _bmad-output/test-artifacts/test-design-7-9-one-app-shell-visual-system.md.
//
// Shared setup and computed-style probes for the shell spec (app-shell-visual-system.spec.ts) and
// the snapshot spec (app-shell-visual-snapshots.spec.ts). The probes read what the browser
// painted, never class names: a migrated class that emits no CSS shows up here as the colour it
// fell back to.
// Story CC-7.12 (Step 69): the capsules list fallback route moved into the shell router.
import { colorRoles, hexToChannels } from '@couture/utils'
import { expect, type Page } from '@playwright/test'
import type { InterceptNetworkCallFn } from '@seontechnologies/playwright-utils/intercept-network-call'
import { seedWebSession } from './commerce-session'
import { localE2EAccessToken } from './local-e2e-token'
import { placeholderContrastFailures, textContrastFailures } from './painted-contrast'
import {
  closeCommunitySocket,
  createShellRouter,
  type ShellMode,
  type ShellScreen,
} from './shell-fixtures'

export const SHELL_TABS: Record<
  ShellScreen,
  { path: string; nav: string; title: RegExp }
> = {
  // Story CC-7.11 D1: Today, Closet, Looks, Community, Profile; routes and test ids stay.
  home: { path: '/', nav: 'bottom-nav-home', title: /^Today$/ },
  closet: { path: '/wardrobe', nav: 'bottom-nav-wardrobe', title: /^Closet$/ },
  looks: { path: '/looks', nav: 'bottom-nav-looks', title: /^Looks$/ },
  community: { path: '/community', nav: 'bottom-nav-community', title: /^Community$/ },
  profile: { path: '/settings', nav: 'bottom-nav-settings', title: /^Profile$/ },
}
export const SHELL_SCREENS = Object.keys(SHELL_TABS) as ShellScreen[]
export const SCHEMES = ['light', 'dark'] as const
export type Scheme = (typeof SCHEMES)[number]

/** Before the real clock, so the fixture bearer (real now + 12 h) never reads as expired. */
export const FIXED_NOW = new Date('2026-11-20T15:00:00.000Z')
/** A fixed member, so every member-named string in a snapshot is the same on every run. */
export const VISUAL_MEMBER_ID = 'shell-visual-member'

/**
 * Serves every tab read from the CC-7.7 shell fixtures for one fixture member and signs the
 * browser in with that member's bearer. Declared before navigation.
 */
export async function openFixtureShell(
  page: Page,
  interceptNetworkCall: InterceptNetworkCallFn,
  options: {
    mode: ShellMode
    screen: ShellScreen
    memberId?: string
    /**
     * A returning member's stored session that the app still has to verify (`pending`, CC-7.7
     * D1), instead of the fixture bearer that is a member at first paint.
     */
    storedSession?: boolean
  }
) {
  let active = options.screen
  const memberId = options.memberId ?? VISUAL_MEMBER_ID
  const router = createShellRouter({
    mode: options.mode,
    screen: () => active,
    requireBearer: true,
  })
  // Story CC-7.12 (Step 69): the capsules list is a shell read now (Looks merges it into Saved,
  // and /looks/capsules reads it), so the router serves it and its own fallback route is gone.
  void interceptNetworkCall({ url: '**/api/v1/**', handler: router.handler })
  await closeCommunitySocket(page)
  if (options.storedSession) await seedStoredSession(page, memberId)
  // CC-7.10 D1: the guardian-pending member signs in with a teen bearer, as the API reads it.
  else
    await seedWebSession(
      page,
      localE2EAccessToken(
        memberId,
        options.mode === 'guardian-pending' ? 'teen' : 'guardian'
      )
    )
  return {
    router,
    setScreen: (screen: ShellScreen) => {
      active = screen
    },
  }
}

/**
 * A stored Supabase session in this browser and no verified bearer yet, as in the CC-7.7
 * layout-shift spec: the profile read verifies it against the fixtures. It expires in an hour,
 * so no refresh call leaves the browser.
 */
async function seedStoredSession(page: Page, memberId: string) {
  const now = Math.floor(Date.now() / 1000)
  const session = {
    access_token: localE2EAccessToken(memberId),
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: now + 3600,
    refresh_token: `shell-refresh-${memberId}`,
    user: {
      id: memberId,
      aud: 'authenticated',
      role: 'authenticated',
      email: 'shell-member@example.test',
      app_metadata: {},
      user_metadata: {},
      created_at: '2026-11-20T12:00:00.000Z',
    },
  }
  await page.addInitScript(
    ({ key, value }) => {
      if (window.location.origin !== 'null') window.localStorage.setItem(key, value)
    },
    { key: 'couturecast.auth-session', value: JSON.stringify(session) }
  )
}

/** The screen's CC-7.7 gate has opened and no fixture read is still in flight. */
export async function waitForShellSettled(
  page: Page,
  router: ReturnType<typeof createShellRouter>
) {
  await page.locator('[data-testid="screen-gate"][data-ready="true"]').first().waitFor()
  await expect
    .poll(() => router.inflight(), { message: 'fixture reads in flight' })
    .toBe(0)
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
}

/** `--cc-*` custom properties on the root, as `r g b` channel triples (spec Design Notes). */
export function tokenTriples(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => {
    const style = getComputedStyle(document.documentElement)
    const out: Record<string, string> = {}
    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList
      try {
        rules = sheet.cssRules
      } catch {
        continue
      }
      const walk = (list: CSSRuleList) => {
        for (const rule of Array.from(list)) {
          if ('cssRules' in rule && (rule as CSSGroupingRule).cssRules)
            walk((rule as CSSGroupingRule).cssRules)
          if (!('style' in rule)) continue
          const declared = (rule as CSSStyleRule).style
          for (let index = 0; index < declared.length; index += 1) {
            const name = declared.item(index)
            if (name.startsWith('--cc-')) out[name] = style.getPropertyValue(name).trim()
          }
        }
      }
      walk(rules)
    }
    return out
  })
}

export const GOLD_ROLES = [
  '--cc-primary',
  '--cc-focus',
  '--cc-tab-active',
  '--cc-premium',
  '--cc-premium-ink',
]

export type PaintFinding = { node: string; property: string; value: string }

/**
 * Every painted colour on visible elements, checked two ways (7.9-E2E-003 and E2E-006), against
 * the `--cc-*` names in `roles` resolved in the element's own palette scope:
 * - `offRole`: the channels match no `--cc-*` role in the current scheme;
 * - `strayGold`: the channels match a gold role on an element with no `data-gold` on itself or
 *   an ancestor.
 * Outline colour is skipped on the focused element (the focus ring is gold by design and has its
 * own check), and SVG `fill`/`stroke` are read only when they are not `none`.
 */
export function paintFindings(
  page: Page,
  roles: Record<string, string>
): Promise<{ offRole: PaintFinding[]; strayGold: PaintFinding[] }> {
  return page.evaluate(
    ({ roles, goldRoles }) => {
      const channels = (value: string) => {
        const match = value.match(
          /rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)(?:[ ,/]+([\d.]+))?\s*\)/
        )
        if (!match) return null
        const alpha = match[4] === undefined ? 1 : Number(match[4])
        if (alpha === 0) return null
        return `${match[1]} ${match[2]} ${match[3]}`
      }
      const normal = (triple: string) => triple.replace(/\s+/g, ' ').trim()
      // A premium palette scope (`[data-theme]`) redefines the roles for its subtree, so each
      // element is checked against the role values where it sits (Codex P2-4).
      const scopes = new Map<Element, { roleChannels: Set<string>; gold: Set<string> }>()
      const scopeOf = (element: Element) => {
        const scope = element.closest('[data-theme]') ?? document.documentElement
        let values = scopes.get(scope)
        if (!values) {
          const style = getComputedStyle(scope)
          const read = (name: string) => normal(style.getPropertyValue(name))
          values = {
            roleChannels: new Set(Object.keys(roles).map(read).filter(Boolean)),
            gold: new Set(goldRoles.map(read).filter(Boolean)),
          }
          scopes.set(scope, values)
        }
        return values
      }
      const describe = (element: Element) => {
        const id = element.getAttribute('data-testid')
        const text = (element.textContent ?? '').trim().slice(0, 40)
        return `${element.tagName.toLowerCase()}${id ? `[data-testid=${id}]` : ''} "${text}"`
      }
      const offRole: { node: string; property: string; value: string }[] = []
      const strayGold: { node: string; property: string; value: string }[] = []
      const painted = (element: Element): [string, string][] => {
        const style = getComputedStyle(element)
        if (style.visibility === 'hidden' || style.display === 'none') return []
        const properties: [string, string][] = [
          ['color', style.color],
          ['background-color', style.backgroundColor],
        ]
        for (const side of ['top', 'right', 'bottom', 'left'])
          if (parseFloat(style.getPropertyValue(`border-${side}-width`)) > 0)
            properties.push([
              `border-${side}-color`,
              style.getPropertyValue(`border-${side}-color`),
            ])
        if (element !== document.activeElement && parseFloat(style.outlineWidth) > 0)
          properties.push(['outline-color', style.outlineColor])
        if (element instanceof SVGElement) {
          if (style.fill !== 'none') properties.push(['fill', style.fill])
          if (style.stroke !== 'none') properties.push(['stroke', style.stroke])
        }
        return properties
      }
      for (const element of Array.from(document.body.querySelectorAll('*'))) {
        const rect = element.getBoundingClientRect()
        if (rect.width === 0 || rect.height === 0) continue
        // Story CC-7.12 (Step 69): a sample garment illustration paints the garment's own colours,
        // which are content like a photo's pixels, never chrome. Its frame and text stay checked.
        if (
          element instanceof SVGElement &&
          element.closest('[data-testid="sample-garment-art"]')
        )
          continue
        const properties = painted(element)
        const allowedGold = element.closest('[data-gold]') !== null
        const { roleChannels, gold } = scopeOf(element)
        for (const [property, value] of properties) {
          const triple = channels(value)
          if (!triple) continue
          if (!roleChannels.has(triple))
            offRole.push({ node: describe(element), property, value })
          if (gold.has(triple) && !allowedGold)
            strayGold.push({ node: describe(element), property, value })
        }
      }
      return { offRole, strayGold }
    },
    { roles, goldRoles: GOLD_ROLES }
  )
}

/**
 * The surface structure (7.9-E2E-002, E2E-004): page surfaces, cards inside cards, and large
 * light fills in dark mode (the inset lookbook card the spec removes).
 */
export function surfaceFindings(page: Page) {
  return page.evaluate(() => {
    const describe = (element: Element) =>
      `${element.tagName.toLowerCase()}[data-testid=${element.getAttribute('data-testid') ?? '-'}]`
    const pages = Array.from(document.querySelectorAll('[data-surface="page"]')).filter(
      (element) => element.getBoundingClientRect().height > 0
    )
    const nestedCards = Array.from(document.querySelectorAll('[data-surface="card"]'))
      .filter((card) => card.parentElement?.closest('[data-surface="card"]'))
      .map(describe)
    const viewport = window.innerWidth * window.innerHeight
    const luminance = (value: string) => {
      const match = value.match(/rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)(?:[ ,/]+([\d.]+))?/)
      if (!match || (match[4] !== undefined && Number(match[4]) === 0)) return null
      const [r = 0, g = 0, b = 0] = [match[1], match[2], match[3]].map((channel) => {
        const c = Number(channel) / 255
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
      })
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    const largeLightFills = Array.from(document.body.querySelectorAll('*'))
      .filter((element) => {
        const rect = element.getBoundingClientRect()
        const visible =
          Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0)) *
          Math.max(0, Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0))
        if (visible < viewport * 0.4) return false
        const lum = luminance(getComputedStyle(element).backgroundColor)
        return lum !== null && lum > 0.5
      })
      .map(describe)
    const gradients = Array.from(document.body.querySelectorAll('*'))
      .filter((element) => getComputedStyle(element).backgroundImage.includes('gradient'))
      .filter((element) => {
        const rect = element.getBoundingClientRect()
        return rect.width * rect.height >= viewport * 0.4
      })
      .map(describe)
    return {
      pageCount: pages.length,
      pageBackground: pages[0] ? getComputedStyle(pages[0]).backgroundColor : null,
      bodyBackground: getComputedStyle(document.body).backgroundColor,
      nestedCards,
      largeLightFills,
      gradients,
    }
  })
}

/** `r g b` triple to the `rgb(r, g, b)` string the browser reports. */
export const rgbOf = (triple: string) => `rgb(${triple.trim().split(/\s+/).join(', ')})`

/** A role's colour as the browser reports it, read from the one token source (spec D1, D2). */
export const roleRgb = (scheme: Scheme, role: keyof (typeof colorRoles)['light']) =>
  rgbOf(hexToChannels(colorRoles[scheme][role]))

/**
 * Lets the painted-contrast probe measure text under a stretched-link overlay: a link or button
 * with no fill of its own, laid over a whole tile (garment-open, spotlight-lookbook-open) so the
 * tile is one tap target. Its own label (a "View look" pill) may sit inside it. During the scan
 * the overlay stops taking hit tests and its children keep theirs, so the badges under it and
 * the pill inside it are each measured where they paint. The tile's own image paints under its
 * badges, so it stops taking hit tests too: a badge whose row is pointer-events none would
 * otherwise hit the photo beneath it and be refused as covered (CI 7c284e60, spotlight tile).
 * A sticky bar or anything with a fill still covers and still fails the probe.
 */
export async function measureThroughOverlays(page: Page) {
  await page.evaluate(() => {
    for (const control of Array.from(document.querySelectorAll('a, button'))) {
      const style = getComputedStyle(control)
      const parent = control.parentElement
      if (!parent || style.position !== 'absolute') continue
      const own = control.getBoundingClientRect()
      const host = parent.getBoundingClientRect()
      const covers = own.width * own.height >= host.width * host.height * 0.9
      const transparent = /rgba\(0, 0, 0, 0\)|transparent/.test(style.backgroundColor)
      if (!covers || !transparent) continue
      ;(control as HTMLElement).style.setProperty('pointer-events', 'none', 'important')
      for (const child of Array.from(control.children))
        (child as HTMLElement).style.setProperty('pointer-events', 'auto', 'important')
      for (const media of Array.from(parent.querySelectorAll('img, picture, video')))
        (media as HTMLElement).style.setProperty('pointer-events', 'none', 'important')
    }
  })
}

export const TOP_BAR_HEIGHT = 56

export async function expectOneTopBar(page: Page, label: string) {
  const header = page.getByTestId('app-header')
  await expect(header, label).toHaveCount(1)
  const box = await header.boundingBox()
  expect(box?.height, `${label}: top bar height`).toBe(TOP_BAR_HEIGHT)
  // One row: every visible child sits inside the bar's 56 px.
  const overflow = await header.evaluate((bar) => {
    const top = bar.getBoundingClientRect().top
    return Array.from(bar.querySelectorAll('*'))
      .map((child) => child.getBoundingClientRect())
      .filter(
        (rect) => rect.height > 0 && (rect.top < top - 0.5 || rect.bottom > top + 56.5)
      ).length
  })
  expect(overflow, `${label}: top bar children outside one 56 px row`).toBe(0)
  await expect(header.locator('h1'), `${label}: one h1 title`).toHaveCount(1)
  await expect(header.locator('h1'), `${label}: title text`).not.toBeEmpty()
}

export async function expectOneSurface(page: Page, label: string) {
  const roles = await tokenTriples(page)
  const surface = await surfaceFindings(page)
  expect(surface.pageCount, `${label}: page surfaces`).toBe(1)
  expect(surface.pageBackground, `${label}: page surface colour`).toBe(
    rgbOf(roles['--cc-page'] ?? '')
  )
  expect(surface.nestedCards, `${label}: cards inside cards`).toEqual([])
  return surface
}

/**
 * 7.9-E2E-001..006 for one tab in one scheme: the top bar, one page surface, token colours, gold
 * only by role, and painted contrast of every text run. The two scheme spec files call it, one
 * file per scheme so the burn-in shards can spread the full-page scans (CI 46f09ae8: in one file
 * they filled a 20-minute burn-in shard).
 */
export async function checkShellTab(
  page: Page,
  interceptNetworkCall: InterceptNetworkCallFn,
  screen: ShellScreen,
  scheme: 'light' | 'dark'
) {
  await page.emulateMedia({ colorScheme: scheme })
  const { router } = await openFixtureShell(page, interceptNetworkCall, {
    mode: 'populated',
    screen,
  })
  await page.goto(SHELL_TABS[screen].path)
  await waitForShellSettled(page, router)
  await expect(page.locator('html')).toHaveAttribute('data-session', 'member')

  // E2E-001: the bar, with the tab label as its title (D6).
  await expectOneTopBar(page, screen)
  await expect(page.getByTestId('app-header').locator('h1')).toHaveText(
    SHELL_TABS[screen].title
  )

  // E2E-002 and E2E-004: one page surface, one card level; no inset light card in dark.
  const surface = await expectOneSurface(page, `${screen} ${scheme}`)
  if (scheme === 'dark') {
    expect(surface.largeLightFills, 'light fills over 40% of the screen').toEqual([])
    expect(surface.gradients, 'page-sized gradients').toEqual([])
  }

  // E2E-003 and E2E-006: every painted colour is a role; gold only where data-gold says.
  const roles = await tokenTriples(page)
  expect(Object.keys(roles).length, 'emitted --cc-* roles').toBeGreaterThan(10)
  const paint = await paintFindings(page, roles)
  expect(paint.offRole, 'colours that are not a token role').toEqual([])
  expect(
    paint.strayGold,
    'gold outside the primary action, focus, tab and Premium'
  ).toEqual([])

  // E2E-005: painted contrast in this scheme. Empty fields (Profile's city search) are
  // measured by their placeholder first, then hold a typed value for the text scan; the
  // value is set on the element only, so no search request starts.
  const main = page.locator('main').first()
  expect(await placeholderContrastFailures(main), 'placeholders').toEqual([])
  await main.evaluate((root) => {
    // Text-like fields only: a file, checkbox or range input holds no typed value.
    const textLike =
      'textarea, input:not([type]), input[type="text"], input[type="search"], input[type="email"], input[type="tel"], input[type="url"], input[type="number"]'
    for (const field of Array.from(root.querySelectorAll(textLike))) {
      const input = field as HTMLInputElement
      const rect = input.getBoundingClientRect()
      if (rect.width > 0 && !input.value && !input.disabled && input.type !== 'hidden')
        input.value = 'Chicago'
    }
  })
  await measureThroughOverlays(page)
  expect(await textContrastFailures(main)).toEqual([])
}
