// Learning path Step 83: Clean garment cutouts.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-83-clean-garment-cutouts
// Learning path Step 85: Add several photos at once.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-85-add-several-photos-at-once
import { Buffer } from 'buffer'
import type { PNG as BrowserPng } from 'pngjs/browser'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const files = vi.hoisted(() => new Map<string, Uint8Array>())
const manipulate = vi.hoisted(() => vi.fn())
const deleteFile = vi.hoisted(() => vi.fn((uri: string) => files.delete(uri)))
const paths = vi.hoisted(() => ({
  cache: undefined as string | { uri: string } | undefined,
}))

vi.mock('expo-image-manipulator', () => ({
  manipulateAsync: manipulate,
  SaveFormat: { PNG: 'png', JPEG: 'jpeg' },
}))

vi.mock('expo-file-system', () => ({
  Paths: paths,
  File: class {
    constructor(readonly uri: string) {}

    get exists() {
      return files.has(this.uri)
    }

    bytes() {
      return Promise.resolve(files.get(this.uri)!)
    }

    write(bytes: Uint8Array) {
      files.set(this.uri, Uint8Array.from(bytes))
    }

    delete() {
      deleteFile(this.uri)
    }
  },
}))

const edge = 256
const png = { uri: 'file:///prepared.png', width: edge, height: edge }
const jpeg = { uri: 'file:///prepared.jpeg', width: edge, height: edge }
const source = { uri: 'file:///picked.jpg', width: edge, height: edge }
const uploadLimit = 10 * 1024 * 1024

function colorPhoto(codec: typeof BrowserPng, transparentFormat = false) {
  const channels = transparentFormat ? 4 : 3
  const colorType = transparentFormat ? 6 : 2
  const data = Buffer.alloc(edge * edge * channels, 255)
  for (let y = 64; y < 192; y++) {
    for (let x = 64; x < 192; x++) {
      data.set([36, 92, 161], (y * edge + x) * channels)
    }
  }
  return codec.sync.write(
    { width: edge, height: edge, data },
    {
      colorType,
      inputColorType: colorType,
      inputHasAlpha: transparentFormat,
    }
  )
}

beforeEach(() => {
  files.clear()
  paths.cache = undefined
  deleteFile.mockClear()
  manipulate.mockReset().mockResolvedValueOnce(png).mockResolvedValueOnce(jpeg)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it.each([
  { name: 'RGB', hasAlpha: false },
  { name: 'RGBA', hasAlpha: true },
])(
  'imports and prepares a $name PNG with a UTF-8-only TextDecoder',
  async ({ hasAlpha }) => {
    vi.resetModules()
    const BrowserTextDecoder = globalThis.TextDecoder
    vi.stubGlobal(
      'TextDecoder',
      class extends BrowserTextDecoder {
        constructor(label?: string, options?: TextDecoderOptions) {
          super(label, options)
          if (this.encoding !== 'utf-8')
            throw new RangeError(`Unknown encoding: ${label ?? ''}`)
        }
      }
    )
    expect(() => new TextDecoder('latin1')).toThrow(RangeError)

    const { prepareGarmentCaptureImage } = await import('./garment-capture-image.js')
    const { PNG } = await import('pngjs/browser')
    files.set(png.uri, colorPhoto(PNG, hasAlpha))

    const result = await prepareGarmentCaptureImage(
      source,
      '1:1',
      true,
      new AbortController().signal
    )

    expect(result).toMatchObject({
      file: { uri: png.uri },
      mimeType: 'image/png',
      backgroundRemoved: true,
    })
    const cutout = PNG.sync.read(Buffer.from(files.get(png.uri)!))
    expect(Array.from(cutout.data.subarray(0, 4))).toEqual([0, 0, 0, 0])
    const center = ((edge / 2) * edge + edge / 2) * 4
    expect(Array.from(cutout.data.subarray(center, center + 4))).toEqual([
      36, 92, 161, 255,
    ])
    expect(manipulate).toHaveBeenCalledOnce()
  }
)

it.each([
  { shape: 'legacy string', cache: 'file:///cache/' },
  { shape: 'Expo Directory', cache: { uri: 'file:///cache' } },
])(
  'retires the picker copy with a $shape cache and preserves the library original',
  async ({ cache }) => {
    const { releaseImagePickerCopy } = await import('./garment-capture-image.js')
    paths.cache = cache
    const pickerCopy = 'file:///cache/ImagePicker/picked.jpg'
    const original = 'file:///library/picked.jpg'
    const nestedCopy = 'file:///cache/ImagePicker/album/picked.jpg'
    for (const uri of [pickerCopy, original, nestedCopy])
      files.set(uri, new Uint8Array(1))

    releaseImagePickerCopy(original)
    releaseImagePickerCopy(nestedCopy)
    releaseImagePickerCopy(pickerCopy)

    expect(deleteFile).toHaveBeenCalledExactlyOnceWith(pickerCopy)
    expect([...files.keys()]).toEqual([original, nestedCopy])
  }
)

it('preserves the source when the platform does not provide a cache URI', async () => {
  const sourceUri = 'file:///cache/ImagePicker/picked.jpg'
  files.set(sourceUri, new Uint8Array(1))
  const { releaseImagePickerCopy } = await import('./garment-capture-image.js')
  releaseImagePickerCopy(sourceUri)
  expect(deleteFile).not.toHaveBeenCalled()
  expect(files.has(sourceUri)).toBe(true)
})

it.each([
  { state: 'truncated header', offset: 0, value: 0, truncateAt: 20 },
  { state: 'wrong IHDR chunk', offset: 12, value: 0 },
  { state: 'different width', offset: 19, value: 255 },
  { state: 'different height', offset: 23, value: 255 },
  { state: 'interlaced layout', offset: 28, value: 1 },
])(
  'falls back before decoding a PNG with $state',
  async ({ offset, value, truncateAt }) => {
    const { prepareGarmentCaptureImage } = await import('./garment-capture-image.js')
    const { PNG } = await import('pngjs/browser')
    const input = colorPhoto(PNG).subarray(0, truncateAt)
    input[offset] = value
    const read = vi.spyOn(PNG.sync, 'read')
    files.set(png.uri, input)

    const result = await prepareGarmentCaptureImage(
      source,
      '1:1',
      true,
      new AbortController().signal
    )

    expect(read).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      file: { uri: jpeg.uri },
      mimeType: 'image/jpeg',
      backgroundRemoved: false,
    })
    expect(deleteFile).toHaveBeenCalledWith(png.uri)
  }
)

