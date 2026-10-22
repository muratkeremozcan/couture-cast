import type { PactV4, V3MockServer } from '@pact-foundation/pact'
import {
  createProviderState,
  setJsonContent,
  setJsonBody,
} from '@seontechnologies/pactjs-utils'
import { communitySyncClient, ResponseError, type DefaultApi } from '@couture/api-client'
import {
  communityConflictResponseSchema,
  communityInvalidRequestResponseSchema,
  communityUnavailableResponseSchema,
  getAlertPreferencesResponseSchema,
  updateNotificationPreferencesResponseSchema,
  type CommunityPlatform,
} from '@couture/api-client/contracts/http'
import { expect } from 'vitest'
import { pactEventHeaders } from '../shared'

// Provider scrutiny: CommunitySyncController, CommunityPreferencesService,
// PushRegistrationController/Service, CommunityTargetsService and AlertsController.
// Service doubles model dependency outcomes; actual controllers/guards and generated
// clients execute. DB isolation, cursor cryptography and atomicity require INT proofs.
// pactjs-utils deviation: exact protocol examples intentionally pin discriminants,
// opaque correlation and integer revisions. 1.1.0's Zod union/int conversion cannot
// faithfully express these examples; canonical schemas execute in the real wrapper.
const preferences = {
  enabled: false,
  pushEnabled: true,
  quietHoursEnabled: false,
  quietHoursStart: '22:00',
  quietHoursEnd: '07:00',
  timezone: 'UTC',
  timezoneConfigured: false,
  revision: 'policy-1',
}
const legacy = {
  pushEnabled: true,
  quietHoursEnabled: false,
  quietHoursStart: '22:00',
  quietHoursEnd: '07:00',
  timezone: 'UTC',
}
const registration = {
  registrationId: 'registration-65',
  bindingGeneration: 2,
  platform: 'ios',
  permission: 'granted',
  lastUsedAt: '2026-10-01T12:00:00.000Z',
}
const tokenInput = {
  token: 'ExpoPushToken[synthetic_contract_65]',
  installationId: '65000000-0000-4000-8000-000000000001',
  platform: 'ios' as const,
  permission: 'granted' as const,
}
const post = {
  id: 'post-65',
  caption: 'Layered wool.',
  altText: 'A charcoal wool coat.',
  climateBand: 'temperate_dry',
  imageAccess: {
    url: 'https://storage.synthetic.test/post-65.jpg',
    expiresAt: '2026-10-01T13:00:00.000Z',
  },
  createdAt: '2026-10-01T11:00:00.000Z',
  publishedAt: '2026-10-01T12:00:00.000Z',
  status: 'published',
  challengeId: null,
  author: { displayName: 'Explorer', isSelf: false },
  reactions: {
    counts: { applause: 2, love: 0, inspiration: 0 },
    total: 2,
    viewerReaction: null,
    revision: 4,
    generation: 3,
  },
}
const root = {
  id: 'root-65',
  postId: 'post-65',
  parentId: null,
  body: 'Beautiful layers.',
  author: 'Explorer',
  isOwn: false,
  unavailable: false,
  publicationSequence: 4,
  publishedAt: '2026-10-01T12:00:00.000Z',
  replyCount: 1,
}
const reply = {
  ...root,
  id: 'reply-65',
  parentId: root.id,
  publicationSequence: 45,
  replyCount: 0,
}
const available = {
  key: 'focus',
  status: 'available',
  communityRevision: '7',
  post,
  comment: reply,
  parent: root,
  pageCursor: 'opaque-reply-page',
  parentPageCursor: 'opaque-root-page',
  threadPosition: 45,
}
const targetInput = {
  targets: [
    { key: 'focus', postId: 'post-65', commentId: 'reply-65', parentId: 'root-65' },
  ],
}
const eventPage = {
  events: [
    { version: 1, kind: 'post.published', postId: 'post-65', communityRevision: '5' },
    { version: 1, kind: 'reactions.changed', postId: 'post-65', communityRevision: '6' },
    {
      version: 1,
      kind: 'comment.published',
      postId: 'post-65',
      commentId: 'reply-65',
      parentId: 'root-65',
      communityRevision: '7',
    },
    {
      version: 1,
      kind: 'comment.status',
      postId: 'post-65',
      commentId: 'own-pending-65',
      privateRevision: '2',
    },
  ],
  nextCursor: 'opaque-next-65',
  hasMore: false,
  resyncRequired: false,
}
type Sync = ReturnType<typeof communitySyncClient>
type Case = {
  id: string
  scenario: string
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  path: string
  query?: Record<string, string>
  body?: object
  status: number
  response: object
  call: (sync: Sync, api: DefaultApi) => Promise<unknown>
  expected?: unknown
}
const settings = '/api/v1/community/notification-preferences'
const tokens = '/api/v1/notifications/push-tokens'
const events = '/api/v1/community/events'
const targets = '/api/v1/community/targets/resolve'
const typedUnavailable = {
  statusCode: 503,
  code: 'unavailable',
  retryAfterSeconds: 2,
  message: 'Access could not be verified.',
  error: 'Service Unavailable',
}
const conflicts = (code: string) => ({ code, message: 'Installation binding changed.' })
export const communityEngagementInteractions: Case[] = [
  {
    id: 'CONTRACT-001 settings snapshot with timezone provenance',
    scenario: 'ready',
    method: 'GET',
    path: settings,
    status: 200,
    response: { data: preferences },
    call: (s) => s.preferences(),
    expected: preferences,
  },
  {
    id: 'CONTRACT-001 revision-guarded opt-in',
    scenario: 'ready',
    method: 'PATCH',
    path: settings,
    body: { baseRevision: 'policy-1', enabled: true, timezone: 'Europe/Paris' },
    status: 200,
    response: {
      data: {
        ...preferences,
        enabled: true,
        timezone: 'Europe/Paris',
        timezoneConfigured: true,
        revision: 'policy-2',
      },
    },
    call: (s) =>
      s.patchPreferences({
        baseRevision: 'policy-1',
        enabled: true,
        timezone: 'Europe/Paris',
      }),
    expected: {
      ...preferences,
      enabled: true,
      timezone: 'Europe/Paris',
      timezoneConfigured: true,
      revision: 'policy-2',
    },
  },
  {
    id: 'CONTRACT-001 legacy write invalidates stale revision',
    scenario: 'legacy-updated',
    method: 'PATCH',
    path: settings,
    body: { baseRevision: 'policy-1', enabled: true },
    status: 409,
    response: {
      statusCode: 409,
      code: 'revision_conflict',
      current: { ...preferences, revision: 'policy-2' },
    },
    call: (s) => s.patchPreferences({ baseRevision: 'policy-1', enabled: true }),
  },
  {
    id: 'CONTRACT-002 register installation',
    scenario: 'ready',
    method: 'POST',
    path: tokens,
    body: tokenInput,
    status: 200,
    response: { data: registration },
    call: (s) => s.register(tokenInput),
    expected: registration,
  },
  {
    id: 'CONTRACT-002 list owned installations without raw token',
    scenario: 'ready',
    method: 'GET',
    path: tokens,
    status: 200,
    response: { data: { registrations: [registration] } },
    call: (s) => s.registrations(),
    expected: { registrations: [registration] },
  },
  {
    id: 'CONTRACT-002 remove current owned binding',
    scenario: 'ready',
    method: 'DELETE',
    path: `${tokens}/registration-65`,
    query: { bindingGeneration: '2' },
    status: 200,
    response: { data: { removed: true } },
    call: (s) => s.remove('registration-65', 2),
    expected: { removed: true },
  },
  {
    id: 'CONTRACT-002 stale removal cannot remove transferred binding',
    scenario: 'ready',
    method: 'DELETE',
    path: `${tokens}/registration-65`,
    query: { bindingGeneration: '1' },
    status: 200,
    response: { data: { removed: false } },
    call: (s) => s.remove('registration-65', 1),
    expected: { removed: false },
  },
  {
    id: 'CONTRACT-002 another owner sees no registration',
    scenario: 'other-owner',
    method: 'GET',
    path: tokens,
    status: 200,
    response: { data: { registrations: [] } },
    call: (s) => s.registrations(),
    expected: { registrations: [] },
  },
  {
    id: 'CONTRACT-002 implicit cross-owner transfer conflicts',
    scenario: 'other-owner',
    method: 'POST',
    path: tokens,
    body: tokenInput,
    status: 409,
    response: conflicts('binding_changed'),
    call: (s) => s.register(tokenInput),
  },
  {
    id: 'CONTRACT-003 initial stream snapshot',
    scenario: 'ready',
    method: 'GET',
    path: events,
    query: { mode: 'all' },
    status: 200,
    response: {
      data: {
        events: [],
        nextCursor: 'opaque-head-65',
        hasMore: false,
        resyncRequired: false,
      },
    },
    call: (s) => s.events('all'),
    expected: {
      events: [],
      nextCursor: 'opaque-head-65',
      hasMore: false,
      resyncRequired: false,
    },
  },
  {
    id: 'CONTRACT-003 public and owned private event variants',
    scenario: 'ready',
    method: 'GET',
    path: events,
    query: { mode: 'all', cursor: 'opaque-head-65' },
    status: 200,
    response: { data: eventPage },
    call: (s) => s.events('all', 'opaque-head-65'),
    expected: eventPage,
  },
  {
    id: 'CONTRACT-003 expired epoch requires resync',
    scenario: 'ready',
    method: 'GET',
    path: events,
    query: { mode: 'all', cursor: 'old-epoch' },
    status: 409,
    response: {
      statusCode: 409,
      code: 'resync_required',
      message: 'Community resynchronization required.',
    },
    call: (s) => s.events('all', 'old-epoch'),
  },
  {
    id: 'CONTRACT-003 visibility invalidation requests resync',
    scenario: 'ready',
    method: 'GET',
    path: events,
    query: { mode: 'all', cursor: 'hidden-event' },
    status: 200,
    response: {
      data: {
        events: [{ version: 1, kind: 'resync', resyncRequired: true }],
        nextCursor: 'opaque-head-65',
        hasMore: false,
        resyncRequired: true,
      },
    },
    call: (s) => s.events('all', 'hidden-event'),
    expected: {
      events: [{ version: 1, kind: 'resync', resyncRequired: true }],
      nextCursor: 'opaque-head-65',
      hasMore: false,
      resyncRequired: true,
    },
  },
  {
    id: 'CONTRACT-003 invalid or cross-owner cursor',
    scenario: 'ready',
    method: 'GET',
    path: events,
    query: { mode: 'all', cursor: 'foreign-cursor' },
    status: 400,
    response: {
      statusCode: 400,
      code: 'invalid_cursor',
      message: 'Invalid community cursor.',
    },
    call: (s) => s.events('all', 'foreign-cursor'),
  },
  {
    id: 'CONTRACT-003 dependency unavailable stays retryable',
    scenario: 'unavailable',
    method: 'GET',
    path: events,
    query: { mode: 'all' },
    status: 503,
    response: typedUnavailable,
    call: (s) => s.events('all'),
  },
  {
    id: 'CONTRACT-003 affirmative access denial',
    scenario: 'denied',
    method: 'GET',
    path: events,
    query: { mode: 'all' },
    status: 403,
    response: {
      statusCode: 403,
      message: 'Community access is disabled.',
      code: 'denied',
    },
    call: (s) => s.events('all'),
  },
  {
    id: 'CONTRACT-004 locate older root and reply with atomic revision',
    scenario: 'ready',
    method: 'POST',
    path: targets,
    body: targetInput,
    status: 200,
    response: { data: { targets: [available] } },
    call: (s) => s.resolve(targetInput),
    expected: { targets: [available] },
  },
  {
    id: 'CONTRACT-004 absent and hidden targets expose only correlation keys',
    scenario: 'ready',
    method: 'POST',
    path: targets,
    body: {
      targets: [
        { key: 'absent', postId: 'missing' },
        { key: 'hidden', postId: 'private' },
      ],
    },
    status: 200,
    response: {
      data: {
        targets: [
          { key: 'absent', status: 'unavailable' },
          { key: 'hidden', status: 'unavailable' },
        ],
      },
    },
    call: (s) =>
      s.resolve({
        targets: [
          { key: 'absent', postId: 'missing' },
          { key: 'hidden', postId: 'private' },
        ],
      }),
    expected: {
      targets: [
        { key: 'absent', status: 'unavailable' },
        { key: 'hidden', status: 'unavailable' },
      ],
    },
  },
  {
    id: 'CONTRACT-004 removed child preserves available post',
    scenario: 'child-removed',
    method: 'POST',
    path: targets,
    body: targetInput,
    status: 200,
    response: {
      data: {
        targets: [
          {
            ...available,
            comment: null,
            parent: null,
            pageCursor: null,
            parentPageCursor: null,
            threadPosition: null,
          },
        ],
      },
    },
    call: (s) => s.resolve(targetInput),
    expected: {
      targets: [
        {
          ...available,
          comment: null,
          parent: null,
          pageCursor: null,
          parentPageCursor: null,
          threadPosition: null,
        },
      ],
    },
  },
  {
    id: 'CONTRACT-005 old strict alert preferences read',
    scenario: 'ready',
    method: 'GET',
    path: '/api/v1/alerts/preferences',
    status: 200,
    response: { data: { preferences: legacy, rules: [] } },
    call: async (_s, api) =>
      getAlertPreferencesResponseSchema.parse(await api.apiV1AlertsPreferencesGet()),
    expected: { data: { preferences: legacy, rules: [] } },
  },
  {
    id: 'CONTRACT-005 old strict alert preferences write',
    scenario: 'ready',
    method: 'PUT',
    path: '/api/v1/alerts/preferences',
    body: legacy,
    status: 200,
    response: { data: { preferences: legacy } },
    call: async (_s, api) =>
      updateNotificationPreferencesResponseSchema.parse(
        await api.apiV1AlertsPreferencesPut({
          updateNotificationPreferencesInput: legacy,
        })
      ),
    expected: { data: { preferences: legacy } },
  },
]

