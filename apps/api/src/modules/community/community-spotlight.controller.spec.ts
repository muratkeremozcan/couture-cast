// Story 6.6: the spotlight route and the opened endpoint's branch dispatch. The
// real guarded route runs in integration/community-spotlight-http.integration.spec.ts.
import { BadRequestException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'
import type { CommunitySpotlight } from '@couture/api-client/contracts/http'
import type { RequestAuthContext } from '../auth/security.types'
import { CommunityController } from './community.controller'
import type { CommunityService } from './community.service'
import type { CommunitySpotlightService } from './community-spotlight.service'

const auth: RequestAuthContext = { token: 't', userId: 'viewer-1', role: 'guardian' }
const page: CommunitySpotlight = {
  level: 'none',
  label: null,
  items: [],
  nextCursor: null,
}

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
      { getSpotlight, recordOpened } as unknown as CommunitySpotlightService
    ),
  }
}

describe('6.6 spotlight controller', () => {
  it('6.6-UNIT-060 reads with the default limit and negotiates reactions like the feed', async () => {
    const { subject, getSpotlight } = controller()
    await expect(subject.getSpotlight(auth, 'mobile', {})).resolves.toEqual({
      data: page,
    })
    expect(getSpotlight).toHaveBeenLastCalledWith({
      userId: 'viewer-1',
      platform: 'mobile',
      cursor: undefined,
      limit: 6,
    })
    await subject.getSpotlight(auth, 'web', { limit: '12', cursor: 'next' }, '1')
    expect(getSpotlight).toHaveBeenLastCalledWith({
      userId: 'viewer-1',
      platform: 'web',
      cursor: 'next',
      limit: 12,
      reactions: true,
    })
  })

  it('6.6-UNIT-061 refuses a missing platform and limits outside 1 to 12', async () => {
    const { subject, getSpotlight } = controller()
    await expect(subject.getSpotlight(auth, undefined, {})).rejects.toThrow(
      BadRequestException
    )
    for (const limit of ['0', '13'])
      await expect(subject.getSpotlight(auth, 'web', { limit })).rejects.toThrow(
        BadRequestException
      )
    expect(getSpotlight).not.toHaveBeenCalled()
  })

  it('6.6-UNIT-062 routes a spotlight open to the spotlight service only', async () => {
    const { subject, recordOpened, recordCardOpened } = controller()
    await subject.openPost(auth, 'post-1', 'web', { surface: 'spotlight', rank: 4 })
    expect(recordOpened).toHaveBeenCalledWith({
      userId: 'viewer-1',
      postId: 'post-1',
      platform: 'web',
      rank: 4,
    })
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
