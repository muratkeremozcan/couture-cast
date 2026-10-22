// Story 6.5 acceptance: one compiled flag-evaluation instance with its own pool and HTTP remote.
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
require('reflect-metadata')
const url = new URL(process.env.STORY65_WORKER_DATABASE_URL)
if (!/^\/tea_community_[a-f0-9]{32}$/.test(url.pathname))
  throw new Error('Isolated UUID DB required')
const { PrismaClient } = require('@prisma/client')
const {
  CommunityFlagEvaluationService,
} = require('../../dist/src/modules/feature-flags/community-flag-evaluation.service.js')
const {
  CommunityAuthorizationBudget,
  CommunityUnavailableException,
} = require('../../dist/src/modules/community/community-availability.js')

const prisma = new PrismaClient({ datasources: { db: { url: url.toString() } } })
const endpoint = process.env.STORY65_FLAG_REMOTE_ENDPOINT
if (new URL(endpoint).hostname !== '127.0.0.1')
  throw new Error('Loopback remote required')
// The production evaluator sees a real network provider; it never sees a fixture shortcut.
const remote = {
  async getFeatureFlagValue(_flag, member, options) {
    const response = await fetch(`${endpoint}?member=${encodeURIComponent(member)}`, {
      signal: options?.signal,
    })
    if (!response.ok) throw new Error('Remote flag provider failure')
    return (await response.json()).value
  },
}
const service = new CommunityFlagEvaluationService(prisma, remote)
await prisma.$queryRaw`SELECT 1`
process.send?.({ event: 'ready', value: { pid: process.pid } })
process.on('message', async ({ id, op, args }) => {
  try {
    let value = null
    if (op === 'evaluate') {
      const started = performance.now()
      const wall = Date.now()
      try {
        const grant = await service.evaluate(args, new CommunityAuthorizationBudget())
        value = {
          outcome: 'granted',
          value: grant.value,
          expiresAt: grant.expiresAt.getTime(),
          wall,
          elapsedMs: performance.now() - started,
        }
      } catch (error) {
        if (!(error instanceof CommunityUnavailableException)) throw error
        value = {
          outcome: 'unavailable',
          retryAfterSeconds: error.retryAfterSeconds,
          wall,
          elapsedMs: performance.now() - started,
        }
      }
    }
    if (op === 'close') {
      await prisma.$disconnect()
      process.send?.({ id, value })
      process.disconnect()
      return
    }
    process.send?.({ id, value })
  } catch (error) {
    process.send?.({ id, error: error.code ?? error.name })
  }
})
