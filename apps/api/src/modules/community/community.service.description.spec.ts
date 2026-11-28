// Learning path Step 82: Suggested Community descriptions.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-82-suggested-community-descriptions
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'
import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common'
import { COMMUNITY_UPLOAD_SESSION_MISMATCH_MESSAGE } from '@couture/api-client/contracts/http'
import { CommunityObjectDownloadError } from './community-storage.adapter'
import { CommunityRateLimitException } from './community-rate-limit.exception'
import {
  createService,
  ownPendingPost,
  registerCommunityServiceLifecycle,
  viewerUserId,
} from '../../testing/community/community-service.fixture'

const input = {
  postId: 'ead5dc72-9d08-42a5-820e-c125a8528dcb',
  uploadSessionId: '1ac688b8-a0ea-4e32-91c1-ee2931fbd10c',
}
const path = `community/${input.postId}/${input.uploadSessionId}.png`

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function draft(overrides = {}) {
  return {
    ...ownPendingPost,
    id: input.postId,
    status: 'draft',
    image_object_path: path,
    upload_expires_at: new Date(Date.now() + 60_000),
    ...overrides,
  }
}

async function validDraft() {
  const bytes = await sharp({
    create: { width: 320, height: 480, channels: 3, background: '#2277bb' },
  })
    .png()
    .toBuffer()
  const post = draft({
    image_content_type: 'image/png',
    image_byte_size: bytes.length,
    image_checksum: createHash('sha256').update(bytes).digest('hex'),
    locale: 'fr-FR',
  })
  return { post, bytes }
}

