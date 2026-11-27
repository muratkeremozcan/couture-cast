import type { Page, Request, Route } from '@playwright/test'
import {
  communityCommentsResponseSchema,
  communityCommentSubmissionsResponseSchema,
  communityEventsResponseSchema,
  communityFeedModeSchema,
  communityNotificationPreferencesResponseSchema,
  communityReactionFeedResponseSchema,
  communityReactionSpotlightResponseSchema,
  garmentListResponseSchema,
  listSavedLocationsResponseSchema,
  outfitCapsuleListResponseSchema,
  plannerResponseSchema,
  resolveCommunityTargetsResponseSchema,
  ritualResponseSchema,
  savedLookListResponseSchema,
  savedLookResponseSchema,
  silhouetteProfileResponseSchema,
  styleProfileResponseSchema,
  trackedResponseSchema,
  updateStyleProfileInputSchema,
  userProfileResponseSchema,
  wardrobeOnboardingStateResponseSchema,
  type CommunityFeedMode,
  type CommunityReactionFeed,
  type CommunityReactionFeedItem,
  type CommunityReactionSpotlight,
  type GarmentListResponse,
  type ResolveCommunityTargetsInput,
  type ShopThisLook,
  type StyleProfile,
  type WardrobeOnboardingStateResponse,
} from '@couture/api-client/contracts/http'

/**
 * Story CC-7.12 (Step 69): capsules list and one-saved-look reads added; Looks gates on both lists.
 *
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
 *   Story CC-7.12 (Step 69): Looks reads saved looks and capsules (both `sort=created_desc`) before
 *   its gate opens, and a Saved tile opens the one-look read (`saved-look`).
 *   ritual-503 populated, the ritual read answers 503 (the matrix's "Ritual fails" row)
 *   empty-closet populated except for the garment list, so Today can test an empty closet
 *                independently of weather and Community
 *   closet-unavailable populated, but the user's recent garments read fails
 *   guardian-pending  Story CC-7.10 D1: a 14 year old teen whose one linked guardian is still
 *              `pending`. Under the production consent policy `off` the API lets a teen waiting on
 *              a guardian through on every read (`teenAccessBlocked(prefs, 'off')` is false), so
 *              the member's own reads answer as `empty` (no city, no closet, onboarding not
 *              started) while the shared Community feed and Spotlight answer as `populated`.
 */
export type ShellMode =
  | 'empty'
  | 'empty-closet'
  | 'closet-unavailable'
  | 'populated'
  | 'delayed'
  | 'late'
  | 'ritual-503'
  | 'guardian-pending'
export type ShellScreen = 'home' | 'closet' | 'looks' | 'community' | 'profile'
export type ShellCommunityFixture = {
  feed: (mode: CommunityFeedMode) => CommunityReactionFeed
  spotlight: CommunityReactionSpotlight
}
export type ShellClosetFixture = {
  garments: GarmentListResponse
  onboarding: WardrobeOnboardingStateResponse
}

export const DELAY_MS = 3000
/** The Community sync channel's slow answer: late, and half its ~2 s deadline. */
export const SYNC_DELAY_MS = 1000

/** Text the Home outfit renders for one member, so a test can tell two members apart. */
export const ownerMarker = (memberId: string) => `comfort note for ${memberId}`
export const POPULATED_GARMENTS = 24
export const SHELL_PROFILE_NAME = 'Alex Morgenstern-Falkenberg'
const EMPTY_STYLE_PROFILE: StyleProfile = {
  mood: null,
  palette: null,
  texture: null,
  fit: null,
  avoid: [],
}
/** Story CC-7.12: the populated member's one saved look and one capsule (Looks > Saved tiles). */
export const SHELL_SAVED_LOOK_ID = 'shell-saved-look-1'
export const SHELL_CAPSULE_ID = 'shell-capsule-1'

const iso = '2026-11-20T12:00:00.000Z'
const pixel =
  'data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20viewBox=%220%200%201%201%22%3E%3Cpath%20d=%22M0%200h1v1H0z%22%20fill=%22blue%22/%3E%3C/svg%3E'

