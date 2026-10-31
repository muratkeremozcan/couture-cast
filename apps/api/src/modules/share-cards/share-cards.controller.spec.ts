// Learning path Step 48: Safe branded share-card export.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-48-safe-branded-share-card-export
import { EventEmitter } from 'node:events'
import { BadRequestException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'
import { preparedShareCardFixture } from '@couture/api-client/testing/share-card-fixture'
import { ShareCardsController } from './share-cards.controller.js'
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