describe('Community draft photo caption', () => {
  registerCommunityServiceLifecycle()

  it('uses a verified private upload and returns a localized editable sentence', async () => {
    const { service, findPostById, downloadBounded } = createService()
    const { post, bytes } = await validDraft()
    downloadBounded.mockResolvedValue(bytes)
    findPostById.mockResolvedValue(post)

    await expect(service.describeDraft({ userId: viewerUserId, input })).resolves.toBe(
      'Cette photo fait ressortir des nuances de bleu.'
    )
    expect(downloadBounded).toHaveBeenCalledWith(
      path,
      bytes.length,
      expect.any(AbortSignal)
    )
    expect(bytes.every((byte) => byte === 0)).toBe(true)
  })

  it('includes eligibility in the five-second budget and stops before reading the photo', async () => {
    vi.useFakeTimers()
    const { service, assertDraftCaptionAccess, findPostById, downloadBounded } =
      createService()
    const eligibility = deferred<void>()
    assertDraftCaptionAccess.mockReturnValueOnce(eligibility.promise)
    const settled = vi.fn()
    const attempt = service.describeDraft({ userId: viewerUserId, input })
    const outcome = attempt.then(settled, settled)

    try {
      await vi.advanceTimersByTimeAsync(4_999)
      expect(assertDraftCaptionAccess).toHaveBeenCalledOnce()
      expect(settled).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      await expect(attempt).rejects.toMatchObject({ status: 503 })
    } finally {
      eligibility.resolve()
    }

    await outcome
    await vi.advanceTimersByTimeAsync(0)
    expect(findPostById).not.toHaveBeenCalled()
    expect(downloadBounded).not.toHaveBeenCalled()
  })

  it('aborts a stalled private read and keeps its slot until the late image is discarded', async () => {
    const { service, assertDraftCaptionAccess, findPostById, downloadBounded } =
      createService()
    const { post, bytes } = await validDraft()
    const lateBytes = Buffer.from(bytes)
    vi.useFakeTimers()
    const storage = deferred<Buffer>()
    findPostById.mockResolvedValue(post)
    downloadBounded.mockReturnValueOnce(storage.promise)
    const settled = vi.fn()
    const attempt = service.describeDraft({ userId: viewerUserId, input })
    const outcome = attempt.then(settled, settled)

    try {
      await vi.advanceTimersByTimeAsync(4_999)
      expect(downloadBounded).toHaveBeenCalledOnce()
      const signal = downloadBounded.mock.calls[0]?.[2]
      expect(signal?.aborted).toBe(false)
      expect(settled).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      await expect(attempt).rejects.toMatchObject({ status: 503 })
      expect(signal?.aborted).toBe(true)
      await expect(
        service.describeDraft({ userId: viewerUserId, input })
      ).rejects.toMatchObject({
        status: 429,
        retryAfterSeconds: 1,
      })
      expect(downloadBounded).toHaveBeenCalledOnce()
    } finally {
      storage.resolve(lateBytes)
    }

    await outcome
    await vi.advanceTimersByTimeAsync(0)
    expect(assertDraftCaptionAccess).toHaveBeenCalledTimes(2)
    expect(findPostById).toHaveBeenCalledTimes(2)
    expect(lateBytes.every((byte) => byte === 0)).toBe(true)

    vi.useRealTimers()
    downloadBounded.mockResolvedValueOnce(Buffer.from(bytes))
    await expect(service.describeDraft({ userId: viewerUserId, input })).resolves.toBe(
      'Cette photo fait ressortir des nuances de bleu.'
    )
    expect(downloadBounded).toHaveBeenCalledTimes(2)
  })

  it('serves four active readers and refuses a fifth before reserving or reading', async () => {
    const { service, findPostById, reserveDraftCaptionRequest, downloadBounded } =
      createService()
    const { post, bytes } = await validDraft()
    const storage = deferred<void>()
    const drafts = Array.from({ length: 5 }, (_, index) => {
      const userId = `member-${index}`
      const postId = `ead5dc72-9d08-42a5-820e-c125a8528dc${index}`
      return {
        userId,
        input: { ...input, postId },
        post: {
          ...post,
          id: postId,
          user_id: userId,
          image_object_path: `community/${postId}/${input.uploadSessionId}.png`,
        },
      }
    })
    findPostById.mockImplementation((postId) =>
      Promise.resolve(drafts.find((entry) => entry.post.id === postId)?.post ?? null)
    )
    downloadBounded.mockImplementation(async () => {
      await storage.promise
      return Buffer.from(bytes)
    })
    const all = Promise.allSettled(
      drafts.slice(0, 4).map((entry) => service.describeDraft(entry))
    )
    try {
      await vi.waitFor(() => expect(downloadBounded).toHaveBeenCalledTimes(4))
      await expect(service.describeDraft(drafts[4]!)).rejects.toMatchObject({
        status: 503,
        message: 'Community caption suggestion is busy.',
      })
      expect(reserveDraftCaptionRequest).toHaveBeenCalledTimes(4)
      expect(downloadBounded).toHaveBeenCalledTimes(4)
    } finally {
      storage.resolve()
    }
    expect(await all).toEqual(
      Array.from({ length: 4 }, () => ({
        status: 'fulfilled',
        value: 'Cette photo fait ressortir des nuances de bleu.',
      }))
    )
  })

  it.each([
    ['checksum', { image_checksum: '8'.repeat(64) }],
    ['media type', { image_content_type: 'image/jpeg' }],
    ['byte size', { image_byte_size: 1 }],
    ['locale', { locale: 'en-US' }],
  ])('refuses a draft whose %s changes before delivery', async (_, updated) => {
    const { service, findPostById, downloadBounded } = createService()
    const { post, bytes } = await validDraft()
    downloadBounded.mockResolvedValue(bytes)
    findPostById
      .mockResolvedValueOnce(post)
      .mockResolvedValueOnce({ ...post, ...updated })
    await expect(
      service.describeDraft({ userId: viewerUserId, input })
    ).rejects.toMatchObject({
      status: 409,
      message: COMMUNITY_UPLOAD_SESSION_MISMATCH_MESSAGE,
    })
    expect(findPostById).toHaveBeenCalledTimes(2)
  })

  it.each([
    [new CommunityObjectDownloadError('missing'), 409],
    [new CommunityObjectDownloadError('too-large'), 400],
    [new ServiceUnavailableException(), 503],
  ])('maps storage outcomes distinctly to HTTP %s', async (error, status) => {
    const { service, findPostById, downloadBounded } = createService()
    const { post } = await validDraft()
    findPostById.mockResolvedValue(post)
    downloadBounded.mockRejectedValue(error)
    await expect(
      service.describeDraft({ userId: viewerUserId, input })
    ).rejects.toMatchObject({ status })
  })

  it('does not read the draft or image when the member fails database eligibility', async () => {
    const { service, assertDraftCaptionAccess, findPostById, downloadBounded } =
      createService()
    assertDraftCaptionAccess.mockRejectedValue(new ForbiddenException())
    await expect(
      service.describeDraft({ userId: viewerUserId, input })
    ).rejects.toMatchObject({ status: 403 })
    expect(findPostById).not.toHaveBeenCalled()
    expect(downloadBounded).not.toHaveBeenCalled()
  })

  it('preserves the shared rate-limit refusal without downloading the image', async () => {
    const { service, findPostById, reserveDraftCaptionRequest, downloadBounded } =
      createService()
    const { post } = await validDraft()
    findPostById.mockResolvedValue(post)
    reserveDraftCaptionRequest.mockRejectedValue(
      new CommunityRateLimitException('Limited', 30)
    )
    await expect(
      service.describeDraft({ userId: viewerUserId, input })
    ).rejects.toMatchObject({ status: 429, retryAfterSeconds: 30 })
    expect(downloadBounded).not.toHaveBeenCalled()
  })

  it('without returning a caption, refuses when the post leaves draft during analysis', async () => {
    const { service, findPostById, assertDraftCaptionAccess, downloadBounded } =
      createService()
    const { post, bytes } = await validDraft()
    findPostById
      .mockResolvedValueOnce(post)
      .mockResolvedValueOnce({ ...post, status: 'pending_review' })
    downloadBounded.mockResolvedValue(bytes)
    await expect(
      service.describeDraft({ userId: viewerUserId, input })
    ).rejects.toMatchObject({ status: 404 })
    expect(assertDraftCaptionAccess).toHaveBeenCalledTimes(2)
  })

  it.each([
    [{ user_id: 'another-member' }, input, 404],
    [{ status: 'published' }, input, 404],
    [{ erasure_requested_at: new Date() }, input, 404],
    [{ upload_expires_at: new Date(0) }, input, 409],
    [{}, { ...input, uploadSessionId: '8b3a4f4a-792f-4a80-a9de-c1d2474c4420' }, 409],
  ])(
    'never downloads when the draft or upload session is unavailable',
    async (overrides, request, status) => {
      const { service, findPostById, downloadBounded } = createService()
      findPostById.mockResolvedValue(draft(overrides))
      await expect(
        service.describeDraft({ userId: viewerUserId, input: request })
      ).rejects.toMatchObject({ status })
      expect(downloadBounded).not.toHaveBeenCalled()
    }
  )

  it('declines bytes that do not match the draft declaration', async () => {
    const { service, findPostById, downloadBounded } = createService()
    const bytes = await sharp({
      create: { width: 320, height: 480, channels: 3, background: '#2277bb' },
    })
      .png()
      .toBuffer()
    downloadBounded.mockResolvedValue(bytes)
    findPostById.mockResolvedValue(
      draft({
        image_content_type: 'image/png',
        image_byte_size: bytes.length,
        image_checksum: '0'.repeat(64),
      })
    )

    await expect(
      service.describeDraft({ userId: viewerUserId, input })
    ).rejects.toMatchObject({ status: 400 })
  })
})
