// Learning path Step 43: Realtime engagement and push notifications.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-43-realtime-engagement-and-push-notifications
import type { PrismaClient } from '@prisma/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  COMMUNITY_APPEND_STALL_MS,
  communityBuildIdentity,
  CommunityOperationalTelemetry,
} from './community-operational-telemetry.js'
afterEach(() => vi.unstubAllEnvs())
describe('durable operational telemetry sink', () => {
  it('uses only a verified build digest, with hosting fallback', () => {
    vi.stubEnv('COUTURE_BUILD_SHA', '')
    expect(communityBuildIdentity()).toBe('unknown')
    vi.stubEnv('COUTURE_BUILD_SHA', 'a'.repeat(40))
    expect(communityBuildIdentity()).toBe('a'.repeat(40))
    vi.stubEnv('COUTURE_BUILD_SHA', undefined)
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'b'.repeat(40))
    expect(communityBuildIdentity()).toBe('b'.repeat(40))
  })
  it.each([
    ['absent', {}],
    [
      'unconfigured',
      { captureAcknowledged: vi.fn(), acknowledgedCaptureConfigured: () => false },
    ],
  ] as const)('parks every row with no lease while the sink is %s', async (_, sink) => {
    const query = vi.fn()
    const updateMany = vi.fn()
    const prisma = {
      $queryRaw: query,
      communityEngagementTelemetry: { updateMany },
    } as unknown as PrismaClient
    const telemetry = new CommunityOperationalTelemetry(prisma, sink)
    await expect(telemetry.deliver()).resolves.toBe(0)
    await expect(telemetry.deliver()).resolves.toBe(0)
    expect(query).not.toHaveBeenCalled()
    expect(updateMany).not.toHaveBeenCalled()
  })
  it.each(['reject', 'accept'] as const)(
    'settles only acknowledged delivery, sink=%s',
    async (outcome) => {
      const row = {
        id: 'event',
        event_type: 'community_backlog',
        created_at: new Date(),
        attempts: 20,
        outcome: 'append',
      }
      const query = vi.fn().mockResolvedValueOnce([row]).mockResolvedValue([])
      const updateMany = vi.fn().mockResolvedValue({ count: 1 })
      const capture = vi
        .fn()
        .mockImplementation(() =>
          outcome === 'reject'
            ? Promise.reject(new Error('sink offline'))
            : Promise.resolve()
        )
      const prisma = {
        $queryRaw: query,
        communityEngagementTelemetry: { updateMany },
      } as unknown as PrismaClient
      await expect(
        new CommunityOperationalTelemetry(prisma, {
          captureAcknowledged: capture,
          acknowledgedCaptureConfigured: () => true,
        }).deliver()
      ).resolves.toBe(outcome === 'accept' ? 1 : 0)
      expect(query).toHaveBeenCalledTimes(2)
      expect(updateMany).toHaveBeenCalledExactlyOnceWith({
        where: {
          id: 'event',
          lease_owner: expect.any(String) as string,
          delivered_at: null,
        },
        data: {
          lease_owner: null,
          lease_until: null,
          ...(outcome === 'accept'
            ? { delivered_at: expect.any(Date) as Date }
            : { next_attempt_at: expect.any(Date) as Date }),
        },
      })
      expect(capture).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          distinctId: 'community-operational',
          properties: expect.objectContaining({
            $process_person_profile: false,
            $geoip_disable: true,
            $insert_id: 'event',
          }) as unknown,
        }),
        { signal: expect.any(AbortSignal) as AbortSignal }
      )
    }
  )
  it('records a busy or just-drained backlog lane every minute and an idle one hourly', async () => {
    let now = Date.parse('2026-11-10T12:00:00Z')
    let counts = { append: 0n, delivery: 0n }
    const create = vi.fn().mockResolvedValue({})
    const prisma = {
      $queryRaw: vi.fn(() =>
        Promise.resolve([
          { lane: 'append', count: counts.append, age: 0 },
          { lane: 'delivery', count: counts.delivery, age: 0 },
        ])
      ),
      communityEngagementTelemetry: { create },
    } as unknown as PrismaClient
    const telemetry = new CommunityOperationalTelemetry(prisma, {}, () => now)
    const recorded = async () => {
      create.mockClear()
      await telemetry.backlog()
      return create.mock.calls.map((call) => {
        const { data } = call[0] as { data: { outcome: string; backlog_count: number } }
        return `${data.outcome}=${data.backlog_count}`
      })
    }
    expect(await recorded()).toEqual(['append=0', 'delivery=0'])
    now += 60_000
    expect(await recorded()).toEqual([])
    counts = { append: 3n, delivery: 0n }
    now += 60_000
    expect(await recorded()).toEqual(['append=3'])
    now += 60_000
    expect(await recorded()).toEqual(['append=3'])
    counts = { append: 0n, delivery: 0n }
    now += 60_000
    expect(await recorded()).toEqual(['append=0'])
    now += 60_000
    expect(await recorded()).toEqual([])
    now += 60 * 60_000
    expect(await recorded()).toEqual(['append=0', 'delivery=0'])
  })

  // Production 2026-11-11: append never succeeded and outbox rows aged for hours with only
  // routine backlog rows to show for it. An append lane older than five minutes is a stall:
  // recorded as community_append_stalled (forwarded to PostHog, where an alert watches it) and
  // logged, at most once per five minutes while it lasts.
  it('records community_append_stalled when the oldest unappended row passes five minutes', async () => {
    let now = Date.parse('2026-11-11T12:00:00Z')
    let age = 0
    const create = vi.fn().mockResolvedValue({})
    const prisma = {
      $queryRaw: vi.fn(() =>
        Promise.resolve([
          { lane: 'append', count: 2n, age },
          { lane: 'delivery', count: 0n, age: 0 },
        ])
      ),
      communityEngagementTelemetry: { create },
    } as unknown as PrismaClient
    const telemetry = new CommunityOperationalTelemetry(prisma, {}, () => now)
    const stalled = async () => {
      create.mockClear()
      await telemetry.backlog()
      return create.mock.calls
        .map(
          (call) =>
            (call[0] as { data: { event_type: string; oldest_age_ms: number } }).data
        )
        .filter((data) => data.event_type === 'community_append_stalled')
        .map((data) => data.oldest_age_ms)
    }
    age = COMMUNITY_APPEND_STALL_MS - 1
    expect(await stalled()).toEqual([])
    age = COMMUNITY_APPEND_STALL_MS
    expect(await stalled()).toEqual([COMMUNITY_APPEND_STALL_MS])
    now += 60_000
    age += 60_000
    expect(await stalled()).toEqual([])
    now += COMMUNITY_APPEND_STALL_MS
    age += COMMUNITY_APPEND_STALL_MS
    expect(await stalled()).toEqual([age])
  })
})
