// Learning path Step 50: Moderator queue and case detail.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-50-moderator-queue-and-case-detail
// Story 6.10 test owner: the moderator queue and case detail against a real, migrated Postgres.
// I-Q-ORDER, I-Q-GROUP, I-Q-ORPHAN, I-Q-FILTERS, I-Q-DETAIL, I-Q-READONLY, I-Q-AUDIT, I-Q-HTTP.
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  moderationCaseDetailResponseSchema,
  moderationCasesResponseSchema,
} from '@couture/api-client/contracts/http'
import {
  checksumTables,
  moderationQueueTestContext,
} from './helpers/moderation-queue-context.js'
import { seedModerationQueue, type SeededQueue } from './helpers/moderation-queue-seed.js'

const NOW = new Date('2026-11-03T12:00:00.000Z')
const anyString = expect.any(String) as string
const ctx = moderationQueueTestContext()
const { prisma, clock, flags, flagValues, storage } = ctx

let seed: SeededQueue
let moderator: ReturnType<Awaited<ReturnType<typeof ctx.bootApp>>['as']>
let boot: Awaited<ReturnType<typeof ctx.bootApp>>
const ids = (keys: readonly string[]) => keys.map((key) => seed.expectations[key]!.caseId)
const caseIds = (body: { data: { items: { caseId: string }[] } }) =>
  body.data.items.map((item) => item.caseId)

beforeAll(async () => {
  clock.at(NOW)
  seed = await seedModerationQueue(prisma, { now: NOW })
  boot = await ctx.bootApp()
  moderator = boot.as('moderator', seed.moderator.id)
}, 120_000)

afterEach(() => {
  clock.at(NOW)
  flagValues.clear()
  storage.signReadUrl.mockClear()
  flags.getFeatureFlag.mockClear()
})

const listCases = (query = '') => moderator.get(`/api/v1/moderation/cases${query}`)
const getCase = (caseId: string, as = moderator) =>
  as.get(`/api/v1/moderation/cases/${caseId}`)
const auditCount = (userId?: string) =>
  prisma.auditLog.count({
    where: {
      event_type: 'moderation_case_viewed',
      ...(userId ? { user_id: userId } : {}),
    },
  })

describe('I-Q-ORDER: default queue', () => {
  it('returns open cases by risk, earliest due and case key, with the derived fields', async () => {
    const response = await listCases().expect(200)
    const body = moderationCasesResponseSchema.parse(response.body)
    expect(caseIds(body)).toEqual(ids(seed.openOrder))
    expect(body.data.nextCursor).toBeNull()
    expect(body.data.serverNow).toBe(NOW.toISOString())
    for (const key of seed.openOrder) {
      const expected = seed.expectations[key]!
      const item = body.data.items.find((entry) => entry.caseId === expected.caseId)!
      expect(item, key).toMatchObject({
        source: expected.source,
        status: 'open',
        risk: expected.risk,
        slaState: expected.slaState,
        slaDueAt: expected.dueAt.toISOString(),
        reportCount: expected.reportCount,
        locale: expected.locale,
      })
    }
  })

  it('leaves out resolved cases and targets nobody reported (D2)', async () => {
    const body = (await listCases().expect(200)).body as {
      data: { items: { caseId: string }[] }
    }
    const listed = caseIds(body)
    expect(listed).not.toContain(seed.expectations.H!.caseId)
    for (const never of seed.neverQueued) expect(listed).not.toContain(never)
  })

  it('answers with the shared envelope and one clock read', async () => {
    const body = (await listCases().expect(200)).body as { data: { serverNow: string } }
    expect(Object.keys(body)).toEqual(['data'])
    expect(body.data.serverNow).toBe(NOW.toISOString())
  })
})

describe('I-Q-GROUP: one case per reported target', () => {
  it('groups three reporters and three reasons into one high-risk case', async () => {
    const body = moderationCasesResponseSchema.parse((await listCases().expect(200)).body)
    const grouped = body.data.items.filter(
      (item) => item.caseId === seed.expectations.B!.caseId
    )
    expect(grouped).toHaveLength(1)
    expect(grouped[0]).toMatchObject({
      reportCount: 3,
      reasons: ['harassment', 'other', 'spam'],
      // Strongest reason is harassment (medium), three distinct reporters raise it once.
      risk: 'high',
      // The earliest of the three due times.
      slaDueAt: seed.expectations.B!.dueAt.toISOString(),
    })
  })
})

