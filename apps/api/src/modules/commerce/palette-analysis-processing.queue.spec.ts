// Story 5.4 Task 6: job-id and schema unit tests, mirroring
// silhouette-photo-processing.queue.spec.ts's scope exactly.
import { describe, expect, it } from 'vitest'
import {
  buildPaletteAnalysisJobId,
  PALETTE_ANALYSIS_PROCESSING_JOB,
  paletteAnalysisProcessingJobSchema,
} from './palette-analysis-processing.queue.js'

describe('buildPaletteAnalysisJobId', () => {
  it('5.4-UNIT-distinguishes two analysis attempts on the same profile', () => {
    // PaletteProfile is one row per user, so its id is stable for the life
    // of the account. Keying only on it means BullMQ silently drops every
    // attempt after the first for the whole job-retention window.
    expect(buildPaletteAnalysisJobId('profile-1', 'correlation-a')).not.toBe(
      buildPaletteAnalysisJobId('profile-1', 'correlation-b')
    )
  })

  it('is stable for the same attempt, so a double enqueue still dedupes', () => {
    expect(buildPaletteAnalysisJobId('profile-1', 'correlation-a')).toBe(
      buildPaletteAnalysisJobId('profile-1', 'correlation-a')
    )
  })

  it('avoids the colon BullMQ rejects in a custom job id', () => {
    expect(buildPaletteAnalysisJobId('profile-1', 'correlation-a')).not.toContain(':')
  })
})

describe('paletteAnalysisProcessingJobSchema', () => {
  it('validates paletteProfileId and rejects invalid inputs', () => {
    expect(
      paletteAnalysisProcessingJobSchema.parse({ paletteProfileId: 'palette_123' })
    ).toEqual({ paletteProfileId: 'palette_123' })
    expect(() =>
      paletteAnalysisProcessingJobSchema.parse({ paletteProfileId: '' })
    ).toThrow()
    expect(() =>
      paletteAnalysisProcessingJobSchema.parse({
        paletteProfileId: 'x',
        extra: 'nope',
      })
    ).toThrow()
    expect(PALETTE_ANALYSIS_PROCESSING_JOB).toBe('palette-analysis-processing')
  })
})