/** The read each request is, by path and the query that tells same-path reads apart. */
export function readKey(url: string, method: string) {
  const { pathname, searchParams } = new URL(url)
  const path = pathname.replace(/^.*\/api\/v1\//, '')
  if (method === 'POST' && path === 'community/targets/resolve')
    return 'community-resolve'
  // Story CC-7.11 D12: opening a post detail layer records the open and reads its comments.
  if (method === 'POST' && /^community\/posts\/[^/]+\/opened$/.test(path))
    return 'community-opened'
  if (method === 'GET' && /^community\/posts\/[^/]+\/comments$/.test(path))
    return 'community-comments'
  if (method === 'GET' && /^community\/posts\/[^/]+\/comment-submissions$/.test(path))
    return 'community-comment-submissions'
  if (method !== 'GET') return null
  // Story CC-7.12 D2, D5: the Looks Saved grid reads the owner's capsules, and a Saved tile opens
  // the one saved look.
  if (/^wardrobe\/[^/]+\/capsules$/.test(path)) return 'capsules'
  if (/^wardrobe\/saved-looks\/[^/]+$/.test(path)) return 'saved-look'
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
    'community/notification-preferences': 'notification-preferences',
    'user/profile': 'profile',
    'wardrobe/onboarding': 'onboarding',
    'wardrobe/garments': 'garments',
    'commerce/preferences': 'commerce-preferences',
    'commerce/subscription': 'subscription',
    'commerce/premium/access': 'premium-access',
    'commerce/premium/theme': 'premium-theme',
    // Story CC-7.11 D6, D9: the Silhouette and Plan routes a sub-screen spec opens.
    'wardrobe/silhouette': 'silhouette',
    'commerce/premium/planner': 'planner',
  }
  return known[path] ?? null
}

/**
 * Reads that gate each tab. CC-7.13 Today waits on the ritual, the city label, the closet read and the
 * eligible Spotlight teaser. The separate Community Spotlight read belongs to the Community tab.
 */
export const GATE_READS: Record<ShellScreen, string[]> = {
  home: ['ritual', 'locations', 'garments', 'home-teaser'],
  // Story CC-7.11: the onboarding read only labels the More menu now, outside the gate.
  closet: ['profile', 'garments'],
  // Story CC-7.12 D1, D3: Looks opens on Saved or Ideas only once both lists answered. The
  // capsules read follows the profile read that names its owner.
  looks: ['saved-looks', 'capsules'],
  community: ['community-feed', 'community-spotlight'],
  profile: [
    'profile',
    'locations',
    'onboarding',
    'premium-access',
    'notification-preferences',
  ],
}

/** One page of a member's list: the one item when populated, else none. */
function listPage<T>(populated: boolean, item: T) {
  const data = populated ? [item] : []
  return { data, total: data.length, limit: 50, offset: 0 }
}

/** Story CC-7.12 D5: the one-look read answers 404 for any id but the populated member's look. */
function savedLookMissing(request: Request, populated: boolean) {
  const { pathname } = new URL(request.url())
  return !populated || !pathname.endsWith(`/${encodeURIComponent(SHELL_SAVED_LOOK_ID)}`)
}

const SAVED_LOOK_NOT_FOUND = {
  statusCode: 404,
  message: 'SAVED_LOOK_NOT_FOUND',
  error: 'Not Found',
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
  } satisfies CommunityReactionFeedItem & { title: string }
}