it('falls back when the local PNG exceeds the upload size limit', async () => {
  const { prepareGarmentCaptureImage } = await import('./garment-capture-image.js')
  const { PNG } = await import('pngjs/browser')
  const read = vi.spyOn(PNG.sync, 'read')
  files.set(png.uri, new Uint8Array(uploadLimit + 1))

  const result = await prepareGarmentCaptureImage(
    source,
    '1:1',
    true,
    new AbortController().signal
  )

  expect(read).not.toHaveBeenCalled()
  expect(result).toMatchObject({ mimeType: 'image/jpeg', backgroundRemoved: false })
  expect(deleteFile).toHaveBeenCalledWith(png.uri)
})

it('falls back when the encoded PNG exceeds the upload size limit', async () => {
  const { prepareGarmentCaptureImage } = await import('./garment-capture-image.js')
  const { PNG } = await import('pngjs/browser')
  files.set(png.uri, colorPhoto(PNG))
  const write = vi
    .spyOn(PNG.sync, 'write')
    .mockReturnValueOnce(Buffer.alloc(uploadLimit + 1))

  const result = await prepareGarmentCaptureImage(
    source,
    '1:1',
    true,
    new AbortController().signal
  )

  expect(write).toHaveBeenCalledOnce()
  expect(result).toMatchObject({ mimeType: 'image/jpeg', backgroundRemoved: false })
  expect(deleteFile).toHaveBeenCalledWith(png.uri)
})

it('requires the prepared crop to meet the upload dimension floor', async () => {
  const { prepareGarmentCaptureImage } = await import('./garment-capture-image.js')
  await expect(
    prepareGarmentCaptureImage(
      { ...source, width: 1000, height: 300 },
      '4:3',
      true,
      new AbortController().signal
    )
  ).rejects.toThrow('Crop is too small')
  expect(manipulate).not.toHaveBeenCalled()
})

it('still prepares a JPEG when the rejected PNG file cannot be deleted', async () => {
  const { prepareGarmentCaptureImage } = await import('./garment-capture-image.js')
  files.set(png.uri, new Uint8Array([1, 2, 3, 4]))
  deleteFile.mockImplementationOnce(() => {
    throw new Error('Native file already gone')
  })

  const result = await prepareGarmentCaptureImage(
    source,
    '1:1',
    true,
    new AbortController().signal
  )

  expect(deleteFile).toHaveBeenCalledWith(png.uri)
  expect(result).toMatchObject({ mimeType: 'image/jpeg', backgroundRemoved: false })
})
