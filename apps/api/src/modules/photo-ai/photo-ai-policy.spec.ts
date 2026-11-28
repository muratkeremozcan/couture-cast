// Learning path Step 81: Photo AI consent and processor approval.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-81-photo-ai-consent-and-processor-approval
import { expect, it } from 'vitest'
import { PRODUCTION_PHOTO_AI_POLICY } from './photo-ai-policy.js'

it('CC-7.24 defines the disabled age matrix and a manual path for each photo feature', () => {
  const disabledByAge = {
    'unknown-or-under-13': false,
    '13-15': false,
    '16-17': false,
    '18+': false,
  }
  const matrix = Object.fromEntries(
    Object.entries(PRODUCTION_PHOTO_AI_POLICY.features).map(
      ([feature, { inputClass, ageBands, manualPath }]) => [
        feature,
        { inputClass, ageBands, manualPath },
      ]
    )
  )
  expect(matrix).toEqual({
    'community-description': {
      inputClass: 'community-photo',
      ageBands: disabledByAge,
      manualPath: 'Write the description',
    },
    'garment-cutout': {
      inputClass: 'garment-photo',
      ageBands: disabledByAge,
      manualPath: 'Keep the original photo',
    },
    'garment-tags': {
      inputClass: 'garment-photo',
      ageBands: disabledByAge,
      manualPath: 'Select tags',
    },
    'flat-lay-garments': {
      inputClass: 'flat-lay-photo',
      ageBands: disabledByAge,
      manualPath: 'Add garments one at a time',
    },
  })
  expect(PRODUCTION_PHOTO_AI_POLICY.approvedProcessors).toEqual([])
})
