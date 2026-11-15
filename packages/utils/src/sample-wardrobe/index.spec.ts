// Story 6.16: both clients import the preview through the package root.
import { describe, expect, it } from 'vitest'
import * as root from '../index'
import * as previewModule from './index'

describe('guest preview exports', () => {
  it('exposes the preview module through the package root', () => {
    for (const name of [
      'SAMPLE_CATALOG',
      'SAMPLE_ART',
      'selectSampleOutfit',
      'createGuestPreviewStore',
      'parseGuestPreviewState',
      'evaluateGuestPreviewGate',
      'formatSampleExplanation',
      'GUEST_PREVIEW_STRINGS',
      'windExceeds',
    ]) {
      expect(root, name).toHaveProperty(name)
    }
    expect(root.SAMPLE_CATALOG).toBe(previewModule.SAMPLE_CATALOG)
  })
})
