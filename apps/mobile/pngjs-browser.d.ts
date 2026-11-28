declare module 'pngjs/browser' {
  import type { Buffer } from 'buffer'

  type Raster = { width: number; height: number; data: Buffer }

  export const PNG: {
    sync: {
      read(input: Buffer): Raster
      write(
        raster: Raster,
        options?: {
          deflateLevel?: number
          inputColorType?: 2 | 6
          inputHasAlpha?: boolean
          colorType?: 2 | 6
        }
      ): Buffer
    }
  }
}
