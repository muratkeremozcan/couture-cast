// Story 6.5 owner: dedicated WebSocket-only, identifier-free community doorbells.
import { createServer, type Server as HttpServer } from 'node:http'
import { Server, type Socket } from 'socket.io'
import { ForbiddenException, UnauthorizedException } from '@nestjs/common'
import type { PrismaClient } from '@prisma/client'
import type { AccessTokenIdentityService } from '../modules/auth/access-token-identity.service.js'
import type { CommunityAccessService } from '../modules/community/community-access.service.js'
import {
  CommunityAuthorizationBudget,
  type CommunityGrant,
} from '../modules/community/community-availability.js'
import type { CommunityStreamRepository } from '../modules/community/community-stream.repository.js'
import { createBaseLogger } from '../logger/pino.config.js'
import { communityRealtimeInstance } from './community-realtime-instance.js'

export type CommunityRealtimeDependencies = {
  prisma: PrismaClient
  identity: Pick<AccessTokenIdentityService, 'resolveIdentity'>
  access: Pick<CommunityAccessService, 'assert'> &
    Partial<Pick<CommunityAccessService, 'authorize'>>
  streams: Pick<CommunityStreamRepository, 'assist'>
  origins: string[]
  release?: () => Promise<void>
}
type Connection = {
  member: string
  expiresAt: number
  checkedAt: number
  publicHead: string
  privateHead: string
  lastBell: number
  connectedAt: number
  /** Jittered per socket so one instance's sockets never revalidate in lockstep. */
  revalidateAfter: number
}
/**
 * Per-socket revalidation interval, 4 to 6 s. Ticks run about every second and a loaded
 * tick can start late, so the upper end leaves two seconds of headroom under D1's eight
 * seconds while still spreading a reconnect herd across a two-second window.
 */
const revalidationInterval = () => 4000 + Math.random() * 2000
/**
 * Concurrent member authorizations per instance, across handshakes and ticks. Each one is a
 * pool transaction with a 100 ms acquisition wait; unbounded, a herd of sockets waited past
 * the 2 s budget and healthy members were told the service was unavailable. Time spent
 * queued here still counts against each request's own budget.
 */
const AUTHORIZATION_CONCURRENCY = 3
function concurrencyLimit(limit: number) {
  let active = 0
  const waiting: (() => void)[] = []
  return async <T>(work: () => Promise<T>): Promise<T> => {
    while (active >= limit) await new Promise<void>((resolve) => waiting.push(resolve))
    active++
    try {
      return await work()
    } finally {
      active--
      waiting.shift()?.()
    }
  }
}
/** Why a check failed, for logs: an error class or code, never an identifier. */
function failureReason(error: unknown): string {
  if (error instanceof ForbiddenException) return 'denied'
  const cause: unknown =
    error && typeof error === 'object' && 'cause' in error ? error.cause : undefined
  for (const candidate of [error, cause])
    if (
      candidate &&
      typeof candidate === 'object' &&
      'code' in candidate &&
      typeof candidate.code === 'string'
    )
      return candidate.code
  return error instanceof Error ? error.name : 'unknown'
}
/**
 * A handshake refused before any identity is verified: a foreign Origin, no bearer, or a
 * bearer already past its own expiry. It is a transport refusal, not an affirmative denial,
 * so it carries no `community:availability` control. Clients treat it as an ordinary
 * disconnect and keep polling HTTP, which authorizes independently.
 */
class HandshakeRefused extends Error {}
/**
 * React Native's WebSocket always sends a default Origin built from the socket URL. An Origin
 * naming this server's own host is therefore the native client's absent Origin: it is allowed
 * only with a bearer in handshake auth, which is then verified like any other.
 */
function sameHostOrigin(origin: string, host: string | undefined) {
  try {
    return Boolean(host) && new URL(origin).host === host
  } catch {
    return false
  }
}
const control = (socket: Socket, status: 'denied' | 'unavailable') => {
  socket.emit('community:availability', { version: 1, status })
  socket.disconnect(true)
}
function expiry(token: string): number {
  try {
    const payload: unknown = JSON.parse(
      Buffer.from(token.split('.')[1] ?? '', 'base64url').toString()
    )
    if (
      payload &&
      typeof payload === 'object' &&
      'exp' in payload &&
      typeof payload.exp === 'number'
    )
      return payload.exp * 1000
  } catch {
    /* Unverified input still requires real identity validation. */
  }
  return 0
}

