import { Buffer } from 'node:buffer'
import { ConflictException, ForbiddenException } from '@nestjs/common'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { preparedShareCardFixture } from '@couture/api-client/testing/share-card-fixture'
import { SHARE_CARD_GLOBAL_LIMIT, ShareCardsService } from './share-cards.service.js'
const projected = { kind: 'outfit', scenario: 'morning', categories: ['top'] }
const sources = { resolve: vi.fn(), resolveGuarded: vi.fn() }
const renderer = {
  prepare:
    vi.fn<
      (
        source: unknown,
        locale: string,
        watermark: boolean,
        photo: Buffer | undefined,
        signal: AbortSignal
      ) => Promise<{ bytes: Buffer; accessibilityLabel: string }>
    >(),
}
const storage = { downloadBounded: vi.fn() }
const prisma = {
  auditLog: { create: vi.fn() },
  $transaction: vi.fn(async (work: (tx: unknown) => Promise<unknown>) => work(prisma)),
}
const service = new ShareCardsService(
  prisma as never,
  sources as never,
  renderer as never,
  storage as never
)
const input = {
  source: { kind: 'outfit', recommendationId: 'owned' },
  locale: 'en-US',
  watermark: true,
  purpose: 'preview',
} as const
beforeEach(() => {
  sources.resolve.mockReset().mockResolvedValue(projected)
  sources.resolveGuarded.mockReset().mockResolvedValue(projected)
  renderer.prepare.mockReset().mockResolvedValue({
    bytes: Buffer.from(preparedShareCardFixture.pngBase64, 'base64'),
    accessibilityLabel: preparedShareCardFixture.accessibilityLabel,
  })
  prisma.auditLog.create.mockReset().mockResolvedValue({})
  storage.downloadBounded.mockReset()
})
afterEach(() => vi.useRealTimers())
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((yes) => {
    resolve = yes
  })
  return { promise, resolve }
}
const rendered = {
  bytes: Buffer.from(preparedShareCardFixture.pngBase64, 'base64'),
  accessibilityLabel: preparedShareCardFixture.accessibilityLabel,
}
describe('share-card preparation boundaries', () => {
  it('U-OUTFIT U-LOG-PRIVACY: closed output and audit retain no source identifier or sensitive text', async () => {
    const card = await service.prepare('private-member', input)
    expect(card).toEqual(preparedShareCardFixture)
    await service.prepare('private-member', {
      ...input,
      purpose: 'save',
      expectedSha256: card.sha256,
    })
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: {
        user_id: 'private-member',
        event_type: 'share_card_export_authorized',
        event_data: {
          sourceKind: 'outfit',
          locale: 'en-US',
          watermark: true,
          templateVersion: 1,
        },
      },
    })
    expect(JSON.stringify(card)).not.toContain('private-member')
    expect(JSON.stringify(card)).not.toContain('owned')
    expect(storage.downloadBounded).not.toHaveBeenCalled()
  })
  it('U-STALE-PREVIEW: changed composition and stale expected hash cannot authorize save', async () => {
    await expect(
      service.prepare('member', {
        ...input,
        purpose: 'save',
        expectedSha256: 'f'.repeat(64),
      })
    ).rejects.toBeInstanceOf(ConflictException)
    expect(prisma.auditLog.create).not.toHaveBeenCalled()
    sources.resolve
      .mockReset()
      .mockResolvedValueOnce(projected)
      .mockResolvedValueOnce({ ...projected, categories: ['dress'] })
    await expect(service.prepare('member', input)).rejects.toBeInstanceOf(
      ConflictException
    )
  })
  it('U-PREPARE-ERROR: renderer errors and audit outage fail closed with a fixed error code', async () => {
    renderer.prepare.mockRejectedValueOnce(
      new Error('private signed URL https://private.invalid')
    )
    await expect(service.prepare('member', input)).rejects.toMatchObject({
      status: 503,
      response: { code: 'render_unavailable' },
    })
    prisma.auditLog.create.mockRejectedValueOnce(new Error('private audit payload'))
    await expect(
      service.prepare('member', {
        ...input,
        purpose: 'save',
        expectedSha256: preparedShareCardFixture.sha256,
      })
    ).rejects.toMatchObject({ status: 503 })
  })
  it('U-IDENTITY U-CANCEL U-OFFLINE: cancelled and freshly denied requests produce no image', async () => {
    const abort = new AbortController()
    abort.abort()
    await expect(service.prepare('member', input, abort.signal)).rejects.toMatchObject({
      status: 503,
    })
    expect(renderer.prepare).not.toHaveBeenCalled()
    sources.resolve.mockRejectedValueOnce(new ForbiddenException('denied'))
    await expect(service.prepare('member', input)).rejects.toMatchObject({ status: 403 })
    expect(renderer.prepare).not.toHaveBeenCalled()
  })
  it('U-DEADLINE: the real15second service deadline refuses held dependency work and no late result/audit is accepted', async () => {
    vi.useFakeTimers()
    const late = deferred<typeof rendered>()
    renderer.prepare.mockReturnValueOnce(late.promise)
    const attempt = service.prepare('deadline-member', {
      ...input,
      purpose: 'save',
      expectedSha256: preparedShareCardFixture.sha256,
    })
    const refused = expect(attempt).rejects.toMatchObject({
      status: 503,
      response: { code: 'render_unavailable' },
    })
    await vi.advanceTimersByTimeAsync(15000)
    await refused
    expect(renderer.prepare.mock.calls[0]?.[4].aborted).toBe(true)
    await expect(service.prepare('deadline-member', input)).rejects.toMatchObject({
      status: 503,
    })
    late.resolve(rendered)
    await vi.advanceTimersByTimeAsync(0)
    expect(prisma.auditLog.create).not.toHaveBeenCalled()
    await expect(service.prepare('deadline-member', input)).resolves.toEqual(
      preparedShareCardFixture
    )
  })
  it('U-ADMISSION: bounded global/member capacity stays owned after cancellation until actual settlement, then releases on failure', async () => {
    const holds = Array.from({ length: SHARE_CARD_GLOBAL_LIMIT }, () =>
      deferred<typeof rendered>()
    )
    renderer.prepare.mockImplementation(
      () => holds[renderer.prepare.mock.calls.length - 1]!.promise
    )
    const parents = holds.map(() => new AbortController())
    const work = holds.map((_, index) =>
      service.prepare(`capacity-${index}`, input, parents[index]!.signal)
    )
    const refusals = work.map((promise) =>
      expect(promise).rejects.toMatchObject({ status: 503 })
    )
    await vi.waitFor(() =>
      expect(renderer.prepare).toHaveBeenCalledTimes(SHARE_CARD_GLOBAL_LIMIT)
    )
    await expect(service.prepare('capacity-0', input)).rejects.toMatchObject({
      status: 503,
    })
    await expect(service.prepare('extra-member', input)).rejects.toMatchObject({
      status: 503,
    })
    parents.forEach((parent) => parent.abort())
    await Promise.all(refusals)
    await expect(service.prepare('extra-member', input)).rejects.toMatchObject({
      status: 503,
    })
    holds.forEach((hold) => hold.resolve(rendered))
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    renderer.prepare.mockRejectedValueOnce(new Error('native failure'))
    await expect(service.prepare('extra-member', input)).rejects.toMatchObject({
      status: 503,
    })
    renderer.prepare.mockResolvedValue(rendered)
    await expect(service.prepare('extra-member', input)).resolves.toEqual(
      preparedShareCardFixture
    )
  })
  it('U-AUDIT-RACE: late final refusal after audit persistence rejects the transaction and grant', async () => {
    const delayed = deferred<unknown>()
    prisma.auditLog.create.mockReturnValueOnce(delayed.promise)
    sources.resolveGuarded.mockRejectedValueOnce(new ForbiddenException('revoked'))
    const attempt = service.prepare('audit-member', {
      ...input,
      purpose: 'save',
      expectedSha256: preparedShareCardFixture.sha256,
    })
    await vi.waitFor(() => expect(prisma.auditLog.create).toHaveBeenCalledOnce())
    delayed.resolve({})
    await expect(attempt).rejects.toMatchObject({ status: 403 })
    expect(sources.resolveGuarded).toHaveBeenCalledOnce()
  })
})
