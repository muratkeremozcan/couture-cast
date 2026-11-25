// Story 7.5 test plan 7.5-UNIT-004: the community caption keeps its output after the color
// classifier moved to packages/utils/src/garment-color.ts.
// Learning path Step 63: Garment detail and tag edit.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-63-garment-detail-and-tag-edit
import { describe, expect, it } from 'vitest'
import { buildCommunityPhotoCaption } from './community-photo-caption'

type Rgb = readonly [number, number, number]

/** A 10x10 image filled left to right with the given colors, each on whole columns. */
function image(columns: readonly Rgb[], alpha = 255) {
  const width = 10
  const height = 10
  const rgba = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [red, green, blue] = columns[Math.floor((x * columns.length) / width)]!
      const offset = (y * width + x) * 4
      rgba[offset] = red
      rgba[offset + 1] = green
      rgba[offset + 2] = blue
      rgba[offset + 3] = alpha
    }
  }
  return { rgba, width, height }
}

describe('buildCommunityPhotoCaption', () => {
  it('[P1] [7.5-UNIT-004] names a single blue photo in en-US', () => {
    expect(buildCommunityPhotoCaption(image([[30, 60, 200]]), 'en-US')).toBe(
      'This photo features blue tones.'
    )
  })

  it('[P1] [7.5-UNIT-004] uses the locale color table (en-CA grey)', () => {
    expect(buildCommunityPhotoCaption(image([[128, 128, 150]]), 'en-CA')).toBe(
      'This photo features grey tones.'
    )
  })

  it('[P1] [7.5-UNIT-004] lists prominent colors by weight with the locale list format', () => {
    // Center pixels weigh 4x: red 94, blue 76, black 20 of 190. Black is under the 14 percent
    // floor, so only red and blue are named, heaviest first.
    const caption = buildCommunityPhotoCaption(
      image([
        [0, 0, 0],
        [200, 30, 30],
        [200, 30, 30],
        [30, 60, 200],
        [30, 60, 200],
      ]),
      'en-US'
    )
    expect(caption).toBe('This photo features red and blue tones.')
  })

  it('[P1] [7.5-UNIT-004] returns null when every pixel is transparent', () => {
    expect(buildCommunityPhotoCaption(image([[30, 60, 200]], 0), 'en-US')).toBeNull()
  })
})
