import { maskGarmentBackground } from '@couture/utils'

export function removePlainGarmentBackground(context: CanvasRenderingContext2D): {
  removed: boolean
  hasTransparency: boolean
} {
  const { width, height } = context.canvas
  const image = context.getImageData(0, 0, width, height)
  const removed = maskGarmentBackground(image.data, width, height)
  if (removed) context.putImageData(image, 0, 0)
  return {
    removed,
    hasTransparency:
      removed || image.data.some((alpha, offset) => offset % 4 === 3 && alpha < 255),
  }
}
