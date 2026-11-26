import type { Page, Request, Route } from '@playwright/test'
import {
  communityEventsResponseSchema,
  communityReactionFeedResponseSchema,
  communityReactionSpotlightResponseSchema,
  listSavedLocationsResponseSchema,
  resolveCommunityTargetsResponseSchema,
  ritualResponseSchema,
  userProfileResponseSchema,
  wardrobeOnboardingStateResponseSchema,
  type ResolveCommunityTargetsInput,
} from '@couture/api-client/contracts/http'

/**
 * Story CC-7.7 (AC5, spec D7): fixed responses for every API call the four signed-in web tabs
 * make on mount, for playwright/tests/signed-in-shell-layout-shift.spec.ts. Bodies follow the
 * strict client parsers (copied from jade-first-use.spec.ts, home-ritual.test.tsx and the web MSW
 * handlers) and the ones with a published schema are parsed here, so a contract change fails
 * the fixture with the schema's message instead of a shift score.
 *
 * Modes:
 *   empty      every read answers its empty state (ritual: the no-city 400 Home turns into setup)
 *   populated  every read answers one or more items
 *   delayed    populated, every stubbed content read answers after DELAY_MS
 *   late       populated, the active screen's gate reads answer at once, every other content
 *              read after DELAY_MS (AC3: the late sections land after the first tap)
 *   The Community sync channel (`community/events`, `community/targets/resolve`) answers after
 *   SYNC_DELAY_MS in both slow modes: past its own ~2 s deadline the feed hides as an outage,
 *   which is not what these modes measure.
 *   ritual-503 populated, the ritual read answers 503 (the matrix's "Ritual fails" row)
 */
export type ShellMode = 'empty' | 'populated' | 'delayed' | 'late' | 'ritual-503'
export type ShellScreen = 'home' | 'closet' | 'community' | 'profile'

export const DELAY_MS = 3000
/** The Community sync channel's slow answer: late, and half its ~2 s deadline. */
export const SYNC_DELAY_MS = 1000

/** Text the Home outfit renders for one member, so a test can tell two members apart. */
export const ownerMarker = (memberId: string) => `comfort note for ${memberId}`
export const POPULATED_GARMENTS = 24

const iso = '2026-11-20T12:00:00.000Z'
const pixel =
  'data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20viewBox=%220%200%201%201%22%3E%3Cpath%20d=%22M0%200h1v1H0z%22%20fill=%22blue%22/%3E%3C/svg%3E'

