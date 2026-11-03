// Learning path Step 50: Moderator queue and case detail.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-50-moderator-queue-and-case-detail
// Story 6.10 test owner: the service rules of the moderator queue, against a fake repository.
// U-Q-SVC-AUDIT-FAILCLOSED, -CLOCK, -SNAPSHOT, -LOGGING, -IDENTITY, -MEDIA, -FINDINGS,
// -PRIOR-ACTIONS, -CONFLICT. The integration suite repeats the privacy rules on real rows.
import { Logger, ServiceUnavailableException } from '@nestjs/common'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RequestAuthContext } from '../auth/security.types.js'
import type {
  LoadedCase,
  ModerationQueueRepository,
} from './moderation-queue.repository.js'
import {
  MODERATION_MEDIA_TTL_SECONDS,
  ModerationQueueService,
  projectSnapshot,
} from './moderation-queue.service.js'

const NOW = new Date('2026-11-03T12:00:00.000Z')
const anyString = expect.any(String) as string
const AUTH: RequestAuthContext = { token: 't', userId: 'mod-user-1', role: 'moderator' }
const SIGNED =
  'https://storage.test/object/sign/community/p1/img.jpg?token=SECRET-SIGNATURE'

type Overrides = Partial<LoadedCase>
const postCase = (overrides: Overrides = {}): LoadedCase => ({
  kind: 'post',
  source: 'post',
  reports: [
    {
      id: 'rep-1',
      reporterId: 'reporter-1',
      reason: 'harassment',
      details: 'reporter typed this',
      snapshot: {
        caption: 'Seen caption',
        altText: 'Seen alt',
        locale: 'es-419',
        capturedAt: NOW.toISOString(),
      },
      subjectAlias: 'author-alias',
      imagePath: 'community/p1/img.jpg',
      dueAt: new Date(NOW.getTime() + 3 * 3_600_000),
      acceptedAt: new Date(NOW.getTime() - 3_600_000),
      resolvedAt: null,
    },
  ],
  post: {
    userId: 'author-user-1',
    status: 'published',
    publishedAt: NOW,
    imagePath: 'community/p1/img.jpg',
    anonymizedAt: null,
    objectsPurgedAt: null,
    moderationReason: null,
    engineVersion: null,
    locale: 'en-US',
  },
  comment: null,
  aliases: new Map([['reporter-1', 'quiet-fox']]),
  priorActions: [],
  ...overrides,
})

function build(loaded: LoadedCase | null = postCase()) {
  const repository = {
    loadCase: vi.fn().mockResolvedValue(loaded),
    listCases: vi.fn().mockResolvedValue([]),
    recordCaseView: vi.fn().mockResolvedValue(undefined),
  }
  const storage = { signReadUrl: vi.fn().mockResolvedValue(SIGNED) }
  const clock = vi.fn(() => new Date(NOW))
  const service = new ModerationQueueService(
    repository as unknown as ModerationQueueRepository,
    storage,
    clock
  )
  return { service, repository, storage, clock }
}

let logged: unknown[][]
beforeEach(() => {
  logged = []
  for (const method of ['log', 'warn', 'error', 'debug', 'verbose'] as const)
    vi.spyOn(Logger.prototype, method).mockImplementation((...args: unknown[]) => {
      logged.push(args)
    })
})
afterEach(() => vi.restoreAllMocks())

