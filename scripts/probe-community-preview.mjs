#!/usr/bin/env node
// Story 6.5 O1 / OPS-001..003: hosted realtime probe for a protected Vercel preview.
//
// Proves, against the deployed API, what the hosted socket route actually does: the 101
// upgrade on /api/realtime, the Origin matrix, identifier-free doorbells, commit-to-doorbell
// latency, distinct realtime instances (when the server acknowledges one), and a connection
// that lives through the server's 295 s recycle and catches up exactly once.
//
// Identities are the API's fixture bearers, which the preview accepts behind Vercel
// deployment protection (VERCEL_ENV=preview). The protection bypass value is read from the
// environment, sent only as a request header, and never written to output.
//
// CLI: PROBE_API_BASE_URL=... [PROBE_WEB_ORIGIN=...] [VERCEL_AUTOMATION_BYPASS_SECRET=...]
//      [PROBE_READER_USER_ID=... PROBE_WRITER_USER_ID=...] [PROBE_ALLOW_LOCAL_TARGET=1 loopback only] [PROBE_HOLD_MS=320000] [PROBE_SOCKETS=6] [PROBE_SAMPLES=5] [PROBE_OUT=evidence.json]
//      node scripts/probe-community-preview.mjs
import fs from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { io } from 'socket.io-client'
import WebSocket from 'ws'

const DOORBELL = JSON.stringify({ version: 1, type: 'community:changed' })
const RECYCLE_MS = 295_000
const FOREIGN_ORIGIN = 'https://origin-probe.invalid'
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])
const LATENCY_BOUND_MS = 10_000
// Longer than the bound, so a late doorbell fails the latency claim instead of passing it.
const DOORBELL_WAIT_MS = 20_000
const PUBLISH_WAIT_MS = 90_000
const FIXTURE_DIR = new URL(
  '../apps/api/test/fixtures/community-moderation/v1/',
  import.meta.url
)
const FIXTURE_FILE = 'safe-satin-plum-512x512.jpg'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const expiresAt = (bearer) =>
  JSON.parse(Buffer.from(bearer.split('.')[1], 'base64url').toString()).exp
const digest = (value) => createHash('sha256').update(value).digest('hex').slice(0, 12)

/** The API's fixture bearer shape; `exp` is required by the realtime handshake. */
export function fixtureBearer(userId, ttlSeconds) {
  const claims = {
    sub: userId,
    role: 'guardian',
    e2e: 'couturecast-mobile-e2e',
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  }
  return `test-token.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.couturecast-mobile-e2e`
}

function birthdate(yearsAgo) {
  const today = new Date()
  return new Date(
    Date.UTC(
      today.getUTCFullYear() - yearsAgo,
      today.getUTCMonth(),
      today.getUTCDate(),
      12
    )
  )
    .toISOString()
    .slice(0, 10)
}

