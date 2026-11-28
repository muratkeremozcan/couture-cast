// Learning path Step 30: Smart tagging and comfort metadata.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-30-smart-tagging-and-comfort-metadata
// Learning path Step 84: Suggested tags that are right.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-84-suggested-tags-that-are-right
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  garmentCategoryEnum,
  garmentSubtypeEnum,
  GARMENT_SUBTYPE_ANALYSIS_VERSION,
  garmentTagSuggestionSnapshotSchema,
} from '@couture/api-client/contracts/http'
import {
  initializeInferenceWorker,
  runInferenceOnImage,
} from './fashion-clip-inference.worker'
import { classifyTagSuggestions } from './garment-tagging.engine'

const fixtures = path.resolve(__dirname, '../../../test/fixtures/garment-tagging')
const holdout = path.join(fixtures, 'holdout-v1')
const holdoutManifestSchema = z.object({
  name: z.literal('wardrobe-tagging-holdout-v1'),
  images: z
    .array(
      z.object({
        file: z.string().regex(/^[a-z0-9-]+\.jpg$/),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        category: garmentCategoryEnum,
        subtype: garmentSubtypeEnum.nullable(),
      })
    )
    .length(20),
})

async function infer(image: Buffer) {
  return garmentTagSuggestionSnapshotSchema.parse(
    classifyTagSuggestions(await runInferenceOnImage(image))
  )
}

describe('Garment Tagging Model Smoke Test', () => {
  beforeAll(async () => {
    await initializeInferenceWorker(
      process.env.GARMENT_TAGGING_MODEL_DIR ||
        path.resolve(__dirname, '../../../.cache/garment-tagging-model')
    )
  }, 60_000)

  it('processes a neutral garment fixture and returns valid finite schema output', async () => {
    const parsed = await infer(fs.readFileSync(path.join(fixtures, 'neutral-top.png')))
    expect(parsed.analysisVersion).toBe(GARMENT_SUBTYPE_ANALYSIS_VERSION)
    expect(parsed.category.value).toBeDefined()
    expect(parsed.category.confidence).toBeGreaterThanOrEqual(0)
    expect(parsed.category.confidence).toBeLessThanOrEqual(1)
    expect(parsed.material.value).toBeDefined()
    expect(parsed.comfortRange.value).toBeDefined()
  }, 30_000)

  it('recognizes a plain top from the cutout fixtures as having no listed subtype', async () => {
    const plainTop = path.resolve(
      __dirname,
      '../../../../../packages/utils/test/fixtures/garment-cutouts/plain.jpg'
    )
    const result = await infer(fs.readFileSync(plainTop))
    expect(result.category).toMatchObject({ value: 'top', isConfident: true })
    expect(result.subtype).toMatchObject({ value: null, isConfident: true })
  }, 30_000)

  it('meets the fixed category and subtype top-1 targets with abstentions counted as misses', async () => {
    const manifest = holdoutManifestSchema.parse(
      JSON.parse(fs.readFileSync(path.join(holdout, 'manifest.json'), 'utf8'))
    )
    expect(new Set(manifest.images.map(({ file }) => file)).size).toBe(20)
    expect(new Set(manifest.images.map(({ sha256 }) => sha256)).size).toBe(20)
    expect(new Set(manifest.images.map(({ category }) => category))).toEqual(
      new Set(garmentCategoryEnum.options)
    )
    const categoryMisses: string[] = []
    const subtypeMisses: string[] = []
    const subtypeCases = manifest.images.filter(({ subtype }) => subtype !== null)
    expect(subtypeCases).toHaveLength(18)
    expect(new Set(subtypeCases.map(({ subtype }) => subtype))).toEqual(
      new Set(garmentSubtypeEnum.options)
    )

    for (const expected of manifest.images) {
      const image = fs.readFileSync(path.join(holdout, expected.file))
      expect(createHash('sha256').update(image).digest('hex'), expected.file).toBe(
        expected.sha256
      )
      const { category, subtype } = await infer(image)
      if (!category.isConfident || category.value !== expected.category) {
        categoryMisses.push(
          `${expected.file} expected ${expected.category}, got ${category.isConfident ? category.value : 'abstention'}`
        )
      }
      if (
        expected.subtype !== null &&
        (!subtype?.isConfident || subtype.value !== expected.subtype)
      ) {
        subtypeMisses.push(
          `${expected.file} expected ${expected.subtype}, got ${subtype?.isConfident ? subtype.value : 'abstention'}`
        )
      }
    }

    const categoryHits = manifest.images.length - categoryMisses.length
    const subtypeHits = subtypeCases.length - subtypeMisses.length
    process.stdout.write(
      `${manifest.name}: category ${categoryHits}/${manifest.images.length}, subtype ${subtypeHits}/${subtypeCases.length}\n`
    )
    expect
      .soft(categoryHits / manifest.images.length, categoryMisses.join('\n'))
      .toBeGreaterThanOrEqual(0.9)
    expect
      .soft(subtypeHits / subtypeCases.length, subtypeMisses.join('\n'))
      .toBeGreaterThanOrEqual(0.8)
  }, 120_000)
})
