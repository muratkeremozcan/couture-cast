// Learning path Step 50: Moderator queue and case detail.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-50-moderator-queue-and-case-detail
// Story 6.10 test owner: U-Q-CTRL-ROLES, -FLAG-ORDER, -VALIDATION, -READONLY and U-Q-READSET.
// The HTTP behavior is proved against real guards in the integration suite. These tests pin the
// declarations a refactor could drop without changing any answer a test happens to ask for.
import 'reflect-metadata'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants'
import { RequestMethod } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'
import { API_ROLES_KEY } from '../auth/security.decorators.js'
import { RequestAuthGuard, RolesGuard } from '../auth/security.guards.js'
import type { RequestAuthContext } from '../auth/security.types.js'
import { ModerationController } from './moderation.controller.js'
import { ModerationQueueController } from './moderation-queue.controller.js'
import { MODERATION_QUEUE_READ_TABLES } from './moderation-queue.repository.js'

const anyString = expect.any(String) as string
// The decorated handler, read as data so no unbound method is passed around.
const recordAction: unknown = Object.getOwnPropertyDescriptor(
  ModerationController.prototype,
  'recordAction'
)?.value
const AUTH: RequestAuthContext = { token: 't', userId: 'mod-1', role: 'moderator' }

function build(flag: boolean | Error = true) {
  const queue = {
    listCases: vi.fn().mockResolvedValue({ data: { items: [], nextCursor: null } }),
    getCase: vi.fn().mockResolvedValue({ data: {} }),
  }
  const flags = {
    getFeatureFlag: vi.fn(() =>
      flag instanceof Error ? Promise.reject(flag) : Promise.resolve(flag)
    ),
  }
  return {
    controller: new ModerationQueueController(queue as never, flags as never),
    queue,
    flags,
  }
}

describe('U-Q-CTRL-ROLES: the guard declarations', () => {
  it('guards the whole controller with the auth guard and the role guard, in that order', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, ModerationQueueController)).toEqual([
      RequestAuthGuard,
      RolesGuard,
    ])
  })

  it('admits exactly moderator and admin', () => {
    expect(Reflect.getMetadata(API_ROLES_KEY, ModerationQueueController)).toEqual([
      'moderator',
      'admin',
    ])
  })

  it('matches the role set of the existing write-only moderation controller', () => {
    const existing: unknown = Reflect.getMetadata(API_ROLES_KEY, recordAction as object)
    expect(existing).toEqual(
      Reflect.getMetadata(API_ROLES_KEY, ModerationQueueController)
    )
  })
})

describe('U-Q-CTRL-FLAG-ORDER', () => {
  it('reads the flag for the caller and serves when it is on', async () => {
    const { controller, flags, queue } = build(true)
    await controller.listCases(AUTH, {})
    expect(flags.getFeatureFlag).toHaveBeenCalledWith(
      'moderation_console_enabled',
      'mod-1'
    )
    expect(queue.listCases).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['off', false],
    ['unreadable', new Error('posthog and the cache both failed')],
  ])(
    'answers 503 moderation_console_disabled and never reads cases when the flag is %s',
    async (_name, flag) => {
      const { controller, queue } = build(flag)
      for (const call of [
        () => controller.listCases(AUTH, {}),
        () => controller.getCase(AUTH, 'post.p1'),
      ])
        await expect(call()).rejects.toMatchObject({
          response: { statusCode: 503, code: 'moderation_console_disabled' },
        })
      expect(queue.listCases).not.toHaveBeenCalled()
      expect(queue.getCase).not.toHaveBeenCalled()
    }
  )

  it('checks the flag before it validates the query, so a disabled console answers 503 for bad input too', async () => {
    const { controller } = build(false)
    await expect(controller.listCases(AUTH, { risk: 'critical' })).rejects.toMatchObject({
      response: { code: 'moderation_console_disabled' },
    })
  })
})