function client({ apiBaseUrl, bypass }) {
  const base = apiBaseUrl.replace(/\/$/, '')
  const protection = bypass ? { 'x-vercel-protection-bypass': bypass } : {}
  async function http(method, path, { bearer, body, headers = {} } = {}) {
    for (let attempt = 0; ; attempt++) {
      const response = await fetch(`${base}${path}`, {
        method,
        headers: {
          ...protection,
          'x-couture-platform': 'web',
          'x-couture-reactions': '1',
          ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
          ...(body ? { 'content-type': 'application/json' } : {}),
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
      })
      const text = await response.text()
      const json = text ? safeJson(text) : null
      if (response.status === 429 && attempt < 3) {
        await sleep(Number(response.headers.get('retry-after') ?? '5') * 1000 + 250)
        continue
      }
      return { status: response.status, json, headers: response.headers }
    }
  }
  function socket({ bearer, origin, collect }) {
    return new Promise((resolve) => {
      const extraHeaders = { ...protection, ...(origin ? { origin } : {}) }
      const s = io(`${base}/community`, {
        path: '/api/realtime',
        addTrailingSlash: false,
        transports: ['websocket'],
        auth: bearer ? { token: bearer } : {},
        reconnection: false,
        forceNew: true,
        timeout: 8000,
        extraHeaders,
      })
      const events = []
      s.onAny((event, ...args) => {
        events.push({ event, at: performance.now(), args })
        collect?.(event, args)
      })
      s.once('connect', () =>
        resolve({ connected: true, socket: s, events, at: performance.now() })
      )
      s.once('connect_error', (error) => {
        s.close()
        resolve({
          connected: false,
          message: error?.message ?? String(error),
          control:
            error && typeof error === 'object' && 'data' in error
              ? (error.data ?? null)
              : null,
          events,
        })
      })
    })
  }
  return { base, http, socket, protection }
}

function safeJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/** Finds an instance acknowledgement anywhere in the events a socket received on connect. */
function instanceNonce(events) {
  for (const { args } of events) {
    for (const arg of args) {
      if (arg && typeof arg === 'object') {
        for (const [key, value] of Object.entries(arg)) {
          if (/instance|nonce/i.test(key) && typeof value === 'string') return value
        }
      }
    }
  }
  return null
}

async function signup(api, label) {
  const response = await api.http('POST', '/api/v1/auth/signup', {
    body: {
      email: `preview-probe-${label}-${randomUUID()}@example.com`,
      birthdate: birthdate(30),
    },
  })
  if (response.status !== 201 || !response.json?.userId)
    throw new Error(`signup ${label} answered ${response.status}`)
  return response.json.userId
}

async function readAll(api, bearer, cursor) {
  const events = []
  let next = cursor
  for (let page = 0; page < 50; page++) {
    const path = `/api/v1/community/events?mode=all${next ? `&cursor=${encodeURIComponent(next)}` : ''}`
    const response = await api.http('GET', path, { bearer })
    if (response.status !== 200) return { status: response.status, events, cursor: next }
    const data = response.json.data
    events.push(...data.events)
    next = data.nextCursor
    if (!data.hasMore)
      return { status: 200, events, cursor: next, resyncRequired: data.resyncRequired }
  }
  return { status: 200, events, cursor: next }
}

async function react(api, bearer, postId, selection, baseRevision) {
  const body = { selection, mutationId: randomUUID(), baseRevision }
  const started = performance.now()
  let response = await api.http('PUT', `/api/v1/community/posts/${postId}/reaction`, {
    bearer,
    body,
  })
  if (response.status === 409 && response.json?.data) {
    response = await api.http('PUT', `/api/v1/community/posts/${postId}/reaction`, {
      bearer,
      body: {
        ...body,
        mutationId: randomUUID(),
        baseRevision: response.json.data.revision,
      },
    })
  }
  if (response.status !== 200) throw new Error(`reaction answered ${response.status}`)
  return { started, committed: performance.now(), revision: response.json.data.revision }
}

function waitFor(predicate, timeoutMs) {
  return new Promise((resolve) => {
    const started = performance.now()
    const tick = () => {
      const value = predicate()
      if (value) return resolve(value)
      if (performance.now() - started >= timeoutMs) return resolve(null)
      setTimeout(tick, 25)
    }
    tick()
  })
}

const notExecuted = (reason) => ({ reason: `not executed: ${reason}` })

async function probeIdentity(api, label, configured) {
  if (configured) return { id: configured, source: 'configured' }
  try {
    return { id: await signup(api, label), source: 'signup' }
  } catch (error) {
    // An unknown member still exercises Origin and authorization ordering.
    return { id: randomUUID(), source: 'unregistered', error: String(error?.message) }
  }
}

function recordIdentities(record, reader, writer) {
  const registered = reader.source !== 'unregistered' && writer.source !== 'unregistered'
  record(
    'identities',
    registered ? 'pass' : 'not-executed',
    registered
      ? { reader: reader.source, writer: writer.source }
      : notExecuted(`preview signup unavailable (${reader.error ?? writer.error})`)
  )
}

function recordAccess(record, feed) {
  if (feed.status === 200) {
    record('communityAccess', 'pass', {})
    return 'granted'
  }
  const reason =
    feed.status === 403
      ? 'community_read_enabled is off or access is denied for the probe identities'
      : `community feed answered ${feed.status}`
  record('communityAccess', 'not-executed', notExecuted(reason))
  return 'refused'
}

/**
 * Writes go only to a preview. A loopback API reporting `test` or `development` is allowed
 * only when explicitly opted in for local validation; production never is.
 */
export function targetRefusal(apiBaseUrl, environment, allowLocalTarget = false) {
  if (environment === 'preview') return null
  const loopback = LOOPBACK_HOSTS.has(new URL(apiBaseUrl).hostname)
  if (allowLocalTarget && loopback && ['test', 'development'].includes(environment))
    return null
  return `health reports environment ${JSON.stringify(environment)}; the probe writes only to a preview`
}

async function fixtureImage() {
  const manifest = JSON.parse(
    await readFile(new URL('manifest.json', FIXTURE_DIR), 'utf8')
  )
  const entry = manifest.files.find((file) => file.path === FIXTURE_FILE)
  const bytes = await readFile(new URL(FIXTURE_FILE, FIXTURE_DIR))
  if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256)
    throw new Error(`${FIXTURE_FILE} does not match its manifest hash`)
  return { ...entry, bytes }
}

