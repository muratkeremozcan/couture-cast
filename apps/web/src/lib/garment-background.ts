import { maskGarmentBackground } from '@couture/utils'

export function removePlainGarmentBackground(context: CanvasRenderingContext2D): {
  removed: boolean
  hasTransparency: boolean
} {
  const { width, height } = context.canvas
  const image = context.getImageData(0, 0, width, height)
  const removed = maskGarmentBackground(image.data, width, height)
  if (removed) {
    // Drop hidden backdrop colors before encoding the transparent raster.
    for (let offset = 0; offset < image.data.length; offset += 4) {
      if (image.data[offset + 3] === 0) image.data.fill(0, offset, offset + 3)
    }
    context.putImageData(image, 0, 0)
    return { removed: true, hasTransparency: true }
  }
  for (let offset = 3; offset < image.data.length; offset += 4) {
    if (image.data[offset] !== 255) return { removed: false, hasTransparency: true }
  }
  return { removed: false, hasTransparency: false }
}
