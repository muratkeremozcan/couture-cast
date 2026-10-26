import { checkImageSignal, runAbortableSharp } from '../../common/abortable-sharp.js'
import { Injectable } from '@nestjs/common'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp, { type OverlayOptions } from 'sharp'
import { z } from 'zod'
import type { SupportedLocale } from '@couture/api-client/contracts/http'
import type { ShareCardProjection } from './share-card-source.repository.js'
import { assertFontGlyphs } from './share-card-font.js'
import { stripShareCardMetadata } from './share-card-png.js'

const catalogSchema = z.object({
  outfit: z.string(),
  watermarkRole: z.string(),
  community: z.string(),
  scenarios: z.record(z.string()),
  categories: z.record(z.string()),
  climateBands: z.record(z.string()),
})
const ivory = '#F7F3E8'
const charcoal = '#292724'
const gold = '#B28D46'
const asset = (name: string) => join(__dirname, 'assets', name)
const xml = (text: string) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

@Injectable()
export class ShareCardRenderer {
  async prepare(
    projection: ShareCardProjection,
    locale: SupportedLocale,
    watermark: boolean,
    photo?: Buffer,
    signal?: AbortSignal
  ): Promise<{ bytes: Buffer; accessibilityLabel: string }> {
    // Collect the exact closed strings as they enter the pixel composition.
    // The label and PNG share one catalog read and the same live projection.
    const labels: string[] = []
    const bytes = await this.render(projection, locale, watermark, photo, labels, signal)
    return { bytes, accessibilityLabel: labels.join('. ') }
  }

  async render(
    projection: ShareCardProjection,
    locale: SupportedLocale,
    watermark: boolean,
    photo?: Buffer,
    labels: string[] = [],
    signal?: AbortSignal
  ): Promise<Buffer> {
    checkImageSignal(signal)
    const catalog = catalogSchema.parse(
      JSON.parse(await readFile(asset(`${locale}.json`), 'utf8'))
    )
    const overlays: OverlayOptions[] = []
    const text = async (
      label: string,
      heading: boolean,
      width: number,
      height: number,
      left: number,
      top: number
    ) => {
      checkImageSignal(signal)
      labels.push(label)
      const fontfile = asset(heading ? 'PlayfairDisplay.ttf' : 'SpaceGrotesk.ttf')
      // Read explicitly on every render. Missing packaged fonts fail before Pango can fall back.
      assertFontGlyphs(await readFile(fontfile), label)
      const pipeline = sharp({
        text: {
          text: `<span foreground="${charcoal}">${xml(label)}</span>`,
          font: heading ? 'Playfair Display 72' : 'Space Grotesk 36',
          fontfile,
          width,
          align: 'centre',
          rgba: true,
        },
      })
        .timeout({ seconds: 5 })
        .resize(width, height, { fit: 'inside', withoutEnlargement: true })
        .png()
      const input = await runAbortableSharp(pipeline, signal, () => pipeline.toBuffer())
      const metadata = sharp(input)
      const dimensions = await runAbortableSharp(metadata, signal, () =>
        metadata.metadata()
      )
      overlays.push({
        input,
        left: left + Math.floor((width - (dimensions.width ?? width)) / 2),
        top,
      })
    }
    const title = projection.kind === 'outfit' ? catalog.outfit : catalog.community
    await text(title, true, 936, 90, 72, 64)
    if (projection.kind === 'outfit') {
      const scenario = catalog.scenarios[projection.scenario]
      if (!scenario) throw new Error('render_catalog')
      await text(scenario, false, 936, 48, 72, 168)
      for (const [index, category] of projection.categories.entries()) {
        const label = catalog.categories[category]
        if (
          !label ||
          !['top', 'bottom', 'outerwear', 'dress', 'shoes', 'accessory'].includes(
            category
          )
        )
          throw new Error('render_catalog')
        const left = 72 + (index % 3) * 312
        const top = 240 + Math.floor(index / 3) * 450
        overlays.push({
          input: await readFile(asset(`${category}.svg`)),
          left: left + 16,
          top: top + 40,
        })
        await text(label, false, 280, 64, left + 16, top + 340)
      }
    } else {
      if (!photo) throw new Error('source_media')
      // Raw pixels form a new resource; metadata never enters the composition.
      checkImageSignal(signal)
      const pipeline = sharp(photo, {
        limitInputPixels: 4096 * 4096,
        failOn: 'error',
      })
        .timeout({ seconds: 5 })
        .rotate()
        .resize(936, 900, { fit: 'cover', position: 'centre', kernel: 'lanczos3' })
        .toColourspace('srgb')
        .removeAlpha()
        .raw()
      const { data, info } = await runAbortableSharp(pipeline, signal, () =>
        pipeline.toBuffer({ resolveWithObject: true })
      )
      overlays.push({
        input: data,
        raw: { width: info.width, height: info.height, channels: info.channels },
        left: 72,
        top: 240,
      })
      if (projection.climateBand !== null) {
        const band = catalog.climateBands[projection.climateBand]
        if (!band) throw new Error('render_catalog')
        await text(band, false, 936, 40, 72, 1172)
      }
    }
    if (watermark) {
      checkImageSignal(signal)
      const fontfile = asset('SpaceGrotesk.ttf')
      const pipeline = sharp({
        text: {
          text:
            projection.kind === 'outfit'
              ? '<span foreground="#292724" alpha="35%">CoutureCast</span>'
              : '<span foreground="#ffffff" alpha="65%">CoutureCast</span>',
          font: 'Space Grotesk 28',
          fontfile,
          rgba: true,
        },
      })
        .timeout({ seconds: 5 })
        .png()
      const mark = await runAbortableSharp(pipeline, signal, () => pipeline.toBuffer())
      const metadata = sharp(mark)
      const markInfo = await runAbortableSharp(metadata, signal, () =>
        metadata.metadata()
      )
      overlays.push({
        input: mark,
        left: Math.floor((1080 - (markInfo.width ?? 0)) / 2),
        top: 1106,
      })
    }
    overlays.push({
      input: { create: { width: 936, height: 3, channels: 3, background: gold } },
      left: 72,
      top: 1228,
    })
    await text('CoutureCast', true, 936, 64, 72, 1258)
    if (watermark) labels.push(`${catalog.watermarkRole}: CoutureCast`)
    checkImageSignal(signal)
    const composite = sharp({
      create: { width: 1080, height: 1350, channels: 3, background: ivory },
    })
      .timeout({ seconds: 5 })
      .composite(overlays)
      .removeAlpha()
      .toColourspace('srgb')
      .raw()
    const raw = await runAbortableSharp(composite, signal, () => composite.toBuffer())
    const encoder = sharp(raw, { raw: { width: 1080, height: 1350, channels: 3 } })
      .timeout({ seconds: 5 })
      .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false, effort: 10 })
    const png = await runAbortableSharp(encoder, signal, () => encoder.toBuffer())
    checkImageSignal(signal)
    return stripShareCardMetadata(png)
  }
}