describe('I-Q-ORPHAN: erased targets stay readable', () => {
  it('lists an orphan post and an orphan comment as their own cases', async () => {
    const body = moderationCasesResponseSchema.parse((await listCases().expect(200)).body)
    const post = body.data.items.find(
      (item) => item.caseId === seed.expectations.F!.caseId
    )!
    expect(post.caseId).toMatch(/^orphan-post\./)
    expect(post.excerpt).toBe('Caption F')
    const comment = body.data.items.find(
      (item) => item.caseId === seed.expectations.G!.caseId
    )!
    expect(comment.caseId).toMatch(/^orphan-comment\./)
    expect(comment.excerpt).toBeNull()
    expect(comment.locale).toBeNull()
  })

  it('reads an orphan post from its snapshot with the media marked erased', async () => {
    const response = await getCase(seed.expectations.F!.caseId).expect(200)
    const { data } = moderationCaseDetailResponseSchema.parse(response.body)
    expect(data).toMatchObject({
      source: 'post',
      target: { state: 'erased', status: null, publishedAt: null, parentBody: null },
      snapshot: { available: true, caption: 'Caption F', altText: 'Alt F' },
      subject: { state: 'alias', alias: seed.author.alias },
      media: { state: 'unavailable', reason: 'target_erased' },
    })
    expect(data.reporters).toHaveLength(1)
    expect(data.reporters[0]!.identity).toEqual({ state: 'erased', alias: null })
    expect(storage.signReadUrl).not.toHaveBeenCalled()
  })

  it('reads an orphan comment whose snapshot is unavailable without failing', async () => {
    const response = await getCase(seed.expectations.G!.caseId).expect(200)
    const { data } = moderationCaseDetailResponseSchema.parse(response.body)
    expect(data.snapshot).toMatchObject({ available: false, caption: null, body: null })
    expect(data.target.state).toBe('erased')
    expect(data.subject).toEqual({ state: 'erased', alias: null })
    expect(data.media).toEqual({ state: 'unavailable', reason: 'no_image' })
  })
})

describe('I-Q-FILTERS', () => {
  const listed = async (query: string) =>
    caseIds((await listCases(query).expect(200)).body as never)

  it.each([
    ['source=comment', ['D', 'G']],
    ['source=post', ['F', 'B', 'A', 'C', 'E']],
    ['locale=es-419', ['B', 'D']],
    ['locale=de-DE', ['F']],
    ['locale=unknown', ['G']],
    ['risk=high', ['F', 'B', 'A']],
    ['risk=medium', ['D', 'C']],
    ['risk=low', ['G', 'E']],
    ['sla=breached', ['F']],
    ['sla=at_risk', ['B', 'D', 'C', 'G']],
    ['sla=on_track', ['A', 'E']],
    ['sla=resolved', []],
    ['status=resolved', ['H']],
    ['status=resolved&sla=resolved', ['H']],
    ['source=comment&locale=es-419&risk=medium&sla=at_risk', ['D']],
    ['source=post&locale=es-419&risk=low', []],
  ])('?%s', async (query, expected) => {
    expect(await listed(`?${query}`)).toEqual(ids(expected))
  })

  it('applies the sla filter and the item state from one clock at the six-hour edge', async () => {
    // Case A is due NOW + 10 h. At NOW + 4 h exactly 6 h remain, which is still at risk.
    clock.at(new Date(NOW.getTime() + 4 * 3_600_000))
    let page = moderationCasesResponseSchema.parse(
      (await listCases('?sla=at_risk').expect(200)).body
    )
    const edge = page.data.items.find(
      (item) => item.caseId === seed.expectations.A!.caseId
    )
    expect(edge?.slaState).toBe('at_risk')

    // One millisecond earlier 6 h + 1 ms remain: on track in the filter and in the item.
    clock.at(new Date(NOW.getTime() + 4 * 3_600_000 - 1))
    page = moderationCasesResponseSchema.parse(
      (await listCases('?sla=at_risk').expect(200)).body
    )
    expect(page.data.items.map((item) => item.caseId)).not.toContain(
      seed.expectations.A!.caseId
    )
    page = moderationCasesResponseSchema.parse(
      (await listCases('?sla=on_track').expect(200)).body
    )
    expect(
      page.data.items.find((item) => item.caseId === seed.expectations.A!.caseId)
        ?.slaState
    ).toBe('on_track')
  })

  it('reports a case as breached from the instant it is due', async () => {
    clock.at(seed.expectations.D!.dueAt)
    const page = moderationCasesResponseSchema.parse(
      (await listCases('?sla=breached').expect(200)).body
    )
    const ids = page.data.items.map((item) => item.caseId)
    expect(ids).toContain(seed.expectations.D!.caseId)
    expect(
      page.data.items.find((item) => item.caseId === seed.expectations.D!.caseId)
        ?.slaState
    ).toBe('breached')
  })
})