/** CC-7.15 fixture members share two approved looks across the feed and Spotlight. */
export function calmCommunityFixture(startsEmpty: boolean): ShellCommunityFixture {
  const outfits = [
    {
      ...feedItem('calm-community-peer-1', 'Blue layers'),
      author: { isSelf: false, displayName: 'Style Explorer CC7150A1' },
    },
    {
      ...feedItem('calm-community-peer-2', 'Rain shell'),
      author: { isSelf: false, displayName: 'Style Explorer CC7150B2' },
    },
  ] as const
  const [nearby] = outfits
  return {
    feed: (mode) => ({
      items: startsEmpty && mode !== 'all' ? [] : [outfits[1], outfits[0]],
      authorStates: [],
      nextCursor: null,
      mode,
      viewerBand: startsEmpty ? 'cold_dry' : 'temperate_dry',
      bandResolved: true,
      bandUnresolvedReason: null,
      experimentVariant: 'auto',
      activeChallenge: startsEmpty
        ? null
        : {
            id: 'calm-community-challenge',
            slug: 'weekend-layers',
            climateBand: 'temperate_dry',
            title: 'Weekend Layers Challenge',
            body: 'Put together a look for a cool weekend.',
            startsAt: '2026-11-16T00:00:00.000Z',
            endsAt: '2026-11-23T00:00:00.000Z',
            timeZone: 'America/Chicago',
          },
    }),
    spotlight: startsEmpty
      ? { level: 'none', label: null, items: [], nextCursor: null }
      : {
          level: 'city',
          label: 'Chicago',
          items: [{ ...nearby, rank: 1 }],
          nextCursor: null,
        },
  }
}

