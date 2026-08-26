// Story 5.4 Task 6: deterministic fixture analysis engine for tests,
// mirroring fixture-silhouette-photo-moderation.engine.ts's gated pattern
// exactly.
import { allowsTestOnlySecrets } from '../../config/runtime-environment.js'
import type {
  PaletteAnalysisEngine,
  SelfieAnalysisOutcome,
} from './palette-analysis.engine.js'

/**
 * The fixture engine reads the desired outcome from a magic byte sequence at
 * the start of the buffer (`FIXTURE:<outcome>[:undertone:depth:confidence]:`),
 * so tests can drive every branch deterministically without depending on
 * Sharp's actual pixel analysis. A buffer without the marker defaults to a
 * `ready` warm/medium/0.82 result.
 */
const FIXTURE_PREFIX = 'FIXTURE:'

export function buildFixturePaletteSelfie(
  outcome: SelfieAnalysisOutcome['outcome'],
  ready?: { undertone: string; depth: string; confidence: number }
): Buffer {
  if (outcome === 'ready') {
    const undertone = ready?.undertone ?? 'warm'
    const depth = ready?.depth ?? 'medium'
    const confidence = ready?.confidence ?? 0.82
    return Buffer.from(
      `${FIXTURE_PREFIX}ready:${undertone}:${depth}:${confidence}:`,
      'utf8'
    )
  }
  return Buffer.from(`${FIXTURE_PREFIX}${outcome}:`, 'utf8')
}

export class FixturePaletteAnalysisEngine implements PaletteAnalysisEngine {
  constructor() {
    if (process.env.PALETTE_ANALYSIS_ENGINE !== 'fixture' || !allowsTestOnlySecrets()) {
      throw new Error(
        'FixturePaletteAnalysisEngine is strictly forbidden outside an allowed test environment'
      )
    }
  }

  analyzeSelfie(imageBuffer: Buffer): Promise<SelfieAnalysisOutcome> {
    const marker = imageBuffer.subarray(0, 256).toString('utf8')
    if (marker.startsWith(FIXTURE_PREFIX)) {
      const parts = marker.slice(FIXTURE_PREFIX.length).split(':')
      const outcome = parts[0]
      if (outcome === 'ready') {
        const undertone = parts[1] ?? 'warm'
        const depth = parts[2] ?? 'medium'
        const confidence = Number.parseFloat(parts[3] ?? '0.82')
        return Promise.resolve({ outcome: 'ready', undertone, depth, confidence })
      }
      if (
        outcome === 'no_face' ||
        outcome === 'low_quality' ||
        outcome === 'privacy_violation'
      ) {
        return Promise.resolve({ outcome })
      }
    }
    return Promise.resolve({
      outcome: 'ready',
      undertone: 'warm',
      depth: 'medium',
      confidence: 0.82,
    })
  }
}
