// Learning path Step 58: Image uploads straight to storage.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#image-uploads-straight-to-storage
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type * as WardrobeModule from './wardrobe'

const prepareGarmentImage = vi.hoisted(() => vi.fn())

vi.mock('./wardrobe', async (importOriginal) => ({
  ...(await importOriginal<typeof WardrobeModule>()),
  prepareGarmentImage,
}))

import { allocateCommunityLookFromWeb } from './community'
import { WEB_ACCESS_TOKEN_STORAGE_KEY } from './wardrobe'

afterEach(() => {
  window.sessionStorage.clear()
  vi.restoreAllMocks()
})

describe('allocateCommunityLookFromWeb image preparation', () => {
  /**
   * Review round 1, 2026-11-19: the wardrobe change to JPEG must not reach community posts,
   * which keep their own format (PNG stays PNG, transparency kept).
   */
  it('prepares the photo in its source format', async () => {
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'test-access-token')
    prepareGarmentImage.mockRejectedValue(new Error('stop after preparation'))

    await expect(
      allocateCommunityLookFromWeb({
        imagePreview: 'blob:look',
        locale: 'en-US',
        idempotencyKey: '11111111-1111-4111-8111-111111111111',
      })
    ).rejects.toThrow()

    expect(prepareGarmentImage).toHaveBeenCalledWith('blob:look', '4:3', false, 'source')
  })
})
