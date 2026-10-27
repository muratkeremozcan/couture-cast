import { Buffer } from 'node:buffer'
import { ConflictException, ForbiddenException } from '@nestjs/common'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { preparedShareCardFixture } from '@couture/api-client/testing/share-card-fixture'
import { SHARE_CARD_GLOBAL_LIMIT, ShareCardsService } from './share-cards.service.js'
import { ShareCardAdmission } from './share-card-admission.js'
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
let service: ShareCardsService
const input = {
  source: { kind: 'outfit', recommendationId: 'owned' },
  locale: 'en-US',
  watermark: true,
  purpose: 'preview',
} as const
beforeEach(() => {
  service = new ShareCardsService(
    prisma as never,
    sources as never,
    renderer as never,
    storage as never
  )
  sources.resolve.mockReset().mockResolvedValue(projected)
  sources.resolveGuarded.mockReset().mockResolvedValue(projected)
  renderer.prepare.mockReset().mockResolvedValue({
    bytes: Buffer.from(preparedShareCardFixture.pngBase64, 'base64'),
    accessibilityLabel: preparedShareCardFixture.accessibilityLabel,
  })
  prisma.auditLog.create.mockReset().mockResolvedValue({})
  storage.downloadBounded.mockReset()
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((yes) => {
    resolve = yes
  })
  return { promise, resolve }
}
/** Resolves once `count` admitted operations have released their slots. */
function admissionReleases(count: number) {
  const acquire = Object.getOwnPropertyDescriptor(
    ShareCardAdmission.prototype,
    'acquire'
  )!.value as (
    this: ShareCardAdmission,
    member: string,
    signal: AbortSignal
  ) => Promise<() => void>
  let released = 0
  let settle!: () => void
  const settled = new Promise<void>((resolve) => {
    settle = resolve
  })
  vi.spyOn(ShareCardAdmission.prototype, 'acquire').mockImplementation(async function (
    this: ShareCardAdmission,
    member: string,
    signal: AbortSignal
  ) {
    const release = await (acquire.call(this, member, signal) as Promise<() => void>)
    return () => {
      release()
      if (++released === count) settle()
    }
  })
  return settled
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
  it('U-CANCEL: cancelled and freshly denied requests produce no image', async () => {
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
    const queuedParent = new AbortController()
    const queued = service.prepare('deadline-member', input, queuedParent.signal)
    const queuedRefusal = expect(queued).rejects.toMatchObject({
      status: 503,
    })
    queuedParent.abort()
    await queuedRefusal
    expect(renderer.prepare).toHaveBeenCalledOnce()
    late.resolve(rendered)
    await vi.advanceTimersByTimeAsync(0)
    expect(prisma.auditLog.create).not.toHaveBeenCalled()
    await expect(service.prepare('deadline-member', input)).resolves.toEqual(
      preparedShareCardFixture
    )
  })
  it('U-ADMISSION: bounded global/member capacity stays owned after cancellation until actual settlement, then releases on failure', async () => {
    const released = admissionReleases(SHARE_CARD_GLOBAL_LIMIT)
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
    await released
    renderer.prepare.mockRejectedValueOnce(new Error('native failure'))
    await expect(service.prepare('extra-member', input)).rejects.toMatchObject({
      status: 503,
    })
    renderer.prepare.mockResolvedValue(rendered)
    await expect(service.prepare('extra-member', input)).resolves.toEqual(
      preparedShareCardFixture
    )
  })
  it('M1: a newer composition waits for its cancelled predecessor without releasing active capacity early', async () => {
    const oldRender = deferred<typeof rendered>()
    renderer.prepare.mockReturnValueOnce(oldRender.promise)
    const parent = new AbortController()
    const first = service.prepare('rapid-composition', input, parent.signal)
    const cancelled = expect(first).rejects.toMatchObject({ status: 503 })
    await vi.waitFor(() => expect(renderer.prepare).toHaveBeenCalledOnce())
    parent.abort()
    await cancelled
    const replacement = service.prepare('rapid-composition', {
      ...input,
      watermark: false,
    })
    const accepted = expect(replacement).resolves.toEqual(preparedShareCardFixture)
    try {
      expect(renderer.prepare).toHaveBeenCalledOnce()
    } finally {
      oldRender.resolve(rendered)
    }
    await accepted
    expect(renderer.prepare).toHaveBeenCalledTimes(2)
    expect(renderer.prepare.mock.calls[1]?.[2]).toBe(false)
  })
  it('M1-DEADLINE: waiting and rendering share one15second deadline and timed-out waiters never start', async () => {
    vi.useFakeTimers()
    const oldRender = deferred<typeof rendered>()
    renderer.prepare.mockReturnValueOnce(oldRender.promise)
    const parent = new AbortController()
    const first = service.prepare('queued-deadline', input, parent.signal)
    const cancelled = expect(first).rejects.toMatchObject({ status: 503 })
    await vi.advanceTimersByTimeAsync(0)
    parent.abort()
    await cancelled
    const queued = service.prepare('queued-deadline', input)
    const expired = expect(queued).rejects.toMatchObject({ status: 503 })
    await vi.advanceTimersByTimeAsync(15000)
    await expired
    expect(renderer.prepare).toHaveBeenCalledOnce()
    oldRender.resolve(rendered)
    await vi.advanceTimersByTimeAsync(0)
    expect(renderer.prepare).toHaveBeenCalledOnce()
    await expect(service.prepare('queued-deadline', input)).resolves.toEqual(
      preparedShareCardFixture
    )

    const predecessor = deferred<typeof rendered>()
    const replacement = deferred<typeof rendered>()
    renderer.prepare
      .mockReset()
      .mockReturnValueOnce(predecessor.promise)
      .mockReturnValueOnce(replacement.promise)
    const nextParent = new AbortController()
    const old = service.prepare('shared-deadline', input, nextParent.signal)
    const oldRefused = expect(old).rejects.toMatchObject({ status: 503 })
    await vi.advanceTimersByTimeAsync(0)
    nextParent.abort()
    await oldRefused
    const next = service.prepare('shared-deadline', input)
    let settled = false
    const nextRefused = expect(next).rejects.toMatchObject({ status: 503 })
    void next.catch(() => {
      settled = true
    })
    await vi.advanceTimersByTimeAsync(14000)
    predecessor.resolve(rendered)
    await vi.advanceTimersByTimeAsync(0)
    expect(renderer.prepare).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(999)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await nextRefused
    expect(renderer.prepare.mock.calls[1]?.[4].aborted).toBe(true)
    replacement.resolve(rendered)
    await vi.advanceTimersByTimeAsync(0)
    expect(prisma.auditLog.create).not.toHaveBeenCalled()
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