describe('I-Q-DETAIL', () => {
  const detail = async (key: string, as = moderator) =>
    moderationCaseDetailResponseSchema.parse(
      (await getCase(seed.expectations[key]!.caseId, as).expect(200)).body
    ).data

  it('shows a reported post with its snapshot, live state, reporter and short-lived media', async () => {
    const data = await detail('A')
    expect(data).toMatchObject({
      source: 'post',
      status: 'open',
      risk: 'high',
      slaState: 'on_track',
      serverNow: NOW.toISOString(),
      reportCount: 1,
      locale: 'en-US',
      subject: { state: 'alias', alias: seed.author.alias },
      snapshot: {
        available: true,
        caption: 'Snapshot caption A',
        altText: 'Snapshot alt A',
      },
      target: { state: 'live', status: 'published' },
      findings: null,
      priorActions: [],
      viewerConflict: false,
    })
    expect(data.reporters).toEqual([
      {
        identity: { state: 'alias', alias: seed.reporters.r1.alias },
        reason: 'hate_speech',
        details: 'Reporter note for A',
        reportedAt: anyString,
        resolved: false,
      },
    ])
    expect(storage.signReadUrl).toHaveBeenCalledTimes(1)
    expect(storage.signReadUrl).toHaveBeenCalledWith(seed.posts.A.image_object_path, 120)
    expect(data.media).toMatchObject({
      state: 'available',
      expiresAt: new Date(NOW.getTime() + 120_000).toISOString(),
    })
  })

  it('maps a machine finding to its category and engine version and raises the risk', async () => {
    const data = await detail('C')
    expect(data.findings).toEqual({
      codes: ['text_policy_match'],
      categories: ['language'],
      engineVersion: '1.2.0',
      operatorNote: null,
    })
    expect(data.risk).toBe('medium')
  })

  it('lists every reporter of a grouped case under their alias', async () => {
    const data = await detail('B')
    expect(data.reportCount).toBe(3)
    expect(data.reporters.map((entry) => entry.identity.alias).sort()).toEqual(
      [seed.reporters.r1, seed.reporters.r2, seed.reporters.r3].map((r) => r.alias).sort()
    )
  })

  it('reads a reporter with no alias row as unknown and never creates one', async () => {
    const before = await prisma.communityAlias.count()
    const data = await detail('E')
    expect(data.reporters[0]!.identity).toEqual({ state: 'unknown', alias: null })
    expect(await prisma.communityAlias.count()).toBe(before)
  })

  it('shows a comment case from its snapshot and live state, without media', async () => {
    const data = await detail('D')
    expect(data).toMatchObject({
      source: 'comment',
      locale: 'es-419',
      subject: { state: 'alias', alias: seed.author.alias },
      snapshot: { available: true, body: 'Snapshot body D', caption: null },
      target: { state: 'live', status: 'published', parentBody: null },
      media: { state: 'unavailable', reason: 'no_image' },
      // The first audit row of a report is `reported`, which duplicates the report itself.
      priorActions: [],
    })
    expect(data.reporters[0]!.details).toBeNull()
    expect(storage.signReadUrl).not.toHaveBeenCalled()
  })

  it('flags a viewer who wrote the target or filed a report, and nobody else', async () => {
    expect((await detail('A')).viewerConflict).toBe(false)
    const author = boot.as('moderator', seed.author.id)
    expect((await detail('A', author)).viewerConflict).toBe(true)
    const reporter = boot.as('admin', seed.reporters.r1.id)
    expect((await detail('A', reporter)).viewerConflict).toBe(true)
    expect((await detail('D', reporter)).viewerConflict).toBe(false)
  })

  it('carries no user id, email, raw report id, object path or bucket anywhere', async () => {
    const forbidden = [
      seed.author.id,
      seed.moderator.id,
      seed.reporters.r1.id,
      seed.reporters.r2.id,
      seed.reporters.r3.id,
      seed.reporters.bare.id,
      'community-images',
      '@',
    ]
    for (const key of Object.keys(seed.expectations)) {
      const response = await getCase(seed.expectations[key]!.caseId, moderator)
      if (response.status !== 200) continue
      // The signed URL is the one place a path may appear, because the URL is the grant.
      const body = response.body as { data: { media: { url?: string } } }
      delete body.data.media.url
      const text = JSON.stringify(body)
      for (const value of forbidden)
        expect(text, `${key} leaks ${value}`).not.toContain(value)
      expect(text).not.toContain(seed.posts.A.image_object_path as string)
      expect(text).not.toMatch(
        /"(user_id|userId|email|reporterId|reportId|objectPath|bucket|ip)"/
      )
    }
    const queue = (await listCases().expect(200)).text
    for (const value of forbidden) expect(queue).not.toContain(value)
  })
})

