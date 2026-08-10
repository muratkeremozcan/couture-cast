import { describe, expect, it } from 'vitest'
import {
  buildSilhouettePhotoJobId,
  SILHOUETTE_PHOTO_PROCESSING_JOB,
  silhouettePhotoProcessingJobSchema,
} from './silhouette-photo-processing.queue'

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
