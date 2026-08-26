// Story 5.4 Decision 3: the selfie skin-pixel isolation and classification
// pipeline. No face detector and no ML model: a published, deterministic
// chroma gate (Chai-Ngan YCbCr skin-chroma bounds) isolates candidate skin
// pixels, and closed-form CIELAB colour science (packages/utils/src/skin-tone.ts)
// classifies the survivors.
import sharp from 'sharp'
import {
  classifyDepth,
  classifyUndertone,
  hueAngleDegrees,
  hueAngleInterquartileSpread,
  individualTypologyAngle,
  type Lab,
  linearizeSrgbChannel,
  linearRgbToLab,
  type SkinDepth,
  type SkinUndertone,
} from '@couture/utils'
import type {
  PaletteAnalysisEngine,
  SelfieAnalysisOutcome,
} from './palette-analysis.engine.js'

/** Bounded, deterministic working resolution for every step below. */
const FRAME_SIZE = 256

/** The centre box, as a fraction of FRAME_SIZE, where a framed face sits. */
const CENTRE_CROP_FRACTION = 0.5

/**
 * Chai-Ngan published YCbCr skin-chroma bounds, computed from the
 * gamma-encoded sRGB bytes via the BT.601 matrix -- never from linearized
 * values, which would shift every threshold.
 */
const SKIN_CB_MIN = 77
const SKIN_CB_MAX = 127
const SKIN_CR_MIN = 133
const SKIN_CR_MAX = 173

/**
 * Below this fraction of cropped pixels surviving the chroma gate, there is
 * no face-shaped skin region here at all. This is the ONLY thing that emits
 * `no_face`: there is no face detector, so "no face" means "not enough
 * skin-chromatic pixels where a face should be".
 */
const MIN_SKIN_PIXEL_FRACTION = 0.15

/**
 * A privacy safety net distinct from the face-framing checks above: computed
 * over the FULL frame (not the centre crop), before any cropping happens.
 * A normal face-in-frame selfie (face, hair, shoulders, background) never
 * approaches this skin-pixel fraction; a photo dominated by bare skin does.
 * This is a conservative heuristic, not a vendor-grade classifier -- the same
 * honest framing `HeuristicSilhouettePhotoModerationEngine` uses for its own
 * safety-net check on a different photo type.
 */
const PRIVACY_FULL_FRAME_SKIN_FRACTION_MAX = 0.92

/** Below this confidence, the answer is not trustworthy enough to publish (Decision 3). */
const MIN_CONFIDENCE = 0.4

/** Interquartile hue-angle spread (degrees) at or above which confidence bottoms out at 0. */
const HUE_IQR_ZERO_CONFIDENCE = 90

type RawFrame = { data: Buffer; width: number; height: number; channels: number }

