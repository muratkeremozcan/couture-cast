type RgbaPixels = Uint8Array | Uint8ClampedArray

const CORNER_TOLERANCE = 22
const BACKGROUND_TOLERANCE = 32
const PLANE_COLOR_TOLERANCE = 12
const MAX_AMBIGUOUS_AREA = 0.015
const STRONG_SUBJECT_TOLERANCE = 44
const MAX_DETACHED_SUBJECT_FRACTION = 0.02
const MIN_STRONG_BOUNDARY_FRACTION = 0.7

const BACKGROUND = 1
const SUBJECT = 2

function colorDistance(pixels: RgbaPixels, left: number, right: number) {
  const red = pixels[left]! - pixels[right]!
  const green = pixels[left + 1]! - pixels[right + 1]!
  const blue = pixels[left + 2]! - pixels[right + 2]!
  return red * red + green * green + blue * blue
}

function backdropReference(pixels: RgbaPixels, width: number, height: number) {
  // Use the sampled color closest to the whole border sample. A single pixel in a
  // JPEG can be several levels off after downsampling or fall in a small shadow.
  const inset = Math.round(Math.min(width, height) / 50)
  const columns = [0, inset, width - inset - 1, width - 1]
  const rows = [0, inset, height - inset - 1, height - 1]
  const offsets = rows.flatMap((row) =>
    columns.map((column) => (row * width + column) * 4)
  )
  let reference = 0
  let bestScore = Infinity
  for (const offset of offsets) {
    const score = offsets.reduce(
      (sum, sample) => sum + colorDistance(pixels, sample, offset),
      0
    )
    if (score < bestScore) {
      reference = offset
      bestScore = score
    }
  }
  return reference
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
  pixels: RgbaPixels,
  background: Uint32Array,
  size: number,
  width: number,
  reference: number
) {
  const maxAmbiguousPixels = (pixels.length / 4) * MAX_AMBIGUOUS_AREA
  let ambiguousPixels = 0
  for (let cursor = 0; cursor < size; cursor++) {
    const index = background[cursor]!
    const distance = colorDistance(pixels, reference, index * 4)
    if (distance === 0) continue
    if (
      distance <= PLANE_COLOR_TOLERANCE ** 2 &&
      !isCoherentTone(pixels, index, width, distance / 4)
    )
      continue
    if (++ambiguousPixels > maxAmbiguousPixels) return true
  }
  return false
}

function isCoherentTone(
  pixels: RgbaPixels,
  index: number,
  width: number,
  agreementDistance: number
) {
  // The difference must persist in both axes. Sensor grain can vary locally on
  // the same backdrop. A broad, distinct patch can be a garment panel.
  const reach = Math.max(2, Math.round(width / 100))
  const column = index % width
  const above = (index - reach * width) * 4
  const below = (index + reach * width) * 4
  if (column < reach || column + reach >= width || above < 0 || below >= pixels.length)
    return false
  const offset = index * 4
  // The agreement radius is half the distance to the reference tone, so a matched
  // sample also differs from the backdrop even when the center is only a few RGB levels away.
  const similarDistinctTone = (sample: number) =>
    colorDistance(pixels, offset, sample) <= agreementDistance
  return (
    similarDistinctTone(above) &&
    similarDistinctTone(below) &&
    similarDistinctTone(offset - reach * 4) &&
    similarDistinctTone(offset + reach * 4)
  )
}

// A corner flood can leave a second object, or group the garment with a weak shadow.
// Require one dominant component with a mostly distinct edge.
function hasConfidentForeground(
  pixels: RgbaPixels,
  regions: Uint8Array,
  queue: Uint32Array,
  width: number,
  height: number,
  foregroundSize: number,
  reference: number
) {
  let size = 0
  let edgePixels = 0
  let strongEdgePixels = 0
  const enqueue = (index: number) => {
    if (regions[index]) return
    regions[index] = SUBJECT
    queue[size++] = index
  }
  enqueue(Math.floor(height / 2) * width + Math.floor(width / 2))
  for (let cursor = 0; cursor < size; cursor++) {
    const index = queue[cursor]!
    const column = index % width
    // A garment touching the crop edge has an incomplete boundary.
    if (
      column === 0 ||
      column === width - 1 ||
      index < width ||
      index >= regions.length - width
    ) {
      return false
    }
    const left = index - 1
    const right = index + 1
    const above = index - width
    const below = index + width
    if (
      regions[left] === BACKGROUND ||
      regions[right] === BACKGROUND ||
      regions[above] === BACKGROUND ||
      regions[below] === BACKGROUND
    ) {
      edgePixels++
      if (colorDistance(pixels, reference, index * 4) > STRONG_SUBJECT_TOLERANCE ** 2) {
        strongEdgePixels++
      }
    }
    enqueue(left)
    enqueue(right)
    enqueue(above)
    enqueue(below)
  }
  return (
    size >= foregroundSize * (1 - MAX_DETACHED_SUBJECT_FRACTION) &&
    strongEdgePixels >= edgePixels * MIN_STRONG_BOUNDARY_FRACTION
  )
}

function hasContinuousBackdrop(
  matches: (index: number) => boolean,
  width: number,
  height: number
) {
  const count = width * height
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
  return edges.every((matched, edge) => matched >= 0.9 * (edge < 2 ? width : height))
}

function fillBackdrop(
  visited: Uint8Array,
  queue: Uint32Array,
  width: number,
  corners: number[],
  matches: (index: number) => boolean
) {
  const count = visited.length
  let size = 0
  const enqueue = (index: number) => {
    if (visited[index] || !matches(index)) return
    visited[index] = BACKGROUND
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
  return size
}

function isOpaqueRaster(pixels: RgbaPixels, width: number, height: number) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 3 ||
    height < 3 ||
    width * height * 4 !== pixels.length
  ) {
    return false
  }
  // A source that already has alpha needs no automatic masking.
  for (let offset = 3; offset < pixels.length; offset += 4) {
    if (pixels[offset] !== 255) return false
  }
  return true
}

