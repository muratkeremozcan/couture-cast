// Story 4.4 Task 4: pluggable moderation engine, mirroring garment-tagging.engine.ts's
// pattern (interface + real engine + fixture engine, decision 9).
export type SilhouetteModerationOutcome = 'ready' | 'contrast' | 'privacy_violation'

export interface SilhouetteModerationVerdict {
  outcome: SilhouetteModerationOutcome
}

export interface SilhouettePhotoModerationEngine {
  moderate(imageBuffer: Buffer): Promise<SilhouetteModerationVerdict>
}
