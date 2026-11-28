import type {
  PhotoAiFeature,
  PhotoAiInputClass,
} from '@couture/api-client/contracts/http'

export const PHOTO_AI_POLICY = Symbol('PHOTO_AI_POLICY')

export type PhotoAiAgeBand = 'unknown-or-under-13' | '13-15' | '16-17' | '18+'

type FeaturePolicy = Readonly<{
  inputClass: PhotoAiInputClass
  policyVersion: string
  ageBands: Readonly<Record<PhotoAiAgeBand, boolean>>
  manualPath: string
}>

export type PhotoAiProcessorApproval = Readonly<{
  provider: string
  feature: PhotoAiFeature
  inputClass: PhotoAiInputClass
  policyVersion: string
}>

export type PhotoAiPolicy = Readonly<{
  features: Readonly<Record<PhotoAiFeature, FeaturePolicy>>
  approvedProcessors: readonly PhotoAiProcessorApproval[]
}>

const launchAgeBands = Object.freeze({
  'unknown-or-under-13': false,
  '13-15': false,
  '16-17': false,
  '18+': false,
})

function disabledFeature(
  inputClass: PhotoAiInputClass,
  manualPath: string
): FeaturePolicy {
  return Object.freeze({
    inputClass,
    policyVersion: '2026-11-27',
    ageBands: launchAgeBands,
    manualPath,
  })
}

export const PRODUCTION_PHOTO_AI_POLICY: PhotoAiPolicy = Object.freeze({
  features: Object.freeze({
    'community-description': disabledFeature('community-photo', 'Write the description'),
    'garment-cutout': disabledFeature('garment-photo', 'Keep the original photo'),
    'garment-tags': disabledFeature('garment-photo', 'Select tags'),
    'flat-lay-garments': disabledFeature('flat-lay-photo', 'Add garments one at a time'),
  }),
  approvedProcessors: Object.freeze([]),
})