export function bodies(
  memberId: string,
  populated: boolean,
  teenPending = false,
  options: {
    emptyCloset?: boolean
    todayPhotoUrl?: string
    todayOffer?: ShopThisLook
    community?: ShellCommunityFixture
    closet?: ShellClosetFixture
  } = {}
) {
  // Community content is other members' posts, so a pending teen with nothing of their own still
  // sees it (CC-7.10 D1).
  const community = populated || teenPending
  const feedItems = community
    ? [feedItem('shell-look-1', 'Blue layers'), feedItem('shell-look-2', 'Rain shell')]
    : []
  const feedPage = {
    items: feedItems,
    authorStates: [],
    nextCursor: null,
    mode: 'auto',
    // A member with no saved city gets the all-regions feed with the reason, as the API answers
    // (community.service.ts resolveViewerBand: no locations is `no_location`; CC-7.10 Codex #9).
    viewerBand: populated ? 'temperate_dry' : null,
    bandResolved: populated,
    bandUnresolvedReason: populated ? null : 'no_location',
    experimentVariant: 'auto',
    activeChallenge: null,
  }
  // The Spotlight needs a saved city (community-spotlight.service.ts resolveViewer): a member
  // without one gets level none, whatever the feed holds.
  const spotlight =
    options.community?.spotlight ??
    (populated
      ? {
          level: 'city',
          label: 'Chicago',
          items: [{ ...feedItem('shell-spot-1', 'Spotlight look'), rank: 1 }],
          nextCursor: null,
        }
      : { level: 'none', label: null, items: [], nextCursor: null })
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
        garmentIds: options.emptyCloset
          ? ['default-top', 'default-bottom', 'default-shoes']
          : ['shell-garment-1', 'default-bottom', 'default-shoes'],
        displayGarments: options.emptyCloset
          ? []
          : [
              {
                id: 'shell-garment-1',
                category: 'top',
                ...(options.todayPhotoUrl
                  ? {
                      imageAccess: {
                        url: options.todayPhotoUrl,
                        expiresAt: '2026-11-20T15:15:00.000Z',
                      },
                    }
                  : {}),
              },
            ],
        reasoningBadges: options.todayOffer
          ? [
              {
                key: 'warm-layer',
                label: 'Warm layer',
                bullets: ['A layer helps when it cools down.'],
              },
            ]
          : [],
        comfortNotes: `${scenario} ${ownerMarker(memberId)}`,
        shopThisLook: options.todayOffer ?? null,
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
    id: SHELL_SAVED_LOOK_ID,
    ownerUserId: memberId,
    source: 'home_sample',
    lookId: 'sample:l:office-oxford',
    weather: 'mild-dry',
    title: null,
    anchorGarmentId: null,
    anchorSnapshot: null,
    composition: [
      ['top', 'sample:g:oxford-shirt'],
      ['bottom', 'sample:g:dark-jeans'],
      ['shoes', 'sample:g:loafers'],
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
  // Story CC-7.12 D2: one capsule, saved a day before the look, so the newest-first Saved grid
  // shows the look first and the capsule second.
  const capsuleCreated = '2026-11-19T12:00:00.000Z'
  const capsule = {
    id: SHELL_CAPSULE_ID,
    ownerUserId: memberId,
    name: 'Office week',
    description: null,
    occasions: ['work'],
    isFavorite: false,
    revision: 0,
    availabilityStatus: 'ready',
    unavailableGarmentCount: 0,
    garments: [0, 1].map((index) => ({
      id: `shell-garment-${index + 1}`,
      category: ['top', 'bottom'][index],
      material: 'cotton',
      comfortRange: 'mild',
      imageAccess: { url: pixel, expiresAt: '2099-12-31T00:00:00.000Z' },
      availabilityStatus: 'ready',
      garmentOrder: index,
    })),
    createdAt: capsuleCreated,
    updatedAt: capsuleCreated,
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

  const profile = teenPending
    ? {
        user: {
          id: memberId,
          email: 'shell-member@example.test',
          displayName: SHELL_PROFILE_NAME,
          // 14 at the fixed clock (2026-11-20), inside the 13 to 15 consent band.
          birthdate: '2012-06-01T00:00:00.000Z',
          role: 'teen',
        },
        linkedGuardians: [
          {
            guardianId: 'shell-guardian-pending',
            status: 'pending',
            consentGrantedAt: null,
          },
        ],
        linkedTeens: [],
      }
    : {
        user: {
          id: memberId,
          email: 'shell-member@example.test',
          displayName: SHELL_PROFILE_NAME,
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
    'saved-looks': checked(savedLookListResponseSchema, listPage(populated, savedLook)),
    capsules: checked(outfitCapsuleListResponseSchema, listPage(populated, capsule)),
    // Story CC-7.12 D5: the one-look read behind /looks/saved/<id>. Any other id is a 404.
    'saved-look': checked(savedLookResponseSchema, { data: savedLook }),
    'events-poll': { events: [], nextSince: null },
    silhouette: checked(silhouetteProfileResponseSchema, {
      data: {
        mode: 'default_mannequin',
        heightSlider: null,
        buildSlider: null,
        myForm: null,
        revision: 0,
        updatedAt: iso,
      },
    }),
    // Seven failed days: a valid week with nothing generated, so Plan renders without a
    // forecast service (the spec asserts its top bar and back, not the outfits).
    planner: checked(plannerResponseSchema, {
      data: {
        locationId: 'shell-home',
        timezone: 'America/Chicago',
        anchorDate: '2026-11-20',
        daysReady: 0,
        days: Array.from({ length: 7 }, (_, day) => ({
          status: 'error',
          planDate: `2026-11-${String(20 + day).padStart(2, '0')}`,
          errorCode: 'generation_failed',
          retryable: true,
        })),
      },
    }),
    'community-opened': checked(trackedResponseSchema, { tracked: true }),
    'community-comments': checked(communityCommentsResponseSchema, {
      data: { items: [], nextCursor: null, snapshot: 0, hasNewer: false },
    }),
    'community-comment-submissions': checked(communityCommentSubmissionsResponseSchema, {
      data: { items: [], nextCursor: null },
    }),
    'community-feed': checked(communityReactionFeedResponseSchema, { data: feedPage }),
    'community-spotlight': checked(communityReactionSpotlightResponseSchema, {
      data: spotlight,
    }),
    'home-teaser': { data: spotlight },
    'community-events': checked(communityEventsResponseSchema, {
      data: { events: [], nextCursor: 'fixture', hasMore: false, resyncRequired: false },
    }),
    'notification-preferences': checked(communityNotificationPreferencesResponseSchema, {
      data: {
        enabled: true,
        pushEnabled: true,
        quietHoursEnabled: false,
        quietHoursStart: '22:00',
        quietHoursEnd: '07:00',
        timezone: 'America/Chicago',
        revision: 'shell-notification-preferences',
      },
    }),
    profile: checked(userProfileResponseSchema, profile),
    onboarding: checked(
      wardrobeOnboardingStateResponseSchema,
      options.closet?.onboarding ?? { data: onboarding }
    ),
    garments: checked(
      garmentListResponseSchema,
      options.closet?.garments ?? {
        data: populated
          ? Array.from({ length: POPULATED_GARMENTS }, (_, i) => garment(i))
          : [],
      }
    ),
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
      [
        ...spotlight.items.map(({ rank: _rank, ...post }) => post),
        ...(options.community?.feed('all').items ?? feedItems),
      ].map((item) => [item.id, item] as const)
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
            post,
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

  return { json, resolve, styleProfile: EMPTY_STYLE_PROFILE }
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
  todayPhotoUrl?: string
  todayOffer?: ShopThisLook
  community?: ShellCommunityFixture
  closet?: ShellClosetFixture
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
  const teenPending = mode === 'guardian-pending'
  const populated = mode !== 'empty' && !teenPending
  // Bodies follow the bearer each request carries, so a member switch inside one document
  // (7.7-E2E-009) gets the new member's content and the old member's text tells a leak apart.
  const bodiesByOwner = new Map<string, ReturnType<typeof bodies>>()
  const bodiesFor = (request: Request) => {
    // Only reached with a fixture bearer (the handler refuses the rest), so no fallback owner.
    const owner = fixtureOwner(request.headers()['authorization'])!
    if (!bodiesByOwner.has(owner))
      bodiesByOwner.set(
        owner,
        bodies(owner, populated, teenPending, {
          emptyCloset: mode === 'empty-closet',
          todayPhotoUrl: options.todayPhotoUrl,
          todayOffer: options.todayOffer,
          community: options.community,
          closet: options.closet,
        })
      )
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

  const styleAnswer = (request: Request): Parameters<Route['fulfill']>[0] => {
    const fixture = bodiesFor(request)
    const method = request.method()
    if (method === 'PATCH') {
      const patch = updateStyleProfileInputSchema.safeParse(request.postDataJSON())
      if (!patch.success)
        return { status: 400, json: { message: 'Invalid style preferences' } }
      fixture.styleProfile = { ...fixture.styleProfile, ...patch.data }
    } else if (method === 'DELETE') fixture.styleProfile = EMPTY_STYLE_PROFILE
    return { json: styleProfileResponseSchema.parse({ data: fixture.styleProfile }) }
  }

  /** The fixture answer for one known read. */
  const answerFor = (key: string, request: Request): Parameters<Route['fulfill']>[0] => {
    if (key === 'style-profile') return styleAnswer(request)
    const { json, resolve } = bodiesFor(request)
    if (key === 'community-resolve') return { json: resolve(request) }
    if (key === 'ritual' && !populated) return { status: 400, json: NO_CITY }
    if (key === 'ritual' && mode === 'ritual-503')
      return { status: 503, json: { statusCode: 503, message: 'Unavailable' } }
    if (key === 'garments' && mode === 'empty-closet') return { json: { data: [] } }
    if (key === 'saved-look' && savedLookMissing(request, populated))
      return { status: 404, json: SAVED_LOOK_NOT_FOUND }
    if (key === 'community-feed') {
      // The page names the filter it was asked for, as the API does.
      const feed = json[key] as { data: Record<string, unknown> }
      const requested = new URL(request.url()).searchParams.get('mode') ?? 'auto'
      if (options.community) {
        return {
          json: checked(communityReactionFeedResponseSchema, {
            data: options.community.feed(communityFeedModeSchema.parse(requested)),
          }),
        }
      }
      return { json: { data: { ...feed.data, mode: requested } } }
    }
    return { json: json[key] }
  }

  const handler = async (route: Route, request: Request) => {
    const key = /\/api\/v1\/personalization\/style-profile(?:\?|$)/.test(request.url())
      ? 'style-profile'
      : readKey(request.url(), request.method())
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
      if (key === 'garments' && mode === 'closet-unavailable') await route.abort()
      else await route.fulfill(answerFor(key, request))
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