async function decodeToRawFrame(imageBuffer: Buffer): Promise<RawFrame> {
  const { data, info } = await sharp(imageBuffer, {
    failOn: 'error',
    limitInputPixels: 4096 * 4096,
    sequentialRead: true,
  })
    .rotate()
    .resize(FRAME_SIZE, FRAME_SIZE, { fit: 'cover', position: 'attention' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  return { data, width: info.width, height: info.height, channels: info.channels }
}

/** BT.601 Cb/Cr from gamma-encoded 0-255 sRGB bytes. Full-range, matching the Chai-Ngan bounds. */
function bt601CbCr(r: number, g: number, b: number): { cb: number; cr: number } {
  const cb = -0.168736 * r - 0.331264 * g + 0.5 * b + 128
  const cr = 0.5 * r - 0.418688 * g - 0.081312 * b + 128
  return { cb, cr }
}

function isSkinChromaPixel(r: number, g: number, b: number): boolean {
  const { cb, cr } = bt601CbCr(r, g, b)
  return cb >= SKIN_CB_MIN && cb <= SKIN_CB_MAX && cr >= SKIN_CR_MIN && cr <= SKIN_CR_MAX
}

function fullFrameSkinFraction(frame: RawFrame): number {
  const { data, width, height, channels } = frame
  const totalPixels = width * height
  let skinCount = 0
  for (let i = 0; i < totalPixels; i++) {
    const offset = i * channels
    const r = data[offset] ?? 0
    const g = data[offset + 1] ?? 0
    const b = data[offset + 2] ?? 0
    if (isSkinChromaPixel(r, g, b)) {
      skinCount++
    }
  }
  return skinCount / totalPixels
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 0) {
    return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
  }
  return sorted[mid] ?? 0
}

/**
 * Surviving-pixel fraction scaled by the inter-quartile tightness of the
 * survivors' hue angle: broad agreement across many pixels scores high, a
 * handful of scattered pixels scores low (Decision 3).
 *
 * The spread is CIRCULAR (`hueAngleInterquartileSpread`), because a hue angle
 * is a point on a circle. A skin-chroma-gated selfie rarely straddles the
 * 0/360 wrap, but the wardrobe derivation reads the same formula over garment
 * colours that do, and one implementation of "how much do these hues
 * disagree" is the point.
 */
function computeConfidence(
  survivingFraction: number,
  hueAngles: readonly number[]
): number {
  const iqr = hueAngleInterquartileSpread(hueAngles)
  const tightness = Math.max(0, 1 - iqr / HUE_IQR_ZERO_CONFIDENCE)
  return Math.min(1, Math.max(0, survivingFraction * tightness))
}

export class HeuristicPaletteAnalysisEngine implements PaletteAnalysisEngine {
  async analyzeSelfie(imageBuffer: Buffer): Promise<SelfieAnalysisOutcome> {
    const frame = await decodeToRawFrame(imageBuffer)

    // Privacy safety net over the full frame, before any cropping.
    if (fullFrameSkinFraction(frame) > PRIVACY_FULL_FRAME_SKIN_FRACTION_MAX) {
      return { outcome: 'privacy_violation' }
    }

    const { data, width, height, channels } = frame
    const cropWidth = Math.round(width * CENTRE_CROP_FRACTION)
    const cropHeight = Math.round(height * CENTRE_CROP_FRACTION)
    const cropX0 = Math.floor((width - cropWidth) / 2)
    const cropY0 = Math.floor((height - cropHeight) / 2)

    const survivorLabs: Lab[] = []
    let croppedPixelCount = 0

    for (let y = cropY0; y < cropY0 + cropHeight; y++) {
      for (let x = cropX0; x < cropX0 + cropWidth; x++) {
        croppedPixelCount++
        const offset = (y * width + x) * channels
        const r = data[offset] ?? 0
        const g = data[offset + 1] ?? 0
        const b = data[offset + 2] ?? 0
        if (!isSkinChromaPixel(r, g, b)) {
          continue
        }
        // Linearization happens AFTER the chroma gate, on survivors only
        // (Decision 3): the Chai-Ngan bounds are published against
        // gamma-encoded BT.601 YCbCr, and feeding linearized values would
        // shift every threshold.
        survivorLabs.push(
          linearRgbToLab([
            linearizeSrgbChannel(r),
            linearizeSrgbChannel(g),
            linearizeSrgbChannel(b),
          ])
        )
      }
    }

    const survivingFraction =
      croppedPixelCount > 0 ? survivorLabs.length / croppedPixelCount : 0
    if (survivingFraction < MIN_SKIN_PIXEL_FRACTION) {
      return { outcome: 'no_face' }
    }

    const medianLab: Lab = {
      L: median(survivorLabs.map((lab) => lab.L)),
      a: median(survivorLabs.map((lab) => lab.a)),
      b: median(survivorLabs.map((lab) => lab.b)),
    }
    const hueAngles = survivorLabs.map((lab) => hueAngleDegrees(lab))
    const confidence = computeConfidence(survivingFraction, hueAngles)

    if (confidence < MIN_CONFIDENCE) {
      return { outcome: 'low_quality' }
    }

    const ita = individualTypologyAngle(medianLab)
    if (ita === null) {
      // The formula is undefined for b* <= 0, and a bluish-or-neutral median
      // is not skin at all -- this never falls through to a depth band.
      return { outcome: 'low_quality' }
    }

    const depth: SkinDepth = classifyDepth(ita)
    const undertone: SkinUndertone = classifyUndertone(medianLab)

    return { outcome: 'ready', undertone, depth, confidence }
  }
}
