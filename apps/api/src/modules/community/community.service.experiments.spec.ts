// Learning path Step 38: Community feed by climate band.
/* eslint-disable @typescript-eslint/no-unsafe-assignment -- assertions nest expect.objectContaining() and vi.fn() members, which is the established pattern for these suites. */
import { describe, expect, it } from 'vitest'
import {
  COMMUNITY_CURSOR_INVALID_MESSAGE,
  encodeCommunityFeedCursor,
} from '@couture/api-client/contracts/http'
import {
  viewerUserId,
  publishedPost,
  createService,
  registerCommunityServiceLifecycle,
} from '../../testing/community/community-service.fixture'

describe('CommunityService experiment identity', () => {
  registerCommunityServiceLifecycle()

  // `dedupe_key` is a declared property on all three of these event schemas and
  // travels to the analytics sink, while every community event is in
  // `PSEUDONYMOUS_EVENT_TYPES`: `user_id` is nulled on the persisted row and
  // `distinctId` is an HMAC. A raw user id inside the key would therefore land on
  // the same row as the pseudonym meant to hide it, making that row a
  // self-contained join back to the person. It does not weaken the pseudonymity,
  // it undoes it, which is the same defect as a user id in an object path.
  //
  // These assert the MECHANISM, not the current token format, so they still fail
  // if someone reintroduces the id alongside a token later.
  describe('dedupe keys never carry a raw user id', () => {
    const rawUserId = 'user-viewer-456-raw-identity'

    it('keeps the reporter out of the report key', async () => {
      const { service, captureEvent, recordReport } = createService()
      recordReport.mockResolvedValueOnce({ kind: 'created' })

      await service.reportPost({
        userId: rawUserId,
        postId: 'other-post',
        platform: 'web',
        input: { reason: 'spam' },
      })

      const call = captureEvent.mock.calls.find(
        (entry) => entry[1] === 'community_post_reported'
      )
      const { dedupeKey } = call?.[2] as { dedupeKey: string }
      expect(dedupeKey).not.toContain(rawUserId)
      // The post is still in the key, so two reporters on one post stay two
      // events and a replayed report still collapses.
      expect(dedupeKey).toContain('other-post')
    })

    it('keeps the viewer out of the card-open key', async () => {
      const { service, findPostById, captureEvent } = createService()
      findPostById.mockResolvedValueOnce(publishedPost)

      await service.recordCardOpened({
        userId: rawUserId,
        postId: 'post-other-user',
        platform: 'web',
        input: { experimentVariant: 'auto' },
      })

      const call = captureEvent.mock.calls.find(
        (entry) => entry[1] === 'community_card_opened'
      )
      const { dedupeKey } = call?.[2] as { dedupeKey: string }
      expect(dedupeKey).not.toContain(rawUserId)
      expect(dedupeKey).toContain('post-other-user')
    })

    it('still distinguishes two viewers, so the tokenization did not collapse the key', async () => {
      // The whole reason the viewer is in this key: without it the sink's upsert
      // folds every viewer's open of one post into a single event and the
      // non-self lift the beta gate advances on cannot exceed one per post.
      const { service, findPostById, captureEvent } = createService()
      findPostById.mockResolvedValue(publishedPost)

      await service.recordCardOpened({
        userId: 'raw-viewer-alpha',
        postId: 'post-other-user',
        platform: 'web',
        input: { experimentVariant: 'auto' },
      })
      await service.recordCardOpened({
        userId: 'raw-viewer-beta',
        postId: 'post-other-user',
        platform: 'web',
        input: { experimentVariant: 'auto' },
      })

      const keys = captureEvent.mock.calls
        .filter((entry) => entry[1] === 'community_card_opened')
        .map((entry) => (entry[2] as { dedupeKey: string }).dedupeKey)
      expect(keys[0]).not.toBe(keys[1])
    })

    it('produces the same key twice for one viewer, so a retry still collapses', async () => {
      const { service, findPostById, captureEvent } = createService()
      findPostById.mockResolvedValue(publishedPost)

      for (let attempt = 0; attempt < 2; attempt += 1) {
        await service.recordCardOpened({
          userId: rawUserId,
          postId: 'post-other-user',
          platform: 'web',
          input: { experimentVariant: 'auto' },
        })
      }

      const keys = captureEvent.mock.calls
        .filter((entry) => entry[1] === 'community_card_opened')
        .map((entry) => (entry[2] as { dedupeKey: string }).dedupeKey)
      expect(keys[0]).toBe(keys[1])
    })
  })
  describe('beta experiment assignment binds to what is served', () => {
    // Stable, derived from the user id: `viewer-all` hashes into the `all` arm
    // and `user-viewer-1` into the `auto` arm. Pinned here so the intent of each
    // test is readable without recomputing a digest.
    const allArmViewer = 'viewer-all'

    it('serves the all-region feed to an all-arm viewer who requested auto', async () => {
      // THE DEFECT THIS COVERS: the variant used to be computed after the query
      // and read only by telemetry and the response, so both arms were served
      // whatever the client asked for. A lift measured between two arms that
      // receive the identical feed is noise, which made the story's own advance
      // condition unmeasurable at any traffic volume.
      const { service, findPublishedFeedPosts } = createService()

      const result = await service.getFeed({
        userId: allArmViewer,
        platform: 'web',
        mode: 'auto',
      })

      expect(result.experimentVariant).toBe('all')
      expect(findPublishedFeedPosts).toHaveBeenCalledWith(
        expect.objectContaining({ filterBand: undefined, mode: 'all' })
      )
    })

    it('reports the mode SERVED, not the mode requested', async () => {
      // Without this the two arms are indistinguishable in the data even once
      // they are served differently.
      const { service, captureEvent } = createService()

      const result = await service.getFeed({
        userId: allArmViewer,
        platform: 'web',
        mode: 'auto',
      })

      expect(result.mode).toBe('all')
      expect(captureEvent).toHaveBeenCalledWith(
        allArmViewer,
        'community_feed_viewed',
        expect.objectContaining({ filterMode: 'all', experimentVariant: 'all' })
      )
    })

    it('serves band resolution to an auto-arm viewer who requested auto', async () => {
      const { service, findPublishedFeedPosts } = createService()

      const result = await service.getFeed({
        userId: viewerUserId,
        platform: 'web',
        mode: 'auto',
      })

      expect(result.experimentVariant).toBe('auto')
      expect(result.mode).toBe('auto')
      expect(findPublishedFeedPosts).toHaveBeenCalledWith(
        expect.objectContaining({ filterBand: 'temperate_dry', mode: 'auto' })
      )
    })

    it('lets an explicit band request win over the assignment', async () => {
      // A band chip is a user action. An assignment that silently overrode it
      // would mean the filter did not work for half the population, which is a
      // worse defect than an unmeasurable experiment.
      const { service, findPublishedFeedPosts } = createService()

      const result = await service.getFeed({
        userId: allArmViewer,
        platform: 'web',
        mode: 'cold_wet',
      })

      expect(result.mode).toBe('cold_wet')
      expect(result.experimentVariant).toBe('all')
      expect(findPublishedFeedPosts).toHaveBeenCalledWith(
        expect.objectContaining({ filterBand: 'cold_wet', mode: 'cold_wet' })
      )
    })

    it('lets an explicit all request stand for an auto-arm viewer', async () => {
      const { service, findPublishedFeedPosts } = createService()

      const result = await service.getFeed({
        userId: viewerUserId,
        platform: 'web',
        mode: 'all',
      })

      expect(result.mode).toBe('all')
      expect(result.experimentVariant).toBe('auto')
      expect(findPublishedFeedPosts).toHaveBeenCalledWith(
        expect.objectContaining({ filterBand: undefined })
      )
    })

    it('accepts a page-two cursor minted under the effective mode', async () => {
      // The client re-sends `auto`; the cursor it was handed says `all`. The
      // assignment is stable, so the server resolves `auto` to `all` again and
      // the keyset matches. Binding the cursor to the REQUESTED mode would 400
      // every second page for half the population.
      const { service, findPublishedFeedPosts } = createService()
      const pageTwo = encodeCommunityFeedCursor({
        publishedAt: '2026-09-05T12:00:00.000Z',
        id: 'post-other-user',
        mode: 'all',
        // `all` filters on nothing, so the page was served unfiltered and the
        // cursor records that as `null` rather than omitting the field.
        band: null,
      })

      await service.getFeed({
        userId: allArmViewer,
        platform: 'web',
        mode: 'auto',
        cursor: pageTwo,
      })

      expect(findPublishedFeedPosts).toHaveBeenCalledWith(
        expect.objectContaining({
          cursor: expect.objectContaining({ mode: 'all' }) as unknown,
        })
      )
    })

    it('rejects a cursor minted under a mode the viewer is not being served', async () => {
      const { service } = createService()
      const foreignCursor = encodeCommunityFeedCursor({
        publishedAt: '2026-09-05T12:00:00.000Z',
        id: 'post-other-user',
        mode: 'cold_wet',
        band: 'cold_wet',
      })

      await expect(
        service.getFeed({
          userId: allArmViewer,
          platform: 'web',
          mode: 'auto',
          cursor: foreignCursor,
        })
      ).rejects.toThrow(COMMUNITY_CURSOR_INVALID_MESSAGE)
    })

    // HIGH-9: binding the mode alone left a real hole open. Under `auto` the
    // band is recomputed per request from weather guaranteed fresh only within
    // 60 minutes, so it can move mid-scroll while `mode` stays `auto` the whole
    // time and nothing notices.
    it('rejects a cursor whose band no longer matches the one being filtered on', async () => {
      // Page one was served on `cold_dry`; this viewer now resolves to
      // `temperate_dry`. Applying page one's keyset to the new filtered set
      // would skip everything newer in the new band for the rest of the scroll.
      const { service } = createService()
      const staleBandCursor = encodeCommunityFeedCursor({
        publishedAt: '2026-09-05T12:00:00.000Z',
        id: 'post-sample-1',
        mode: 'auto',
        band: 'cold_dry',
      })

      await expect(
        service.getFeed({
          userId: viewerUserId,
          platform: 'web',
          mode: 'auto',
          cursor: staleBandCursor,
        })
      ).rejects.toThrow(COMMUNITY_CURSOR_INVALID_MESSAGE)
    })

    it('rejects an unfiltered cursor once the band has resolved', async () => {
      // The other half of the same failure: page one was served with no band at
      // all because resolution failed, and page two would silently become the
      // filtered feed under the same cursor. `null` is a real assertion about
      // page one, not an absence.
      const { service } = createService()
      const unfilteredCursor = encodeCommunityFeedCursor({
        publishedAt: '2026-09-05T12:00:00.000Z',
        id: 'post-sample-1',
        mode: 'auto',
        band: null,
      })

      await expect(
        service.getFeed({
          userId: viewerUserId,
          platform: 'web',
          mode: 'auto',
          cursor: unfilteredCursor,
        })
      ).rejects.toThrow(COMMUNITY_CURSOR_INVALID_MESSAGE)
    })

    it('accepts an unfiltered cursor while the band is still unresolved', async () => {
      // The legitimate case the `null` has to stay distinguishable for: a viewer
      // whose band never resolves pages the all-regions feed, and every page is
      // minted and validated as unfiltered.
      const { service, findPublishedFeedPosts } = createService({
        weatherStatus: 'unavailable',
      })
      const unfilteredCursor = encodeCommunityFeedCursor({
        publishedAt: '2026-09-05T12:00:00.000Z',
        id: 'post-sample-1',
        mode: 'auto',
        band: null,
      })

      await service.getFeed({
        userId: viewerUserId,
        platform: 'web',
        mode: 'auto',
        cursor: unfilteredCursor,
      })

      expect(findPublishedFeedPosts).toHaveBeenCalledWith(
        expect.objectContaining({ filterBand: undefined })
      )
    })
  })
})
