// Learning path Step 38: Community feed by climate band.
/* eslint-disable @typescript-eslint/no-unsafe-assignment -- assertions nest expect.objectContaining() and expect.any(), which is the established pattern for these suites. */
// Story 6.1: Community moderation worker and processor tests (ADR-013).
import { createHash } from 'node:crypto'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import type { PrismaClient } from '@prisma/client'
import type { TelemetryService } from '../telemetry/telemetry.service'
import type { CommunityStorage } from './community-storage.adapter'
import { FixtureCommunityModerationEngine } from './community-moderation.engine'
import {
  CommunityModerationProcessor,
  MODERATION_DOWNLOAD_TIMEOUT_MS,
  MODERATION_SCREENING_TIMEOUT_MS,
  withModerationTimeout,
} from './community-moderation.processor'
import { createCommunityModerationWorker } from './community-moderation.worker'
import type { CommunityModerationJob } from './community-moderation.queue'
import type { Job, WorkerOptions } from 'bullmq'

const workerHarness = vi.hoisted(() => ({
  registeredProcessor: null as
    | ((job: Job<CommunityModerationJob>) => Promise<void>)
    | null,
  mockCreateWorker: vi.fn(),
}))

vi.mock('../../workers/base.worker.js', () => ({
  createWorker: vi.fn(
    (
      queue: string,
      proc: (job: Job<CommunityModerationJob>) => Promise<void>,
      options: WorkerOptions
    ) => {
      workerHarness.registeredProcessor = proc
      workerHarness.mockCreateWorker(queue, proc, options)
      return { on: vi.fn(), close: vi.fn() }
    }
  ),
  defaultWorkerOptions: vi.fn(() => ({})),
}))

/**
 * A job fixture is only ever read for `data`, `opts.attempts` and
 * `attemptsMade`, but the registered processor is typed as taking a full
 * `Job`. The cast is confined here rather than repeated at each call site.
 */
function asJob(fixture: {
  data: CommunityModerationJob
  opts: { attempts: number }
  attemptsMade: number
}): Job<CommunityModerationJob> {
  return fixture as unknown as Job<CommunityModerationJob>
}

