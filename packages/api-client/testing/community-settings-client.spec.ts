import { afterEach, describe, expect, it, vi } from 'vitest'
import { Configuration, DefaultApi } from '../src/generated'
import { communitySyncClient } from '../src/community-sync-client'
import {
  communityDeviceTimezoneDraft,
  communityPreferenceChanges,
  communityPreferenceFailureKey,
  isCommunityPreferenceConflict,
  rebaseCommunityPreferenceDraft,
} from '../src/community-notification-settings'
import {
  communityNotificationDataSchema,
  resolveCommunityTargetsInputSchema,
  type CommunityNotificationSettings,
} from '../src/contracts/http/community-sync'

const settings: CommunityNotificationSettings = {
  enabled: true,
  pushEnabled: true,
  timezoneConfigured: true,
  timezone: 'America/Chicago',
  quietHoursEnabled: true,
  quietHoursStart: '22:00',
  quietHoursEnd: '07:00',
  revision: 'revision',
}
const registration = {
  registrationId: 'binding',
  bindingGeneration: 2,
  platform: 'ios',
  permission: 'granted',
  lastUsedAt: '2026-10-20T00:00:00Z',
}
afterEach(() => vi.restoreAllMocks())
describe('sparse preference conflict recovery', () => {
  it('sends each edited field and preserves untouched shared settings', () => {
    expect(communityPreferenceChanges(settings, { ...settings })).toEqual({})
    const edited = {
      ...settings,
      enabled: false,
      quietHoursEnabled: false,
      quietHoursStart: '21:00',
      quietHoursEnd: '08:00',
      timezone: 'Europe/Paris',
    }
    expect(communityPreferenceChanges(settings, edited)).toEqual({
      enabled: false,
      quietHoursEnabled: false,
      quietHoursStart: '21:00',
      quietHoursEnd: '08:00',
      timezone: 'Europe/Paris',
    })
    expect(
      communityPreferenceChanges({ ...settings, timezoneConfigured: false }, settings)
    ).toEqual({ timezone: settings.timezone })
  })
  it('accepts a valid device zone only before the user has configured one', () => {
    expect(communityDeviceTimezoneDraft(settings, 'Europe/Paris')).toBe(settings)
    const unset = { ...settings, timezoneConfigured: false }
    expect(communityDeviceTimezoneDraft(unset, undefined)).toBe(unset)
    expect(communityDeviceTimezoneDraft(unset, 'invalid-zone')).toBe(unset)
    expect(communityDeviceTimezoneDraft(unset, 'Europe/Paris')).toEqual({
      ...unset,
      timezone: 'Europe/Paris',
    })
  })
  it('rebase preserves a concurrent explicitly configured zone while retaining the user edit', () => {
    const base = { ...settings, timezoneConfigured: false }
    const current = { ...settings, revision: 'new', timezone: 'Europe/Paris' }
    expect(
      rebaseCommunityPreferenceDraft(
        base,
        current,
        { ...base, enabled: false, timezone: 'Asia/Tokyo' },
        'Asia/Tokyo'
      )
    ).toEqual({ ...current, enabled: false })
    expect(
      rebaseCommunityPreferenceDraft(base, current, { ...base, timezone: 'Asia/Tokyo' })
    ).toEqual({ ...current, timezone: 'Asia/Tokyo' })
    expect(
      rebaseCommunityPreferenceDraft(settings, current, { ...settings, enabled: false })
    ).toEqual({ ...current, enabled: false })
    expect(
      rebaseCommunityPreferenceDraft(
        base,
        base,
        { ...base, timezone: 'Asia/Tokyo' },
        'Asia/Tokyo'
      )
    ).toEqual({ ...base, timezone: 'Asia/Tokyo' })
  })
  it.each([
    undefined,
    null,
    false,
    '409',
    {},
    { response: {} },
    { response: new Response(null, { status: 503 }) },
    { response: new Response(null, { status: 409 }) },
  ])('recognizes only an actual HTTP409 response: %j', (error) => {
    expect(isCommunityPreferenceConflict(error)).toBe(
      Boolean(
        error &&
          typeof error === 'object' &&
          'response' in error &&
          error.response instanceof Response &&
          error.response.status === 409
      )
    )
  })
  it('localizes permission refusal separately from retryable failures', () => {
    expect(
      communityPreferenceFailureKey(new Error('notification_permission_denied'))
    ).toBe('community.notifications.permission')
    expect(communityPreferenceFailureKey(new Error('offline'))).toBe(
      'community.notifications.failed'
    )
    expect(communityPreferenceFailureKey(undefined)).toBe(
      'community.notifications.failed'
    )
  })
})

