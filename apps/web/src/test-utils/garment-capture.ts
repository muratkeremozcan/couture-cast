import { vi } from 'vitest'
import type { PreparedImage } from '../lib/wardrobe'

export function prepareGarmentImageFixture(): Promise<PreparedImage> {
  return Promise.resolve({
    blob: new Blob(['fixture-garment'], { type: 'image/jpeg' }),
    widthPx: 384,
    heightPx: 384,
    mimeType: 'image/jpeg',
    sha256: 'fixture-garment-checksum',
    backgroundRemoved: false,
  })
}

export function stubGarmentPreviewUrl() {
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = vi.fn(() => 'blob:fixture-garment')
      static revokeObjectURL = vi.fn()
    }
  )
}