/** Allocates, uploads and publishes one look owned by a probe identity, then awaits its review. */
async function publishProbePost(api, bearer) {
  const image = await fixtureImage()
  const key = randomUUID()
  const allocated = await api.http('POST', '/api/v1/community/posts/allocate', {
    bearer,
    headers: { 'idempotency-key': key },
    body: {
      locale: 'en-US',
      contentType: image.contentType,
      byteSize: image.byteSize,
      sha256: image.sha256,
      widthPx: image.widthPx,
      heightPx: image.heightPx,
    },
  })
  if (allocated.status !== 200) return { reason: `allocate answered ${allocated.status}` }
  const session = allocated.json.data
  // The signed storage URL is not the protected deployment: no bypass, no bearer.
  const upload = await fetch(session.uploadUrl, {
    method: 'PUT',
    headers: { 'x-upload-token': session.uploadToken, 'content-type': image.contentType },
    body: image.bytes,
  })
  if (!upload.ok) return { reason: `upload answered ${upload.status}` }
  const published = await api.http('POST', '/api/v1/community/posts/publish', {
    bearer,
    headers: { 'idempotency-key': key },
    body: {
      postId: session.postId,
      uploadSessionId: session.uploadSessionId,
      altText: 'A plum satin fabric swatch.',
      altTextConfirmed: true,
      caption: null,
      locale: 'en-US',
    },
  })
  if (published.status !== 200) return { reason: `publish answered ${published.status}` }
  const started = performance.now()
  while (performance.now() - started < PUBLISH_WAIT_MS) {
    const post = await api.http('GET', `/api/v1/community/posts/${session.postId}`, {
      bearer,
    })
    const status = post.json?.data?.status
    if (status === 'published') return { post: post.json.data }
    if (['flagged', 'review_failed', 'withdrawn'].includes(status))
      return { postId: session.postId, reason: `the probe look ended ${status}` }
    await sleep(2000)
  }
  return {
    postId: session.postId,
    reason: `the probe look was not published within ${PUBLISH_WAIT_MS / 1000} s (no screening worker on this deployment?)`,
  }
}

/** Alternates the writer's applause on the probe-owned post; returns the event revision. */
function reactionCommitter(api, writerBearer, post) {
  let revision = post.reactions?.revision ?? 0
  let selection = null
  return async () => {
    selection = selection ? null : 'applause'
    const result = await react(api, writerBearer, post.id, selection, revision)
    revision = result.revision
    // The stream event carries the post's community revision, not the reaction counter.
    const resolved = await api.http('POST', '/api/v1/community/targets/resolve', {
      bearer: writerBearer,
      body: { targets: [{ key: post.id, postId: post.id }] },
    })
    const target = resolved.json?.data?.targets?.[0]
    return { ...result, eventRevision: Number(target?.communityRevision ?? Number.NaN) }
  }
}

async function probePost(api, record, access, readerBearer) {
  if (access !== 'granted') return null
  const owned = await publishProbePost(api, readerBearer)
  record(
    'probePost',
    owned.post ? 'pass' : 'not-executed',
    owned.post ? { post: owned.post.id } : notExecuted(owned.reason)
  )
  return owned
}

