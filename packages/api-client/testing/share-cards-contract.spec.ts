import { describe, expect, it } from 'vitest'
import {
  SHARE_CARD_MAX_BYTES,
  prepareShareCardInputSchema,
  preparedShareCardSchema,
} from '../src/contracts/http/share-cards'
import { generateHttpOpenApiDocument } from '../src/contracts/http/openapi'
import { preparedShareCardFixture } from '../src/testing/share-card-fixture'
const preview = {
  source: { kind: 'outfit', recommendationId: 'own-id' },
  locale: 'en-US',
  watermark: true,
  purpose: 'preview',
}
describe('share-card contract', () => {
  it('U-CONTRACT: admits only strict bounded source references and purpose branches', () => {
    expect(prepareShareCardInputSchema.parse(preview)).toEqual(preview)
    expect(
      prepareShareCardInputSchema.parse({
        ...preview,
        source: { kind: 'community_post', postId: 'own-post' },
        purpose: 'save',
        expectedSha256: 'a'.repeat(64),
      }).purpose
    ).toBe('save')
    for (const candidate of [
      { ...preview, url: 'https://private.invalid' },
      { ...preview, expectedSha256: 'a'.repeat(64) },
      { ...preview, source: { ...preview.source, url: 'private' } },
      ...['../private', 'https://example.invalid', 'a'.repeat(129), ''].map(
        (recommendationId) => ({
          ...preview,
          source: { kind: 'outfit', recommendationId },
        })
      ),
      { ...preview, purpose: 'save' },
      { ...preview, purpose: 'save', expectedSha256: 'A'.repeat(64) },
      { ...preview, locale: 'xx' },
    ])
      expect(prepareShareCardInputSchema.safeParse(candidate).success).toBe(false)
  })
  it('bounds bytes and publishes the canonical operation', () => {
    const doc = generateHttpOpenApiDocument()
    expect(doc.paths?.['/api/v1/share-cards/prepare']?.post?.operationId).toBe(
      'prepareShareCard'
    )
    expect(preparedShareCardSchema.safeParse(preparedShareCardFixture).success).toBe(true)
    const limit = 4 * Math.ceil(SHARE_CARD_MAX_BYTES / 3)
    expect(
      preparedShareCardSchema.safeParse({
        ...preparedShareCardFixture,
        pngBase64: 'A'.repeat(limit),
      }).success
    ).toBe(true)
    for (const pngBase64 of ['', 'A'.repeat(limit + 4), 'AAA', 'AA=A', 'AA\nAA'])
      expect(
        preparedShareCardSchema.safeParse({ ...preparedShareCardFixture, pngBase64 })
          .success
      ).toBe(false)
  })
  it('U-CONTRACT bounds the full accessibility label and rejects absent or control-bearing text', () => {
    const response = preparedShareCardFixture
    for (const accessibilityLabel of [
      undefined,
      '',
      'a'.repeat(1025),
      'Brand\nName',
      'Brand\u0000Name',
      'Brand\u007fName',
      'Brand\u0085Name',
    ])
      expect(
        preparedShareCardSchema.safeParse({ ...response, accessibilityLabel }).success
      ).toBe(false)
    expect(
      preparedShareCardSchema.safeParse({
        ...response,
        accessibilityLabel: 'a'.repeat(1024),
      }).success
    ).toBe(true)
    expect(
      preparedShareCardSchema.safeParse({
        ...response,
        accessibilityLabel: 'Tenue. Matin. CoutureCast. Filigrane: CoutureCast',
      }).success
    ).toBe(true)
  })
})
