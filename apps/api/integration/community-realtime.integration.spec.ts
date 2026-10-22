import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { PrismaClient } from '@prisma/client'
import { io, type Socket } from 'socket.io-client'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  buildLookbookPostCreateInput,
  createLookbookPost,
  createUser,
  persistUser,
} from '@couture/testing'
import { isolatedCommunityDatabase } from './helpers/isolated-community-database.js'
import { createCommunityRealtimeServer } from '../src/realtime/community-realtime.server.js'
import { communityRealtimeInstance } from '../src/realtime/community-realtime-instance.js'
import { communityRealtimeConnectedSchema } from '@couture/api-client/contracts/http'
import { AccessTokenIdentityService } from '../src/modules/auth/access-token-identity.service.js'
import { CommunityAccessService } from '../src/modules/community/community-access.service.js'
import { CommunityStreamRepository } from '../src/modules/community/community-stream.repository.js'
import { CommunityFlagEvaluationService } from '../src/modules/feature-flags/community-flag-evaluation.service.js'
import { FeatureFlagsService } from '../src/modules/feature-flags/feature-flags.service.js'
import { FeatureFlagsRepository } from '../src/modules/feature-flags/feature-flags.repository.js'

const db = isolatedCommunityDatabase()
const prisma = new PrismaClient({ datasources: { db: { url: db.url } } })
const streams = new CommunityStreamRepository(prisma)
const remote = { getFeatureFlagValue: vi.fn(() => Promise.resolve<unknown>(true)) }
const access = new CommunityAccessService(
  prisma,
  new FeatureFlagsService(
    new FeatureFlagsRepository(prisma),
    remote,
    new CommunityFlagEvaluationService(prisma, remote)
  )
)
const sockets: Socket[] = []
const runtimes: ReturnType<typeof createCommunityRealtimeServer>[] = []
beforeAll(async () => {
  await db.migrate()
  vi.stubEnv('TEST_ENV', 'local')
  vi.stubEnv('COMMUNITY_FLAG_FIXTURE_MODE', 'false')
}, 30_000)
afterEach(async () => {
  sockets.splice(0).forEach((socket) => socket.disconnect())
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()))
})
afterAll(async () => {
  await prisma.$disconnect()
  await db.drop()
  vi.unstubAllEnvs()
})
function fixtureToken(member: string, expires = Date.now() + 60_000) {
  // Explicit local fixture-auth lane. Supabase signed-session proof is a separate gate.
  return `e30.${Buffer.from(
    JSON.stringify({
      sub: member,
      role: 'guardian',
      exp: Math.floor(expires / 1000),
      e2e: 'couturecast-mobile-e2e',
    })
  ).toString('base64url')}.couturecast-mobile-e2e`
}
async function fixture() {
  return persistUser(
    prisma,
    createUser({ profilePreferences: { compliance: { accountStatus: 'active' } } })
  )
}
async function instance(
  assistance: Pick<CommunityStreamRepository, 'assist'> = streams,
  identity = new AccessTokenIdentityService(prisma)
) {
  const runtime = createCommunityRealtimeServer(() =>
    Promise.resolve({
      prisma,
      access,
      streams: assistance,
      identity,
      origins: ['https://story65.synthetic.test'],
    })
  )
  runtimes.push(runtime)
  await new Promise<void>((resolve) => runtime.server.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${(runtime.server.address() as AddressInfo).port}`
}
function client(baseUrl: string, token?: string, origin?: string) {
  const socket = io(`${baseUrl}/community`, {
    path: '/api/realtime',
    addTrailingSlash: false,
    transports: ['websocket'],
    auth: token ? { token } : {},
    reconnection: false,
    forceNew: true,
    autoConnect: false,
    ...(origin ? { extraHeaders: { Origin: origin } } : {}),
  })
  sockets.push(socket)
  return socket
}
async function connect(socket: Socket) {
  const connected = new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve)
    socket.once('connect_error', reject)
  })
  socket.connect()
  await connected
}
function next<T>(socket: Socket, event: string): Promise<T> {
  return new Promise((resolve) => socket.once(event, resolve))
}

describe('Story 6.5 real local websocket-only transport with isolated fixture auth', () => {
  it('A02 real identity dependency failures use strict unavailable and recover on a fresh handshake', async () => {
    const member = await fixture()
    vi.stubEnv('SUPABASE_URL', 'https://story65.identity.invalid')
    vi.stubEnv('SUPABASE_ANON_KEY', 'synthetic-key')
    const ambiguousEmail = `ambiguous-${randomUUID()}@synthetic.test`
    await prisma.user.createMany({
      data: [{ email: ambiguousEmail }, { email: ambiguousEmail.toUpperCase() }],
    })
    let mode = '503'
    const provider = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      if (mode === 'network')
        return Promise.reject(new TypeError('isolated connection failure'))
      if (mode === 'json') return Promise.resolve(new Response('<html>', { status: 200 }))
      if (mode === 'shape') return Promise.resolve(Response.json([]))
      if (mode === 'empty') return Promise.resolve(Response.json({}))
      if (mode === 'mapping' || mode === 'ambiguous')
        return Promise.resolve(
          Response.json({
            email: mode === 'mapping' ? 'unmapped@synthetic.test' : ambiguousEmail,
            email_verified: true,
          })
        )
      if (mode === 'db')
        return Promise.resolve(
          Response.json({ email: member.email, email_verified: true })
        )
      if (mode === 'ready')
        return Promise.resolve(
          Response.json({
            app_metadata: { app_user_id: member.id, app_role: 'guardian' },
          })
        )
      return Promise.resolve(Response.json({}, { status: Number(mode) }))
    })
    const token = `e30.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 120 })).toString('base64url')}.signature`
    const refused = new URL(db.url)
    refused.port = '1'
    refused.searchParams.set('connect_timeout', '1')
    const broken = new PrismaClient({ datasources: { db: { url: refused.toString() } } })
    let database = prisma
    const identity = new AccessTokenIdentityService(
      new Proxy(prisma, {
        get: (target, key): unknown =>
          key === 'user' ? database.user : Reflect.get(target, key),
      })
    )
    try {
      const base = await instance(streams, identity)
      for (mode of [
        '503',
        '429',
        'network',
        'json',
        'shape',
        'db',
        '401',
        '403',
        'mapping',
        'ambiguous',
      ]) {
        database = mode === 'db' ? broken : prisma
        const start = performance.now()
        await expect(connect(client(base, token))).rejects.toMatchObject({
          data: {
            version: 1,
            status: ['401', '403', 'mapping', 'ambiguous'].includes(mode)
              ? 'denied'
              : 'unavailable',
          },
        })
        expect(performance.now() - start).toBeLessThan(2000)
      }
      database = prisma
      mode = 'ready'
      const recovered = client(base, token)
      await connect(recovered)
      expect(recovered.connected).toBe(true)
    } finally {
      provider.mockRestore()
      await broken.$disconnect()
    }
  })

  it('R02 optional append failure cannot disconnect a verified socket or prevent an independent head doorbell', async () => {
    const member = await fixture()
    const socket = client(
      await instance({ assist: () => Promise.reject(new Error('optional failure')) }),
      fixtureToken(member.id)
    )
    await connect(socket)
    const received = next(socket, 'community:changed')
    await prisma.lookbookPost.create({
      data: buildLookbookPostCreateInput(
        createLookbookPost({ userId: member.id, status: 'published' })
      ),
    })
    await streams.append()
    expect(await received).toEqual({ version: 1, type: 'community:changed' })
    expect(socket.connected).toBe(true)
  }, 5000)

  it('R03 primary revalidation starts remain below eight seconds with a slow optional assist', async () => {
    const member = await fixture()
    const backend = new CommunityAccessService(
      prisma,
      new FeatureFlagsService(
        new FeatureFlagsRepository(prisma),
        remote,
        new CommunityFlagEvaluationService(prisma, remote)
      )
    )
    const starts: number[] = []
    const proof = vi.spyOn(access, 'authorize').mockImplementation((...args) => {
      starts.push(performance.now())
      return backend.authorize(...args)
    })
    try {
      const socket = client(
        await instance({
          assist: async () => {
            await new Promise((resolve) => setTimeout(resolve, 200))
            return streams.assist()
          },
        }),
        fixtureToken(member.id)
      )
      await connect(socket)
      // Handshake plus two revalidations. D1 allows each revalidation up to 8 s after the
      // previous start (jittered per socket), so two can take up to 16 s; the bound under
      // test is the interval assertion below, unchanged.
      await vi.waitFor(() => expect(starts.length).toBeGreaterThanOrEqual(3), {
        timeout: 17000,
        interval: 100,
      })
      const intervals = starts.slice(1).map((start, index) => start - starts[index]!)
      console.info(
        JSON.stringify({
          evidence: 'R03',
          boundary: 'actual-local-socket-authorization-starts',
          intervals,
        })
      )
      expect(Math.max(...intervals)).toBeLessThanOrEqual(8000)
    } finally {
      proof.mockRestore()
    }
  }, 20000)

  it('6.5-INT-007: separate instances assist committed work without a screening worker', async () => {
    const member = await fixture()
    const a = client(await instance(), fixtureToken(member.id))
    const b = client(
      await instance(),
      fixtureToken(member.id),
      'https://story65.synthetic.test'
    )
    await Promise.all([connect(a), connect(b)])
    expect(a.io.engine.transport.name).toBe('websocket')
    expect(b.io.engine.transport.name).toBe('websocket')
    const bells = [next(a, 'community:changed'), next(b, 'community:changed')]
    const started = performance.now()
    await prisma.lookbookPost.create({
      data: buildLookbookPostCreateInput(
        createLookbookPost({ userId: member.id, status: 'published' })
      ),
    })
    const received = await Promise.all(bells)
    expect(received).toEqual([
      { version: 1, type: 'community:changed' },
      { version: 1, type: 'community:changed' },
    ])
    expect(performance.now() - started).toBeLessThan(10_000)
    expect(
      await prisma.communityDomainOutbox.count({ where: { appended_at: null } })
    ).toBe(0)
  }, 12_000)

  /**
   * A rejection decided before any identity is verified is a transport refusal: it carries
   * no `community:availability` control, so clients keep polling HTTP, which authorizes
   * independently. Only an outcome about a verified identity is an affirmative `denied`.
   */
  async function refusedWithoutControl(socket: Socket) {
    const error: unknown = await connect(socket).then(
      () => {
        throw new Error('Expected the handshake to be refused')
      },
      (reason: unknown) => reason
    )
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe('Community connection unavailable.')
    expect((error as { data?: unknown }).data).toBeUndefined()
    expect(socket.connected).toBe(false)
  }

  it.each([
    ['native bearer without Origin', () => undefined],
    ['allowed browser Origin', () => 'https://story65.synthetic.test'],
    // React Native's WebSocket always sends a default Origin built from the socket URL.
    ['native default Origin of the socket host', (base: string) => base],
  ] as const)(
    '6.5-INT-008: %s with a verified bearer connects',
    async (_label, origin) => {
      const member = await fixture()
      const base = await instance()
      const socket = client(base, fixtureToken(member.id), origin(base))
      await connect(socket)
      expect(socket.connected).toBe(true)
    }
  )

  it('6.5-INT-008: a foreign browser Origin is refused without a denial control', async () => {
    const member = await fixture()
    const socket = client(
      await instance(),
      fixtureToken(member.id),
      'https://denied.synthetic.test'
    )
    await refusedWithoutControl(socket)
  })

  it('6.5-INT-008: a verified bearer larger than 1 KB connects', async () => {
    // Supabase access tokens carry user and app metadata; 1.5 KB and more is ordinary.
    const member = await fixture()
    const token = `e30.${Buffer.from(
      JSON.stringify({
        sub: member.id,
        role: 'guardian',
        exp: Math.floor((Date.now() + 60_000) / 1000),
        e2e: 'couturecast-mobile-e2e',
        user_metadata: { profile: 'm'.repeat(1400) },
      })
    ).toString('base64url')}.couturecast-mobile-e2e`
    expect(token.length).toBeGreaterThan(1500)
    expect(token.length).toBeLessThanOrEqual(8192)
    const socket = client(await instance(), token)
    await connect(socket)
    expect(socket.connected).toBe(true)
  })

  it('6.5-INT-008: malformed Origins and malformed bearers are refused without a denial control', async () => {
    const member = await fixture()
    const base = await instance()
    // Sandboxed frames and file:// pages send the literal Origin "null".
    await refusedWithoutControl(client(base, fixtureToken(member.id), 'null'))
    const raw = (auth: Record<string, unknown>) => {
      const socket = io(`${base}/community`, {
        path: '/api/realtime',
        addTrailingSlash: false,
        transports: ['websocket'],
        auth,
        reconnection: false,
        forceNew: true,
        autoConnect: false,
      })
      sockets.push(socket)
      return socket
    }
    await refusedWithoutControl(raw({ token: 42 }))
    // A bearer whose expiry cannot be read is treated as already expired.
    await refusedWithoutControl(raw({ token: 'e30.bm90LWpzb24.signature' }))
    await refusedWithoutControl(
      raw({
        token: `e30.${Buffer.from(JSON.stringify({ sub: member.id })).toString('base64url')}.sig`,
      })
    )
    await refusedWithoutControl(raw({ token: 'x'.repeat(8193) }))
  })

  it('6.5-INT-008: cookie-only and expired bearer handshakes fail closed', async () => {
    const member = await fixture()
    const base = await instance()
    await refusedWithoutControl(client(base))
    // The socket host's own Origin never stands in for a bearer.
    const cookieOnly = io(`${base}/community`, {
      path: '/api/realtime',
      addTrailingSlash: false,
      transports: ['websocket'],
      reconnection: false,
      forceNew: true,
      autoConnect: false,
      extraHeaders: {
        Origin: base,
        Cookie: `sb-access-token=${fixtureToken(member.id)}`,
      },
    })
    sockets.push(cookieOnly)
    await refusedWithoutControl(cookieOnly)
    await refusedWithoutControl(client(base, fixtureToken(member.id, Date.now() - 1000)))
  })

  it('6.5-INT-010: every connection is acknowledged with this process instance value and nothing else', async () => {
    const member = await fixture()
    const a = client(await instance(), fixtureToken(member.id))
    const b = client(await instance(), fixtureToken(member.id))
    const acknowledgements = [
      next(a, 'community:connected'),
      next(b, 'community:connected'),
    ]
    await Promise.all([connect(a), connect(b)])
    const [first, second] = await Promise.all(acknowledgements)
    // Two servers in one process share one instance value; a strict schema admits no
    // host, region, member or request data alongside it.
    expect(communityRealtimeConnectedSchema.parse(first)).toEqual({
      version: 1,
      instance: communityRealtimeInstance,
    })
    expect(second).toEqual(first)
  })

  it('6.5-INT-009: private-only activity does not ring another member and denial closes with generic control', async () => {
    const owner = await fixture()
    const other = await fixture()
    const base = await instance()
    const a = client(base, fixtureToken(owner.id))
    const b = client(base, fixtureToken(other.id))
    await Promise.all([connect(a), connect(b)])
    const otherBell = vi.fn()
    b.on('community:changed', otherBell)
    const ownBell = next(a, 'community:changed')
    const privateHead = await prisma.communityStreamHead.findUniqueOrThrow({
      where: { owner_id: owner.id },
    })
    await prisma.communityDomainOutbox.create({
      data: {
        id: randomUUID(),
        stream_id: privateHead.id,
        kind: 'comment.status',
        revision: 1,
      },
    })
    await ownBell
    expect(otherBell).not.toHaveBeenCalled()
    const denied = next(b, 'community:availability')
    const disconnected = next(b, 'disconnect')
    await prisma.userProfile.update({
      where: { user_id: other.id },
      data: { preferences: { compliance: { accountStatus: 'suspended' } } },
    })
    // Force the next tick to revalidate before attempting any public doorbell.
    await prisma.lookbookPost.create({
      data: buildLookbookPostCreateInput(
        createLookbookPost({ userId: owner.id, status: 'published' })
      ),
    })
    expect(await denied).toEqual({ version: 1, status: 'denied' })
    await disconnected
    expect(otherBell).not.toHaveBeenCalled()
  }, 12_000)
})