/**
 * What this run can reach: a preview deployment, two identities, their community access and
 * one look the probe owns. A non-preview target aborts here, before any write. Missing
 * prerequisites narrow what runs; they never fail the run.
 */
async function preflight(api, record, evidence, options) {
  const health = await api.http('GET', '/api/health')
  const environment = health.json?.environment ?? null
  evidence.deployment = {
    status: health.status,
    gitSha: health.json?.gitSha ?? null,
    environment,
    vercelId: health.headers.get('x-vercel-id'),
  }
  if (health.status !== 200) {
    record('reachability', 'fail', { reason: `health answered ${health.status}` })
    return null
  }
  const refusal = targetRefusal(api.base, environment, options.allowLocalTarget)
  if (refusal) {
    record('environment', 'fail', { reason: refusal })
    return null
  }
  const reader = await probeIdentity(api, 'reader', options.readerUserId)
  const writer = await probeIdentity(api, 'writer', options.writerUserId)
  evidence.identities = { reader: digest(reader.id), writer: digest(writer.id) }
  recordIdentities(record, reader, writer)
  const writerBearer = fixtureBearer(writer.id, 3600)
  const readerBearer = () => fixtureBearer(reader.id, 600)
  const feed = await api.http('GET', '/api/v1/community/feed?mode=all&limit=12', {
    bearer: writerBearer,
  })
  const access = recordAccess(record, feed)
  const owned = await probePost(api, record, access, readerBearer())
  return {
    access,
    post: owned?.post ?? null,
    ownedPostId: owned?.post?.id ?? owned?.postId ?? null,
    readerBearer,
    commit: owned?.post ? reactionCommitter(api, writerBearer, owned.post) : null,
  }
}

/** The raw upgrade, the engine.io open packet and the namespace answer on the hosted route. */
function rawUpgrade(api, bearer) {
  return new Promise((resolve) => {
    const result = { httpStatus: null, vercelId: null, open: null, namespace: null }
    const ws = new WebSocket(
      `${api.base.replace(/^http/, 'ws')}/api/realtime?EIO=4&transport=websocket`,
      { headers: api.protection }
    )
    const done = () => {
      ws.terminate()
      resolve(result)
    }
    ws.on('upgrade', (response) => {
      result.httpStatus = response.statusCode
      result.vercelId = response.headers['x-vercel-id'] ?? null
    })
    ws.on('unexpected-response', (_request, response) => {
      result.httpStatus = response.statusCode
      done()
    })
    ws.on('message', (raw) => {
      const text = raw.toString()
      if (text.startsWith('0')) {
        const open = safeJson(text.slice(1)) ?? {}
        result.open = {
          upgrades: open.upgrades,
          pingInterval: open.pingInterval,
          pingTimeout: open.pingTimeout,
        }
        ws.send(`40/community,${JSON.stringify({ token: bearer })}`)
      } else if (text.startsWith('40/community')) {
        result.namespace = { connected: true }
        done()
      } else if (text.startsWith('44/community')) {
        const body = safeJson(text.slice(text.indexOf(',') + 1)) ?? {}
        result.namespace = { connected: false, control: body.data ?? null }
        done()
      }
    })
    ws.on('error', done)
    setTimeout(done, 10_000)
  })
}

/** OPS-001: executable whenever the preview is reachable, with or without community access. */
async function probeUpgrade(api, record, session) {
  const upgrade = await rawUpgrade(api, session.readerBearer())
  const slash = await api.http('GET', '/api/realtime/?EIO=4&transport=polling')
  const upgraded = upgrade.httpStatus === 101 && Boolean(upgrade.open)
  const namespaceOk =
    session.access === 'granted'
      ? upgrade.namespace?.connected === true
      : upgrade.namespace?.connected === false && Boolean(upgrade.namespace.control)
  record('upgrade101', upgraded && namespaceOk ? 'pass' : 'fail', {
    ...upgrade,
    trailingSlashPollingStatus: slash.status,
    note:
      session.access === 'granted'
        ? 'Namespace connected with a fixture bearer.'
        : 'Namespace answered with an authorization control: the upgrade and Origin passed, access is a prerequisite.',
  })
}

/**
 * OPS-001: a foreign Origin, or no bearer, is refused before identity with no control payload.
 * An accepted Origin either connects or, without community access, is refused by authorization
 * with a control payload, so Origin acceptance is provable without the community flag.
 */