describe('I-Q-READONLY: reads change nothing but the audit log', () => {
  it('leaves every community, moderation and member table byte-identical', async () => {
    const before = await checksumTables(prisma)
    const auditBefore = await auditCount()
    await listCases().expect(200)
    await listCases('?status=resolved').expect(200)
    let details = 0
    for (const key of Object.keys(seed.expectations)) {
      await getCase(seed.expectations[key]!.caseId).expect(200)
      details += 1
    }
    expect(await checksumTables(prisma)).toEqual(before)
    expect(await auditCount()).toBe(auditBefore + details)
  })
})

describe('I-Q-AUDIT: one audit row per detail read', () => {
  it('writes exactly the pinned row shape for a moderator and for an admin', async () => {
    const caseId = seed.expectations.A!.caseId
    await getCase(caseId).expect(200)
    await getCase(caseId, boot.as('admin', seed.moderator.id)).expect(200)
    const rows = await prisma.auditLog.findMany({
      where: { user_id: seed.moderator.id, event_type: 'moderation_case_viewed' },
      orderBy: { timestamp: 'desc' },
      take: 2,
    })
    expect(rows).toHaveLength(2)
    const roles = rows.map((row) => (row.event_data as { role: string }).role).sort()
    expect(roles).toEqual(['admin', 'moderator'])
    for (const row of rows) {
      expect(Object.keys(row.event_data as object).sort()).toEqual([
        'caseId',
        'role',
        'source',
      ])
      expect(row.event_data).toMatchObject({ caseId, source: 'post' })
      expect(row.ip_address).toBeNull()
      // A signed URL or any case content never enters the audit row.
      expect(JSON.stringify(row.event_data)).not.toMatch(
        /storage\.test|SIGNED|Caption|alias/i
      )
    }
  })

  it('writes two rows for two reads and none for a queue page', async () => {
    const before = await auditCount()
    await listCases().expect(200)
    expect(await auditCount()).toBe(before)
    await getCase(seed.expectations.B!.caseId).expect(200)
    await getCase(seed.expectations.B!.caseId).expect(200)
    expect(await auditCount()).toBe(before + 2)
  })

  it('writes none for a denied, unknown, malformed, disabled or invalid read', async () => {
    const before = await auditCount()
    await getCase(
      seed.expectations.A!.caseId,
      boot.as('guardian', seed.author.id)
    ).expect(403)
    await getCase('post.doesnotexist').expect(404)
    await getCase('not-a-case').expect(404)
    await boot
      .anonymous()
      .get(`/api/v1/moderation/cases/${seed.expectations.A!.caseId}`)
      .expect(401)
    flagValues.set('moderation_console_enabled', false)
    await getCase(seed.expectations.A!.caseId).expect(503)
    expect(await auditCount()).toBe(before)
  })

  it('fails closed when the audit row cannot be written: no case data, no signed URL', async () => {
    // A moderator id with no User row violates the AuditLog foreign key.
    const ghost = boot.as('moderator', `ghost-${seed.runId}`)
    const before = await auditCount()
    const response = await getCase(seed.expectations.A!.caseId, ghost).expect(503)
    expect(response.body).toMatchObject({ statusCode: 503, code: 'audit_unavailable' })
    expect(Object.keys(response.body as object).sort()).toEqual([
      'code',
      'message',
      'statusCode',
    ])
    expect(response.text).not.toMatch(/Caption|alias|storage\.test|SIGNED|Snapshot/i)
    expect(storage.signReadUrl).not.toHaveBeenCalled()
    expect(await auditCount()).toBe(before)
  })
})

