// Learning path Step 58: Hosted wardrobe workers and manual tagging.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#hosted-wardrobe-workers-and-manual-tagging
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  GarmentTaggingManualModeError,
  TAGGING_MANUAL_MODE_CODE,
} from './garment-tagging.engine'
import { ManualGarmentTaggingEngine } from './manual-garment-tagging.engine'

describe('ManualGarmentTaggingEngine', () => {
  it('never produces a suggestion: it answers the manual-mode error for any image', async () => {
    const engine = new ManualGarmentTaggingEngine()

    await expect(engine.inferTags(Buffer.from('any-image'))).rejects.toBeInstanceOf(
      GarmentTaggingManualModeError
    )
    await expect(engine.inferTags(Buffer.alloc(0))).rejects.toMatchObject({
      name: 'GarmentTaggingManualModeError',
      code: TAGGING_MANUAL_MODE_CODE,
    })
    expect(TAGGING_MANUAL_MODE_CODE).toBe('TAGGING_MANUAL_MODE')
  })

  it('imports nothing but the engine contract, so selecting it loads no model runtime', () => {
    const source = readFileSync(
      path.resolve(__dirname, 'manual-garment-tagging.engine.ts'),
      'utf8'
    )
    // `from`, side-effect `import '...'`, dynamic `import('...')` and `require('...')` all count.
    const specifiers = [
      ...source.matchAll(/\b(?:from|import|require)\s*\(?\s*['"]([^'"]+)['"]/g),
    ].map((match) => match[1])
    expect(specifiers.toSorted()).toEqual([
      './garment-tagging.engine',
      '@couture/api-client/contracts/http',
    ])
  })
})