async function probeOrigins(api, record, session, webOrigin) {
  const accepted = (result) => result.connected || Boolean(result.control)
  const cases = [
    ['foreignOriginWithBearer', FOREIGN_ORIGIN, true, 'refused-before-identity'],
    ['absentOriginWithBearer', null, true, 'accepted'],
    ['sameHostOriginWithBearer', new URL(api.base).origin, true, 'accepted'],
    ['absentOriginNoBearer', null, false, 'refused-before-identity'],
  ]
  const matrix = {}
  for (const [name, origin, withBearer, expected] of cases) {
    const result = await api.socket({
      bearer: withBearer ? session.readerBearer() : null,
      origin,
    })
    result.socket?.close()
    const observed = result.connected
      ? 'connected'
      : result.control
        ? `refused-by-authorization:${result.control.status}`
        : 'refused-before-identity'
    const ok =
      expected === 'accepted'
        ? session.access === 'granted'
          ? result.connected
          : accepted(result)
        : !accepted(result)
    matrix[name] = { expected, observed, ok }
  }
  record('originMatrix', Object.values(matrix).every((row) => row.ok) ? 'pass' : 'fail', {
    matrix,
  })
  if (!webOrigin) return
  // A deployment setting, kept apart from the server's rule: HTTP_CORS_ORIGIN is a static list.
  const web = await api.socket({ bearer: session.readerBearer(), origin: webOrigin })
  web.socket?.close()
  record(
    'webOriginAllowed',
    accepted(web) ? 'pass' : 'not-executed',
    accepted(web)
      ? { origin: webOrigin }
      : {
          origin: webOrigin,
          ...notExecuted('preview HTTP_CORS_ORIGIN does not list this web origin'),
        }
  )
}

async function sampleDoorbells(subscribers, session, samples) {
  const latencies = []
  const payloads = new Set()
  for (let i = 0; i < samples; i++) {
    const marks = subscribers.map((connection) => connection.events.length)
    const result = await session.commit()
    const arrivals = await Promise.all(
      subscribers.map((connection, index) =>
        waitFor(
          () =>
            connection.events
              .slice(marks[index])
              .find((event) => event.event === 'community:changed'),
          DOORBELL_WAIT_MS
        )
      )
    )
    for (const arrival of arrivals) {
      if (!arrival) {
        latencies.push(null)
        continue
      }
      payloads.add(JSON.stringify(arrival.args[0] ?? null))
      // Upper bound: from the moment the commit request left, since a doorbell may beat the response.
      latencies.push(Math.round(arrival.at - result.started))
    }
    await sleep(1500)
  }
  return { latencies, payloads }
}

function instanceClaim(nonces, sockets) {
  const distinct = new Set(nonces.filter(Boolean))
  if (nonces.every((nonce) => nonce === null))
    return [
      'not-executed',
      { sockets, ...notExecuted('the server sent no instance acknowledgement') },
    ]
  return [
    distinct.size >= 2 ? 'pass' : 'observed-single',
    {
      sockets,
      acknowledged: nonces.filter(Boolean).length,
      distinctInstances: distinct.size,
      note:
        distinct.size >= 2
          ? 'Connections landed on separate realtime instances.'
          : 'Every connection landed on one instance; placement did not spread them.',
    },
  ]
}