describe('I-Q-HTTP: real guards, real routes', () => {
  const caseId = () => seed.expectations.A!.caseId

  it('answers 401 without a usable bearer token', async () => {
    for (const path of [
      '/api/v1/moderation/cases',
      `/api/v1/moderation/cases/${caseId()}`,
    ]) {
      await boot.anonymous().get(path).expect(401)
      await boot
        .anonymous()
        .get(path)
        .set('Authorization', 'Bearer not-a-token')
        .expect(401)
      await boot.anonymous().get(path).set('Authorization', 'Basic abc').expect(401)
      await boot.anonymous().get(path).set('Authorization', 'Bearer').expect(401)
    }
  })

  it('answers 403 Insufficient role to a guardian and a teen, with one body for every case id', async () => {
    const bodies = new Set<string>()
    for (const role of ['guardian', 'teen'] as const) {
      const member = boot.as(role, seed.author.id)
      const queue = await member.get('/api/v1/moderation/cases').expect(403)
      expect(queue.body).toMatchObject({ statusCode: 403, message: 'Insufficient role' })
      bodies.add(queue.text)
      for (const id of [
        caseId(),
        'post.doesnotexist',
        'not-a-case',
        'post.a%2Fb',
        'orphan-post.x',
      ]) {
        const response = await member.get(`/api/v1/moderation/cases/${id}`).expect(403)
        bodies.add(response.text)
      }
    }
    expect([...bodies]).toHaveLength(1)
  })

  it('does not reveal the flag to a non-moderator and does reveal it to a moderator', async () => {
    flagValues.set('moderation_console_enabled', false)
    const guardian = boot.as('guardian', seed.author.id)
    await guardian.get('/api/v1/moderation/cases').expect(403)
    await guardian.get(`/api/v1/moderation/cases/${caseId()}`).expect(403)
    for (const path of [
      '/api/v1/moderation/cases',
      `/api/v1/moderation/cases/${caseId()}`,
    ]) {
      const response = await moderator.get(path).expect(503)
      expect(response.body).toEqual({
        statusCode: 503,
        code: 'moderation_console_disabled',
        message: anyString,
      })
      expect(response.text).not.toMatch(/Caption|alias|items|data/)
    }
    // The flag is read for the caller, after the role check.
    expect(flags.getFeatureFlag).not.toHaveBeenCalledWith(
      'moderation_console_enabled',
      seed.author.id
    )
  })

  it('fails closed with 503 disabled when the flag read itself fails', async () => {
    flags.getFeatureFlag.mockRejectedValueOnce(new Error('posthog down'))
    const response = await listCases().expect(503)
    expect(response.body).toMatchObject({ code: 'moderation_console_disabled' })
    flags.getFeatureFlag.mockRejectedValueOnce(new Error('posthog down'))
    await getCase(caseId()).expect(503)
  })

  it('answers 400 with a closed code for a bad filter, limit, repeated key or cursor', async () => {
    for (const query of [
      '?risk=critical',
      '?limit=500',
      '?limit=0',
      '?limit=1e1',
      '?source=post&source=comment',
      '?status=all',
      '?sla=late',
      '?unexpected=1',
      `?locale=${encodeURIComponent('x\'; DROP TABLE "CommunityPostReport";--')}`,
    ]) {
      const response = await listCases(query).expect(400)
      expect(response.body).toEqual({
        statusCode: 400,
        code: 'invalid_filter',
        message: anyString,
      })
      // The input is never echoed back.
      expect(response.text).not.toMatch(/critical|DROP|unexpected/)
    }
    for (const cursor of ['x', 'a.b', 'e30.e30']) {
      const response = await listCases(`?cursor=${cursor}`).expect(400)
      expect(response.body).toMatchObject({ statusCode: 400, code: 'invalid_cursor' })
    }
    // Past the 1,024-character cap the query schema refuses the value before the cursor is read.
    const oversized = await listCases(`?cursor=${'A'.repeat(1025)}`).expect(400)
    expect(oversized.body).toMatchObject({ statusCode: 400, code: 'invalid_filter' })
  })

  it('answers 404 case_not_found with one body for unknown and malformed ids', async () => {
    const bodies = new Set<string>()
    for (const id of [
      'post.doesnotexist',
      'comment.doesnotexist',
      'orphan-post.doesnotexist',
      'orphan-comment.doesnotexist',
      'not-a-case',
      'post.',
      'post.a%20b',
      'POST.abc',
      `post.${'a'.repeat(500)}`,
      "post.a'--",
    ]) {
      const response = await getCase(id).expect(404)
      expect(response.body).toMatchObject({ statusCode: 404, code: 'case_not_found' })
      bodies.add(response.text)
    }
    expect([...bodies]).toHaveLength(1)
  })

  it('serves a post-case id only under its own prefix', async () => {
    const postId = seed.expectations.A!.caseId.replace(/^post\./, '')
    await getCase(`comment.${postId}`).expect(404)
    await getCase(`orphan-post.${postId}`).expect(404)
  })

  it('sets private, no-store and Vary Authorization on every answer, refusals included', async () => {
    flagValues.clear()
    const responses = [
      await listCases().expect(200),
      await listCases('?risk=critical').expect(400),
      await getCase(caseId()).expect(200),
      await getCase('not-a-case').expect(404),
      await boot.anonymous().get('/api/v1/moderation/cases').expect(401),
      await boot.anonymous().get(`/api/v1/moderation/cases/${caseId()}`).expect(401),
      await boot
        .as('guardian', seed.author.id)
        .get('/api/v1/moderation/cases')
        .expect(403),
      await getCase(caseId(), boot.as('teen', seed.author.id)).expect(403),
    ]
    flagValues.set('moderation_console_enabled', false)
    responses.push(await listCases().expect(503), await getCase(caseId()).expect(503))
    for (const response of responses) {
      expect(response.headers['cache-control'], String(response.status)).toBe(
        'private, no-store'
      )
      expect(response.headers.vary ?? '').toMatch(/Authorization/i)
    }
  })

  it('exposes no write method on either route', async () => {
    for (const method of ['post', 'put', 'patch', 'delete'] as const) {
      for (const path of [
        '/api/v1/moderation/cases',
        `/api/v1/moderation/cases/${caseId()}`,
      ]) {
        const client = boot.anonymous()
        const call = {
          post: () => client.post(path),
          put: () => client.put(path),
          patch: () => client.patch(path),
          delete: () => client.delete(path),
        }[method]
        const response = await call().set(
          'Authorization',
          `Bearer test-token:moderator:${seed.moderator.id}`
        )
        expect([404, 405], `${method} ${path}`).toContain(response.status)
      }
    }
  })

  it('lets a moderator and an admin read, and keeps page size within the limit', async () => {
    const admin = boot.as('admin', seed.moderator.id)
    await admin.get('/api/v1/moderation/cases').expect(200)
    const page = moderationCasesResponseSchema.parse(
      (await listCases('?limit=2').expect(200)).body
    )
    expect(page.data.items).toHaveLength(2)
    expect(page.data.nextCursor).toEqual(expect.any(String))
  })
})