export async function verifyCommunityEngagement(
  pact: PactV4,
  createClient: (server: V3MockServer) => DefaultApi,
  platform: CommunityPlatform,
  interaction: Case
) {
  // Provider endpoints: CommunitySyncController / PushRegistrationController / AlertsController.
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'Community engagement protocol state',
        params: { scenario: interaction.scenario },
      })
    )
    .uponReceiving(`${platform} 6.5-${interaction.id}`)
    .withRequest(
      interaction.method,
      interaction.path,
      setJsonContent({
        headers: pactEventHeaders,
        query: interaction.query,
        body: interaction.body,
      })
    )
    .willRespondWith(interaction.status, setJsonBody(interaction.response))
    .executeTest(async (server) => {
      const api = createClient(server)
      if (interaction.status < 400) {
        expect(await interaction.call(communitySyncClient(api), api)).toEqual(
          interaction.expected
        )
        return
      }
      const error: unknown = await interaction
        .call(communitySyncClient(api), api)
        .catch((failure: unknown) => failure)
      expect(error).toBeInstanceOf(ResponseError)
      if (!(error instanceof ResponseError))
        throw new Error('Expected generated-client ResponseError')
      expect(error.response.status).toBe(interaction.status)
      const body: unknown = await error.response.json()
      if (interaction.status === 409) communityConflictResponseSchema.parse(body)
      if (interaction.status === 400) communityInvalidRequestResponseSchema.parse(body)
      if (interaction.status === 503) communityUnavailableResponseSchema.parse(body)
      expect(body).toEqual(interaction.response)
    })
}
