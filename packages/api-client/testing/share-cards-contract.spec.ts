import { describe, expect, it } from 'vitest'
import {
  SHARE_CARD_MAX_BYTES,
  prepareShareCardInputSchema,
  prepareShareCardResponseSchema,
  preparedShareCardSchema,
  shareCardCapabilitiesResponseSchema,
  shareCardCapabilitiesSchema,
} from '../src/contracts/http/share-cards'
import * as root from '../src'
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
  it('U-SHARE-CONTRACT: share requires a lowercase 64-hex digest and nothing else', () => {
    const share = {
      ...preview,
      source: { kind: 'community_post', postId: 'own-post' },
      purpose: 'share',
      expectedSha256: 'b'.repeat(64),
    }
    expect(prepareShareCardInputSchema.parse(share)).toEqual(share)
    for (const candidate of [
      { ...share, expectedSha256: undefined },
      { ...share, expectedSha256: 'B'.repeat(64) },
      { ...share, expectedSha256: 'b'.repeat(63) },
      { ...share, expectedSha256: 'b'.repeat(65) },
      { ...share, url: 'https://private.invalid' },
      { ...share, fileUri: 'file:///private/cc69-share-1.png' },
      { ...share, filename: 'couturecast-card.png' },
      { ...share, source: { kind: 'community_post', postId: '../private' } },
      { ...share, source: { kind: 'outfit', recommendationId: 'https://x' } },
      { ...share, purpose: 'post' },
    ])
      expect(prepareShareCardInputSchema.safeParse(candidate).success).toBe(false)
  })
  it('U-SHARE-CONTRACT: capabilities is the strict envelope with one boolean', () => {
    expect(
      shareCardCapabilitiesResponseSchema.parse({ data: { nativeShare: true } })
    ).toEqual({ data: { nativeShare: true } })
    expect(shareCardCapabilitiesSchema.parse({ nativeShare: false })).toEqual({
      nativeShare: false,
    })
    for (const candidate of [
      {},
      { nativeShare: true },
      { data: {} },
      { data: { nativeShare: 'true' } },
      { data: { nativeShare: true, tier: 'beta' } },
      { data: { nativeShare: true }, meta: {} },
    ])
      expect(shareCardCapabilitiesResponseSchema.safeParse(candidate).success).toBe(false)
    expect(root.shareCardCapabilitiesResponseSchema).toBe(
      shareCardCapabilitiesResponseSchema
    )
  })
  it('U-SHARE-CONTRACT: preview and save responses keep the exact 6.8 shape', () => {
    // Deployed 6.8 clients parse these strictly; one extra field breaks them.
    expect(Object.keys(preparedShareCardSchema.shape).sort()).toEqual([
      'accessibilityLabel',
      'filename',
      'height',
      'mimeType',
      'pngBase64',
      'sha256',
      'templateVersion',
      'width',
    ])
    expect(Object.keys(prepareShareCardResponseSchema.shape)).toEqual(['data'])
    expect(
      prepareShareCardResponseSchema.safeParse({
        data: { ...preparedShareCardFixture, nativeShare: true },
      }).success
    ).toBe(false)
    expect(
      prepareShareCardResponseSchema.safeParse({
        data: preparedShareCardFixture,
        capabilities: { nativeShare: true },
      }).success
    ).toBe(false)
  })
  it('U-SHARE-CONTRACT: publishes the capabilities operation', () => {
    const doc = generateHttpOpenApiDocument()
    const operation = doc.paths?.['/api/v1/share-cards/capabilities']?.get
    expect(operation?.operationId).toBe('getShareCardCapabilities')
    expect(operation?.security).toEqual([{ bearerAuth: [] }])
    expect(Object.keys(operation?.responses ?? {}).sort()).toEqual(['200', '401'])
    const purposes = JSON.stringify(
      doc.paths?.['/api/v1/share-cards/prepare']?.post?.requestBody
    )
    expect(purposes).toContain('"share"')
  })
})
