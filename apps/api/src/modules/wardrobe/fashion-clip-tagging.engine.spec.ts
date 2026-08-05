import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  assertValidLogits,
  extractLogits,
  verifyModelSnapshot,
} from './fashion-clip-inference.worker'

describe('FashionClipTaggingEngine & Snapshot Integrity', () => {
  const temporaryDirectories: string[] = []

  const createSnapshotDirectory = () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fashion-clip-snapshot-'))
    temporaryDirectories.push(directory)
    return directory
  }

  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })

  it('rejects an incomplete snapshot with a specific checksum failure', async () => {
    const incompleteSnapshotDir = createSnapshotDirectory()
    fs.writeFileSync(path.join(incompleteSnapshotDir, 'config.json'), '{}')

    await expect(verifyModelSnapshot(incompleteSnapshotDir)).rejects.toThrow(
      'Model file checksum mismatch for config.json'
    )
  })

  it('rejects a snapshot directory that does not exist with a specific error', async () => {
    const missingSnapshotDir = path.join(createSnapshotDirectory(), 'missing')

    await expect(verifyModelSnapshot(missingSnapshotDir)).rejects.toThrow(
      `Model snapshot missing required file: ${path.join(missingSnapshotDir, 'config.json')}`
    )
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
    expect(() => assertValidLogits([0.1, 0.2, 0.3], 2)).toThrow(
      'Inference output logits count invalid'
    )
    expect(() =>
      extractLogits(
        {
          image_embeds: new Float32Array([1, 2]),
          text_embeds: new Float32Array([3, 4, 5]),
        },
        2
      )
    ).toThrow('Inference embedding dimensions are invalid')
  })
})
