// Story 6.5 acceptance: actual compiled workers/guard, controlled external I/O only.
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
require('reflect-metadata')
const url = new URL(process.env.STORY65_WORKER_DATABASE_URL)
if (!/^\/tea_community_[a-f0-9]{32}$/.test(url.pathname))
  throw new Error('Isolated UUID DB required')
url.searchParams.set('connection_limit', '1')
const { PrismaClient } = require('@prisma/client')
const {
  CommunityFlagEvaluationService,
} = require('../../dist/src/modules/feature-flags/community-flag-evaluation.service.js')
const {
  CommunitySendGuard,
} = require('../../dist/src/modules/community/community-send-guard.js')
const {
  CommunityPushProvider,
} = require('../../dist/src/modules/community/community-push-provider.js')
const {
  CommunityNotificationsWorker,
} = require('../../dist/src/modules/community/community-notifications.worker.js')
const {
  startCommunityEngagementRuntime,
} = require('../../dist/src/modules/community/community-engagement.runtime.js')
const prisma = new PrismaClient({ datasources: { db: { url: url.toString() } } })
const nativeFetch = globalThis.fetch
const endpoint = process.env.STORY65_PROVIDER_ENDPOINT
let preTransport = false
let continueTransport
let preGuard = false
let continueGuard
// The wrapper pauses only after an actual committed claim, without fabricating DB results.
const observed = new Proxy(prisma, {
  get(target, key) {
    if (key === '$transaction')
      return async (...args) => {
        const result = await target.$transaction(...args)
        if (preGuard && result?.status === 'sending' && result?.lease_owner) {
          process.send?.({ event: 'claimed', value: null })
          await new Promise((resolve) => {
            continueGuard = resolve
          })
        }
        return result
      }
    const value = Reflect.get(target, key)
    return typeof value === 'function' ? value.bind(target) : value
  },
})
globalThis.fetch = async (input, init) => {
  if (preTransport) {
    process.send?.({ event: 'authorized', value: null })
    await new Promise((resolve) => {
      continueTransport = resolve
    })
  }
  const destination = new URL(typeof input === 'string' ? input : input.url)
  if (destination.hostname === 'exp.host') return nativeFetch(endpoint, init)
  if (destination.hostname !== '127.0.0.1') throw new Error('Unapproved external request')
  return nativeFetch(input, init)
}
let holdAnalytics = false
const analyticsReleases = new Set()
const remote = {
  getFeatureFlagValue: async () => true,
  captureAcknowledged: (_event, options) => {
    if (!holdAnalytics) return Promise.resolve()
    process.send?.({ event: 'analytics-held', value: null })
    return new Promise((resolve, reject) => {
      const finish = () => {
        options.signal.removeEventListener('abort', abort)
        analyticsReleases.delete(finish)
        resolve()
      }
      const abort = () => {
        analyticsReleases.delete(finish)
        reject(new Error('Controlled analytics deadline'))
      }
      analyticsReleases.add(finish)
      options.signal.addEventListener('abort', abort, { once: true })
    })
  },
}
const guard = new CommunitySendGuard(
  observed,
  new CommunityFlagEvaluationService(observed, remote),
  new CommunityPushProvider(globalThis.fetch, endpoint)
)
await guard.verifyRuntime()
const [backend] =
  await prisma.$queryRaw`SELECT pg_backend_pid() AS pid, current_setting('server_version_num')::integer AS version`
let runtime
process.send?.({
  event: 'ready',
  value: { pid: process.pid, backend: backend.pid, version: backend.version },
})
process.on('message', async ({ id, op, args }) => {
  try {
    let value = null
    if (op === 'barrier') {
      preGuard = args === 'claim'
      preTransport = args === 'transport'
    }
    if (op === 'continue') {
      continueGuard?.()
      continueTransport?.()
    }
    if (op === 'dispatch') await guard.dispatch(args)
    if (op === 'recover')
      value = await new CommunityNotificationsWorker(prisma, guard).recover()
    if (op === 'analytics') {
      holdAnalytics = args
      if (!args) analyticsReleases.forEach((release) => release())
    }
    if (op === 'runtime') {
      runtime = await startCommunityEngagementRuntime(prisma, remote, args)
      value = runtime.dispatch
    }
    if (op === 'close') {
      continueGuard?.()
      continueTransport?.()
      analyticsReleases.forEach((release) => release())
      await runtime?.close()
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