/**
 * Cut out a centered subject from a continuous backdrop. The caller owns the crop.
 * Only a confident result changes the raster, and only the background alpha is changed.
 */
function findBackdrop(pixels: RgbaPixels, width: number, height: number) {
  if (!isOpaqueRaster(pixels, width, height)) return null
  const count = width * height
  const corners = [0, width - 1, count - width, count - 1]
  const reference = backdropReference(pixels, width, height)
  if (
    corners.some(
      (corner) => colorDistance(pixels, reference, corner * 4) > CORNER_TOLERANCE ** 2
    )
  )
    return null

  const matches = (index: number) =>
    colorDistance(pixels, reference, index * 4) <= BACKGROUND_TOLERANCE ** 2
  if (!hasContinuousBackdrop(matches, width, height)) return null
  const visited = new Uint8Array(count)
  const queue = new Uint32Array(count)
  const size = fillBackdrop(visited, queue, width, corners, matches)
  // Broad close-but-distinct tones can be garment panels that blend into the wall.
  if (
    size < count * 0.12 ||
    size > count * 0.94 ||
    hasAmbiguousBackgroundTone(pixels, queue, size, width, reference)
  ) {
    return null
  }
  return { visited, queue, size, reference }
}

export function maskGarmentBackground(
  pixels: RgbaPixels,
  width: number,
  height: number
): boolean {
  const backdrop = findBackdrop(pixels, width, height)
  if (!backdrop) return false
  const { visited, queue, size, reference } = backdrop
  const count = visited.length
  if (
    !hasCenteredSubject(visited, width, height) ||
    !hasConfidentForeground(
      pixels,
      visited,
      queue,
      width,
      height,
      count - size,
      reference
    )
  ) {
    return false
  }

  for (let index = 0; index < count; index++) {
    if (visited[index] === BACKGROUND) pixels[index * 4 + 3] = 0
  }
  return true
}

type CutoutBounds = { left: number; top: number; width: number; height: number }
type FlatLayRaster = { pixels: RgbaPixels; width: number; height: number; gap: number }

function nearPreviousPiece(
  labels: Uint8Array,
  index: number,
  width: number,
  gap: number,
  label: number
) {
  // Compare silhouette edges even where the pieces' rectangular bounds overlap.
  for (let row = -gap; row <= gap; row++) {
    for (let column = -gap; column <= gap; column++) {
      const neighbor = labels[index + row * width + column]!
      if (neighbor > BACKGROUND && neighbor < label) return true
    }
  }
  return false
}

function traceFlatLayPiece(
  { pixels, width, height, gap }: FlatLayRaster,
  { visited: labels, queue, reference }: NonNullable<ReturnType<typeof findBackdrop>>,
  start: number,
  label: number
) {
  let count = 0
  let edges = 0
  let strongEdges = 0
  let left = width
  let top = height
  let right = 0
  let bottom = 0
  const enqueue = (index: number) => {
    if (labels[index]) return
    labels[index] = label
    queue[count++] = index
  }
  enqueue(start)
  for (let cursor = 0; cursor < count; cursor++) {
    const index = queue[cursor]!
    const x = index % width
    const y = Math.floor(index / width)
    if (x < gap || y < gap || x >= width - gap || y >= height - gap) return null
    left = Math.min(left, x)
    right = Math.max(right, x)
    top = Math.min(top, y)
    bottom = Math.max(bottom, y)
    const neighbors = [index - 1, index + 1, index - width, index + width]
    if (neighbors.some((neighbor) => labels[neighbor] === BACKGROUND)) {
      edges++
      if (colorDistance(pixels, reference, index * 4) > STRONG_SUBJECT_TOLERANCE ** 2) {
        strongEdges++
      }
      if (nearPreviousPiece(labels, index, width, gap, label)) return null
    }
    neighbors.forEach(enqueue)
  }
  return {
    count,
    edges,
    strongEdges,
    bounds: { label, left, top, width: right - left + 1, height: bottom - top + 1 },
  }
}

/** Label separate foreground pieces on an opaque, continuous, contrasting backdrop. */
export function findFlatLayComponents(
  pixels: RgbaPixels,
  width: number,
  height: number,
  limit: number
) {
  const backdrop = findBackdrop(pixels, width, height)
  if (!backdrop) return null
  const { visited: labels, queue } = backdrop
  const pieces: (CutoutBounds & { label: number })[] = []
  const gap = Math.max(3, Math.round(Math.min(width, height) * 0.012))
  const minLength = Math.min(width, height) * 0.08
  const minArea = labels.length * 0.015
  const raster = { pixels, width, height, gap }
  let speckArea = 0

  for (let start = 0; start < labels.length; start++) {
    if (labels[start]) continue
    const piece = traceFlatLayPiece(raster, backdrop, start, pieces.length + 2)
    if (!piece) return null
    const { count, edges, strongEdges, bounds } = piece
    if (count <= 4) {
      speckArea += count
      if (speckArea > labels.length * 0.001) return null
      for (let cursor = 0; cursor < count; cursor++) labels[queue[cursor]!] = BACKGROUND
      continue
    }
    if (
      pieces.length === limit ||
      count < minArea ||
      bounds.width < minLength ||
      bounds.height < minLength ||
      strongEdges < edges * MIN_STRONG_BOUNDARY_FRACTION
    )
      return null
    pieces.push(bounds)
  }

  return pieces.length >= 2 ? { labels, pieces } : null
}