describe('U-Q-SVC-AUDIT-FAILCLOSED', () => {
  it('returns 503 audit_unavailable, no case data and no signed URL when the insert fails', async () => {
    const { service, repository, storage } = build()
    repository.recordCaseView.mockRejectedValue(
      Object.assign(new Error('FK violation on AuditLog_user_id_fkey'), { code: 'P2003' })
    )
    const failure = await service
      .getCase(AUTH, 'post.p1')
      .catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(ServiceUnavailableException)
    expect((failure as ServiceUnavailableException).getResponse()).toEqual({
      statusCode: 503,
      code: 'audit_unavailable',
      message: anyString,
    })
    expect(storage.signReadUrl).not.toHaveBeenCalled()
    expect(
      JSON.stringify((failure as ServiceUnavailableException).getResponse())
    ).not.toMatch(/AuditLog|P2003|Seen caption/)
  })

  it('writes exactly one row with caseId, source and role for a successful read', async () => {
    const { service, repository } = build()
    await service.getCase({ ...AUTH, role: 'admin' }, 'post.p1')
    expect(repository.recordCaseView).toHaveBeenCalledTimes(1)
    expect(repository.recordCaseView).toHaveBeenCalledWith({
      userId: AUTH.userId,
      caseId: 'post.p1',
      source: 'post',
      role: 'admin',
    })
  })

  it('writes none for a malformed or unknown case', async () => {
    const { service, repository } = build(null)
    await expect(service.getCase(AUTH, 'not-a-case')).rejects.toMatchObject({
      response: { code: 'case_not_found' },
    })
    await expect(service.getCase(AUTH, 'post.missing')).rejects.toMatchObject({
      response: { code: 'case_not_found' },
    })
    expect(repository.recordCaseView).not.toHaveBeenCalled()
  })

  it('records the audit row before it signs anything', async () => {
    const { service, repository, storage } = build()
    const order: string[] = []
    repository.recordCaseView.mockImplementation(() => {
      order.push('audit')
      return Promise.resolve()
    })
    storage.signReadUrl.mockImplementation(() => {
      order.push('sign')
      return Promise.resolve(SIGNED)
    })
    await service.getCase(AUTH, 'post.p1')
    expect(order).toEqual(['audit', 'sign'])
  })
})

