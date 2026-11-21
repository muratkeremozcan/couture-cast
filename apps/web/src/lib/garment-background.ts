const CORNER_TOLERANCE = 22
const BACKGROUND_TOLERANCE = 32
const PLANE_COLOR_TOLERANCE = 12
const MAX_AMBIGUOUS_AREA = 0.015

function colorDistance(pixels: Uint8ClampedArray, left: number, right: number) {
  const red = (pixels[left] ?? 0) - (pixels[right] ?? 0)
  const green = (pixels[left + 1] ?? 0) - (pixels[right + 1] ?? 0)
  const blue = (pixels[left + 2] ?? 0) - (pixels[right + 2] ?? 0)
  return red * red + green * green + blue * blue
}

function hasCenteredSubject(background: Uint8Array, width: number, height: number) {
  const centerSamples = [0.35, 0.5, 0.65]
  return centerSamples.every((y) =>
    centerSamples.every(
      (x) => !background[Math.floor(y * height) * width + Math.floor(x * width)]
    )
  )
}

function hasAmbiguousBackgroundTone(
  pixels: Uint8ClampedArray,
  background: Uint32Array,
  size: number
) {
  const maxAmbiguousPixels = (pixels.length / 4) * MAX_AMBIGUOUS_AREA
  let ambiguousPixels = 0
  for (let cursor = 0; cursor < size; cursor++) {
    const offset = background[cursor]! * 4
    if (colorDistance(pixels, 0, offset) <= PLANE_COLOR_TOLERANCE ** 2) continue
    if (++ambiguousPixels > maxAmbiguousPixels) return true
  }
  return false
}

// A low-contrast, continuous border is required before we remove anything. Color matches
// enclosed by the garment are never reached by the flood fill.
export function removePlainGarmentBackground(context: CanvasRenderingContext2D): {
  removed: boolean
  hasTransparency: boolean
} {
  const { width, height } = context.canvas
  const image = context.getImageData(0, 0, width, height)
  const pixels = image.data
  const count = width * height
  const original = () => {
    for (let offset = 3; offset < pixels.length; offset += 4) {
      if (pixels[offset] !== 255) return { removed: false, hasTransparency: true }
    }
    return { removed: false, hasTransparency: false }
  }
  const corners = [0, width - 1, count - width, count - 1]
  if (
    corners.some(
      (corner) =>
        (pixels[corner * 4 + 3] ?? 0) < 250 ||
        colorDistance(pixels, 0, corner * 4) > CORNER_TOLERANCE ** 2
    )
  )
    return original()

  const matches = (index: number) =>
    (pixels[index * 4 + 3] ?? 0) >= 250 &&
    colorDistance(pixels, 0, index * 4) <= BACKGROUND_TOLERANCE ** 2
  const edges: [number, number, number, number] = [0, 0, 0, 0]
  for (let x = 0; x < width; x++) {
    edges[0] += Number(matches(x))
    edges[1] += Number(matches(count - width + x))
  }
  for (let y = 0; y < height; y++) {
    const start = y * width
    edges[2] += Number(matches(start))
    edges[3] += Number(matches(start + width - 1))
  }
  if (
    edges.some((matchesOnEdge, edge) => matchesOnEdge < 0.9 * (edge < 2 ? width : height))
  ) {
    return original()
  }

  const visited = new Uint8Array(count)
  const queue = new Uint32Array(count)
  let size = 0
  const enqueue = (index: number) => {
    if (visited[index] || !matches(index)) return
    visited[index] = 1
    queue[size++] = index
  }
  corners.forEach(enqueue)
  for (let cursor = 0; cursor < size; cursor++) {
    const index = queue[cursor]!
    const column = index % width
    if (column > 0) enqueue(index - 1)
    if (column < width - 1) enqueue(index + 1)
    if (index >= width) enqueue(index - width)
    if (index < count - width) enqueue(index + width)
  }
  // Broad close-but-distinct tones can be garment panels that blend into the wall.
  if (
    size < count * 0.12 ||
    size > count * 0.94 ||
    !hasCenteredSubject(visited, width, height) ||
    hasAmbiguousBackgroundTone(pixels, queue, size)
  ) {
    return original()
  }
  for (let cursor = 0; cursor < size; cursor++) pixels[queue[cursor]! * 4 + 3] = 0
  context.putImageData(image, 0, 0)
  return { removed: true, hasTransparency: true }
}
