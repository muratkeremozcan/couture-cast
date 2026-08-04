import { describe, expect, it } from 'vitest'
import {
  GARMENT_COLOR_PROCESSING_JOB,
  garmentColorProcessingJobSchema,
} from './wardrobe-processing.queue'

describe('garmentColorProcessingJobSchema', () => {
  it('validates garmentId and rejects invalid inputs', () => {
    expect(garmentColorProcessingJobSchema.parse({ garmentId: 'g_123' })).toEqual({
      garmentId: 'g_123',
    })
    expect(() => garmentColorProcessingJobSchema.parse({ garmentId: '' })).toThrow()
    expect(GARMENT_COLOR_PROCESSING_JOB).toBe('garment-color-processing')
  })
})