/** OPS-002: distinct instances need connections; doorbells and latency also need a post. */
async function probeDoorbells(api, record, session, { sockets, samples }) {
  if (session.access !== 'granted') {
    const reason = notExecuted('no community access for the probe identities')
    for (const name of ['instances', 'doorbells', 'crossFunctionLatency'])
      record(name, 'not-executed', reason)
    return
  }
  const subscribers = []
  for (let i = 0; i < sockets; i++) {
    const connection = await api.socket({ bearer: session.readerBearer() })
    if (connection.connected) subscribers.push(connection)
  }
  // The server acknowledges its instance right after the connect packet.
  const nonces = await Promise.all(
    subscribers.map((connection) => waitFor(() => instanceNonce(connection.events), 2000))
  )
  record('instances', ...instanceClaim(nonces, subscribers.length))
  if (!session.commit) {
    const reason = notExecuted('no published probe-owned look to react on')
    record('doorbells', 'not-executed', reason)
    record('crossFunctionLatency', 'not-executed', reason)
    for (const connection of subscribers) connection.socket.close()
    return
  }
  const { latencies, payloads } = await sampleDoorbells(subscribers, session, samples)
  for (const connection of subscribers) connection.socket.close()
  const delivered = latencies.filter((value) => value !== null)
  const exact = payloads.size === 1 && payloads.has(DOORBELL)
  record('doorbells', exact && delivered.length === latencies.length ? 'pass' : 'fail', {
    distinctPayloads: [...payloads],
    samples: latencies.length,
    missing: latencies.length - delivered.length,
  })
  const sorted = [...delivered].sort((a, b) => a - b)
  record(
    'crossFunctionLatency',
    sorted.length && sorted.at(-1) <= LATENCY_BOUND_MS ? 'pass' : 'fail',
    {
      maxMs: sorted.at(-1) ?? null,
      p50Ms: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null,
      note: 'Committed by the REST function, delivered by the separate api/realtime function.',
    }
  )
}

function exactOnce(seen, ours) {
  const counts = new Map()
  for (const value of seen) counts.set(value, (counts.get(value) ?? 0) + 1)
  return {
    duplicates: [...counts].filter(([, count]) => count > 1).map(([value]) => value),
    skipped: [...ours].filter((value) => !counts.has(value)),
    ordered: seen.every((value, index) => index === 0 || value > seen[index - 1]),
  }
}

/** Holds one socket until the server ends it, committing and catching up when it can. */
async function holdUntilRecycle(api, session, holdMs, catchUp, ours) {
  let rang = false
  const heldBearer = session.readerBearer()
  const holder = await api.socket({
    bearer: heldBearer,
    collect: (event) => {
      if (event === 'community:changed') rang = true
    },
  })
  if (!holder.connected) return { holder, heldBearer, closure: null }
  const connectedAt = performance.now()
  let closure = null
  let releasing = false
  holder.socket.once('disconnect', (reason) => {
    // Only a server-initiated end counts; the probe's own release after the hold does not.
    if (!releasing)
      closure = { reason, afterMs: Math.round(performance.now() - connectedAt) }
  })
  while (!closure && performance.now() - connectedAt < holdMs) {
    if (session.commit) {
      ours.add((await session.commit()).eventRevision)
      await waitFor(() => rang || closure, 10_000)
      rang = false
      await catchUp()
    }
    await waitFor(() => closure, 45_000)
  }
  releasing = true
  holder.socket.close()
  return { holder, heldBearer, closure }
}

/** After the server's close: one commit in the gap, a fresh-bearer reconnect, then catch-up. */
async function reconnectAndCatchUp(api, session, closure, freshBearer, catchUp, ours) {
  if (closure && session.commit) ours.add((await session.commit()).eventRevision)
  const reconnect = closure ? await api.socket({ bearer: freshBearer }) : null
  await catchUp()
  if (reconnect?.connected && session.commit) {
    const mark = reconnect.events.length
    ours.add((await session.commit()).eventRevision)
    await waitFor(
      () =>
        reconnect.events.slice(mark).some((event) => event.event === 'community:changed'),
      10_000
    )
    await catchUp()
  }
  reconnect?.socket?.close()
  return reconnect
}

/**
 * OPS-003 lifecycle (needs a connection): the server ends the socket at 295 s and a fresh bearer
 * reconnects. Catch-up (also needs a post): every commit is observed exactly once, in order.
 */
