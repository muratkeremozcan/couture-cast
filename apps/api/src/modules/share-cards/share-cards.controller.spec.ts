import 'reflect-metadata'
import { EventEmitter } from 'node:events'
import { BadRequestException, ForbiddenException } from '@nestjs/common'
import {
  GUARDS_METADATA,
  HEADERS_METADATA,
  MODULE_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants'
import { describe, expect, it, vi } from 'vitest'
import { ZodError } from 'zod'
import { preparedShareCardFixture } from '@couture/api-client/testing/share-card-fixture'
import { RequestAuthGuard } from '../auth/security.guards.js'
import { FeatureFlagsModule } from '../feature-flags/feature-flags.module.js'
import { FeatureFlagsService } from '../feature-flags/feature-flags.service.js'
import { ShareCardsController } from './share-cards.controller.js'
import { ShareCardsModule } from './share-cards.module.js'
import { ShareCardsService } from './share-cards.service.js'
const input = {
  source: { kind: 'outfit', recommendationId: 'owned' },
  locale: 'en-US',
  watermark: true,
  purpose: 'preview',
}
it.each(['request', 'response'] as const)(
  'propagates incomplete %s disconnect and removes listeners',
  async (disconnected) => {
    const request = Object.assign(new EventEmitter(), { aborted: false })
    const response = Object.assign(new EventEmitter(), {
      writableFinished: false,
      destroyed: false,
    })
    const prepare = vi.fn((_member: string, _input: unknown, signal: AbortSignal) => {
      if (disconnected === 'request') request.emit('aborted')
      else response.emit('close')
      expect(signal.aborted).toBe(true)
      return Promise.resolve(preparedShareCardFixture)
    })
    await new ShareCardsController({ prepare } as never).prepare(
      { userId: 'member' } as never,
      input,
      request as never,
      response as never
    )
    // The aborted-signal assertion lives in the double; it ran only if prepare did.
    expect(prepare).toHaveBeenCalledOnce()
    expect(request.listenerCount('aborted')).toBe(0)
    expect(response.listenerCount('close')).toBe(0)
  }
)
describe('completed HTTP request', () => {
  it('normal completed request close and finished response do not cancel valid preparation', async () => {
    const request = Object.assign(new EventEmitter(), { aborted: false, complete: true })
    const response = Object.assign(new EventEmitter(), {
      writableFinished: true,
      destroyed: false,
    })
    const prepare = vi.fn((_member: string, _input: unknown, signal: AbortSignal) => {
      request.emit('close')
      response.emit('close')
      expect(signal.aborted).toBe(false)
      return Promise.resolve(preparedShareCardFixture)
    })
    await expect(
      new ShareCardsController({ prepare } as never).prepare(
        { userId: 'member' } as never,
        input,
        request as never,
        response as never
      )
    ).resolves.toEqual({ data: preparedShareCardFixture })
    expect(prepare).toHaveBeenCalledOnce()
    expect(response.listenerCount('close')).toBe(0)
  })
})
describe('invalid request bodies', () => {
  it.each([
    ['extra top-level field', { ...input, url: 'https://private.invalid' }],
    ['extra source field', { ...input, source: { ...input.source, path: '/private' } }],
    [
      'URL source id',
      { ...input, source: { kind: 'outfit', recommendationId: 'https://x' } },
    ],
    [
      'path source id',
      { ...input, source: { kind: 'community_post', postId: '../private' } },
    ],
    ['preview digest', { ...input, expectedSha256: 'a'.repeat(64) }],
    ['save without digest', { ...input, purpose: 'save' }],
    ['non-object body', 'source=private'],
  ])('U-CONTRACT: %s is refused with 400 before preparation', async (_name, body) => {
    const request = Object.assign(new EventEmitter(), { aborted: false })
    const response = Object.assign(new EventEmitter(), {
      writableFinished: false,
      destroyed: false,
    })
    const prepare = vi.fn()
    await expect(
      new ShareCardsController({ prepare } as never).prepare(
        { userId: 'member' } as never,
        body,
        request as never,
        response as never
      )
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(prepare).not.toHaveBeenCalled()
    expect(request.listenerCount('aborted')).toBe(0)
    expect(response.listenerCount('close')).toBe(0)
  })
})
const connection = () => ({
  request: Object.assign(new EventEmitter(), { aborted: false }),
  response: Object.assign(new EventEmitter(), {
    writableFinished: false,
    destroyed: false,
  }),
})
describe('U-SHARE-CTRL: share routing and envelopes', () => {
  const share = {
    ...input,
    purpose: 'share',
    expectedSha256: preparedShareCardFixture.sha256,
  }
  it('routes a valid share body to the service and returns the strict envelope', async () => {
    const { request, response } = connection()
    const prepare = vi.fn(() => Promise.resolve(preparedShareCardFixture))
    await expect(
      new ShareCardsController({ prepare } as never).prepare(
        { userId: 'member' } as never,
        share,
        request as never,
        response as never
      )
    ).resolves.toEqual({ data: preparedShareCardFixture })
    expect(prepare).toHaveBeenCalledWith('member', share, expect.any(AbortSignal))
  })
  it.each([
    ['share without digest', { ...input, purpose: 'share' }],
    ['share with an uppercase digest', { ...share, expectedSha256: 'A'.repeat(64) }],
    ['share with a file URI', { ...share, fileUri: 'file:///cache/cc69-share-1.png' }],
  ])(
    '%s is refused with the shared 400 envelope before preparation',
    async (_name, body) => {
      const { request, response } = connection()
      const prepare = vi.fn()
      const failure = await new ShareCardsController({ prepare } as never)
        .prepare({ userId: 'member' } as never, body, request as never, response as never)
        .catch((error: unknown) => error)
      expect(failure).toBeInstanceOf(BadRequestException)
      expect((failure as BadRequestException).getResponse()).toMatchObject({
        statusCode: 400,
        error: 'Bad Request',
      })
      expect(prepare).not.toHaveBeenCalled()
    }
  )
  it('passes the flag-off 403 envelope through unchanged', async () => {
    const { request, response } = connection()
    const refusal = new ForbiddenException({
      statusCode: 403,
      code: 'share_disabled',
      message: 'share_disabled',
    })
    const failure = await new ShareCardsController({
      prepare: () => Promise.reject(refusal),
    } as never)
      .prepare({ userId: 'member' } as never, share, request as never, response as never)
      .catch((error: unknown) => error)
    expect(failure).toBe(refusal)
    expect((failure as ForbiddenException).getResponse()).toEqual({
      statusCode: 403,
      code: 'share_disabled',
      message: 'share_disabled',
    })
    expect(request.listenerCount('aborted')).toBe(0)
    expect(response.listenerCount('close')).toBe(0)
  })
  it('ShareCardsModule imports FeatureFlagsModule, which exports the flag service it needs', () => {
    const imports = Reflect.getMetadata(
      MODULE_METADATA.IMPORTS,
      ShareCardsModule
    ) as unknown[]
    expect(imports).toContain(FeatureFlagsModule)
    const exported = Reflect.getMetadata(
      MODULE_METADATA.EXPORTS,
      FeatureFlagsModule
    ) as unknown[]
    expect(exported).toContain(FeatureFlagsService)
    const injected = Reflect.getMetadata('self:paramtypes', ShareCardsService) as {
      index: number
      param: unknown
    }[]
    expect(injected.map(({ param }) => param)).toContain(FeatureFlagsService)
  })
})
describe('U-SHARE-CAP-API: capabilities route', () => {
  const handler = Object.getOwnPropertyDescriptor(
    ShareCardsController.prototype,
    'capabilities'
  )!.value as object
  it('is a guarded GET with a private, no-store cache header', () => {
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('capabilities')
    expect(Reflect.getMetadata(GUARDS_METADATA, ShareCardsController)).toContain(
      RequestAuthGuard
    )
    expect(Reflect.getMetadata(HEADERS_METADATA, handler)).toEqual([
      { name: 'Cache-Control', value: 'private, no-store' },
    ])
  })
  it.each([true, false])(
    "returns the caller's flag value %s in the shared envelope",
    async (nativeShare) => {
      const capabilities = vi.fn(() => Promise.resolve({ nativeShare }))
      await expect(
        new ShareCardsController({ capabilities } as never).capabilities({
          userId: 'cap-member',
        } as never)
      ).resolves.toEqual({ data: { nativeShare } })
      expect(capabilities).toHaveBeenCalledWith('cap-member')
    }
  )
  it('never forwards anything beyond the boolean', async () => {
    const capabilities = () => Promise.resolve({ nativeShare: true, cohort: 'beta' })
    const failure: unknown = await new ShareCardsController({ capabilities } as never)
      .capabilities({ userId: 'cap-member' } as never)
      .catch((error: unknown) => error)
    // The strict envelope refuses the extra key itself; an unrelated throw would not match.
    expect(failure).toBeInstanceOf(ZodError)
    expect((failure as ZodError).issues).toEqual([
      expect.objectContaining({
        code: 'unrecognized_keys',
        keys: ['cohort'],
        path: ['data'],
      }),
    ])
  })
})