describe('U-Q-CTRL-VALIDATION', () => {
  it('answers 400 invalid_filter without echoing the input', async () => {
    const { controller, queue } = build()
    let body: unknown
    try {
      await controller.listCases(AUTH, { risk: 'critical-DO-NOT-ECHO', limit: '500' })
    } catch (error) {
      body = (error as { getResponse: () => unknown }).getResponse()
    }
    expect(body).toEqual({
      statusCode: 400,
      code: 'invalid_filter',
      message: anyString,
    })
    expect(JSON.stringify(body)).not.toContain('DO-NOT-ECHO')
    expect(queue.listCases).not.toHaveBeenCalled()
  })

  it('hands the parsed query, with defaults applied, to the service', async () => {
    const { controller, queue } = build()
    await controller.listCases(AUTH, { risk: 'high' })
    expect(queue.listCases).toHaveBeenCalledWith(AUTH, {
      risk: 'high',
      status: 'open',
      limit: 25,
    })
  })
})

describe('U-Q-CTRL-READONLY: only reads are routed', () => {
  it('declares two GET handlers and nothing else', () => {
    const handlers = Object.getOwnPropertyNames(
      ModerationQueueController.prototype
    ).filter(
      (name) =>
        name !== 'constructor' &&
        typeof (ModerationQueueController.prototype as never)[name] === 'function'
    )
    const routed = handlers
      .map((name) => {
        const handler = (ModerationQueueController.prototype as never)[name]
        return {
          name,
          method: Reflect.getMetadata(METHOD_METADATA, handler) as
            | RequestMethod
            | undefined,
          path: Reflect.getMetadata(PATH_METADATA, handler) as string | undefined,
        }
      })
      .filter((route) => route.method !== undefined)
    expect(routed.map((route) => route.method)).toEqual([
      RequestMethod.GET,
      RequestMethod.GET,
    ])
    expect(routed.map((route) => route.path).sort()).toEqual(['cases', 'cases/:caseId'])
  })

  it('leaves the existing action route and its contract as they were (G)', () => {
    expect(Reflect.getMetadata(PATH_METADATA, ModerationController)).toBe(
      '/api/v1/moderation'
    )
    expect(Reflect.getMetadata(PATH_METADATA, recordAction as object)).toBe('actions')
    expect(Reflect.getMetadata(METHOD_METADATA, recordAction as object)).toBe(
      RequestMethod.POST
    )
  })
})

describe('U-Q-READSET: the repository reads only the tables the RLS suite proves denied', () => {
  const source = readFileSync(join(__dirname, 'moderation-queue.repository.ts'), 'utf8')

  it('names every table in a raw SQL FROM or JOIN inside MODERATION_QUEUE_READ_TABLES', () => {
    const named = [...source.matchAll(/(?:FROM|JOIN)\s+"([A-Za-z]+)"/g)].map(
      (match) => match[1]!
    )
    expect(named.length).toBeGreaterThan(0)
    for (const table of named)
      expect(MODERATION_QUEUE_READ_TABLES, `raw SQL reads ${table}`).toContain(table)
  })

  it('maps every Prisma delegate it reads to a listed table', () => {
    const delegates = [
      ...source.matchAll(
        /(?:this\.prisma|\bdb)\.([a-zA-Z]+)\.(?:find|count|aggregate|groupBy)/g
      ),
    ].map((match) => match[1]!)
    expect(delegates.length).toBeGreaterThan(0)
    for (const delegate of new Set(delegates)) {
      const table = delegate.charAt(0).toUpperCase() + delegate.slice(1)
      expect(MODERATION_QUEUE_READ_TABLES, `delegate ${delegate}`).toContain(table)
    }
  })

  it('writes nothing except the audit row', () => {
    const writes = [
      ...source.matchAll(
        /(?:this\.prisma|\bdb)\.([a-zA-Z]+)\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\b/g
      ),
    ].map((match) => `${match[1]}.${match[2]}`)
    expect(writes).toEqual(['auditLog.create'])
    expect(source).not.toMatch(/\$executeRaw|INSERT\s+INTO|UPDATE\s+"|DELETE\s+FROM/i)
  })

  it('lists no table twice and no table outside the community and moderation set', () => {
    expect(new Set(MODERATION_QUEUE_READ_TABLES).size).toBe(
      MODERATION_QUEUE_READ_TABLES.length
    )
    expect([...MODERATION_QUEUE_READ_TABLES].sort()).toEqual(
      [
        'CommunityAlias',
        'CommunityComment',
        'CommunityCommentAudit',
        'CommunityCommentReport',
        'CommunityPostReport',
        'CommunitySanction',
        'LookbookPost',
        'ModerationDecision',
        'ModerationErasureRequest',
        'ModerationEvent',
      ].sort()
    )
  })
})