async function probeRecycle(api, record, session, holdMs) {
  if (session.access !== 'granted') {
    const reason = notExecuted('no community access for the probe identities')
    record('recycle', 'not-executed', reason)
    record('recycleCatchUp', 'not-executed', reason)
    return
  }
  const ours = new Set()
  const seen = []
  let cursor = (await readAll(api, session.readerBearer(), undefined)).cursor
  const catchUp = async () => {
    const page = await readAll(api, session.readerBearer(), cursor)
    if (page.status !== 200) return
    cursor = page.cursor
    for (const event of page.events)
      if (event.kind === 'reactions.changed' && event.postId === session.post?.id)
        seen.push(Number(event.communityRevision))
  }
  const { holder, heldBearer, closure } = await holdUntilRecycle(
    api,
    session,
    holdMs,
    catchUp,
    ours
  )
  if (!holder.connected) {
    record('recycle', 'fail', { reason: `holder refused: ${holder.message}` })
    return
  }
  const freshBearer = session.readerBearer()
  const reconnect = await reconnectAndCatchUp(
    api,
    session,
    closure,
    freshBearer,
    catchUp,
    ours
  )
  const recycled =
    closure?.reason === 'io server disconnect' &&
    Math.abs(closure.afterMs - RECYCLE_MS) <= 5_000
  record('recycle', recycled && reconnect?.connected ? 'pass' : 'fail', {
    closeReason: closure?.reason ?? 'none within hold',
    closedAfterMs: closure?.afterMs ?? null,
    reconnected: Boolean(reconnect?.connected),
    freshBearerExpiresLater: expiresAt(freshBearer) > expiresAt(heldBearer),
  })
  if (!session.commit) {
    record(
      'recycleCatchUp',
      'not-executed',
      notExecuted('no published probe-owned look to react on')
    )
    return
  }
  const once = exactOnce(seen, ours)
  record(
    'recycleCatchUp',
    !once.duplicates.length && !once.skipped.length && once.ordered ? 'pass' : 'fail',
    { commitRevisions: [...ours], observedRevisions: seen, ...once }
  )
}

/** The probe-owned look leaves the shared preview feed when the run ends. */
async function withdrawProbePost(api, record, session) {
  if (!session.ownedPostId) return
  const withdrawn = await api.http(
    'POST',
    `/api/v1/community/posts/${session.ownedPostId}/withdraw`,
    {
      bearer: session.readerBearer(),
    }
  )
  record('probePostWithdrawn', withdrawn.status === 200 ? 'pass' : 'fail', {
    httpStatus: withdrawn.status,
  })
}

export async function runPreviewProbe(options) {
  const api = client(options)
  const claims = {}
  const record = (name, status, detail) => {
    claims[name] = { status, ...detail }
  }
  const evidence = { startedAt: new Date().toISOString(), apiBaseUrl: api.base, claims }
  const session = await preflight(api, record, evidence, options)
  if (session) {
    await probeUpgrade(api, record, session)
    await probeOrigins(api, record, session, options.webOrigin)
    await probeDoorbells(api, record, session, {
      sockets: options.sockets ?? 6,
      samples: options.samples ?? 5,
    })
    await probeRecycle(api, record, session, options.holdMs ?? 320_000)
    await withdrawProbePost(api, record, session)
  }
  evidence.finishedAt = new Date().toISOString()
  return evidence
}

if (
  import.meta.url ===
  pathToFileURL(process.argv[1] ? fs.realpathSync(process.argv[1]) : '').href
) {
  const apiBaseUrl = process.env.PROBE_API_BASE_URL
  if (!apiBaseUrl) {
    console.error('PROBE_API_BASE_URL is required.')
    process.exit(2)
  }
  const evidence = await runPreviewProbe({
    apiBaseUrl,
    webOrigin: process.env.PROBE_WEB_ORIGIN,
    bypass: process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim() || undefined,
    readerUserId: process.env.PROBE_READER_USER_ID?.trim() || undefined,
    writerUserId: process.env.PROBE_WRITER_USER_ID?.trim() || undefined,
    allowLocalTarget: process.env.PROBE_ALLOW_LOCAL_TARGET === '1',
    holdMs: Number(process.env.PROBE_HOLD_MS ?? 320_000),
    sockets: Number(process.env.PROBE_SOCKETS ?? 6),
    samples: Number(process.env.PROBE_SAMPLES ?? 5),
  })
  const text = JSON.stringify(evidence, null, 2)
  if (process.env.PROBE_OUT) await writeFile(process.env.PROBE_OUT, `${text}\n`)
  console.log(text)
  // Only a real failure fails the run; a missing prerequisite is reported as not executed.
  const failed = Object.values(evidence.claims).some((claim) => claim.status === 'fail')
  process.exit(failed ? 1 : 0)
}