describe('CommunityModerationProcessor & Worker', () => {
  const mockFindUnique = vi.fn()
  const mockPostUpdate = vi.fn().mockResolvedValue({})
  const mockPostUpdateMany = vi.fn().mockResolvedValue({ count: 1 })
  const mockOutboxUpdateMany = vi.fn().mockResolvedValue({ count: 1 })
  const mockModerationEventCreate = vi.fn().mockResolvedValue({ id: 'mod-1' })
  const mockTransaction = vi
    .fn()
    .mockImplementation((callback: (tx: PrismaClient) => Promise<unknown>) =>
      callback(mockPrisma as unknown as PrismaClient)
    )

  const mockPrisma = {
    lookbookPost: {
      findUnique: mockFindUnique,
      update: mockPostUpdate,
      updateMany: mockPostUpdateMany,
    },
    communityModerationOutbox: {
      updateMany: mockOutboxUpdateMany,
    },
    moderationEvent: {
      create: mockModerationEventCreate,
    },
    $transaction: mockTransaction,
  } as unknown as PrismaClient

  const mockDownload = vi.fn()
  const mockUpload = vi.fn().mockResolvedValue(undefined)
  const mockStorage: CommunityStorage = {
    download: mockDownload,
    upload: mockUpload,
    signReadUrl: vi.fn(),
    signReadUrls: vi.fn(),
    createUploadSession: vi.fn(),
    remove: vi.fn(),
  }

  const mockCaptureEvent = vi.fn().mockResolvedValue(undefined)
  const mockTelemetryService = {
    captureEvent: mockCaptureEvent,
  } as unknown as TelemetryService

  /**
   * A REAL JPEG, because the processor now decodes and re-encodes every upload
   * before screening it. A placeholder string would be rejected by the MIME
   * sniff, which is exactly the point of that step.
   */
  let jpegBytes: Buffer
  let jpegChecksum: string
  /** Encoded at a different quality, so the default-quality re-encode changes the bytes. */
  let highQualityJpeg: Buffer
  let highQualityChecksum: string

  beforeAll(async () => {
    const source = () =>
      sharp({
        create: {
          width: 512,
          height: 640,
          channels: 3,
          background: { r: 200, g: 180, b: 160 },
        },
      })

    jpegBytes = await source().jpeg().toBuffer()
    jpegChecksum = createHash('sha256').update(jpegBytes).digest('hex')

    highQualityJpeg = await source().jpeg({ quality: 100 }).toBuffer()
    highQualityChecksum = createHash('sha256').update(highQualityJpeg).digest('hex')
  })

  const pendingPost = (overrides: Record<string, unknown> = {}) => ({
    status: 'pending_review',
    caption: 'A classic autumn trench',
    alt_text: 'Full length photo',
    locale: 'en-US',
    climate_band: 'temperate_dry',
    image_content_type: 'image/jpeg',
    image_checksum: jpegChecksum,
    image_byte_size: jpegBytes.length,
    challenge_id: null,
    ...overrides,
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockPostUpdate.mockResolvedValue({})
    mockPostUpdateMany.mockResolvedValue({ count: 1 })
    mockOutboxUpdateMany.mockResolvedValue({ count: 1 })
    mockModerationEventCreate.mockResolvedValue({ id: 'mod-1' })
    mockDownload.mockResolvedValue(jpegBytes)
  })

  const createProcessor = (engine: FixtureCommunityModerationEngine) =>
    new CommunityModerationProcessor(
      mockPrisma,
      mockStorage,
      mockTelemetryService,
      engine
    )

  describe('Clean path -> published', () => {
    it('transitions pending_review post to published, stamps published_at, and emits telemetry', async () => {
      mockFindUnique.mockResolvedValueOnce(
        pendingPost({
          id: 'post-100',
          user_id: 'user-1',
          image_object_path: 'community/post-100/session-1.jpg',
        })
      )

      const processor = createProcessor(
        new FixtureCommunityModerationEngine({
          textOutcome: { passed: true, reasons: [] },
          imageOutcome: { passed: true, reasons: [] },
        })
      )

      await processor.process({
        postId: 'post-100',
        uploadSessionId: 'session-1',
        platform: 'web',
      })

      expect(mockDownload).toHaveBeenCalledWith('community/post-100/session-1.jpg')
      expect(mockPostUpdateMany).toHaveBeenCalledWith({
        where: { id: 'post-100', status: 'pending_review' },
        data: expect.objectContaining({
          status: 'published',
          published_at: expect.any(Date),
          moderation_reason: null,
          moderation_engine_version: expect.stringContaining('adr013'),
        }),
      })

      expect(mockOutboxUpdateMany).toHaveBeenCalledWith({
        where: { post_id: 'post-100' },
        data: expect.objectContaining({ dispatched_at: expect.any(Date) }),
      })

      // The dedupe key is derived from the post, so a BullMQ redelivery of this
      // job collapses at the sink instead of double-counting a publication the
      // beta gate is measured on.
      expect(mockCaptureEvent).toHaveBeenCalledWith(
        'user-1',
        'community_post_published',
        {
          platform: 'web',
          dedupeKey: 'community_post_published:post-100',
          climateBand: 'temperate_dry',
        }
      )
      // A PASSING VERDICT NOW WRITES AN AUDIT ROW. This assertion used to read
      // `not.toHaveBeenCalled()`, which pinned the defect in place: only
      // `flagPost` and `recordReport` ever created a `ModerationEvent`, so the
      // moderation trail recorded refusals and nothing else and there was no way
      // to answer "was this post screened, by what, and when" for any post a
      // reader can actually see. The engine version is on the row so a later
      // model regression can be scoped to exactly the posts that version
      // cleared.
      expect(mockModerationEventCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          post_id: 'post-100',
          action: 'screening_passed',
          reason: expect.stringContaining('adr013') as string,
          image_object_path: 'community/post-100/session-1.jpg',
          content_snapshot: expect.objectContaining({
            caption: expect.any(String) as string,
            altText: expect.any(String) as string,
          }) as unknown,
        }) as unknown,
      })
    })

    it('writes no audit row when the publish update loses its race', async () => {
      // The audit row lives inside the same transaction as the status update and
      // behind the same `count === 1` guard, so a second worker that arrives
      // after the post already published records nothing. Without the guard a
      // redelivered job would add a second "screened and passed" row for one
      // screening.
      mockFindUnique.mockResolvedValueOnce(
        pendingPost({
          id: 'post-raced',
          user_id: 'user-1',
          image_object_path: 'community/post-raced/session-1.jpg',
        })
      )
      mockPostUpdateMany.mockResolvedValueOnce({ count: 0 })

      const processor = createProcessor(
        new FixtureCommunityModerationEngine({
          textOutcome: { passed: true, reasons: [] },
          imageOutcome: { passed: true, reasons: [] },
        })
      )

      await processor.process({
        postId: 'post-raced',
        uploadSessionId: 'session-1',
        platform: 'web',
      })

      expect(mockModerationEventCreate).not.toHaveBeenCalled()
      expect(mockOutboxUpdateMany).not.toHaveBeenCalled()
    })

    it('counts one challenge participation, keyed so retries and extra posts collapse', async () => {
      // The beta gate counts UNIQUE published participants, so the key is the
      // challenge and the author rather than the post; a second post from the
      // same author into the same challenge is the same participant.
      mockFindUnique.mockResolvedValueOnce(
        pendingPost({
          id: 'post-challenge',
          user_id: 'user-9',
          challenge_id: 'challenge-42',
          image_object_path: 'community/post-challenge/session-c.jpg',
        })
      )

      const processor = createProcessor(
        new FixtureCommunityModerationEngine({
          textOutcome: { passed: true, reasons: [] },
          imageOutcome: { passed: true, reasons: [] },
        })
      )

      await processor.process({ postId: 'post-challenge', uploadSessionId: 'session-c' })

      expect(mockCaptureEvent).toHaveBeenCalledWith(
        'user-9',
        'community_challenge_participated',
        {
          platform: 'web',
          dedupeKey: 'community_challenge_participated:challenge-42:user-9',
          climateBand: 'temperate_dry',
        }
      )
    })

    it('emits no participation event for a post with no challenge', async () => {
      mockFindUnique.mockResolvedValueOnce(
        pendingPost({
          id: 'post-solo',
          user_id: 'user-9',
          challenge_id: null,
          image_object_path: 'community/post-solo/session-s.jpg',
        })
      )

      const processor = createProcessor(
        new FixtureCommunityModerationEngine({
          textOutcome: { passed: true, reasons: [] },
          imageOutcome: { passed: true, reasons: [] },
        })
      )

      await processor.process({ postId: 'post-solo', uploadSessionId: 'session-s' })

      expect(mockCaptureEvent).not.toHaveBeenCalledWith(
        'user-9',
        'community_challenge_participated',
        expect.anything()
      )
    })
  })

  describe('Upload verification before screening', () => {
    it('terminates at review_failed when the stored checksum does not match the bytes', async () => {
      mockFindUnique.mockResolvedValueOnce(
        pendingPost({
          id: 'post-tamper',
          user_id: 'user-t',
          image_object_path: 'community/post-tamper/session-t.jpg',
          image_checksum: 'f'.repeat(64),
        })
      )

      const processor = createProcessor(
        new FixtureCommunityModerationEngine({
          textOutcome: { passed: true, reasons: [] },
          imageOutcome: { passed: true, reasons: [] },
        })
      )

      await processor.process({ postId: 'post-tamper', uploadSessionId: 'session-t' })

      expect(mockPostUpdateMany).toHaveBeenCalledWith({
        where: { id: 'post-tamper', status: 'pending_review' },
        data: {
          status: 'review_failed',
          moderation_reason: 'IMAGE_CHECKSUM_MISMATCH',
        },
      })
    })

    it('terminates at review_failed when the sniffed MIME contradicts the declaration', async () => {
      mockFindUnique.mockResolvedValueOnce(
        pendingPost({
          id: 'post-mime',
          user_id: 'user-m',
          image_object_path: 'community/post-mime/session-m.png',
          image_content_type: 'image/png',
        })
      )
      // Real JPEG bytes declared as a PNG.
      mockDownload.mockResolvedValueOnce(jpegBytes)

      const processor = createProcessor(
        new FixtureCommunityModerationEngine({
          textOutcome: { passed: true, reasons: [] },
          imageOutcome: { passed: true, reasons: [] },
        })
      )

      await processor.process({ postId: 'post-mime', uploadSessionId: 'session-m' })

      expect(mockPostUpdateMany).toHaveBeenCalledWith({
        where: { id: 'post-mime', status: 'pending_review' },
        data: {
          status: 'review_failed',
          moderation_reason: 'UNSUPPORTED_IMAGE_TYPE',
        },
      })
    })

    it('re-encodes the object and persists the new checksum when re-encoding changes the bytes', async () => {
      mockFindUnique.mockResolvedValueOnce(
        pendingPost({
          id: 'post-reencode',
          user_id: 'user-r',
          image_object_path: 'community/post-reencode/session-r.jpg',
          image_checksum: highQualityChecksum,
          image_byte_size: highQualityJpeg.length,
        })
      )
      mockDownload.mockResolvedValueOnce(highQualityJpeg)

      const processor = createProcessor(
        new FixtureCommunityModerationEngine({
          textOutcome: { passed: true, reasons: [] },
          imageOutcome: { passed: true, reasons: [] },
        })
      )

      await processor.process({ postId: 'post-reencode', uploadSessionId: 'session-r' })

      // sharp's re-encode is not byte-identical to the source, so the stored
      // checksum has to be replaced with one that describes what is at rest.
      expect(mockUpload).toHaveBeenCalledWith(
        'community/post-reencode/session-r.jpg',
        expect.any(Buffer),
        'image/jpeg'
      )
      expect(mockPostUpdate).toHaveBeenCalledWith({
        where: { id: 'post-reencode' },
        data: expect.objectContaining({
          image_checksum: expect.any(String),
          image_byte_size: expect.any(Number),
          image_content_type: 'image/jpeg',
        }),
      })
    })
  })

  describe('Flagged path -> ModerationEvent, outbox stamp & SLA alert', () => {
    it('transitions post to flagged, sets moderation_reason, and persists ModerationEvent', async () => {
      mockFindUnique.mockResolvedValueOnce(
        pendingPost({
          id: 'post-200',
          user_id: 'user-2',
          caption: 'Inappropriate offensive caption',
          climate_band: 'cold_dry',
          image_object_path: 'community/post-200/session-2.jpg',
        })
      )

      const processor = createProcessor(
        new FixtureCommunityModerationEngine({
          textOutcome: { passed: false, reasons: ['profanity'] },
          imageOutcome: { passed: true, reasons: [] },
        })
      )

      await processor.process({ postId: 'post-200', uploadSessionId: 'session-2' })

      expect(mockPostUpdateMany).toHaveBeenCalledWith({
        where: { id: 'post-200', status: 'pending_review' },
        data: expect.objectContaining({
          status: 'flagged',
          moderation_reason: 'profanity',
          moderation_engine_version: expect.any(String),
        }),
      })

      expect(mockModerationEventCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          post_id: 'post-200',
          action: 'flagged',
          reason: 'profanity',
          created_at: expect.any(Date),
        }),
      })

      expect(mockCaptureEvent).not.toHaveBeenCalled()
    })

    it('stamps the outbox on the flagged branch so the dispatcher stops re-enqueuing it', async () => {
      // Without this stamp the dispatcher, whose only claim predicate is
      // `dispatched_at IS NULL`, re-enqueues every flagged post forever.
      mockFindUnique.mockResolvedValueOnce(
        pendingPost({
          id: 'post-flagged-outbox',
          user_id: 'user-2',
          image_object_path: 'community/post-flagged-outbox/session-f.jpg',
        })
      )

      const processor = createProcessor(
        new FixtureCommunityModerationEngine({
          textOutcome: { passed: false, reasons: ['profanity'] },
          imageOutcome: { passed: true, reasons: [] },
        })
      )

      await processor.process({
        postId: 'post-flagged-outbox',
        uploadSessionId: 'session-f',
      })

      expect(mockOutboxUpdateMany).toHaveBeenCalledWith({
        where: { post_id: 'post-flagged-outbox' },
        data: { dispatched_at: expect.any(Date) },
      })
    })

    it('aggregates multiple flagged reasons (profanity and nsfw)', async () => {
      mockFindUnique.mockResolvedValueOnce(
        pendingPost({
          id: 'post-300',
          user_id: 'user-3',
          caption: 'Offensive text',
          climate_band: null,
          image_object_path: 'community/post-300/session-3.jpg',
        })
      )

      const processor = createProcessor(
        new FixtureCommunityModerationEngine({
          textOutcome: { passed: false, reasons: ['profanity'] },
          imageOutcome: { passed: false, reasons: ['nsfw'] },
        })
      )

      await processor.process({ postId: 'post-300', uploadSessionId: 'session-3' })

      expect(mockPostUpdateMany).toHaveBeenCalledWith({
        where: { id: 'post-300', status: 'pending_review' },
        data: expect.objectContaining({
          status: 'flagged',
          moderation_reason: expect.stringContaining('profanity'),
        }),
      })
      expect(mockModerationEventCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          post_id: 'post-300',
          reason: expect.stringContaining('profanity'),
        }),
      })
    })

    it('flags rather than publishes when the image screener reports itself unavailable', async () => {
      mockFindUnique.mockResolvedValueOnce(
        pendingPost({
          id: 'post-unscreened',
          user_id: 'user-u',
          image_object_path: 'community/post-unscreened/session-u.jpg',
        })
      )

      // No image outcome configured: the fixture fails closed, like production.
      const processor = createProcessor(
        new FixtureCommunityModerationEngine({
          textOutcome: { passed: true, reasons: [] },
        })
      )

      await processor.process({ postId: 'post-unscreened', uploadSessionId: 'session-u' })

      expect(mockPostUpdateMany).toHaveBeenCalledWith({
        where: { id: 'post-unscreened', status: 'pending_review' },
        data: expect.objectContaining({
          status: 'flagged',
          moderation_reason: 'screening_unavailable',
        }),
      })
    })
  })

  describe('Non-pending or missing posts', () => {
    it('skips processing when post is not found', async () => {
      mockFindUnique.mockResolvedValueOnce(null)
      const processor = createProcessor(new FixtureCommunityModerationEngine())

      await processor.process({ postId: 'missing-post', uploadSessionId: 's1' })

      expect(mockDownload).not.toHaveBeenCalled()
      expect(mockPostUpdateMany).not.toHaveBeenCalled()
    })

    it('skips processing when post status is not pending_review', async () => {
      mockFindUnique.mockResolvedValueOnce({
        id: 'post-400',
        user_id: 'user-4',
        status: 'published',
        image_object_path: 'community/post-400/session-4.jpg',
      })

      const processor = createProcessor(new FixtureCommunityModerationEngine())

      await processor.process({ postId: 'post-400', uploadSessionId: 's1' })

      expect(mockDownload).not.toHaveBeenCalled()
      expect(mockPostUpdateMany).not.toHaveBeenCalled()
    })
  })

  describe('Error handling & retry exhaustion -> review_failed', () => {
    it('propagates storage download errors so BullMQ can retry', async () => {
      mockFindUnique.mockResolvedValueOnce(
        pendingPost({
          id: 'post-err',
          user_id: 'user-err',
          image_object_path: 'community/post-err/session-e.jpg',
        })
      )
      mockDownload.mockRejectedValueOnce(new Error('Storage timeout'))

      const processor = createProcessor(new FixtureCommunityModerationEngine())

      await expect(
        processor.process({ postId: 'post-err', uploadSessionId: 's1' })
      ).rejects.toThrow('Storage timeout')

      expect(mockPostUpdateMany).not.toHaveBeenCalled()
    })

    it('markFailed sets review_failed and stamps the outbox', async () => {
      const processor = createProcessor(new FixtureCommunityModerationEngine())

      await processor.markFailed(
        'post-fail',
        'Exhausted 3 retry attempts due to network timeout'
      )

      expect(mockPostUpdateMany).toHaveBeenCalledWith({
        where: { id: 'post-fail', status: 'pending_review' },
        data: {
          status: 'review_failed',
          moderation_reason: 'Exhausted 3 retry attempts due to network timeout',
        },
      })
      expect(mockOutboxUpdateMany).toHaveBeenCalledWith({
        where: { post_id: 'post-fail' },
        data: { dispatched_at: expect.any(Date) },
      })
    })
  })

  describe('createCommunityModerationWorker', () => {
    it('creates a worker that executes processor and calls markFailed on attempt exhaustion', async () => {
      const worker = createCommunityModerationWorker({
        prisma: mockPrisma,
        storage: mockStorage,
        telemetryService: mockTelemetryService,
      })

      expect(worker).toBeDefined()
      expect(workerHarness.registeredProcessor).toBeTypeOf('function')

      mockFindUnique.mockResolvedValueOnce(
        pendingPost({
          id: 'post-exhausted',
          user_id: 'user-ex',
          image_object_path: 'community/post-exhausted/session-x.jpg',
        })
      )
      mockDownload.mockRejectedValueOnce(new Error('Permanent failure'))

      await expect(
        workerHarness.registeredProcessor!(
          asJob({
            data: { postId: 'post-exhausted', uploadSessionId: 'sess-ex' },
            opts: { attempts: 3 },
            attemptsMade: 2,
          })
        )
      ).rejects.toThrow('Permanent failure')

      expect(mockPostUpdateMany).toHaveBeenCalledWith({
        where: { id: 'post-exhausted', status: 'pending_review' },
        data: {
          status: 'review_failed',
          moderation_reason: 'Permanent failure',
        },
      })
    })

    it('rethrows without markFailed when retry attempts remain', async () => {
      mockFindUnique.mockResolvedValueOnce(
        pendingPost({
          id: 'post-retry',
          user_id: 'user-retry',
          image_object_path: 'community/post-retry/session-y.jpg',
        })
      )
      mockDownload.mockRejectedValueOnce(new Error('Transient network glitch'))

      await expect(
        workerHarness.registeredProcessor!(
          asJob({
            data: { postId: 'post-retry', uploadSessionId: 'sess-retry' },
            opts: { attempts: 3 },
            attemptsMade: 0,
          })
        )
      ).rejects.toThrow('Transient network glitch')

      expect(mockPostUpdateMany).not.toHaveBeenCalled()
    })
  })
  describe('defensive branches', () => {
    it('constructs its own fail-closed engine when none is injected', async () => {
      // The zero-argument construction is what production uses, and its default
      // engine refuses every image rather than clearing it.
      const processor = new CommunityModerationProcessor(
        mockPrisma,
        mockStorage,
        mockTelemetryService
      )
      mockFindUnique.mockResolvedValueOnce(
        pendingPost({
          id: 'post-default-engine',
          user_id: 'user-d',
          image_object_path: 'community/post-default-engine/session-d.jpg',
        })
      )

      await processor.process({
        postId: 'post-default-engine',
        uploadSessionId: 'session-d',
      })

      expect(mockPostUpdateMany).toHaveBeenCalledWith({
        where: { id: 'post-default-engine', status: 'pending_review' },
        data: expect.objectContaining({
          status: 'flagged',
          moderation_reason: 'screening_unavailable',
        }),
      })
    })

    it('throws when a pending post has no object path to screen', async () => {
      mockFindUnique.mockResolvedValueOnce(
        pendingPost({ id: 'post-no-path', user_id: 'user-n', image_object_path: null })
      )

      const processor = createProcessor(new FixtureCommunityModerationEngine())

      await expect(
        processor.process({ postId: 'post-no-path', uploadSessionId: 's' })
      ).rejects.toThrow('missing image_object_path')
    })

    it('terminates at review_failed when the stored declaration is incomplete', async () => {
      mockFindUnique.mockResolvedValueOnce(
        pendingPost({
          id: 'post-no-decl',
          user_id: 'user-d',
          image_object_path: 'community/post-no-decl/session-d.jpg',
          image_checksum: null,
        })
      )

      const processor = createProcessor(new FixtureCommunityModerationEngine())

      await processor.process({ postId: 'post-no-decl', uploadSessionId: 'session-d' })

      expect(mockPostUpdateMany).toHaveBeenCalledWith({
        where: { id: 'post-no-decl', status: 'pending_review' },
        data: {
          status: 'review_failed',
          moderation_reason: 'IMAGE_DECLARATION_MISSING',
        },
      })
    })

    it('emits nothing when another worker already moved the post on', async () => {
      // The guarded update matching zero rows means a concurrent worker won;
      // emitting here would double-count a publication.
      mockFindUnique.mockResolvedValueOnce(
        pendingPost({
          id: 'post-raced',
          user_id: 'user-r',
          image_object_path: 'community/post-raced/session-r.jpg',
        })
      )
      mockPostUpdateMany.mockResolvedValueOnce({ count: 0 })

      const processor = createProcessor(
        new FixtureCommunityModerationEngine({
          textOutcome: { passed: true, reasons: [] },
          imageOutcome: { passed: true, reasons: [] },
        })
      )

      await processor.process({ postId: 'post-raced', uploadSessionId: 'session-r' })

      expect(mockCaptureEvent).not.toHaveBeenCalled()
      expect(mockOutboxUpdateMany).not.toHaveBeenCalled()
    })

    it('writes no moderation event when the flag update loses its race', async () => {
      mockFindUnique.mockResolvedValueOnce(
        pendingPost({
          id: 'post-raced-flag',
          user_id: 'user-r',
          image_object_path: 'community/post-raced-flag/session-r.jpg',
        })
      )
      mockPostUpdateMany.mockResolvedValueOnce({ count: 0 })

      const processor = createProcessor(
        new FixtureCommunityModerationEngine({
          textOutcome: { passed: false, reasons: ['profanity'] },
          imageOutcome: { passed: true, reasons: [] },
        })
      )

      await processor.process({ postId: 'post-raced-flag', uploadSessionId: 'session-r' })

      expect(mockModerationEventCreate).not.toHaveBeenCalled()
      expect(mockOutboxUpdateMany).not.toHaveBeenCalled()
    })

    it('does not stamp the outbox when markFailed finds nothing pending', async () => {
      const processor = createProcessor(new FixtureCommunityModerationEngine())
      mockPostUpdateMany.mockResolvedValueOnce({ count: 0 })

      await processor.markFailed('post-terminal', 'already terminal')

      expect(mockOutboxUpdateMany).not.toHaveBeenCalled()
    })

    it('flags with a generic reason when the engine returns no reasons', async () => {
      mockFindUnique.mockResolvedValueOnce(
        pendingPost({
          id: 'post-silent',
          user_id: 'user-s',
          image_object_path: 'community/post-silent/session-s.jpg',
        })
      )

      const processor = createProcessor(
        new FixtureCommunityModerationEngine({
          textOutcome: { passed: false, reasons: [] },
          imageOutcome: { passed: true, reasons: [] },
        })
      )

      await processor.process({ postId: 'post-silent', uploadSessionId: 'session-s' })

      expect(mockPostUpdateMany).toHaveBeenCalledWith({
        where: { id: 'post-silent', status: 'pending_review' },
        data: expect.objectContaining({ moderation_reason: 'flagged_by_screening' }),
      })
    })

    it('keeps the request alive when the published telemetry emit throws', async () => {
      mockFindUnique.mockResolvedValueOnce(
        pendingPost({
          id: 'post-telemetry',
          user_id: 'user-t',
          image_object_path: 'community/post-telemetry/session-t.jpg',
        })
      )
      mockCaptureEvent.mockRejectedValueOnce(new Error('PostHog down'))

      const processor = createProcessor(
        new FixtureCommunityModerationEngine({
          textOutcome: { passed: true, reasons: [] },
          imageOutcome: { passed: true, reasons: [] },
        })
      )

      await expect(
        processor.process({ postId: 'post-telemetry', uploadSessionId: 'session-t' })
      ).resolves.toBeUndefined()
    })

    it('rejects when the wrapped work outlives its timeout', async () => {
      // Without this ceiling a hung download leaves the job running forever, so
      // BullMQ never fails it and `markFailed` never runs.
      //
      // A one-millisecond budget on purpose: the guard's behaviour is what is
      // under test, and burning the real twenty seconds of wall clock to watch
      // it would add cost and no evidence.
      await expect(
        withModerationTimeout(new Promise(() => undefined), 1, 'test work')
      ).rejects.toThrow('test work timed out after 1ms')
    })

    it('resolves the wrapped work when it finishes inside the budget', async () => {
      await expect(
        withModerationTimeout(Promise.resolve('done'), 1_000, 'test work')
      ).resolves.toBe('done')
    })

    it('pins the two timeout budgets so a change to either is a visible diff', () => {
      // These are operational promises, not tuning knobs: they bound how long a
      // post can sit in `pending_review` before the stale sweep has to rescue
      // it, so moving one silently changes an author-visible guarantee.
      expect(MODERATION_DOWNLOAD_TIMEOUT_MS).toBe(20_000)
      expect(MODERATION_SCREENING_TIMEOUT_MS).toBe(30_000)
    })

    it('marks failed when a job with no configured attempt count fails', async () => {
      // `job.opts.attempts` is optional in BullMQ's type; the default of three
      // is what the queue config actually sets.
      mockFindUnique.mockResolvedValueOnce(
        pendingPost({
          id: 'post-no-attempts',
          user_id: 'user-a',
          image_object_path: 'community/post-no-attempts/session-a.jpg',
        })
      )
      mockDownload.mockRejectedValueOnce(new Error('Permanent failure'))

      createCommunityModerationWorker({
        prisma: mockPrisma,
        storage: mockStorage,
        telemetryService: mockTelemetryService,
      })

      await expect(
        workerHarness.registeredProcessor!(
          asJob({
            data: { postId: 'post-no-attempts', uploadSessionId: 'sess-a' },
            opts: {} as { attempts: number },
            attemptsMade: 2,
          })
        )
      ).rejects.toThrow('Permanent failure')

      expect(mockPostUpdateMany).toHaveBeenCalledWith({
        where: { id: 'post-no-attempts', status: 'pending_review' },
        data: { status: 'review_failed', moderation_reason: 'Permanent failure' },
      })
    })

    it('reports a non-Error rejection with its own fallback message', async () => {
      mockFindUnique.mockResolvedValueOnce(
        pendingPost({
          id: 'post-string-throw',
          user_id: 'user-a',
          image_object_path: 'community/post-string-throw/session-a.jpg',
        })
      )
      mockDownload.mockRejectedValueOnce('not an error object')

      createCommunityModerationWorker({
        prisma: mockPrisma,
        storage: mockStorage,
        telemetryService: mockTelemetryService,
      })

      await expect(
        workerHarness.registeredProcessor!(
          asJob({
            data: { postId: 'post-string-throw', uploadSessionId: 'sess-a' },
            opts: { attempts: 3 },
            attemptsMade: 2,
          })
        )
      ).rejects.toBe('not an error object')

      expect(mockPostUpdateMany).toHaveBeenCalledWith({
        where: { id: 'post-string-throw', status: 'pending_review' },
        data: {
          status: 'review_failed',
          moderation_reason: 'Moderation execution failed',
        },
      })
    })
  })
})
