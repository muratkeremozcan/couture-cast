// Learning path Step 32: Wardrobe onboarding and silhouette setup.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-32-wardrobe-onboarding-and-silhouette-setup
// Learning path Step 58: Image uploads straight to storage.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#image-uploads-straight-to-storage
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { queueConfigs } from '../../config/queues'
import {
  buildSilhouettePhotoJobId,
  SILHOUETTE_PHOTO_PROCESSING_JOB,
  SILHOUETTE_PHOTO_PROCESSING_QUEUE,
  SilhouettePhotoProcessingQueue,
  silhouettePhotoProcessingJobSchema,
  silhouetteSessionFromJobId,
} from './silhouette-photo-processing.queue'

const bullmq = vi.hoisted(() => ({ add: vi.fn(), close: vi.fn() }))

vi.mock('bullmq', () => ({
  Queue: class {
    add = bullmq.add
    close = bullmq.close
  },
}))

const PROFILE_ID = 'silhouette_123'
const SESSION_ID = '3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f'
const OTHER_SESSION_ID = '9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a'

describe('SilhouettePhotoProcessingQueue binding', () => {
  it('4.4-UNIT-06 publishes to moderation-review when nothing overrides the binding', () => {
    // The production module registers the class with no binding provider, so
    // this zero-argument construction is exactly what Nest performs there.
    expect(new SilhouettePhotoProcessingQueue().queueName).toBe('moderation-review')
    expect(SILHOUETTE_PHOTO_PROCESSING_QUEUE).toBe('moderation-review')
    expect(queueConfigs.some((c) => c.name === SILHOUETTE_PHOTO_PROCESSING_QUEUE)).toBe(
      true
    )
  })

  it('4.4-UNIT-06 publishes to an injected binding instead', () => {
    const production = queueConfigs.find((c) => c.name === 'moderation-review')!
    const queue = new SilhouettePhotoProcessingQueue({
      name: 'silhouette-it-test-moderation-review',
      options: production.options,
    })
    expect(queue.queueName).toBe('silhouette-it-test-moderation-review')
  })
})

describe('buildSilhouettePhotoJobId', () => {
  it('4.4-UNIT-05 distinguishes two commits on the same profile', () => {
    // The profile row is one per user, so its id is stable for the life of the
    // account. Keying only on it meant BullMQ silently refused every commit
    // after the first for the whole job-retention window.
    expect(buildSilhouettePhotoJobId('profile-1', 'session-a')).not.toBe(
      buildSilhouettePhotoJobId('profile-1', 'session-b')
    )
  })

  it('4.4-UNIT-05 is stable for the same commit, so a double enqueue still dedupes', () => {
    expect(buildSilhouettePhotoJobId('profile-1', 'session-a')).toBe(
      buildSilhouettePhotoJobId('profile-1', 'session-a')
    )
  })

  it('4.4-UNIT-05 avoids the colon BullMQ rejects in a custom job id', () => {
    expect(buildSilhouettePhotoJobId('profile-1', 'session-a')).not.toContain(':')
  })
})

describe('silhouettePhotoProcessingJobSchema', () => {
  it('4.4-UNIT-05 validates silhouetteProfileId and rejects invalid inputs', () => {
    expect(
      silhouettePhotoProcessingJobSchema.parse({ silhouetteProfileId: 'silhouette_123' })
    ).toEqual({
      silhouetteProfileId: 'silhouette_123',
    })
    expect(() =>
      silhouettePhotoProcessingJobSchema.parse({ silhouetteProfileId: '' })
    ).toThrow()
    expect(SILHOUETTE_PHOTO_PROCESSING_JOB).toBe('silhouette-photo-processing')
  })

  /**
   * Round 4 (Codex C3-6): consumers deployed before the session field existed parse payloads
   * strictly, so the producer sends only the profile id, and this schema drops fields it does
   * not know, so the job still runs. A payload that does carry a session still parses it.
   */
  it('accepts unknown fields and still reads an optional UUID upload session id', () => {
    expect(
      silhouettePhotoProcessingJobSchema.parse({
        silhouetteProfileId: PROFILE_ID,
        uploadSessionId: SESSION_ID,
        addedLater: true,
      })
    ).toEqual({ silhouetteProfileId: PROFILE_ID, uploadSessionId: SESSION_ID })
    expect(() =>
      silhouettePhotoProcessingJobSchema.parse({
        silhouetteProfileId: PROFILE_ID,
        uploadSessionId: '../palette/x',
      })
    ).toThrow()
  })
})

describe('SilhouettePhotoProcessingQueue.enqueue', () => {
  beforeEach(() => {
    bullmq.add.mockReset().mockResolvedValue(undefined)
  })

  // Round 4 (Codex C3-6): the session rides in the deterministic job id only.
  it('sends the profile id alone, under the job id that names the session', async () => {
    await new SilhouettePhotoProcessingQueue().enqueue(PROFILE_ID, SESSION_ID)

    expect(bullmq.add).toHaveBeenCalledExactlyOnceWith(
      SILHOUETTE_PHOTO_PROCESSING_JOB,
      { silhouetteProfileId: PROFILE_ID },
      {
        jobId: `${PROFILE_ID}__${SESSION_ID}`,
        removeOnComplete: { age: 604800 },
        removeOnFail: { age: 604800 },
      }
    )
  })
})

/** Round 4 (Codex C3-6): a job's own session, carried through processing and retry exhaustion. */
describe('silhouetteSessionFromJobId', () => {
  it('reads the session from the job id when the payload has none', () => {
    expect(
      silhouetteSessionFromJobId({
        id: `${PROFILE_ID}__${SESSION_ID}`,
        data: { silhouetteProfileId: PROFILE_ID },
      })
    ).toBe(SESSION_ID)
  })

  it('prefers a session the payload carries', () => {
    expect(
      silhouetteSessionFromJobId({
        id: `${PROFILE_ID}__${OTHER_SESSION_ID}`,
        data: { silhouetteProfileId: PROFILE_ID, uploadSessionId: SESSION_ID },
      })
    ).toBe(SESSION_ID)
  })

  it.each([
    ['no job id', undefined],
    ['a job id of another profile', `silhouette_999__${SESSION_ID}`],
    ['a suffix that is not a UUID', `${PROFILE_ID}__../palette/x`],
    ['a bare profile id', PROFILE_ID],
  ])('names no session for %s', (_label, id) => {
    expect(
      silhouetteSessionFromJobId({ id, data: { silhouetteProfileId: PROFILE_ID } })
    ).toBeNull()
  })
})