describe('U-Q-SVC-CLOCK', () => {
  it('reads the clock once per request and reuses it for state, expiry and the filter parameter', async () => {
    const { service, repository, clock } = build()
    const detail = await service.getCase(AUTH, 'post.p1')
    expect(clock).toHaveBeenCalledTimes(1)
    expect(detail.data.serverNow).toBe(NOW.toISOString())
    expect(detail.data.media).toMatchObject({
      expiresAt: new Date(
        NOW.getTime() + MODERATION_MEDIA_TTL_SECONDS * 1000
      ).toISOString(),
    })

    clock.mockClear()
    await service.listCases(AUTH, { status: 'open', limit: 25 })
    expect(clock).toHaveBeenCalledTimes(1)
    const nowArgument = (repository.listCases.mock.calls[0] as unknown[])[1] as Date
    expect(nowArgument.toISOString()).toBe(NOW.toISOString())
  })

  it('derives the SLA state from the server clock whatever the machine clock says', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(NOW.getTime() + 48 * 3_600_000))
    try {
      const { service } = build()
      expect((await service.getCase(AUTH, 'post.p1')).data.slaState).toBe('at_risk')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('U-Q-SVC-SNAPSHOT: allowlist projection', () => {
  it.each([
    ['null', null],
    ['string', 'oops'],
    ['number', 7],
    ['array', ['caption']],
    ['empty object', {}],
    ['unavailable flag', { unavailable: true, caption: 'x' }],
    ['unknown keys only', { user_id: 'u', secret: 's' }],
  ])('reads %s as unavailable', (_name, raw) => {
    expect(projectSnapshot(raw)).toEqual({
      available: false,
      caption: null,
      altText: null,
      body: null,
      climateBand: null,
      capturedAt: null,
    })
  })

  it('keeps only the known keys and drops the rest', () => {
    const projected = projectSnapshot({
      caption: 'c',
      altText: 'a',
      body: 'b',
      climateBand: 'temperate_dry',
      capturedAt: '2026-11-03T11:00:00.000Z',
      user_id: 'leaked',
      email: 'leak@example.test',
      nested: { deep: 'leaked' },
    })
    expect(projected).toEqual({
      available: true,
      caption: 'c',
      altText: 'a',
      body: 'b',
      climateBand: 'temperate_dry',
      capturedAt: '2026-11-03T11:00:00.000Z',
    })
    expect(JSON.stringify(projected)).not.toMatch(/leak/)
  })

  it('ignores a malformed capture time and non-string values', () => {
    expect(
      projectSnapshot({ caption: 3, altText: 'a', capturedAt: 'yesterday' })
    ).toMatchObject({
      available: true,
      caption: null,
      altText: 'a',
      capturedAt: null,
    })
  })
})

describe('U-Q-SVC-IDENTITY', () => {
  it('maps reporters to alias, erased and unknown and never returns an id', async () => {
    const loaded = postCase()
    loaded.reports = [
      { ...loaded.reports[0]!, id: 'r1', reporterId: 'reporter-1' },
      { ...loaded.reports[0]!, id: 'r2', reporterId: null },
      { ...loaded.reports[0]!, id: 'r3', reporterId: 'reporter-no-alias' },
    ]
    const { service } = build(loaded)
    const { data } = await service.getCase(AUTH, 'post.p1')
    expect(data.reporters.map((entry) => entry.identity)).toEqual([
      { state: 'alias', alias: 'quiet-fox' },
      { state: 'erased', alias: null },
      { state: 'unknown', alias: null },
    ])
    expect(JSON.stringify(data)).not.toMatch(
      /reporter-1|reporter-no-alias|author-user-1|mod-user-1/
    )
  })

  it('takes a post subject from the report row and a comment subject from the live author alias', async () => {
    const { service } = build()
    expect((await service.getCase(AUTH, 'post.p1')).data.subject).toEqual({
      state: 'alias',
      alias: 'author-alias',
    })

    const comment = postCase({
      kind: 'comment',
      source: 'comment',
      post: null,
      comment: {
        userId: 'comment-author',
        status: 'published',
        publishedAt: NOW,
        screeningReason: null,
        screeningVersion: null,
        locale: 'en-US',
        parentBody: null,
      },
      aliases: new Map([['comment-author', 'comment-alias']]),
    })
    expect(
      (await build(comment).service.getCase(AUTH, 'comment.c1')).data.subject
    ).toEqual({
      state: 'alias',
      alias: 'comment-alias',
    })
    const gone = postCase({
      kind: 'orphan-comment',
      source: 'comment',
      post: null,
      comment: null,
    })
    expect(
      (await build(gone).service.getCase(AUTH, 'orphan-comment.c1')).data.subject
    ).toEqual({
      state: 'erased',
      alias: null,
    })
  })

  it('passes reporter details through as capped plain text', async () => {
    const loaded = postCase()
    loaded.reports[0]!.details = 'd'.repeat(900)
    const { data } = await build(loaded).service.getCase(AUTH, 'post.p1')
    expect(data.reporters[0]!.details).toHaveLength(500)
  })
})

describe('U-Q-SVC-MEDIA', () => {
  const media = async (loaded: LoadedCase) =>
    (await build(loaded).service.getCase(AUTH, 'post.p1')).data.media

  it('signs the live image for exactly 120 seconds', async () => {
    const { service, storage } = build()
    const { data } = await service.getCase(AUTH, 'post.p1')
    expect(MODERATION_MEDIA_TTL_SECONDS).toBe(120)
    expect(storage.signReadUrl).toHaveBeenCalledWith('community/p1/img.jpg', 120)
    expect(data.media).toEqual({
      state: 'available',
      url: SIGNED,
      expiresAt: new Date(NOW.getTime() + 120_000).toISOString(),
      altText: 'Seen alt',
    })
    // No path or bucket field next to the signed URL.
    expect(Object.keys(data.media).sort()).toEqual([
      'altText',
      'expiresAt',
      'state',
      'url',
    ])
  })

  it.each([
    ['target erased', postCase({ post: null, kind: 'orphan-post' }), 'target_erased'],
    [
      'anonymized',
      postCase({ post: { ...postCase().post!, anonymizedAt: NOW } }),
      'anonymized',
    ],
    [
      'purged',
      postCase({ post: { ...postCase().post!, objectsPurgedAt: NOW } }),
      'purged',
    ],
    [
      'no image',
      postCase({ post: { ...postCase().post!, imagePath: null } }),
      'no_image',
    ],
    [
      'comment',
      postCase({
        source: 'comment',
        kind: 'comment',
        post: null,
        comment: {
          userId: 'c',
          status: 'published',
          publishedAt: NOW,
          screeningReason: null,
          screeningVersion: null,
          locale: 'en-US',
          parentBody: null,
        },
      }),
      'no_image',
    ],
  ])('reports %s as %s without calling storage', async (_name, loaded, reason) => {
    const { service, storage } = build(loaded)
    const { data } = await service.getCase(AUTH, 'post.p1')
    expect(data.media).toEqual({ state: 'unavailable', reason })
    expect(storage.signReadUrl).not.toHaveBeenCalled()
  })

  it('keeps the case readable on a signing error and never repeats the error text', async () => {
    const { service, storage } = build()
    storage.signReadUrl.mockRejectedValue(
      new Error('Object community/p1/img.jpg missing in bucket community-images')
    )
    const { data } = await service.getCase(AUTH, 'post.p1')
    expect(data.media).toEqual({ state: 'unavailable', reason: 'signing_failed' })
    expect(data.snapshot.available).toBe(true)
    expect(JSON.stringify(logged)).not.toMatch(/img\.jpg|community-images|missing/)
    expect(await media(postCase())).toMatchObject({ state: 'available' })
  })
})

describe('U-Q-SVC-FINDINGS', () => {
  const findings = async (post: Partial<NonNullable<LoadedCase['post']>>) =>
    (
      await build(postCase({ post: { ...postCase().post!, ...post } })).service.getCase(
        AUTH,
        'post.p1'
      )
    ).data

  it('maps known codes to categories with the engine version', async () => {
    const data = await findings({
      moderationReason: 'text_policy_match',
      engineVersion: '1.2.0',
    })
    expect(data.findings).toEqual({
      codes: ['text_policy_match'],
      categories: ['language'],
      engineVersion: '1.2.0',
      operatorNote: null,
    })
    // harassment (medium) plus a finding
    expect(data.risk).toBe('high')
  })

  it.each([
    ['free text', 'Taken down for doxxing'],
    ['mixed known and unknown', 'text_policy_match, nope'],
    ['punctuation only', ' , , '],
  ])('treats %s as no finding', async (_name, reason) => {
    const data = await findings({ moderationReason: reason, engineVersion: '1.0.0' })
    expect(data.findings?.codes ?? []).toEqual([])
    expect(data.risk).toBe('medium')
  })

  it('reports no findings when the target has none', async () => {
    expect((await findings({})).findings).toBeNull()
  })

  it('caps an operator note at 2,000 characters', async () => {
    const data = await findings({ moderationReason: 'n'.repeat(5000) })
    expect(data.findings!.operatorNote!.length).toBeLessThanOrEqual(2000)
  })
})

describe('U-Q-SVC-PRIOR-ACTIONS', () => {
  it('clamps action, reason and keeps actor kinds without ids', async () => {
    const loaded = postCase({
      priorActions: [
        { actorKind: 'screening', action: '', reason: null, occurredAt: NOW },
        {
          actorKind: 'operator',
          action: 'a'.repeat(200),
          reason: 'r'.repeat(5000),
          occurredAt: NOW,
        },
      ],
    })
    const { data } = await build(loaded).service.getCase(AUTH, 'post.p1')
    expect(data.priorActions[0]).toMatchObject({
      action: 'unknown',
      actorKind: 'screening',
    })
    expect(data.priorActions[1]!.action.length).toBeLessThanOrEqual(64)
    expect(data.priorActions[1]!.reason!.length).toBeLessThanOrEqual(2000)
  })
})

describe('U-Q-SVC-CONFLICT', () => {
  const conflict = async (auth: RequestAuthContext, loaded: LoadedCase) =>
    (await build(loaded).service.getCase(auth, 'post.p1')).data.viewerConflict

  it('is true for the author and for a reporter, moderator or admin alike', async () => {
    expect(await conflict({ ...AUTH, userId: 'author-user-1' }, postCase())).toBe(true)
    expect(
      await conflict({ ...AUTH, role: 'admin', userId: 'reporter-1' }, postCase())
    ).toBe(true)
  })

  it('is false for a stranger and for an orphan with no live author', async () => {
    expect(await conflict(AUTH, postCase())).toBe(false)
    expect(
      await conflict({ ...AUTH, userId: 'author-user-1' }, postCase({ post: null }))
    ).toBe(false)
  })
})

describe('U-Q-SVC-LOGGING', () => {
  it('logs the moderator as a short hash and the filter names, never content or the URL', async () => {
    const { service } = build()
    await service.getCase(AUTH, 'post.p1')
    await service.listCases(AUTH, {
      status: 'open',
      limit: 25,
      locale: 'es-419',
      risk: 'high',
      cursor: undefined,
    })
    const text = JSON.stringify(logged)
    expect(text).not.toMatch(
      /SECRET-SIGNATURE|Seen caption|reporter typed this|mod-user-1|es-419|quiet-fox|author-alias/
    )
    expect(text).toContain('moderation_queue_page')
    expect(text).toMatch(/"locale"/)
  })

  it('logs only a closed code when the audit insert fails', async () => {
    const { service, repository } = build()
    repository.recordCaseView.mockRejectedValue(
      new Error('connection to db.internal:5432 refused')
    )
    await service.getCase(AUTH, 'post.p1').catch(() => undefined)
    const text = JSON.stringify(logged)
    expect(text).toContain('audit_unavailable')
    expect(text).not.toMatch(/db\.internal|5432|Seen caption/)
  })
})
