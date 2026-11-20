// Story 5.4 Task 6: job-id and schema unit tests, mirroring
// silhouette-photo-processing.queue.spec.ts's scope exactly.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildPaletteAnalysisJobId,
  PALETTE_ANALYSIS_PROCESSING_JOB,
  PaletteAnalysisProcessingQueue,
  paletteAnalysisProcessingJobSchema,
  paletteAttemptFromJobId,
} from './palette-analysis-processing.queue.js'

const bullmq = vi.hoisted(() => ({ add: vi.fn(), close: vi.fn() }))

vi.mock('bullmq', () => ({
  Queue: class {
    add = bullmq.add
    close = bullmq.close
  },
}))

const PROFILE_ID = 'palette_123'
const SESSION_ID = '3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f'
const ATTEMPT_ID = '9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a'

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
      paletteAnalysisProcessingJobSchema.parse({ paletteProfileId: PROFILE_ID })
    ).toEqual({ paletteProfileId: PROFILE_ID })
    expect(() =>
      paletteAnalysisProcessingJobSchema.parse({ paletteProfileId: '' })
    ).toThrow()
    expect(PALETTE_ANALYSIS_PROCESSING_JOB).toBe('palette-analysis-processing')
  })

  /**
   * Round 4 (Codex C3-6): a payload from a newer producer never fails this consumer, so a
   * rolling deploy cannot reject jobs before processing them.
   */
  it('accepts unknown fields and drops them', () => {
    expect(
      paletteAnalysisProcessingJobSchema.parse({
        paletteProfileId: PROFILE_ID,
        uploadSessionId: SESSION_ID,
        addedLater: 'yes',
      })
    ).toEqual({ paletteProfileId: PROFILE_ID, uploadSessionId: SESSION_ID })
  })
})

describe('PaletteAnalysisProcessingQueue.enqueue', () => {
  beforeEach(() => {
    bullmq.add.mockReset().mockResolvedValue(undefined)
  })

  // Round 4 (Codex C3-6): the analysis attempt rides in the deterministic job id only.
  it('sends the profile id alone, under the job id that names the analysis attempt', async () => {
    await new PaletteAnalysisProcessingQueue().enqueue(PROFILE_ID, ATTEMPT_ID)

    expect(bullmq.add).toHaveBeenCalledExactlyOnceWith(
      PALETTE_ANALYSIS_PROCESSING_JOB,
      { paletteProfileId: PROFILE_ID },
      {
        jobId: `${PROFILE_ID}__${ATTEMPT_ID}`,
        removeOnComplete: { age: 604800 },
        removeOnFail: { age: 604800 },
      }
    )
  })
})

/** Round 4 (Codex C3-6): a job's own analysis attempt, also for jobs enqueued before this. */
describe('paletteAttemptFromJobId', () => {
  it('reads the attempt from the job id when the payload has none', () => {
    expect(
      paletteAttemptFromJobId({
        id: `${PROFILE_ID}__${ATTEMPT_ID}`,
        data: { paletteProfileId: PROFILE_ID },
      })
    ).toBe(ATTEMPT_ID)
  })

  it('prefers a session the payload carries', () => {
    expect(
      paletteAttemptFromJobId({
        id: `${PROFILE_ID}__${ATTEMPT_ID}`,
        data: { paletteProfileId: PROFILE_ID, uploadSessionId: SESSION_ID },
      })
    ).toBe(SESSION_ID)
  })

  it.each([
    ['no job id', undefined],
    ['a job id of another profile', `palette_999__${ATTEMPT_ID}`],
    ['an empty suffix', `${PROFILE_ID}__`],
    ['a suffix longer than any attempt id', `${PROFILE_ID}__${'a'.repeat(129)}`],
  ])('names no attempt for %s', (_label, id) => {
    expect(
      paletteAttemptFromJobId({ id, data: { paletteProfileId: PROFILE_ID } })
    ).toBeNull()
  })
})