/** The read each request is, by path and the query that tells same-path reads apart. */
export function readKey(url: string, method: string) {
  const { pathname, searchParams } = new URL(url)
  const path = pathname.replace(/^.*\/api\/v1\//, '')
  if (method === 'POST' && path === 'community/targets/resolve')
    return 'community-resolve'
  if (method !== 'GET') return null
  if (path === 'community/spotlight')
    return searchParams.get('surface') === 'home_teaser'
      ? 'home-teaser'
      : 'community-spotlight'
  const known: Record<string, string> = {
    ritual: 'ritual',
    locations: 'locations',
    'wardrobe/saved-looks': 'saved-looks',
    'events/poll': 'events-poll',
    'community/feed': 'community-feed',
    'community/events': 'community-events',
    'user/profile': 'profile',
    'wardrobe/onboarding': 'onboarding',
    'wardrobe/garments': 'garments',
    'commerce/preferences': 'commerce-preferences',
    'commerce/subscription': 'subscription',
    'commerce/premium/access': 'premium-access',
    'commerce/premium/theme': 'premium-theme',
  }
  return known[path] ?? null
}

/**
 * Spec D3 (as built, 2026-11-25): the reads each screen's gate waits for. Home waits for the
 * City Spotlight page one because it sits above the Home feed (D4); the teaser read happens only
 * while stacked, which 390 px always is. Closet waits for the first saved-looks page because its
 * row sits above the grid.
 */
export const GATE_READS: Record<ShellScreen, string[]> = {
  // The ritual read counts as settled only once its city line (`locations`) answered too.
  home: ['ritual', 'locations', 'home-teaser', 'community-spotlight'],
  closet: ['profile', 'onboarding', 'garments', 'saved-looks'],
  community: ['community-feed', 'community-spotlight'],
  // The account header's profile read shares the session check, so it is not a gate read.
  profile: [
    'locations',
    'commerce-preferences',
    'subscription',
    'premium-access',
    'premium-theme',
  ],
}

/** The body, after the published schema accepts it. */
function checked<T>(schema: { parse(value: unknown): unknown }, body: T): T {
  schema.parse(body)
  return body
}

function feedItem(id: string, title: string) {
  return {
    id,
    title,
    caption: `${title}, for a cool day.`,
    altText: `Illustration of ${title.toLowerCase()}.`,
    climateBand: 'temperate_dry',
    status: 'published',
    challengeId: null,
    author: { isSelf: false, displayName: 'Fixture neighbor' },
    publishedAt: iso,
    createdAt: iso,
    imageAccess: { url: pixel, expiresAt: '2099-12-31T00:00:00.000Z' },
    // The web always asks for reaction summaries (x-couture-reactions: 1), and the API sends one
    // on every item. Without it the client reads reactions as off and drops the bars, so a
    // refresh without them shrank the cards it replaced (CI E2E-013, 3d4b5c96).
    reactions: {
      counts: { applause: 0, love: 0, inspiration: 0 },
      total: 0,
      viewerReaction: null,
      revision: 0,
      generation: 0,
    },
  }
}

function bodies(memberId: string, populated: boolean) {
  const feedItems = populated
    ? [feedItem('shell-look-1', 'Blue layers'), feedItem('shell-look-2', 'Rain shell')]
    : []
  const feedPage = {
    items: feedItems,
    authorStates: [],
    nextCursor: null,
    mode: 'auto',
    viewerBand: 'temperate_dry',
    bandResolved: true,
    bandUnresolvedReason: null,
    experimentVariant: 'auto',
    activeChallenge: null,
  }
  const spotlight = populated
    ? {
        level: 'city',
        label: 'Chicago',
        items: [{ ...feedItem('shell-spot-1', 'Spotlight look'), rank: 1 }],
        nextCursor: null,
      }
    : { level: 'none', label: null, items: [], nextCursor: null }
  const ritual = {
    data: {
      weather: {
        locationKey: 'chicago',
        latitude: 41.88,
        longitude: -87.63,
        timezone: 'America/Chicago',
        provider: 'openweather',
        providerUpdatedAt: iso,
        fetchedAt: iso,
        current: { temperature: 21, condition: 'clear' },
        hourly: Array.from({ length: 48 }, (_, hour) => ({
          forecastAt: new Date(Date.parse(iso) + hour * 3_600_000).toISOString(),
          temperature: 21,
          feelsLike: 20,
          precipitationProbability: 0,
          precipitationAmount: 0,
          windSpeed: 4,
          windGust: null,
          condition: 'clear',
          providerWeatherCode: '800',
        })),
        alerts: [],
      },
      outfits: (['morning', 'midday', 'evening'] as const).map((scenario) => ({
        id: `${scenario}-recommendation`,
        scenario,
        garmentIds: ['shell-garment-1'],
        displayGarments: [{ id: 'shell-garment-1', category: 'top' }],
        reasoningBadges: [],
        comfortNotes: `${scenario} ${ownerMarker(memberId)}`,
        shopThisLook: null,
      })),
      badges: [],
    },
  }
  const location = {
    id: 'shell-home',
    label: 'Chicago home',
    locationKey: 'chicago',
    latitude: 41.88,
    longitude: -87.63,
    timezone: 'America/Chicago',
    city: 'Chicago',
    region: 'Illinois',
    country: 'US',
    isPrimary: true,
    sortOrder: 0,
    createdAt: iso,
    updatedAt: iso,
  }
  const savedLook = {
    id: 'shell-saved-look-1',
    ownerUserId: memberId,
    source: 'home_sample',
    lookId: 'office-oxford',
    weather: 'mild-dry',
    title: null,
    anchorGarmentId: null,
    anchorSnapshot: null,
    composition: [
      ['top', 'oxford-shirt'],
      ['bottom', 'dark-jeans'],
      ['shoes', 'loafers'],
    ].map(([category, itemId], slotIndex) => ({
      slotIndex,
      category,
      kind: 'catalog',
      itemId,
      label: null,
      missing: false,
      imageAccess: null,
    })),
    swaps: {},
    collection: 'all',
    comfort: {
      runsColdWarm: 'neutral',
      windTolerance: 'medium',
      precipPreparedness: 'medium',
    },
    availabilityStatus: 'ready',
    missingGarmentIds: [],
    needsReviewReasons: [],
    revision: 0,
    createdAt: iso,
    updatedAt: iso,
  }
  const garment = (index: number) => ({
    id: `shell-garment-${index + 1}`,
    status: 'ready',
    category: ['top', 'bottom', 'outerwear', 'shoes'][index % 4],
    material: 'cotton',
    comfortRange: 'mild',
    tagsConfirmedAt: iso,
    fileSizeBytes: 1024,
    mimeType: 'image/png',
    retentionStatus: 'active',
    createdAt: iso,
    committedAt: iso,
    // CC-7.9 snapshots: a populated closet shows its photos. Inline, so nothing loads late.
    imageAccess: { url: pixel, expiresAt: '2099-12-31T00:00:00.000Z' },
  })

  const profile = {
    user: {
      id: memberId,
      email: 'shell-member@example.test',
      displayName: null,
      birthdate: null,
      role: 'guardian',
    },
    linkedGuardians: [],
    linkedTeens: [],
  }
  const onboarding = populated
    ? {
        status: 'completed',
        currentStep: 'complete',
        usedStarterWardrobe: false,
        garmentsCapturedCount: POPULATED_GARMENTS,
        startedAt: iso,
        completedAt: iso,
        revision: 4,
      }
    : {
        status: 'not_started',
        currentStep: 'permission',
        usedStarterWardrobe: false,
        garmentsCapturedCount: 0,
        startedAt: null,
        completedAt: null,
        revision: 0,
      }
  const subscription = populated
    ? {
        status: 'active',
        store: 'stripe',
        productId: 'premium_monthly',
        willRenew: true,
        currentPeriodEnd: '2099-12-12T00:00:00.000Z',
        syncedAt: iso,
        purchasesEnabled: true,
      }
    : {
        status: 'none',
        store: null,
        productId: null,
        willRenew: null,
        currentPeriodEnd: null,
        syncedAt: null,
        purchasesEnabled: true,
      }

  const json: Record<string, unknown> = {
    ritual: checked(ritualResponseSchema, ritual),
    locations: checked(listSavedLocationsResponseSchema, {
      data: populated ? [location] : [],
    }),
    'saved-looks': {
      data: populated ? [savedLook] : [],
      total: populated ? 1 : 0,
      limit: 50,
      offset: 0,
    },
    'events-poll': { events: [], nextSince: null },
    'community-feed': checked(communityReactionFeedResponseSchema, { data: feedPage }),
    'community-spotlight': checked(communityReactionSpotlightResponseSchema, {
      data: spotlight,
    }),
    'home-teaser': { data: spotlight },
    'community-events': checked(communityEventsResponseSchema, {
      data: { events: [], nextCursor: 'fixture', hasMore: false, resyncRequired: false },
    }),
    profile: checked(userProfileResponseSchema, profile),
    onboarding: checked(wardrobeOnboardingStateResponseSchema, { data: onboarding }),
    garments: {
      data: populated
        ? Array.from({ length: POPULATED_GARMENTS }, (_, i) => garment(i))
        : [],
    },
    'commerce-preferences': { data: { affiliateCtasEnabled: true } },
    subscription: { data: subscription },
    'premium-access': {
      data: populated
        ? { premium: true, source: 'subscription' }
        : { premium: false, source: 'none' },
    },
    'premium-theme': {
      data: { theme: null, isEntitled: populated, themesEnabled: true },
    },
  }

  const resolve = (request: Request) => {
    const { targets } = request.postDataJSON() as ResolveCommunityTargetsInput
    const posts = new Map(
      [...feedItems, ...spotlight.items].map((item) => [item.id, item] as const)
    )
    const body = {
      data: {
        // Looked up by postId; the caller's correlation key only travels back (CodeRabbit r1 #21).
        targets: targets.map(({ key, postId }) => {
          const post = posts.get(postId)
          if (!post) return { key, status: 'unavailable' }
          return {
            key,
            status: 'available',
            communityRevision: '0',
            post: feedItem(post.id, post.title),
            comment: null,
            parent: null,
            pageCursor: null,
            parentPageCursor: null,
            threadPosition: null,
          }
        }),
      },
    }
    return checked(resolveCommunityTargetsResponseSchema, body)
  }

  return { json, resolve }
}

/** The `sub` of a local fixture bearer (local-e2e-token.ts), or null for any other header. */
export function fixtureOwner(authorization: string | undefined) {
  const token = authorization?.replace(/^Bearer\s+/i, '') ?? ''
  const [prefix, claims] = token.split('.')
  if (prefix !== 'test-token' || !claims) return null
  try {
    const { sub } = JSON.parse(Buffer.from(claims, 'base64url').toString('utf8')) as {
      sub?: unknown
    }
    return typeof sub === 'string' ? sub : null
  } catch {
    return null
  }
}

const NO_CITY = {
  statusCode: 400,
  message: 'No location preferences found for user',
  error: 'Bad Request',
}

/**
 * Serves every known read for `screen` in `mode`, counts the ones in flight for the settle rule,
 * and records every other `/api/v1` request so the spec can fail by name when a tab starts a
 * read this router does not know (it falls through to the local API, where a fixture member
 * has no rows).
 */
export function createShellRouter(options: {
  mode: ShellMode
  screen: () => ShellScreen
  /**
   * A member run: a stubbed read without a fixture bearer answers 401 instead of member data,
   * so a member who lost the bearer cannot pass on fixture content (Codex P2-10). A signed-out
   * run lets bearer-less reads through to the local API, as a visitor's would go.
   */
  requireBearer: boolean
  /** Extra delay for named reads, on top of the mode's (the stored-session case holds `profile`). */
  hold?: Partial<Record<string, number>>
}) {
  const { mode } = options
  const populated = mode !== 'empty'
  // Bodies follow the bearer each request carries, so a member switch inside one document
  // (7.7-E2E-009) gets the new member's content and the old member's text tells a leak apart.
  const bodiesByOwner = new Map<string, ReturnType<typeof bodies>>()
  const bodiesFor = (request: Request) => {
    // Only reached with a fixture bearer (the handler refuses the rest), so no fallback owner.
    const owner = fixtureOwner(request.headers()['authorization'])!
    if (!bodiesByOwner.has(owner)) bodiesByOwner.set(owner, bodies(owner, populated))
    return bodiesByOwner.get(owner)!
  }
  let open = 0
  const calls = new Map<string, number>()
  const unknown = new Set<string>()
  const unauthenticated = new Set<string>()
  /** Reads held by the test until it releases them (`hold(key)`). */
  const gates = new Map<string, Promise<void>>()

  const delayFor = (key: string) => {
    const held = options.hold?.[key] ?? 0
    // The Community sync channel (events and the target resolve) gives up on a read after about
    // 2 s, then hides the feed as an outage and bootstraps again (CI traces: events aborted at
    // 1996 ms on 3d4b5c96, resolve at 2000 ms on 330e6966, after which the rebuild loop kept a
    // read in flight for good). Past that deadline these modes would measure an outage, not slow
    // content, so the sync answers late but inside it.
    if (key === 'community-events' || key === 'community-resolve')
      return held + (mode === 'delayed' || mode === 'late' ? SYNC_DELAY_MS : 0)
    if (mode === 'delayed') return DELAY_MS + held
    if (mode === 'late' && !GATE_READS[options.screen()].includes(key))
      return DELAY_MS + held
    return held
  }

  const handler = async (route: Route, request: Request) => {
    const key = readKey(request.url(), request.method())
    if (key === null) {
      unknown.add(`${request.method()} ${new URL(request.url()).pathname}`)
      await route.fallback()
      return
    }
    if (fixtureOwner(request.headers()['authorization']) === null) {
      if (options.requireBearer) {
        unauthenticated.add(`${request.method()} ${new URL(request.url()).pathname}`)
        await route.fulfill({
          status: 401,
          json: { statusCode: 401, message: 'Unauthorized' },
        })
      } else {
        await route.fallback()
      }
      return
    }
    calls.set(key, (calls.get(key) ?? 0) + 1)
    open += 1
    try {
      const gate = gates.get(key)
      if (gate) await gate
      const delay = delayFor(key)
      if (delay > 0) await new Promise((resolveDelay) => setTimeout(resolveDelay, delay))
      const { json, resolve } = bodiesFor(request)
      if (key === 'community-resolve') {
        await route.fulfill({ json: resolve(request) })
      } else if (key === 'ritual' && mode === 'empty') {
        await route.fulfill({ status: 400, json: NO_CITY })
      } else if (key === 'ritual' && mode === 'ritual-503') {
        await route.fulfill({
          status: 503,
          json: { statusCode: 503, message: 'Unavailable' },
        })
      } else if (key === 'community-feed') {
        // The page names the filter it was asked for, as the API does.
        const feed = json[key] as { data: Record<string, unknown> }
        const requested = new URL(request.url()).searchParams.get('mode') ?? 'auto'
        await route.fulfill({ json: { data: { ...feed.data, mode: requested } } })
      } else {
        await route.fulfill({ json: json[key] })
      }
    } catch {
      // The page closed or navigated while the stub waited: nothing to answer.
    } finally {
      open -= 1
    }
  }

  return {
    handler,
    inflight: () => open,
    calls: (key: string) => calls.get(key) ?? 0,
    /**
     * Holds every `key` read from now on, sent or not yet sent, until the returned release runs:
     * a test decides when a read answers instead of guessing with a delay.
     */
    hold: (key: string) => {
      let release = () => undefined as void
      gates.set(
        key,
        new Promise<void>((resolve) => {
          release = () => {
            gates.delete(key)
            resolve()
          }
        })
      )
      return () => release()
    },
    unknown: () => [...unknown].sort(),
    /** Member reads that arrived without a fixture bearer and were refused. */
    unauthenticated: () => [...unauthenticated].sort(),
  }
}

/**
 * Keeps the community realtime socket from reaching the local API, where a fixture member has no
 * profile and the socket answers `denied`. A closed socket leaves the grid on events polling,
 * the state a member with a flaky connection sees.
 */
export async function closeCommunitySocket(page: Page) {
  await page.routeWebSocket('**/api/realtime**', (socket) => socket.close())
}
