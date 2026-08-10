// Story 4.4 Task 4: deterministic fixture moderation engine for tests,
// mirroring fixture-garment-tagging.engine.ts's gated pattern exactly.
import { allowsTestOnlySecrets } from '../../config/runtime-environment'
import type {
  SilhouetteModerationOutcome,
  SilhouetteModerationVerdict,
  SilhouettePhotoModerationEngine,
} from './silhouette-photo-moderation.engine'

/**
 * The fixture engine reads the desired outcome from a magic byte sequence at
 * the start of the buffer (`FIXTURE:<outcome>:`), so tests can drive every
 * branch deterministically without depending on Sharp's actual pixel
 * analysis. A buffer without the marker defaults to `ready`.
 */
const FIXTURE_PREFIX = 'FIXTURE:'

export function buildFixtureSilhouettePhoto(
  outcome: SilhouetteModerationOutcome
): Buffer {
  return Buffer.from(`${FIXTURE_PREFIX}${outcome}:`, 'utf8')
}

export class FixtureSilhouettePhotoModerationEngine
  implements SilhouettePhotoModerationEngine
{
  constructor() {
    if (
      process.env.SILHOUETTE_MODERATION_ENGINE !== 'fixture' ||
      !allowsTestOnlySecrets()
    ) {
      throw new Error(
        'FixtureSilhouettePhotoModerationEngine is strictly forbidden outside an allowed test environment'
      )
    }
  }

  moderate(imageBuffer: Buffer): Promise<SilhouetteModerationVerdict> {
    const marker = imageBuffer.subarray(0, 256).toString('utf8')
    if (marker.startsWith(FIXTURE_PREFIX)) {
      const outcome = marker.slice(FIXTURE_PREFIX.length).split(':')[0]
      if (
        outcome === 'contrast' ||
        outcome === 'privacy_violation' ||
        outcome === 'ready'
      ) {
        return Promise.resolve({ outcome })
      }
    }
    return Promise.resolve({ outcome: 'ready' })
  }
}
