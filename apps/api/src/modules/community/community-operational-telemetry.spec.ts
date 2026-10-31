// Learning path Step 43: Realtime engagement and push notifications.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-43-realtime-engagement-and-push-notifications
import type { PrismaClient } from '@prisma/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
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
  it.each(['absent', 'reject', 'accept'] as const)(
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
      await new CommunityOperationalTelemetry(
        prisma,
        outcome === 'absent' ? {} : { captureAcknowledged: capture }
      ).deliver()
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
      if (outcome !== 'absent')
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
      else expect(capture).not.toHaveBeenCalled()
    }
  )
})
