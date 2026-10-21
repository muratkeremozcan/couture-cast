import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { isolatedCommunityDatabase } from './helpers/isolated-community-database.js'
import { PostHogService } from '../src/posthog/posthog.service.js'
import { CommunityFlagEvaluationService } from '../src/modules/feature-flags/community-flag-evaluation.service.js'

const db = isolatedCommunityDatabase()
const prisma = new PrismaClient({ datasources: { db: { url: db.url } } })
let server: Server
let adapter: PostHogService
let result: unknown = true
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
          flags: {
            community_read_enabled: {
              key: 'community_read_enabled',
              enabled: result,
              reason: { code: 'condition_match' },
            },
          },
          errorsWhileComputingFlags: false,
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
      const cache = new CommunityFlagEvaluationService(prisma, adapter)
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
})
