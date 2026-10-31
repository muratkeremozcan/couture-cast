// Learning path Step 44: Community city spotlight.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-44-community-city-spotlight
// Story 6.6: the spotlight route and the opened endpoint's branch dispatch. The
// real guarded route runs in integration/community-spotlight-http.integration.spec.ts.
import { BadRequestException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'
import type { CommunitySpotlight } from '@couture/api-client/contracts/http'
import type { Response } from 'express'
import type { RequestAuthContext } from '../auth/security.types'
import { CommunityController } from './community.controller'
import { CommunityRateLimitException } from './community-rate-limit.exception'
import type { CommunityService } from './community.service'
import type { CommunitySponsorshipService } from '../commerce/community-sponsorship.service'
import type { CommunitySpotlightService } from './community-spotlight.service'

const auth: RequestAuthContext = { token: 't', userId: 'viewer-1', role: 'guardian' }
const page: CommunitySpotlight = {
  level: 'none',
  label: null,
  items: [],
  nextCursor: null,
}

function response() {
  const setHeader = vi.fn()
  return { setHeader, res: { setHeader } as unknown as Response }
}
const { res } = response()

function controller() {
  const getSpotlight = vi.fn().mockResolvedValue(page)
  const recordOpened = vi.fn().mockResolvedValue({ tracked: true })
  const recordCardOpened = vi.fn().mockResolvedValue({ tracked: true })
  return {
    getSpotlight,
    recordOpened,
    recordCardOpened,
    subject: new CommunityController(
      { recordCardOpened } as unknown as CommunityService,
      { getSpotlight, recordOpened } as unknown as CommunitySpotlightService,
      {
        resolveForPosts: vi
          .fn()
          .mockRejectedValue(new Error('unexpected sponsorship read')),
      } as unknown as CommunitySponsorshipService
    ),
  }
}

describe('6.6 spotlight controller', () => {
  it('6.6-UNIT-060 reads with the default limit and negotiates reactions like the feed', async () => {
    const { subject, getSpotlight } = controller()
    await expect(subject.getSpotlight(auth, 'mobile', {}, res)).resolves.toEqual({
      data: page,
    })
    expect(getSpotlight).toHaveBeenLastCalledWith({
      userId: 'viewer-1',
      platform: 'mobile',
      cursor: undefined,
      limit: 6,
      surface: 'community',
    })
    await subject.getSpotlight(auth, 'web', { limit: '12', cursor: 'next' }, res, '1')
    expect(getSpotlight).toHaveBeenLastCalledWith({
      userId: 'viewer-1',
      platform: 'web',
      cursor: 'next',
      limit: 12,
      surface: 'community',
      reactions: true,
    })
  })

  it('6.7-UNIT-001 passes the home_teaser surface through and refuses unknown surfaces', async () => {
    const { subject, getSpotlight } = controller()
    await subject.getSpotlight(
      auth,
      'mobile',
      { limit: '1', surface: 'home_teaser' },
      res
    )
    expect(getSpotlight).toHaveBeenLastCalledWith({
      userId: 'viewer-1',
      platform: 'mobile',
      cursor: undefined,
      limit: 1,
      surface: 'home_teaser',
    })
    getSpotlight.mockClear()
    for (const surface of ['spotlight', 'home', ''])
      await expect(subject.getSpotlight(auth, 'web', { surface }, res)).rejects.toThrow(
        BadRequestException
      )
    expect(getSpotlight).not.toHaveBeenCalled()
  })

  it('6.6-UNIT-061 refuses a missing platform and limits outside 1 to 12', async () => {
    const { subject, getSpotlight } = controller()
    await expect(subject.getSpotlight(auth, undefined, {}, res)).rejects.toThrow(
      BadRequestException
    )
    for (const limit of ['0', '13'])
      await expect(subject.getSpotlight(auth, 'web', { limit }, res)).rejects.toThrow(
        BadRequestException
      )
    expect(getSpotlight).not.toHaveBeenCalled()
  })

  it('6.6-UNIT-065 a page-one read over the limit answers 429 with Retry-After', async () => {
    const { subject, getSpotlight } = controller()
    const { setHeader, res: limited } = response()
    getSpotlight.mockRejectedValueOnce(new CommunityRateLimitException('Too many', 37))
    await expect(subject.getSpotlight(auth, 'web', {}, limited)).rejects.toBeInstanceOf(
      CommunityRateLimitException
    )
    expect(setHeader).toHaveBeenCalledWith('Retry-After', '37')
  })

  it('6.6-UNIT-062 routes a spotlight open to the spotlight service only', async () => {
    const { subject, recordOpened, recordCardOpened } = controller()
    await subject.openPost(auth, 'post-1', 'web', {
      surface: 'spotlight',
      rank: 4,
      level: 'region',
    })
    expect(recordOpened).toHaveBeenCalledWith({
      userId: 'viewer-1',
      postId: 'post-1',
      platform: 'web',
      surface: 'spotlight',
      rank: 4,
      level: 'region',
    })
    expect(recordCardOpened).not.toHaveBeenCalled()
  })

  it('6.7-UNIT-002 routes a Home teaser open to the spotlight service with its surface', async () => {
    const { subject, recordOpened, recordCardOpened } = controller()
    await subject.openPost(auth, 'post-1', 'mobile', {
      surface: 'home_teaser',
      rank: 1,
      level: 'city',
    })
    expect(recordOpened).toHaveBeenCalledWith({
      userId: 'viewer-1',
      postId: 'post-1',
      platform: 'mobile',
      surface: 'home_teaser',
      rank: 1,
      level: 'city',
    })
    expect(recordCardOpened).not.toHaveBeenCalled()
  })

  it('6.6-UNIT-064 refuses a spotlight open without a served level', async () => {
    const { subject, recordOpened, recordCardOpened } = controller()
    for (const body of [
      { surface: 'spotlight', rank: 4 },
      { surface: 'spotlight', rank: 4, level: 'none' },
      { experimentVariant: 'auto', level: 'city' },
    ])
      await expect(subject.openPost(auth, 'post-1', 'web', body)).rejects.toThrow(
        BadRequestException
      )
    expect(recordOpened).not.toHaveBeenCalled()
    expect(recordCardOpened).not.toHaveBeenCalled()
  })

  it('6.6-UNIT-063 keeps a body without surface on the feed card-open path', async () => {
    const { subject, recordOpened, recordCardOpened } = controller()
    await subject.openPost(auth, 'post-1', 'mobile', { experimentVariant: 'auto' })
    expect(recordCardOpened).toHaveBeenCalledWith({
      userId: 'viewer-1',
      postId: 'post-1',
      platform: 'mobile',
      input: { experimentVariant: 'auto' },
    })
    expect(recordOpened).not.toHaveBeenCalled()
  })
})
