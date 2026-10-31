// Learning path Step 48: Safe branded share-card export.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-48-safe-branded-share-card-export
import * as files from 'node:fs/promises'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'
import { supportedLocales } from '@couture/api-client/contracts/http'
import { validateShareCardPng } from '@couture/api-client'
import { ShareCardRenderer } from './share-card-renderer.js'
vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof files>()
  return { ...actual, readFile: vi.fn(actual.readFile) }
})

const renderer = new ShareCardRenderer()
const outfit = {
  kind: 'outfit',
  scenario: 'morning',
  categories: ['top', 'bottom', 'outerwear', 'dress', 'shoes', 'accessory'],
} as const
const hash = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex')
async function expectPaintedText(
  bytes: Buffer,
  top: number,
  height: number,
  left = 72,
  width = 936
) {
  const pixels = await sharp(bytes)
    .extract({ left, top, width, height })
    .removeAlpha()
    .raw()
    .toBuffer()
  let ink = 0
  for (let i = 0; i < pixels.length; i += 3)
    if (pixels[i]! < 160 && pixels[i + 1]! < 160 && pixels[i + 2]! < 160) ink++
  expect(ink).toBeGreaterThan(50)
}
describe('safe card renderer', () => {
  it('U-OUTFIT U-DETERMINISTIC U-OPTIONS: deterministic RGB card with an independent watermark', async () => {
    const projection = { ...outfit, categories: [...outfit.categories] }
    const on = await renderer.render(projection, 'en-US', true)
    const off = await renderer.render(projection, 'en-US', false)
    const restarted = await new ShareCardRenderer().render(projection, 'en-US', true)
    if (process.env.CC68_RENDER_PROOF_FILE) {
      await writeFile(process.env.CC68_RENDER_PROOF_FILE, on)
      await writeFile(
        process.env.CC68_RENDER_PROOF_FILE + '.json',
        JSON.stringify({
          pngBase64: on.toString('base64'),
          sha256: hash(on),
          width: 1080,
          height: 1350,
          mimeType: 'image/png',
          filename: 'couturecast-card.png',
          templateVersion: 1,
        })
      )
    }
    validateShareCardPng(on)
    expect(hash(restarted)).toBe(hash(on))
    expect(hash(off)).not.toBe(hash(on))
    expect(await sharp(on).metadata()).toMatchObject({
      width: 1080,
      height: 1350,
      channels: 3,
    })
  })
  it.each(supportedLocales)(
    'U-LOCALES: renders fixed catalog %s within bounds',
    async (locale) => {
      const catalog = JSON.parse(
        await files.readFile(join(__dirname, 'assets', `${locale}.json`), 'utf8')
      ) as {
        outfit: string
        community: string
        watermarkRole: string
        scenarios: Record<string, string>
        categories: Record<string, string>
        climateBands: Record<string, string>
      }
      for (const watermark of [false, true]) {
        const projection = { ...outfit, categories: [...outfit.categories] }
        const card = await renderer.prepare(projection, locale, watermark)
        validateShareCardPng(card.bytes)
        await expectPaintedText(card.bytes, 64, 90)
        await expectPaintedText(card.bytes, 168, 48)
        for (const index of outfit.categories.keys())
          await expectPaintedText(
            card.bytes,
            580 + Math.floor(index / 3) * 450,
            64,
            88 + (index % 3) * 312,
            280
          )
        await expectPaintedText(card.bytes, 1258, 64)
        expect(card.accessibilityLabel).toBe(
          [
            catalog.outfit,
            catalog.scenarios.morning,
            ...outfit.categories.map((category) => catalog.categories[category]),
            'CoutureCast',
            ...(watermark ? [`${catalog.watermarkRole}: CoutureCast`] : []),
          ].join('. ')
        )
        const photo = await sharp({
          create: { width: 400, height: 600, channels: 3, background: '#123456' },
        })
          .png()
          .toBuffer()
        const post = await renderer.prepare(
          {
            kind: 'community_post',
            path: 'PRIVATE_NAME',
            mimeType: 'image/png',
            sha256: 'a'.repeat(64),
            byteSize: photo.length,
            climateBand: 'temperate_dry',
          },
          locale,
          watermark,
          photo
        )
        expect(post.accessibilityLabel).toBe(
          [
            catalog.community,
            catalog.climateBands.temperate_dry,
            'CoutureCast',
            ...(watermark ? [`${catalog.watermarkRole}: CoutureCast`] : []),
          ].join('. ')
        )
        expect(post.accessibilityLabel).not.toContain('PRIVATE_NAME')
        await expectPaintedText(post.bytes, 64, 90)
        await expectPaintedText(post.bytes, 1172, 40)
        await expectPaintedText(post.bytes, 1258, 64)
      }
    }
  )
  it('U-METADATA U-PIXELS U-PIXEL-ALLOWLIST: preserves own pixels and drops all source metadata', async () => {
    const photographedSign = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600"><rect width="400" height="600" fill="#123456"/><rect x="80" y="170" width="240" height="80" fill="white"/><path d="M100 230V190H125V210H100M145 230V190H170V230M195 190V230H220M245 190H275M260 190V230" stroke="#292724" stroke-width="8" fill="none"/></svg>'
    )
    const clean = await sharp(photographedSign).png().toBuffer()
    const tainted = await sharp(clean)
      .withMetadata({
        exif: { IFD0: { Artist: 'NAME GPS URL https://private.invalid/name.jpg' } },
      })
      .png()
      .toBuffer()
    const source = {
      kind: 'community_post',
      path: 'unused',
      mimeType: 'image/png',
      sha256: 'a'.repeat(64),
      byteSize: clean.length,
      climateBand: null,
    } as const
    const first = await renderer.render(source, 'en-US', false, clean)
    const second = await renderer.render(
      { ...source, path: 'https://private.invalid/NAME', sha256: 'b'.repeat(64) },
      'en-US',
      false,
      tainted
    )
    expect(second.equals(first)).toBe(true)
    validateShareCardPng(second)
    const pixel = await sharp(second)
      .extract({ left: 100, top: 300, width: 1, height: 1 })
      .raw()
      .toBuffer()
    expect([...pixel]).toEqual([18, 52, 86])
    // The high-contrast photographed sign survives in the photo region unchanged.
    const signRegion = { left: 290, top: 535, width: 500, height: 120 }
    expect(await sharp(second).extract(signRegion).raw().toBuffer()).toEqual(
      await sharp(first).extract(signRegion).raw().toBuffer()
    )
    const sign = await sharp(second).extract(signRegion).raw().toBuffer()
    expect(new Set(sign).size).toBeGreaterThan(2)
  })
  it('U-ALPHA: composites a transparent photo onto the card background instead of exposing its hidden RGB', async () => {
    // Exactly the 936x900 photo box, so nothing is resampled and the RGB hidden beneath
    // zero alpha reaches the card unchanged unless the renderer flattens it.
    const width = 936
    const height = 900
    const bands = [
      [255, 0, 0, 0],
      [0, 255, 0, 128],
      [0, 0, 255, 255],
    ] as const
    const pixels = Buffer.alloc(width * height * 4)
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++)
        pixels.set(bands[Math.floor(y / 300)]!, (y * width + x) * 4)
    const photo = await sharp(pixels, { raw: { width, height, channels: 4 } })
      .png()
      .toBuffer()
    expect(await sharp(photo).metadata()).toMatchObject({ width, height, hasAlpha: true })
    const card = await renderer.render(
      {
        kind: 'community_post',
        path: 'unused',
        mimeType: 'image/png',
        sha256: 'a'.repeat(64),
        byteSize: photo.length,
        climateBand: null,
      },
      'en-US',
      false,
      photo
    )
    validateShareCardPng(card)
    const ivory = [0xf7, 0xf3, 0xe8]
    const sample = async (row: number) =>
      [
        ...(await sharp(card)
          .extract({ left: 72 + 400, top: 240 + row, width: 1, height: 1 })
          .raw()
          .toBuffer()),
      ] as number[]
    const blend = (coverage: number, source: number[]) =>
      source.map((value, index) =>
        Math.round(value * coverage + ivory[index]! * (1 - coverage))
      )
    // Fully transparent red shows the card, not the red stored beneath zero alpha.
    expect(await sample(100)).toEqual(ivory)
    // Half-transparent green blends with the card behind it.
    const translucent = await sample(450)
    blend(128 / 255, [0, 255, 0]).forEach((expected, index) =>
      expect(Math.abs(translucent[index]! - expected)).toBeLessThanOrEqual(1)
    )
    expect(translucent).not.toEqual([0, 255, 0])
    // Opaque blue is untouched.
    expect(await sample(750)).toEqual([0, 0, 255])
  })
  it('U-PREPARE-ERROR: a missing packaged font fails before any system-font fallback', async () => {
    const read = (await vi.importActual<typeof files>('node:fs/promises')).readFile
    vi.mocked(files.readFile).mockImplementation(
      (...args: Parameters<typeof files.readFile>) => {
        if (typeof args[0] === 'string' && args[0].endsWith('PlayfairDisplay.ttf'))
          return Promise.reject(new Error('font_unavailable'))
        return read(...args)
      }
    )
    try {
      await expect(
        renderer.render({ ...outfit, categories: [...outfit.categories] }, 'en-US', true)
      ).rejects.toThrow('font_unavailable')
    } finally {
      vi.mocked(files.readFile).mockImplementation(read)
    }
  })
  it('stops subsequent Sharp/text stages when cancellation arrives during an awaited asset read', async () => {
    const original = (await vi.importActual<typeof files>('node:fs/promises')).readFile
    const controller = new AbortController()
    vi.mocked(files.readFile).mockClear()
    vi.mocked(files.readFile).mockImplementation(
      async (...args: Parameters<typeof files.readFile>) => {
        const value = await original(...args)
        if (typeof args[0] === 'string' && args[0].endsWith('PlayfairDisplay.ttf'))
          controller.abort()
        return value
      }
    )
    try {
      await expect(
        renderer.prepare(
          { ...outfit, categories: [...outfit.categories] },
          'en-US',
          true,
          undefined,
          controller.signal
        )
      ).rejects.toThrow('image_cancelled')
      expect(
        vi
          .mocked(files.readFile)
          .mock.calls.filter(
            ([file]) => typeof file === 'string' && file.endsWith('SpaceGrotesk.ttf')
          )
      ).toHaveLength(0)
    } finally {
      vi.mocked(files.readFile).mockImplementation(original)
    }
  })
})
