// Story 6.5 acceptance: the compiled engagement runtime as production composes it.
//
// Same `startCommunityEngagementRuntime(new PrismaClient(), remote)` call as
// `src/workers/bootstrap.ts`, with the default primary pool and the runtime's own 36-connection
// guard pool. Only external I/O is replaced: Expo goes to the owned recorder, flags to the
// owned loopback remote, analytics acknowledgements are counted.
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
require('reflect-metadata')
const primary = new URL(process.env.DATABASE_URL)
if (!/^\/tea_community_[a-f0-9]{32}$/.test(primary.pathname))
  throw new Error('Isolated UUID DB required')
const { PrismaClient } = require('@prisma/client')
const {
  startCommunityEngagementRuntime,
} = require('../../dist/src/modules/community/community-engagement.runtime.js')

const provider = process.env.STORY65_PROVIDER_ENDPOINT
const flags = process.env.STORY65_FLAG_REMOTE_ENDPOINT
const nativeFetch = globalThis.fetch
globalThis.fetch = async (input, init) => {
  const destination = new URL(typeof input === 'string' ? input : input.url)
  if (destination.hostname === 'exp.host')
    return nativeFetch(
      destination.pathname.endsWith('/getReceipts')
        ? new URL('/receipts', provider).toString()
        : provider,
      init
    )
  if (destination.hostname !== '127.0.0.1') throw new Error('Unapproved external request')
  return nativeFetch(input, init)
}
const counts = { flagCalls: 0, analytics: 0, analyticsHeld: 0 }
// Held acknowledgements model a stalled analytics sink; the runtime's own deadline still applies.
let holdAnalytics = false
const analyticsReleases = new Set()
const remote = {
  async getFeatureFlagValue(_flag, member, options) {
    counts.flagCalls++
    const response = await fetch(`${flags}?member=${encodeURIComponent(member)}`, {
      signal: options?.signal,
    })
    if (!response.ok) throw new Error('Remote flag provider failure')
    return (await response.json()).value
  },
  captureAcknowledged: (_event, options) => {
    counts.analytics++
    if (!holdAnalytics) return Promise.resolve()
    counts.analyticsHeld++
    return new Promise((resolve, reject) => {
      const finish = () => {
        options?.signal?.removeEventListener('abort', abort)
        analyticsReleases.delete(finish)
        resolve()
      }
      const abort = () => {
        analyticsReleases.delete(finish)
        reject(new Error('Controlled analytics deadline'))
      }
      analyticsReleases.add(finish)
      options?.signal?.addEventListener('abort', abort, { once: true })
    })
  },
}
const prisma = new PrismaClient()
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
    if (op === 'start') {
      runtime = await startCommunityEngagementRuntime(prisma, remote, args ?? 'general')
      value = runtime.dispatch
    }
    if (op === 'counts') value = { ...counts }
    if (op === 'analytics') {
      holdAnalytics = args
      if (!args) analyticsReleases.forEach((release) => release())
    }
    if (op === 'close') {
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
