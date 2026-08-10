// Story 4.4 Task 4: conservative safety-net heuristic (decisions 8-9). This is
// NOT a substitute for a vendor-grade moderation service -- it is a
// first-line guardrail using the same Sharp region-stats primitive
// wardrobe-color.processor.ts already uses for dominant-color extraction.
// A follow-up story should evaluate a real content-safety vendor before this
// feature scales past an initial rollout.
import sharp from 'sharp'
import type {
  SilhouetteModerationVerdict,
  SilhouettePhotoModerationEngine,
} from './silhouette-photo-moderation.engine'

type RgbMean = { r: number; g: number; b: number }

/** Every region is analysed as 3-channel sRGB, whatever the source encoding. */
const ANALYSIS_CHANNELS = 3 as const

function meanRgb(stats: { channels: { mean: number }[] }): RgbMean {
  return {
    r: stats.channels[0]?.mean ?? 0,
    g: stats.channels[1]?.mean ?? 0,
    b: stats.channels[2]?.mean ?? 0,
  }
}

function euclideanDistance(a: RgbMean, b: RgbMean): number {
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2)
}

/**
 * Widely used simple RGB skin-tone heuristic (Kovac et al.). Deliberately
 * crude: it is a safety-net threshold, not a classifier, and is documented
 * as such rather than overstated (decision 8).
 */
function isSkinTonePixel(r: number, g: number, b: number): boolean {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  return (
    r > 95 && g > 40 && b > 20 && max - min > 15 && Math.abs(r - g) > 15 && r > g && r > b
  )
}

export class HeuristicSilhouettePhotoModerationEngine
  implements SilhouettePhotoModerationEngine
{
  constructor(
    /** Euclidean RGB distance below which border and center are considered
     * indistinguishable, i.e. the subject cannot be separated from the
     * background for a clean overlay (decision 8). Tunable. */
    private readonly contrastThreshold = 40,
    /** Fraction of sampled center-region pixels matching the skin-tone
     * heuristic above which the photo is flagged privacy_violation. */
    private readonly skinRatioThreshold = 0.4,
    /** Sample every Nth pixel of the raw center buffer; full-resolution
     * scanning is unnecessary for a ratio estimate and costs real time on
     * a 4096x4096 image. */
    private readonly sampleStride = 4
  ) {}

  async moderate(imageBuffer: Buffer): Promise<SilhouetteModerationVerdict> {
    const metadata = await sharp(imageBuffer, {
      failOn: 'error',
      limitInputPixels: 4096 * 4096,
      sequentialRead: true,
    }).metadata()
    const width = metadata.width ?? 0
    const height = metadata.height ?? 0
    if (!width || !height) {
      // Decode already succeeded upstream (wardrobe-silhouette-image-validation.ts
      // ran first); a metadata read failure here is unexpected, not a photo
      // problem, so degrade to the terminal-outcome side, not a retry.
      return { outcome: 'ready' }
    }

    const borderMargin = Math.max(1, Math.round(Math.min(width, height) * 0.08))
    const centerWidth = Math.max(1, Math.round(width * 0.5))
    const centerHeight = Math.max(1, Math.round(height * 0.5))
    const centerLeft = Math.round((width - centerWidth) / 2)
    const centerTop = Math.round((height - centerHeight) / 2)

    /**
     * `.stats()` chained directly after `.extract()` on the same pipeline
     * measures the *pre-crop* image in this Sharp/libvips version, not the
     * extracted region -- confirmed by comparing raw pixel bytes against
     * reported stats. Materializing the crop to its own buffer first, then
     * opening a fresh `sharp()` instance on that buffer, is the workaround.
     */
    // Both crops are normalized to exactly 3 sRGB channels. Reinterpreting the
    // raw buffer with `metadata.channels` was wrong whenever the two disagreed
    // -- a PNG with an alpha channel, a palette image, a CMYK JPEG -- which
    // both skewed the mean-RGB comparison and could drop `estimateSkinRatio`
    // into its `channels < 3` early return, silently disabling the bare-skin
    // check for a full-colour photo. A genuinely grayscale photo still cannot
    // be assessed by an RGB skin-tone heuristic; that is a documented
    // limitation of this safety net (decision 9), not something normalization
    // can fix.
    const borderBuffer = await sharp(imageBuffer)
      .extract({ left: 0, top: 0, width, height: borderMargin })
      .removeAlpha()
      .toColourspace('srgb')
      .raw()
      .toBuffer()
    const centerBuffer = await sharp(imageBuffer)
      .extract({
        left: centerLeft,
        top: centerTop,
        width: centerWidth,
        height: centerHeight,
      })
      .removeAlpha()
      .toColourspace('srgb')
      .raw()
      .toBuffer()

    const borderStats = await sharp(borderBuffer, {
      raw: { width, height: borderMargin, channels: ANALYSIS_CHANNELS },
    }).stats()
    const centerStats = await sharp(centerBuffer, {
      raw: { width: centerWidth, height: centerHeight, channels: ANALYSIS_CHANNELS },
    }).stats()

    const distance = euclideanDistance(meanRgb(borderStats), meanRgb(centerStats))
    if (distance < this.contrastThreshold) {
      return { outcome: 'contrast' }
    }

    const skinRatio = this.estimateSkinRatio(
      centerBuffer,
      ANALYSIS_CHANNELS,
      centerWidth * centerHeight
    )
    if (skinRatio > this.skinRatioThreshold) {
      return { outcome: 'privacy_violation' }
    }

    return { outcome: 'ready' }
  }

  private estimateSkinRatio(data: Buffer, channels: number, pixelCount: number): number {
    if (pixelCount === 0 || channels < 3) {
      return 0
    }

    let sampled = 0
    let skinMatches = 0
    for (let pixel = 0; pixel < pixelCount; pixel += this.sampleStride) {
      const offset = pixel * channels
      const r = data[offset] ?? 0
      const g = data[offset + 1] ?? 0
      const b = data[offset + 2] ?? 0
      sampled += 1
      if (isSkinTonePixel(r, g, b)) {
        skinMatches += 1
      }
    }

    return sampled === 0 ? 0 : skinMatches / sampled
  }
}