describe('generated sync HTTP client boundary', () => {
  function setup(body: unknown, options?: RequestInit | (() => RequestInit)) {
    const fetchApi = vi
      .fn<typeof fetch>()
      .mockImplementation(() => Promise.resolve(Response.json(body)))
    const api = new DefaultApi(
      new Configuration({
        basePath: 'https://api.invalid',
        accessToken: 'fixture-session',
        fetchApi,
      })
    )
    return { client: communitySyncClient(api, options), fetchApi }
  }
  it('parses events and combines owner cancellation with a fresh HTTP deadline', async () => {
    const controller = new AbortController()
    const page = { events: [], nextCursor: 'head', hasMore: false, resyncRequired: false }
    const { client, fetchApi } = setup({ data: page }, { signal: controller.signal })
    const request = new AbortController()
    expect(await client.events('all', 'old', request.signal)).toEqual(page)
    const [url, init] = fetchApi.mock.calls[0]!
    expect(new URL(url as string).pathname).toBe('/api/v1/community/events')
    expect(Object.fromEntries(new URL(url as string).searchParams)).toEqual({
      mode: 'all',
      cursor: 'old',
    })
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer fixture-session' })
    controller.abort()
    expect(init?.signal?.aborted).toBe(true)
  })
  it('refreshes caller options per attempt and propagates explicit request cancellation', async () => {
    let header = 'first'
    const options = vi.fn(() => ({ headers: { 'x-request-owner': header } }))
    const { client, fetchApi } = setup({ data: { targets: [] } }, options)
    const controller = new AbortController()
    await client.resolve({ targets: [{ key: 'p', postId: 'p' }] }, controller.signal)
    controller.abort()
    expect(fetchApi.mock.calls[0]?.[1]?.signal?.aborted).toBe(true)
    header = 'second'
    await client.resolve({ targets: [{ key: 'p', postId: 'p' }] })
    expect(options).toHaveBeenCalledTimes(2)
    expect(fetchApi.mock.calls[1]?.[1]?.headers).toMatchObject({
      'x-request-owner': 'second',
    })
    expect(fetchApi.mock.calls[1]?.[1]?.signal?.aborted).toBe(false)
  })
  it('reads preferences, sends sparse patches and rejects malformed edits before HTTP', async () => {
    const { client, fetchApi } = setup({ data: settings })
    expect(await client.preferences()).toEqual(settings)
    expect(
      await client.patchPreferences({ baseRevision: 'revision', enabled: false })
    ).toEqual(settings)
    expect(JSON.parse(fetchApi.mock.calls[1]?.[1]?.body as string)).toEqual({
      baseRevision: 'revision',
      enabled: false,
    })
    await expect(
      client.patchPreferences({ baseRevision: 'revision', quietHoursStart: '25:00' })
    ).rejects.toThrow()
    expect(fetchApi).toHaveBeenCalledTimes(2)
  })
  it('registers, lists and removes generation-bound push installations', async () => {
    const { client, fetchApi } = setup({ data: registration })
    expect(
      await client.register({
        token: 'ExpoPushToken[fixture]',
        installationId: '65000000-0000-4000-8000-000000000001',
        platform: 'ios',
        permission: 'granted',
      })
    ).toEqual(registration)
    fetchApi.mockResolvedValueOnce(
      Response.json({ data: { registrations: [registration] } })
    )
    expect(await client.registrations()).toEqual({ registrations: [registration] })
    fetchApi.mockResolvedValueOnce(Response.json({ data: { removed: true } }))
    expect(await client.remove('binding', 2)).toEqual({ removed: true })
    expect(fetchApi.mock.calls[2]?.[0]).toContain(
      '/push-tokens/binding?bindingGeneration=2'
    )
    expect(fetchApi.mock.calls[2]?.[1]?.method).toBe('DELETE')
  })
  it('rejects unexpected response projections and invalid target requests', async () => {
    const { client, fetchApi } = setup({
      data: { targets: [], privateOwner: 'forbidden' },
    })
    await expect(
      client.resolve({ targets: [{ key: 'p', postId: 'p' }] })
    ).rejects.toThrow()
    await expect(
      client.resolve({ targets: [{ key: 'p', postId: 'p', parentId: 'root' }] })
    ).rejects.toThrow()
    expect(fetchApi).toHaveBeenCalledTimes(1)
  })
})

describe('target correlation and notification parent scopes', () => {
  it('refuses duplicate correlation keys, parent-only pointers and oversized batches', () => {
    for (const targets of [
      [],
      [
        { key: 'p', postId: 'p' },
        { key: 'p', postId: 'q' },
      ],
      [{ key: 'p', postId: 'p', parentId: 'root' }],
      Array.from({ length: 51 }, (_, i) => ({ key: String(i), postId: 'p' })),
    ])
      expect(resolveCommunityTargetsInputSchema.safeParse({ targets }).success).toBe(
        false
      )
    expect(
      resolveCommunityTargetsInputSchema.parse({
        targets: [{ key: 'p', postId: 'p', parentId: 'root', commentId: 'reply' }],
      }).targets
    ).toHaveLength(1)
    const payload = {
      version: 1,
      notificationId: '65000000-0000-4000-8000-000000000001',
      source: 'notification',
      type: 'community',
      cardId: 'p',
      expiresAt: '2026-10-22T00:00:00Z',
    }
    expect(communityNotificationDataSchema.safeParse(payload).success).toBe(true)
    expect(
      communityNotificationDataSchema.safeParse({ ...payload, commentId: 'root' }).success
    ).toBe(true)
    expect(
      communityNotificationDataSchema.safeParse({ ...payload, parentId: 'root' }).success
    ).toBe(false)
  })
})
