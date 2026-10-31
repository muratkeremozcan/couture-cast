// Learning path Step 47: Sponsored community highlights.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-47-sponsored-community-highlights
// Story 6.7b: the per-viewer sponsorship chain. The SQL itself runs against
// PostgreSQL in integration/community-sponsorship.integration.spec.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { logError } = vi.hoisted(() => ({ logError: vi.fn() }))
vi.mock('../../logger/pino.config.js', () => ({
  createBaseLogger: () => ({ child: () => ({ error: logError }) }),
}))
import type { FeatureFlagsService } from '../feature-flags/feature-flags.service.js'
import type {
  CommerceRepository,
  CommunitySponsorshipMatch,
} from './commerce.repository.js'
import { CommunitySponsorshipService } from './community-sponsorship.service.js'

const MATCH: CommunitySponsorshipMatch = {
  post_id: 'post-1',
  offer_id: 'offer-1',
  offer_title: 'Trench coat',
  partner_slug: 'sample-partner',
  partner_display_name: 'Sample Partner',
}

describe('CommunitySponsorshipService', () => {
  const featureFlags = { getFeatureFlag: vi.fn() }
  const repository = {
    findAffiliateCtasEnabled: vi.fn(),
    findUserCommerceContext: vi.fn(),
    findEligibleCommunitySponsorships: vi.fn(),
  }
  let service: CommunitySponsorshipService

  beforeEach(() => {
    featureFlags.getFeatureFlag.mockReset().mockResolvedValue(true)
    repository.findAffiliateCtasEnabled.mockReset().mockResolvedValue(null)
    repository.findUserCommerceContext
      .mockReset()
      .mockResolvedValue({ birthdate: null, locale: undefined })
    repository.findEligibleCommunitySponsorships.mockReset().mockResolvedValue([MATCH])
    service = new CommunitySponsorshipService(
      featureFlags as unknown as FeatureFlagsService,
      repository as unknown as CommerceRepository
    )
  })

  it('6.7b-UNIT-010 projects the block for each eligible post in one batched lookup', async () => {
    const blocks = await service.resolveForPosts({
      userId: 'viewer-1',
      postIds: ['post-1', 'post-2', 'post-1'],
      acceptLanguage: 'fr-CA,fr;q=0.9',
    })

    expect(repository.findEligibleCommunitySponsorships).toHaveBeenCalledOnce()
    expect(repository.findEligibleCommunitySponsorships).toHaveBeenCalledWith(
      ['post-1', 'post-2'],
      'CA'
    )
    expect([...blocks.entries()]).toEqual([
      [
        'post-1',
        {
          partnerId: 'sample-partner',
          partnerDisplayName: 'Sample Partner',
          offerId: 'offer-1',
          offerTitle: 'Trench coat',
        },
      ],
    ])
  })

  it('6.7b-UNIT-011 a saved locale outranks Accept-Language, exactly like the click', async () => {
    repository.findUserCommerceContext.mockResolvedValue({
      birthdate: null,
      locale: 'es-419',
    })

    await service.resolveForPosts({
      userId: 'viewer-1',
      postIds: ['post-1'],
      acceptLanguage: 'en-US',
    })

    expect(repository.findEligibleCommunitySponsorships).toHaveBeenCalledWith(
      ['post-1'],
      '419'
    )
  })

  it('6.7b-UNIT-012 no saved locale and no Accept-Language resolves the global region', async () => {
    await service.resolveForPosts({ userId: 'viewer-1', postIds: ['post-1'] })

    expect(repository.findEligibleCommunitySponsorships).toHaveBeenCalledWith(
      ['post-1'],
      '*'
    )
  })

  it('6.7b-UNIT-013 the flag off yields no blocks and no lookup', async () => {
    featureFlags.getFeatureFlag.mockResolvedValue(false)

    const blocks = await service.resolveForPosts({
      userId: 'viewer-1',
      postIds: ['post-1'],
    })

    expect(blocks.size).toBe(0)
    expect(featureFlags.getFeatureFlag).toHaveBeenCalledWith(
      'commerce_affiliate_enabled',
      'viewer-1'
    )
    expect(repository.findEligibleCommunitySponsorships).not.toHaveBeenCalled()
  })

  it('6.7b-UNIT-014 an opted-out viewer gets no blocks; a missing row reads as opted in', async () => {
    repository.findAffiliateCtasEnabled.mockResolvedValue(false)
    await expect(
      service.resolveForPosts({ userId: 'viewer-1', postIds: ['post-1'] })
    ).resolves.toEqual(new Map())
    expect(repository.findEligibleCommunitySponsorships).not.toHaveBeenCalled()

    repository.findAffiliateCtasEnabled.mockResolvedValue(null)
    const blocks = await service.resolveForPosts({
      userId: 'viewer-1',
      postIds: ['post-1'],
    })
    expect(blocks.size).toBe(1)
  })

  it('6.7b-UNIT-015 an empty page asks nothing', async () => {
    await expect(
      service.resolveForPosts({ userId: 'viewer-1', postIds: [] })
    ).resolves.toEqual(new Map())
    expect(featureFlags.getFeatureFlag).not.toHaveBeenCalled()
  })

  it.each([
    [
      'the flag service',
      () => featureFlags.getFeatureFlag.mockRejectedValue(new Error('flag outage')),
    ],
    [
      'the eligibility query',
      () =>
        repository.findEligibleCommunitySponsorships.mockRejectedValue(
          new Error('relation "CommunityPostSponsorship" post-1 viewer-1')
        ),
    ],
    [
      'a malformed catalog row',
      () =>
        repository.findEligibleCommunitySponsorships.mockResolvedValue([
          { ...MATCH, offer_title: '' },
        ]),
    ],
  ])(
    '6.7b-UNIT-016 a failure in %s fails closed and logs no identifier',
    async (_name, arrange) => {
      arrange()
      logError.mockReset()
      await expect(
        service.resolveForPosts({ userId: 'viewer-1', postIds: ['post-1'] })
      ).resolves.toEqual(new Map())
      expect(logError).toHaveBeenCalledOnce()
      const logged = JSON.stringify(logError.mock.calls)
      expect(logged).toContain('community_sponsorship_resolution_failed')
      expect(logged).not.toContain('viewer-1')
      expect(logged).not.toContain('post-1')
      expect(logged).not.toContain('offer-1')
    }
  )

  it('6.7b-UNIT-017 the click re-check asks for the exact post and offer in the viewer region', async () => {
    await expect(
      service.isClickable({
        postId: 'post-1',
        offerId: 'offer-1',
        locale: undefined,
        acceptLanguage: 'pt-BR',
      })
    ).resolves.toBe(true)
    expect(repository.findEligibleCommunitySponsorships).toHaveBeenCalledWith(
      ['post-1'],
      'BR',
      'offer-1'
    )

    repository.findEligibleCommunitySponsorships.mockResolvedValue([])
    await expect(
      service.isClickable({ postId: 'post-1', offerId: 'offer-1', locale: 'en-US' })
    ).resolves.toBe(false)
  })
})
