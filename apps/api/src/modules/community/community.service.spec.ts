// Learning path Step 38: Community feed by climate band.
/* eslint-disable @typescript-eslint/no-unsafe-assignment -- assertions nest expect.objectContaining() and vi.fn() members, which is the established pattern for these suites. */
import { ServiceUnavailableException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  COMMUNITY_CURSOR_INVALID_MESSAGE,
  communityFeedItemSchema,
  communityFeedSchema,
  encodeCommunityFeedCursor,
} from '@couture/api-client/contracts/http'
import {
  SERVICE_REFERENCE_TIME,
  viewerUserId,
  mockLocation,
  secondaryLocation,
  mockDailySummaries,
  publishedPost,
  ownPendingPost,
  mockChallenge,
  createService,
  registerCommunityServiceLifecycle,
} from '../../testing/community/community-service.fixture'

describe('CommunityService feed', () => {
  registerCommunityServiceLifecycle()

  describe('rollout gates', () => {
    it('gates the feed on community_read_enabled', async () => {
      const { service, getFeatureFlag, findViewerLocations } = createService({
        flagEnabled: false,
      })

      await expect(
        service.getFeed({ userId: viewerUserId, platform: 'web' })
      ).rejects.toThrow(ServiceUnavailableException)

      expect(getFeatureFlag).toHaveBeenCalledWith('community_read_enabled', viewerUserId)
      expect(findViewerLocations).not.toHaveBeenCalled()
    })

    it('gates writes on community_write_enabled, separately from reads', async () => {
      // Read and write roll out separately: viewers can browse the beta before
      // anyone can post into it.
      const { service, getFeatureFlag } = createService({ flagEnabled: false })

      await expect(
        service.publishPost({
          userId: viewerUserId,
          role: 'adult',
          platform: 'web',
          input: {
            postId: 'post-mine',
            uploadSessionId: 'session-1',
            altText: 'A denim jacket over a striped shirt',
            altTextConfirmed: true as const,
            caption: 'Autumn commute look',
            locale: 'en-US' as const,
          },
        })
      ).rejects.toThrow(ServiceUnavailableException)

      expect(getFeatureFlag).toHaveBeenCalledWith('community_write_enabled', viewerUserId)
    })

    // Closing posting must not take away the two things a reader needs while the
    // feed is still being served: the ability to report what they are seeing,
    // and the ability of an author to pull their own post. Both used to sit
    // behind the write flag, so an operator closing posting during an incident
    // silenced abuse reports at the moment they mattered most.
    it('keeps reporting available when posting is closed but the feed is still served', async () => {
      const { service, getFeatureFlag, recordReport } = createService()
      getFeatureFlag.mockImplementation((key: string) =>
        Promise.resolve(key === 'community_read_enabled')
      )

      await expect(
        service.reportPost({
          userId: viewerUserId,
          postId: 'other-post',
          platform: 'web',
          input: { reason: 'spam' },
        })
      ).resolves.toEqual({ tracked: true })

      expect(getFeatureFlag).toHaveBeenCalledWith('community_read_enabled', viewerUserId)
      expect(getFeatureFlag).not.toHaveBeenCalledWith(
        'community_write_enabled',
        viewerUserId
      )
      expect(recordReport).toHaveBeenCalled()
    })

    it('keeps an author able to withdraw their own post when posting is closed', async () => {
      const { service, getFeatureFlag, findPostById, withdrawPostAndRequestErasure } =
        createService()
      getFeatureFlag.mockImplementation((key: string) =>
        Promise.resolve(key === 'community_read_enabled')
      )
      findPostById.mockResolvedValueOnce({ ...publishedPost, user_id: viewerUserId })

      await expect(
        service.withdrawPost({
          userId: viewerUserId,
          postId: 'post-mine',
          platform: 'web',
        })
      ).resolves.toEqual({ tracked: true })

      expect(withdrawPostAndRequestErasure).toHaveBeenCalled()
    })

    it('closes reporting and withdrawal when the feed itself is dark', async () => {
      // The flag that silences reports has to be the one that also stops
      // serving the content, so a fully dark feed still closes both.
      const { service } = createService({ flagEnabled: false })

      await expect(
        service.reportPost({
          userId: viewerUserId,
          postId: 'other-post',
          platform: 'web',
          input: { reason: 'spam' },
        })
      ).rejects.toThrow(ServiceUnavailableException)

      await expect(
        service.withdrawPost({
          userId: viewerUserId,
          postId: 'post-mine',
          platform: 'web',
        })
      ).rejects.toThrow(ServiceUnavailableException)
    })
  })

  describe('cursor decoding and validation', () => {
    it('throws BadRequestException (400) when the cursor is malformed', async () => {
      const { service } = createService()

      await expect(
        service.getFeed({
          userId: viewerUserId,
          platform: 'web',
          cursor: 'not-a-valid-cursor',
        })
      ).rejects.toThrow(COMMUNITY_CURSOR_INVALID_MESSAGE)
    })

    it('decodes a valid cursor and passes the decoded payload to the repository', async () => {
      const { service, findPublishedFeedPosts } = createService()
      const cursorPayload = {
        publishedAt: '2026-09-05T12:00:00.000Z',
        id: 'post-sample-1',
        mode: 'auto' as const,
        // The band the page was actually filtered on. The default viewer
        // resolves to `temperate_dry`, and `auto` filters on the viewer's band.
        band: 'temperate_dry' as const,
      }

      await service.getFeed({
        userId: viewerUserId,
        platform: 'web',
        mode: 'auto',
        cursor: encodeCommunityFeedCursor(cursorPayload),
      })

      expect(findPublishedFeedPosts).toHaveBeenCalledWith(
        expect.objectContaining({ cursor: cursorPayload, mode: 'auto' })
      )
    })

    it('rejects a cursor minted under a different filter mode', async () => {
      // Paging one feed with another feed's keyset would silently skip or repeat
      // posts, so a changed filter restarts paging instead.
      const { service } = createService()
      const otherModeCursor = encodeCommunityFeedCursor({
        publishedAt: '2026-09-05T12:00:00.000Z',
        id: 'post-sample-1',
        mode: 'cold_wet',
        band: 'cold_wet',
      })

      await expect(
        service.getFeed({
          userId: viewerUserId,
          platform: 'web',
          mode: 'auto',
          cursor: otherModeCursor,
        })
      ).rejects.toThrow(COMMUNITY_CURSOR_INVALID_MESSAGE)
    })

    it('accepts a well-formed cursor that points past the end of the feed', async () => {
      const { service, findPublishedFeedPosts } = createService({
        posts: [],
        authorPosts: [],
        nextCursor: null,
      })
      const staleCursor = encodeCommunityFeedCursor({
        publishedAt: '2020-01-01T00:00:00.000Z',
        id: 'post-long-gone',
        mode: 'auto',
        band: 'temperate_dry',
      })

      const result = await service.getFeed({
        userId: viewerUserId,
        platform: 'web',
        cursor: staleCursor,
      })

      expect(result.items).toEqual([])
      expect(result.nextCursor).toBeNull()
      expect(findPublishedFeedPosts).toHaveBeenCalled()
    })
  })

  describe('viewer climate band resolution and unresolved reasons', () => {
    it('resolves the band from the first location with usable weather', async () => {
      const { service } = createService()
      const result = await service.getFeed({ userId: viewerUserId, platform: 'web' })

      expect(result.bandResolved).toBe(true)
      expect(result.viewerBand).toBe('temperate_dry')
      expect(result.bandUnresolvedReason).toBeNull()
    })

    it('walks to the next saved location when the first has no usable weather', async () => {
      const { service, getLatestWeather } = createService({
        locations: [mockLocation, secondaryLocation],
      })
      getLatestWeather.mockResolvedValueOnce({ status: 'stale', data: null })

      const result = await service.getFeed({ userId: viewerUserId, platform: 'web' })

      expect(getLatestWeather).toHaveBeenNthCalledWith(1, 'new-york-ny')
      expect(getLatestWeather).toHaveBeenNthCalledWith(2, 'lisbon-pt')
      expect(result.bandResolved).toBe(true)
    })

    it.each([
      ['no saved locations', { locations: [] }, 'no_location'],
      ['stale weather', { weatherStatus: 'stale' as const }, 'weather_stale'],
      [
        'unavailable weather',
        { weatherStatus: 'unavailable' as const },
        'weather_unavailable',
      ],
      ['an empty forecast', { dailySummaries: [] }, 'weather_malformed'],
      [
        'fewer than three usable days',
        { dailySummaries: [mockDailySummaries[0]] },
        'insufficient_usable_days',
      ],
    ])(
      'reports %s as bandUnresolvedReason %s',
      async (_label, options, expectedReason) => {
        // Clients render their localized banner from this, so it is populated
        // honestly rather than defaulted.
        const { service } = createService(options)
        const result = await service.getFeed({ userId: viewerUserId, platform: 'web' })

        expect(result.bandResolved).toBe(false)
        expect(result.viewerBand).toBeNull()
        expect(result.bandUnresolvedReason).toBe(expectedReason)
      }
    )
  })

  describe('filter modes', () => {
    it('pins the feed to a named band', async () => {
      const { service, findPublishedFeedPosts } = createService()
      const result = await service.getFeed({
        userId: viewerUserId,
        platform: 'web',
        mode: 'cold_wet',
      })

      expect(result.viewerBand).toBe('temperate_dry')
      expect(result.mode).toBe('cold_wet')
      expect(findPublishedFeedPosts).toHaveBeenCalledWith(
        expect.objectContaining({ filterBand: 'cold_wet' })
      )
    })

    it('returns every region for mode all', async () => {
      // `all` is a real requestable mode, not a fallback: the beta experiment
      // assigns half the viewers to it and both arms have to be requestable.
      const { service, findPublishedFeedPosts } = createService()
      await service.getFeed({ userId: viewerUserId, platform: 'web', mode: 'all' })

      expect(findPublishedFeedPosts).toHaveBeenCalledWith(
        expect.objectContaining({ filterBand: undefined })
      )
    })

    it('follows the viewer band under mode auto', async () => {
      const { service, findPublishedFeedPosts } = createService()
      await service.getFeed({ userId: viewerUserId, platform: 'web', mode: 'auto' })

      expect(findPublishedFeedPosts).toHaveBeenCalledWith(
        expect.objectContaining({ filterBand: 'temperate_dry' })
      )
    })

    it('falls back to every region under auto when the band is unresolved', async () => {
      const { service, findPublishedFeedPosts } = createService({ locations: [] })
      await service.getFeed({ userId: viewerUserId, platform: 'web', mode: 'auto' })

      expect(findPublishedFeedPosts).toHaveBeenCalledWith(
        expect.objectContaining({ filterBand: undefined })
      )
    })
  })

  describe('public items and author states', () => {
    it('keeps the author own non-published posts out of items', async () => {
      const { service } = createService()
      const result = await service.getFeed({ userId: viewerUserId, platform: 'web' })

      expect(result.items.map((item) => item.id)).toEqual(['post-other-user'])
      expect(result.authorStates.map((state) => state.id)).toEqual(['post-self-user'])
    })

    it('carries moderationReason on author states so a recovery state is visible', async () => {
      const { service } = createService({
        authorPosts: [
          {
            ...ownPendingPost,
            status: 'flagged' as never,
            moderation_reason: 'screening_unavailable',
          },
        ],
      })

      const result = await service.getFeed({ userId: viewerUserId, platform: 'web' })
      expect(result.authorStates[0]?.moderationReason).toBe('screening_unavailable')
    })

    it('renders an author state with no signable object as a null imageAccess', async () => {
      // The public projection has no way to say "this post is here but its media
      // is gone"; the author's own section does, and that is where the localized
      // removed-content notice comes from.
      const { service, signReadUrls } = createService()
      signReadUrls.mockResolvedValue(new Map())

      const result = await service.getFeed({ userId: viewerUserId, platform: 'web' })

      expect(result.items).toEqual([])
      expect(result.authorStates[0]?.imageAccess).toBeNull()
    })

    it('produces a whole feed the response schema accepts', async () => {
      const { service } = createService()
      const result = await service.getFeed({ userId: viewerUserId, platform: 'web' })

      expect(() => communityFeedSchema.parse(result)).not.toThrow()
      for (const item of result.items) {
        expect(() => communityFeedItemSchema.parse(item)).not.toThrow()
      }
    })
  })

  describe('author pseudonym and privacy constraints', () => {
    it('serves the persisted alias and never the raw user id', async () => {
      const { service, resolveAliases } = createService()
      const result = await service.getFeed({ userId: viewerUserId, platform: 'web' })

      const otherPost = result.items[0]!
      expect(resolveAliases).toHaveBeenCalledWith(
        ['user-author-999'],
        expect.any(Function)
      )
      expect(otherPost.author.isSelf).toBe(false)
      expect(otherPost.author.displayName).toBe('Style Explorer ALIAS-user-author-999')
      expect(otherPost.id).not.toContain('user-author-999')
      expect(JSON.stringify(otherPost.imageAccess)).not.toContain('user-author-999')
      expect(JSON.stringify(otherPost)).not.toContain('new-york-ny')
    })

    it('keeps the raw user id out of the object path and the signed URL', async () => {
      const { service } = createService()
      const result = await service.getFeed({ userId: viewerUserId, platform: 'web' })

      for (const item of result.items) {
        expect(item.imageAccess.url).not.toContain('user-author-999')
        expect(item.imageAccess.url).not.toContain(viewerUserId)
      }
    })

    it('labels the viewer own post You', async () => {
      const { service } = createService({
        posts: [{ ...publishedPost, user_id: viewerUserId }],
      })
      const result = await service.getFeed({ userId: viewerUserId, platform: 'web' })

      expect(result.items[0]?.author).toEqual({ displayName: 'You', isSelf: true })
    })
  })

  describe('signed image URLs', () => {
    beforeEach(() => vi.setSystemTime(SERVICE_REFERENCE_TIME))
    it('signs each section in one call with a matching expiresAt', async () => {
      const { service, signReadUrls } = createService()
      const result = await service.getFeed({ userId: viewerUserId, platform: 'web' })

      // Two calls, one per section, rather than one per item: the old shape cost
      // up to thirty storage round trips for a single page.
      expect(signReadUrls).toHaveBeenCalledTimes(2)
      expect(signReadUrls).toHaveBeenCalledWith(
        ['community/post-other-user/aaa.jpg'],
        900
      )

      const expiryDate = new Date(result.items[0]!.imageAccess.expiresAt)
      expect(expiryDate.toISOString()).toBe('2026-09-05T12:15:00.000Z')
    })
  })

  describe('active challenge resolution', () => {
    it('resolves localized copy for the requested language', async () => {
      const { service, findActiveChallenge } = createService()
      const result = await service.getFeed({
        userId: viewerUserId,
        platform: 'web',
        acceptLanguage: 'fr-FR',
      })

      expect(findActiveChallenge).toHaveBeenCalledWith('temperate_dry')
      expect(result.activeChallenge).toEqual({
        id: 'challenge-100',
        slug: 'autumn-layers-2026',
        climateBand: 'temperate_dry',
        title: 'Defi Superpositions Automnales',
        body: 'Partagez vos tenues de saison.',
        startsAt: '2026-09-01T00:00:00.000Z',
        endsAt: '2026-09-08T00:00:00.000Z',
        timeZone: 'Europe/Istanbul',
      })
    })

    it('falls back to en-US copy when the requested language has no translation', async () => {
      const { service } = createService()
      const result = await service.getFeed({
        userId: viewerUserId,
        platform: 'web',
        acceptLanguage: 'ja-JP',
      })

      expect(result.activeChallenge?.title).toBe('Autumn Layers Challenge')
    })

    it('serves the default locale copy when no Accept-Language header is sent', async () => {
      const { service } = createService()
      const result = await service.getFeed({ userId: viewerUserId, platform: 'web' })

      expect(result.activeChallenge?.title).toBe('Autumn Layers Challenge')
    })

    it('returns activeChallenge: null when there is no active challenge', async () => {
      const { service } = createService({ challenge: null })
      const result = await service.getFeed({ userId: viewerUserId, platform: 'web' })

      expect(result.activeChallenge).toBeNull()
    })

    it('drops a malformed challenge to null instead of failing the whole feed', async () => {
      // An empty body fails `embeddedCommunityChallengeSchema`, which used to
      // surface as a 500 on every feed request for every viewer.
      const { service } = createService({
        challenge: { ...mockChallenge, copy: { 'en-US': { title: 'Broken', body: '' } } },
      })

      const result = await service.getFeed({ userId: viewerUserId, platform: 'web' })

      expect(result.activeChallenge).toBeNull()
      expect(result.items.length).toBe(1)
    })
  })

  describe('feed telemetry', () => {
    it('emits a payload the real closed-enum validator accepts', async () => {
      const { service, captureEvent, telemetryFailures } = createService()
      await service.getFeed({ userId: viewerUserId, platform: 'mobile' })

      expect(telemetryFailures).toEqual([])
      expect(captureEvent).toHaveBeenCalledWith(
        viewerUserId,
        'community_feed_viewed',
        expect.objectContaining({
          platform: 'mobile',
          climateBand: 'temperate_dry',
          bandResolved: true,
          filterMode: 'auto',
          itemCount: 1,
          isEmpty: false,
          dedupeKey: expect.any(String),
          experimentVariant: expect.stringMatching(/^(auto|all)$/),
        })
      )
    })

    it('reports the VIEWER band, never the requested filter', async () => {
      // Reporting the filter would make the unresolved-band guardrail
      // unmeasurable: an unresolved viewer browsing a pinned band would look
      // resolved.
      const { service, captureEvent } = createService({ locations: [] })
      await service.getFeed({ userId: viewerUserId, platform: 'web', mode: 'cold_wet' })

      expect(captureEvent).toHaveBeenCalledWith(
        viewerUserId,
        'community_feed_viewed',
        expect.objectContaining({
          climateBand: null,
          bandResolved: false,
          filterMode: 'cold_wet',
        })
      )
    })

    it('never puts the raw user id in the dedupe key', async () => {
      const { service, captureEvent } = createService()
      await service.getFeed({ userId: viewerUserId, platform: 'web' })

      const props = captureEvent.mock.calls[0]![2] as { dedupeKey: string }
      expect(props.dedupeKey).not.toContain(viewerUserId)
    })

    it('assigns a stable experiment variant', async () => {
      const { service } = createService()
      const first = await service.getFeed({ userId: viewerUserId, platform: 'web' })
      const second = await service.getFeed({ userId: viewerUserId, platform: 'web' })

      expect(first.experimentVariant).toBe(second.experimentVariant)
    })

    it('fails open when telemetry capture fails', async () => {
      const { service, captureEvent } = createService()
      captureEvent.mockRejectedValueOnce(new Error('Telemetry service offline'))

      const result = await service.getFeed({ userId: viewerUserId, platform: 'web' })

      expect(result.items.length).toBe(1)
    })
  })
})
