import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ShareCardSourceRepository } from './share-card-source.repository.js'
const member = 'member'
const db = {
  user: { findUnique: vi.fn() },
  userProfile: { findUnique: vi.fn() },
  outfitRecommendation: { findFirst: vi.fn() },
  outfitCapsule: { findFirst: vi.fn() },
  garmentItem: { findFirst: vi.fn() },
  lookbookPost: { findFirst: vi.fn() },
}
const community = {
  readAuthorized: vi.fn((_member: string, work: () => unknown) => work()),
}
const sources = new ShareCardSourceRepository(db as never, community as never)
const owned = {
  user_id: member,
  scenario: 'morning',
  garment_ids: ['default-top'],
  capsule_id: null,
}
const post = {
  user_id: member,
  status: 'published',
  published_at: new Date(),
  erasure_requested_at: null,
  anonymized_at: null,
  image_object_path: 'community/owned/photo.png',
  image_content_type: 'image/png',
  image_checksum: 'a'.repeat(64),
  image_byte_size: 100,
  climate_band: null,
}
beforeEach(() => {
  db.user.findUnique.mockResolvedValue({
    profile: { birthdate: new Date('1990-01-01') },
    teen_roles: [],
  })
  db.userProfile.findUnique.mockResolvedValue({
    birthdate: new Date('1990-01-01'),
    preferences: { compliance: { accountStatus: 'active' } },
    capsule_revision: 3,
  })
  db.outfitRecommendation.findFirst.mockResolvedValue(owned)
  db.garmentItem.findFirst.mockResolvedValue({ category: 'top' })
  db.outfitCapsule.findFirst.mockResolvedValue({ id: 'capsule' })
  db.lookbookPost.findFirst.mockResolvedValue(post)
})
describe('share-card closed source projection', () => {
  it.each([
    null,
    { ...owned, scenario: 'malformed' },
    { ...owned, garment_ids: [] },
    { ...owned, garment_ids: ['default-top', 'default-top'] },
    { ...owned, garment_ids: Array.from({ length: 13 }, (_, i) => `id-${i}`) },
  ])('U-OUTFIT-DENY: malformed persisted recommendation refuses export', async (row) => {
    db.outfitRecommendation.findFirst.mockResolvedValue(row)
    await expect(
      sources.resolve(member, { kind: 'outfit', recommendationId: 'owned' })
    ).rejects.toMatchObject({ status: 404 })
  })
  it.each([null, { category: 'private unknown category' }])(
    'U-OUTFIT-DENY: absent/foreign/unready/category-invalid garment lookup fails',
    async (garment) => {
      db.outfitRecommendation.findFirst.mockResolvedValue({
        ...owned,
        garment_ids: ['real'],
      })
      db.garmentItem.findFirst.mockResolvedValue(garment)
      await expect(
        sources.resolve(member, { kind: 'outfit', recommendationId: 'owned' })
      ).rejects.toMatchObject({ status: 404 })
      expect(db.garmentItem.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 'real',
            user_id: member,
            retention_status: 'active',
            upload_status: 'ready',
          },
        })
      )
    }
  )
  it.each([null, { id: 'capsule' }])(
    'U-OUTFIT-DENY: capsule ownership/global recorded revision are required',
    async (capsule) => {
      db.outfitRecommendation.findFirst.mockResolvedValue({
        ...owned,
        capsule_id: 'capsule',
        capsule_revision: 2,
      })
      db.outfitCapsule.findFirst.mockResolvedValue(capsule)
      await expect(
        sources.resolve(member, { kind: 'outfit', recommendationId: 'owned' })
      ).rejects.toMatchObject({ status: 404 })
    }
  )
  it.each([
    null,
    { ...post, published_at: null },
    { ...post, anonymized_at: new Date() },
    { ...post, erasure_requested_at: new Date() },
    { ...post, user_id: 'canary-user-owned' },
    { ...post, status: 'withdrawn' },
    { ...post, image_object_path: null },
    { ...post, image_object_path: 'https://private.invalid/owned.png' },
    { ...post, image_object_path: 'community/other/photo.png' },
    { ...post, image_object_path: 'community/owned/../photo.png' },
    { ...post, image_content_type: 'image/gif' },
    { ...post, image_checksum: 'invalid' },
    { ...post, image_checksum: null },
    { ...post, image_byte_size: 0 },
    { ...post, image_byte_size: -1 },
    { ...post, image_byte_size: 10 * 1024 * 1024 + 1 },
  ])(
    'U-POST-DENY: private/nonvisible/unsafe stored media has no projection',
    async (row) => {
      db.lookbookPost.findFirst.mockResolvedValue(row)
      await expect(
        sources.resolve(member, { kind: 'community_post', postId: 'owned' })
      ).rejects.toMatchObject({ status: 404 })
    }
  )
  it('U-OUTFIT U-POST U-LOG-PRIVACY: only fixed category/scenario or authorized media declaration crosses the projection boundary', async () => {
    expect(
      await sources.resolve(member, { kind: 'outfit', recommendationId: 'owned' })
    ).toEqual({
      kind: 'outfit',
      scenario: 'morning',
      categories: ['top'],
      fingerprint: expect.any(String) as string,
    })
    expect(
      await sources.resolve(member, { kind: 'community_post', postId: 'owned' })
    ).toEqual({
      kind: 'community_post',
      path: post.image_object_path,
      mimeType: 'image/png',
      sha256: post.image_checksum,
      byteSize: 100,
      climateBand: null,
    })
    expect(db.lookbookPost.findFirst).toHaveBeenCalledWith({
      where: { id: 'owned', user_id: member },
    })
  })
})
