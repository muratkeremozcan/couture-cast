// Story 5.4 Task 6: pluggable selfie analysis engine, mirroring
// silhouette-photo-moderation.engine.ts's pattern (interface + real engine +
// fixture engine, three-part shape).
export type SelfieAnalysisOutcome =
  | {
      readonly outcome: 'ready'
      readonly undertone: string
      readonly depth: string
      readonly confidence: number
    }
  | { readonly outcome: 'no_face' }
  | { readonly outcome: 'low_quality' }
  | { readonly outcome: 'privacy_violation' }

export interface PaletteAnalysisEngine {
  analyzeSelfie(imageBuffer: Buffer): Promise<SelfieAnalysisOutcome>
}
