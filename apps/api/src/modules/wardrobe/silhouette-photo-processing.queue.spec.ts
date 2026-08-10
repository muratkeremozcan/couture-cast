import { describe, expect, it } from 'vitest'
import {
  SILHOUETTE_PHOTO_PROCESSING_JOB,
  silhouettePhotoProcessingJobSchema,
} from './silhouette-photo-processing.queue'

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
