import { describe, expect, it } from 'vitest'
import {
  prepareShareCardInputSchema,
  preparedShareCardSchema,
} from '../src/contracts/http/share-cards'
import { generateHttpOpenApiDocument } from '../src/contracts/http/openapi'
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
    expect(
      preparedShareCardSchema.safeParse({
        pngBase64: 'AAAA',
        accessibilityLabel: 'Outfit. Morning. Top. CoutureCast. Watermark: CoutureCast',
        sha256: 'a'.repeat(64),
        width: 1080,
        height: 1350,
        mimeType: 'image/png',
        filename: 'couturecast-card.png',
        templateVersion: 1,
      }).success
    ).toBe(true)
  })
  it('U-CONTRACT bounds the full accessibility label and rejects absent or control-bearing text', () => {
    const response = {
      pngBase64: 'AAAA',
      sha256: 'a'.repeat(64),
      width: 1080,
      height: 1350,
      mimeType: 'image/png',
      filename: 'couturecast-card.png',
      templateVersion: 1,
    }
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
