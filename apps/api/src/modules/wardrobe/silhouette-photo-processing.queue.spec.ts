// Learning path Step 32: Wardrobe onboarding and silhouette setup.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-32-wardrobe-onboarding-and-silhouette-setup
import { describe, expect, it } from 'vitest'
import { queueConfigs } from '../../config/queues'
import {
  buildSilhouettePhotoJobId,
  SILHOUETTE_PHOTO_PROCESSING_JOB,
  SILHOUETTE_PHOTO_PROCESSING_QUEUE,
  SilhouettePhotoProcessingQueue,
  silhouettePhotoProcessingJobSchema,
} from './silhouette-photo-processing.queue'

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
})
