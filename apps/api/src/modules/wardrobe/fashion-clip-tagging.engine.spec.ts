import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  assertValidLogits,
  extractLogits,
  verifyModelSnapshot,
} from './fashion-clip-inference.worker'

describe('FashionClipTaggingEngine & Snapshot Integrity', () => {
  it('rejects an incomplete snapshot that is missing required model files', () => {
    const incompleteSnapshotDir = path.join(__dirname, '../../../model-manifests')
    expect(() => verifyModelSnapshot(incompleteSnapshotDir)).toThrow(
      'missing required file'
    )
  })

  it('rejects a snapshot directory that does not exist', () => {
    expect(() => verifyModelSnapshot('/non/existent/path')).toThrow()
  })

  it('extracts model logits from direct tensor output', () => {
    expect(
      extractLogits({ logits_per_image: new Float32Array([0.1, 0.2, 0.3]) }, 3)
    ).toEqual([expect.closeTo(0.1), expect.closeTo(0.2), expect.closeTo(0.3)])
  })

  it('calculates logits from image and text embeddings', () => {
    expect(
      extractLogits(
        {
          image_embeds: new Float32Array([1, 2]),
          text_embeds: new Float32Array([3, 4, 5, 6]),
        },
        2
      )
    ).toEqual([11, 17])
  })

  it('rejects incomplete and non-finite model outputs', () => {
    expect(() => assertValidLogits([0.1], 2)).toThrow(
      'Inference output logits count invalid'
    )
    expect(() => assertValidLogits([0.1, Number.NaN], 2)).toThrow(
      'Inference returned non-finite score'
    )
  })
})
