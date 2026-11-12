// Learning path Step 43: Realtime engagement and push notifications.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-43-realtime-engagement-and-push-notifications
import 'reflect-metadata'
import { noComplimentaryGrants } from './helpers/no-complimentary-grants.js'
import { randomUUID } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { isolatedCommunityDatabase } from './helpers/isolated-community-database.js'
import { PostHogService } from '../src/posthog/posthog.service.js'
import {
  CommunityFlagEvaluationService,
  CommunityUnavailableException,
} from '../src/modules/feature-flags/community-flag-evaluation.service.js'

const db = isolatedCommunityDatabase()
const prisma = new PrismaClient({ datasources: { db: { url: db.url } } })
let server: Server
let adapter: PostHogService
let result: unknown = true
// What the recorder answers: the evaluated flag, PostHog's definitive answer for a key the
// project does not define (HTTP 200, no errors, the key left out), or that same omission
// while PostHog reports an evaluation error.
let answer: 'evaluated' | 'absent' | 'absent_with_errors' = 'evaluated'
const calls: { body: unknown; agent: string | undefined }[] = []
beforeAll(async () => {
  await db.migrate()
  server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk: Buffer) => {
      body += chunk.toString()
    })
    request.on('end', () => {
      calls.push({ body: JSON.parse(body), agent: request.headers['user-agent'] })
      response.writeHead(200, { 'Content-Type': 'application/json' })
      // Primary source: https://posthog.com/docs/api/flags, basic v2 response.
      response.end(
        JSON.stringify({
          flags:
            answer === 'evaluated'
              ? {
                  community_read_enabled: {
                    key: 'community_read_enabled',
                    enabled: result,
                    reason: { code: 'condition_match' },
                  },
                }
              : {},
          errorsWhileComputingFlags: answer === 'absent_with_errors',
          requestId: randomUUID(),
        })
      )
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  vi.stubEnv('POSTHOG_HOST', `http://127.0.0.1:${(server.address() as AddressInfo).port}`)
  vi.stubEnv('POSTHOG_API_KEY', 'phc_synthetic_recording_provider')
  adapter = new PostHogService()
}, 30_000)
afterAll(async () => {
  adapter?.onApplicationShutdown()
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()))
  await prisma.$disconnect()
  await db.drop()
  vi.unstubAllEnvs()
})
describe('Story 6.5 actual remote flag adapter and HTTP recorder', () => {
  it.each([true, false])(
    '6.5-INT-010: stores the documented v2 remote boolean %s with one network invocation',
    async (value) => {
      result = value
      const member = await prisma.user.create({
        data: { email: `story65-${randomUUID()}@synthetic.test` },
      })
      const previous = calls.length
      const cache = new CommunityFlagEvaluationService(
        prisma,
        adapter,
        noComplimentaryGrants
      )
      expect((await cache.evaluate(member.id)).value).toBe(value)
      expect(calls).toHaveLength(previous + 1)
      expect(calls.at(-1)?.body).toMatchObject({
        distinct_id: member.id,
        flag_keys_to_evaluate: ['community_read_enabled'],
      })
      expect((await cache.evaluate(member.id)).value).toBe(value)
      expect(calls).toHaveLength(previous + 1)
    }
  )

  // Production 2026-11-11: the PostHog project the runtime read defined no
  // community_read_enabled, so every claim saw the key omitted and threw unavailable, and each
  // delivery re-deferred about every 45 s until its group expired a day later. An omission does
  // not prove the flag is missing: PostHog also omits an inactive flag and one filtered from the
  // server runtime. So an omitted key resolves closed to its declared default (false here),
  // cached for one claim, and never reads the FeatureFlag fallback row, whose true could
  // otherwise renew a non-grantee's access for as long as the omission lasts.
  describe('a key PostHog omits', () => {
    const evaluateAbsent = async (row: boolean | null) => {
      answer = 'absent'
      if (row === null)
        await prisma.featureFlag.deleteMany({ where: { key: 'community_read_enabled' } })
      else
        await prisma.featureFlag.upsert({
          where: { key: 'community_read_enabled' },
          create: { key: 'community_read_enabled', value: row },
          update: { value: row },
        })
      const member = await prisma.user.create({
        data: { email: `story65-absent-${randomUUID()}@synthetic.test` },
      })
      const previous = calls.length
      const cache = new CommunityFlagEvaluationService(
        prisma,
        adapter,
        noComplimentaryGrants
      )
      try {
        const first = await cache.evaluate(member.id)
        const second = await cache.evaluate(member.id)
        return {
          first: first.value,
          second: second.value,
          calls: calls.length - previous,
        }
      } finally {
        answer = 'evaluated'
        await prisma.featureFlag.deleteMany({ where: { key: 'community_read_enabled' } })
      }
    }

    it.each([true, false, null])(
      '6.5-INT-010a: resolves closed to the declared default false whatever the fallback row (%s), cached with one network invocation',
      async (row) => {
        expect(await evaluateAbsent(row)).toEqual({
          first: false,
          second: false,
          calls: 1,
        })
      }
    )

    it('6.5-INT-010b: never reads the FeatureFlag fallback row', async () => {
      const reads = vi.spyOn(prisma.featureFlag, 'findUnique')
      try {
        await evaluateAbsent(true)
        expect(reads).not.toHaveBeenCalled()
      } finally {
        reads.mockRestore()
      }
    })

    it('6.5-INT-010c: stays unavailable when PostHog reports an evaluation error', async () => {
      answer = 'absent_with_errors'
      try {
        const member = await prisma.user.create({
          data: { email: `story65-absent-error-${randomUUID()}@synthetic.test` },
        })
        const cache = new CommunityFlagEvaluationService(
          prisma,
          adapter,
          noComplimentaryGrants
        )
        await expect(cache.evaluate(member.id)).rejects.toBeInstanceOf(
          CommunityUnavailableException
        )
      } finally {
        answer = 'evaluated'
      }
    })
  })
})