export function attachCommunityRealtime(
  server: HttpServer,
  dependencies: () => Promise<CommunityRealtimeDependencies>
) {
  const io = new Server(server, {
    path: '/api/realtime',
    addTrailingSlash: false,
    transports: ['websocket'],
    serveClient: false,
    destroyUpgrade: false,
    // The handshake CONNECT packet carries the bearer, and the handshake below accepts one
    // of up to 8192 characters. A smaller engine limit silently drops ordinary Supabase
    // tokens (user and app metadata push them past 1 KB) before identity is checked.
    // Clients send no other messages on this namespace.
    maxHttpBufferSize: 16 * 1024,
    pingInterval: 10_000,
    pingTimeout: 5000,
  })
  const namespace = io.of('/community')
  const logger = createBaseLogger().child({ feature: 'community-realtime' })
  const limited = concurrencyLimit(AUTHORIZATION_CONCURRENCY)
  const connections = new Map<Socket, Connection>()
  const authorized = new WeakMap<Socket, Connection>()
  let timer: ReturnType<typeof setTimeout> | undefined
  let closing = false
  let running = false
  let assistance: Promise<void> | undefined
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  let lastDependencies: CommunityRealtimeDependencies | undefined
  let handshakes = 0
  const releaseIdle = () => {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => {
      idleTimer = undefined
      if (connections.size || handshakes || running) {
        if (!connections.size) releaseIdle()
        return
      }
      const previous = lastDependencies
      lastDependencies = undefined
      void previous?.release?.().catch(() => undefined)
    }, 1000)
    idleTimer.unref?.()
  }
  const timers = new Map<Socket, ReturnType<typeof setTimeout>>()
  const remove = (socket: Socket) => {
    connections.delete(socket)
    const expiryTimer = timers.get(socket)
    if (expiryTimer) clearTimeout(expiryTimer)
    timers.delete(socket)
    if (!connections.size && timer) {
      clearTimeout(timer)
      timer = undefined
    }
    if (!connections.size && !closing) releaseIdle()
  }
  const schedule = () => {
    if (!timer && connections.size && !closing) {
      timer = setTimeout(() => {
        timer = undefined
        schedule()
        void tick()
      }, 1000)
      timer.unref?.()
    }
  }
  const authorize = async (
    deps: CommunityRealtimeDependencies,
    member: string,
    budget: CommunityAuthorizationBudget
  ): Promise<CommunityGrant> =>
    limited(async () => {
      budget.check()
      if (deps.access.authorize) return deps.access.authorize(member, budget)
      // Explicit injected test adapters retain the existing assert-only interface.
      await budget.run(() => deps.access.assert(member))
      return {
        value: true,
        expiresAt: new Date(Date.now() + budget.remaining()),
        validUntil: budget.deadline,
      }
    })
  const tick = async () => {
    if (running || closing) return
    running = true
    const started = performance.now()
    const budget = new CommunityAuthorizationBudget()
    try {
      const deps = await budget.run(dependencies)
      lastDependencies = deps
      if (!assistance) {
        assistance = Promise.resolve()
          .then(() => deps.streams.assist())
          .then(() => undefined)
          .catch(() => undefined)
          .finally(() => {
            assistance = undefined
          })
      }
      const failures = new Map<string, number>()
      const fail = (socket: Socket, error: unknown) => {
        const reason = failureReason(error)
        failures.set(reason, (failures.get(reason) ?? 0) + 1)
        control(socket, error instanceof ForbiddenException ? 'denied' : 'unavailable')
      }
      const checks = new Map<string, Promise<CommunityGrant>>()
      const check = (member: string) => {
        let existing = checks.get(member)
        if (!existing) {
          existing = authorize(deps, member, budget)
          checks.set(member, existing)
        }
        return existing
      }
      // Revalidation starts from the prior invocation start, independently of optional work.
      await Promise.all(
        [...connections].map(async ([socket, state]) => {
          if (
            Date.now() >= state.expiresAt ||
            Date.now() - state.connectedAt >= 295_000
          ) {
            socket.disconnect(true)
            return
          }
          if (started - state.checkedAt < state.revalidateAfter) return
          state.checkedAt = started
          state.revalidateAfter = revalidationInterval()
          try {
            budget.check(await check(state.member))
          } catch (error) {
            fail(socket, error)
          }
        })
      )
      if (!connections.size) return
      const members = [...new Set([...connections.values()].map((c) => c.member))]
      const heads = await budget.run(() =>
        deps.prisma.communityStreamHead.findMany({
          where: { OR: [{ id: 'public' }, { owner_id: { in: members } }] },
        })
      )
      const publicHead = heads.find((h) => h.id === 'public')
      const key = (head: typeof publicHead) =>
        head ? `${head.epoch}:${head.sequence}` : ''
      await Promise.all(
        [...connections].map(async ([socket, state]) => {
          const currentPublic = key(publicHead)
          const currentPrivate = key(heads.find((h) => h.owner_id === state.member))
          if (currentPublic === state.publicHead && currentPrivate === state.privateHead)
            return
          try {
            state.checkedAt = started
            state.revalidateAfter = revalidationInterval()
            const grant = await check(state.member)
            budget.check(grant)
            if (
              !socket.connected ||
              !connections.has(socket) ||
              Date.now() >= state.expiresAt
            )
              return
            if (Date.now() - state.lastBell < 1000) return
            socket.emit('community:changed', { version: 1, type: 'community:changed' })
            state.lastBell = Date.now()
            state.publicHead = currentPublic
            state.privateHead = currentPrivate
          } catch (error) {
            fail(socket, error)
          }
        })
      )
      if (failures.size)
        logger.warn(
          { reasons: Object.fromEntries(failures) },
          'community_realtime_revalidation_failed'
        )
    } catch (error) {
      logger.error(
        { reason: failureReason(error), sockets: connections.size },
        'community_realtime_tick_failed'
      )
      for (const socket of connections.keys()) control(socket, 'unavailable')
    } finally {
      running = false
    }
  }
  namespace.use((socket, next) => {
    handshakes++
    if (idleTimer) clearTimeout(idleTimer)
    void (async () => {
      const budget = new CommunityAuthorizationBudget()
      const deps = await budget.run(dependencies)
      lastDependencies = deps
      const origin = socket.handshake.headers.origin
      if (
        origin &&
        !deps.origins.includes(origin) &&
        !sameHostOrigin(origin, socket.handshake.headers.host)
      )
        throw new HandshakeRefused()
      // Cookies are never read: a bearer in handshake auth is the only credential.
      const token: unknown = socket.handshake.auth.token
      if (typeof token !== 'string' || !token || token.length > 8192)
        throw new HandshakeRefused()
      const expiresAt = expiry(token)
      if (expiresAt <= Date.now()) throw new HandshakeRefused()
      const identity = await budget.run(() => deps.identity.resolveIdentity(token))
      const checkedAt = performance.now()
      const grant = await authorize(deps, identity.userId, budget)
      const heads = await budget.run(() =>
        deps.prisma.communityStreamHead.findMany({
          where: { OR: [{ id: 'public' }, { owner_id: identity.userId }] },
        })
      )
      budget.check(grant)
      // The bearer lapsed during the handshake: a fresh token on reconnect resolves it.
      if (expiresAt <= Date.now()) throw new HandshakeRefused()
      const key = (id: string) => {
        const h = heads.find((head) => head.id === id || head.owner_id === id)
        return h ? `${h.epoch}:${h.sequence}` : ''
      }
      authorized.set(socket, {
        member: identity.userId,
        expiresAt,
        checkedAt,
        publicHead: key('public'),
        privateHead: key(identity.userId),
        lastBell: 0,
        connectedAt: Date.now(),
        revalidateAfter: revalidationInterval(),
      } satisfies Connection)
    })()
      .then(() => next())
      .catch((error: unknown) => {
        if (error instanceof HandshakeRefused) {
          next(new Error('Community connection unavailable.'))
          return
        }
        const failure = Object.assign(new Error('Community connection unavailable.'), {
          data: {
            version: 1,
            status:
              error instanceof ForbiddenException ||
              error instanceof UnauthorizedException
                ? 'denied'
                : 'unavailable',
          },
        })
        next(failure)
      })
      .finally(() => {
        handshakes--
        if (!connections.size) releaseIdle()
      })
  })
  namespace.on('connection', (socket) => {
    const state = authorized.get(socket)
    if (!state) {
      socket.disconnect(true)
      return
    }
    connections.set(socket, state)
    socket.emit('community:connected', {
      version: 1,
      instance: communityRealtimeInstance,
    })
    const expiration = setTimeout(
      () => socket.disconnect(true),
      Math.max(
        1,
        Math.min(state.expiresAt - Date.now(), 295_000 - (Date.now() - state.connectedAt))
      )
    )
    expiration.unref?.()
    timers.set(socket, expiration)
    socket.once('disconnect', () => remove(socket))
    schedule()
  })
  const close = async () => {
    closing = true
    if (timer) clearTimeout(timer)
    if (idleTimer) clearTimeout(idleTimer)
    for (const socket of connections.keys()) {
      remove(socket)
      socket.disconnect(true)
    }
    const previous = lastDependencies
    lastDependencies = undefined
    await io.close()
    await previous?.release?.()
  }
  server.once('close', () => {
    closing = true
    if (timer) clearTimeout(timer)
    if (idleTimer) clearTimeout(idleTimer)
    for (const socket of connections.keys()) remove(socket)
    const previous = lastDependencies
    lastDependencies = undefined
    void previous?.release?.().catch(() => undefined)
  })
  return { io, close }
}
export function createCommunityRealtimeServer(
  dependencies: () => Promise<CommunityRealtimeDependencies>
) {
  const server = createServer((_request, response) => {
    response.writeHead(426)
    response.end()
  })
  const runtime = attachCommunityRealtime(server, dependencies)
  return { server, ...runtime }
}
