import type { PrismaClient } from '@prisma/client'

import type { WardrobeStorage } from './wardrobe-storage.adapter'

function channelHex(value: number): string {
  return Math.max(0, Math.min(255, Math.round(value)))
    .toString(16)
    .padStart(2, '0')
}

export class WardrobeColorProcessor {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly storage: WardrobeStorage
  ) {}

  private async extractDominantHex(bytes: Buffer): Promise<string> {
    try {
      const sharpModule = await import('sharp')
      const sharpFn = sharpModule.default || sharpModule
      const stats = await sharpFn(bytes, {
        failOn: 'error',
        limitInputPixels: 4096 * 4096,
        sequentialRead: true,
      }).stats()
      const red = stats.channels[0]?.mean ?? 0
      const green = stats.channels[1]?.mean ?? 0
      const blue = stats.channels[2]?.mean ?? 0
      return `#${channelHex(red)}${channelHex(green)}${channelHex(blue)}`
    } catch {
      return '#808080'
    }
  }

  async process(garmentId: string): Promise<void> {
    const garment = await this.prisma.garmentItem.findUnique({
      where: { id: garmentId },
    })
    if (
      !garment?.object_path ||
      garment.retention_status !== 'active' ||
      !['processing', 'failed'].includes(garment.upload_status)
    ) {
      return
    }

    const bytes = await this.storage.download(garment.object_path)
    const dominantHex = await this.extractDominantHex(bytes)

    await this.prisma.$transaction([
      this.prisma.garmentItem.update({
        where: { id: garment.id },
        data: {
          color_palette: { dominant: dominantHex },
          upload_status: 'ready',
          failure_code: null,
        },
      }),
      this.prisma.paletteInsights.upsert({
        where: { garment_item_id: garment.id },
        create: {
          garment_item_id: garment.id,
          user_id: garment.user_id,
          hex_codes: [dominantHex],
          confidence_score: 1,
        },
        update: {
          hex_codes: [dominantHex],
          confidence_score: 1,
        },
      }),
    ])
  }

  async markFailed(garmentId: string): Promise<void> {
    await this.prisma.garmentItem.updateMany({
      where: { id: garmentId, upload_status: 'processing' },
      data: { upload_status: 'failed', failure_code: 'COLOR_PROCESSING_FAILED' },
    })
  }
}
