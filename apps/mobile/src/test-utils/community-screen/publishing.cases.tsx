import {
  UPLOAD_URL,
  PIXEL,
  IMAGE_REFERENCE_NOW,
  item,
  feed,
  CHALLENGE,
  feedJson,
  feedUrls,
  serveFeed,
} from './harness'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { render } from 'vitest-browser-react'
import { expect, it, vi } from 'vitest'
import { CommunityScreen } from '@/src/features/community/community-screen'
import enUS from '@/assets/locales/en-US.json'
import i18n from '@/src/lib/i18n'
import { press } from '@/src/test-utils/press'
import { server } from '@/src/test-utils/msw/server'
import { setMobileAccessTokenResolver } from '@/src/lib/mobile-auth'

export function registerCommunityPublishingCases() {
  // --- Compose --------------------------------------------------------------

  it('6.1-MOB-018 publishes a flat body with confirmed alt text on one idempotency key', async () => {
    const suggestion = 'A layered outfit photographed against a plain wall.'
    const seen: Record<string, unknown> = {}
    server.use(
      http.post('*/api/v1/community/posts/allocate', async ({ request }) => {
        seen.allocateBody = await request.json()
        seen.allocateKey = request.headers.get('idempotency-key')
        return HttpResponse.json({
          data: {
            postId: 'post-new-42',
            uploadSessionId: 'session-42',
            uploadUrl: UPLOAD_URL,
            uploadToken: 'token-42',
            requiredHeaders: { 'content-type': 'image/jpeg' },
            expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
            altTextSuggestion: suggestion,
            altTextSuggestionLocale: 'en-US',
          },
        })
      }),
      http.put(UPLOAD_URL, () => new HttpResponse(null, { status: 200 })),
      http.post('*/api/v1/community/posts/publish', async ({ request }) => {
        seen.publishBody = await request.json()
        seen.publishKey = request.headers.get('idempotency-key')
        return HttpResponse.json({
          data: item({
            id: 'post-new-42',
            status: 'pending_review',
            publishedAt: null,
            author: { displayName: 'You', isSelf: true },
          }),
        })
      })
    )

    await render(<CommunityScreen />)
    press(await screen.findByTestId('community-new-post-button'))
    await screen.findByTestId('community-post-sheet')

    press(screen.getByTestId('community-pick-image-button'))
    await screen.findByTestId('community-post-preview-image')

    // The suggestion is the SERVER's, landed in a field the author can edit.
    const altInput = screen.getByTestId<HTMLTextAreaElement>('community-alt-text-input')
    await waitFor(() => expect(altInput.value).toBe(suggestion))

    const publishButton = screen.getByTestId('community-publish-button')
    expect(publishButton.getAttribute('aria-disabled')).toBe('true')

    const captionInput = screen.getByTestId('community-caption-input')
    fireEvent.change(captionInput, { target: { value: 'Look at https://bad-link.com' } })
    expect((await screen.findByTestId('community-caption-error')).textContent).toBe(
      enUS.community.validation.captionUrl
    )

    fireEvent.change(captionInput, { target: { value: 'Ask me at me@example.xyz' } })
    await waitFor(() =>
      expect(screen.getByTestId('community-caption-error').textContent).toBe(
        enUS.community.validation.captionEmail
      )
    )

    fireEvent.change(captionInput, { target: { value: 'Clean aesthetic daily style' } })
    await waitFor(() =>
      expect(screen.queryByTestId('community-caption-error')).toBeNull()
    )

    expect(publishButton.getAttribute('aria-disabled')).toBe('true')
    press(screen.getByTestId('community-confirm-alt-text'))
    await waitFor(() =>
      expect(publishButton.getAttribute('aria-disabled')).not.toBe('true')
    )

    press(publishButton)

    await waitFor(() => expect(seen.publishBody).toBeTruthy())
    expect(seen.publishBody).toEqual({
      postId: 'post-new-42',
      uploadSessionId: 'session-42',
      altText: suggestion,
      altTextConfirmed: true,
      caption: 'Clean aesthetic daily style',
      locale: 'en-US',
    })
    expect(seen.allocateBody).toEqual({
      locale: 'en-US',
      contentType: 'image/jpeg',
      byteSize: 4,
      sha256: '0'.repeat(64),
      widthPx: 1200,
      heightPx: 1200,
    })
    expect(seen.allocateKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    )
    // One key per attempt, so a retry replays the session instead of allocating a second.
    expect(seen.publishKey).toBe(seen.allocateKey)

    await waitFor(() => expect(screen.queryByTestId('community-post-sheet')).toBeNull())
    expect(screen.getByTestId('deep-link-info-banner').textContent).toContain(
      enUS.community.compose.success
    )
  })

  it('6.1-MOB-019 aborts the publish when the byte upload fails', async () => {
    let publishCalls = 0
    server.use(
      http.put(UPLOAD_URL, () => new HttpResponse(null, { status: 500 })),
      http.post('*/api/v1/community/posts/publish', () => {
        publishCalls += 1
        return HttpResponse.json({ data: item() })
      })
    )

    await render(<CommunityScreen />)
    press(await screen.findByTestId('community-new-post-button'))
    await screen.findByTestId('community-post-sheet')

    press(screen.getByTestId('community-pick-image-button'))

    const error = await screen.findByTestId('community-publish-error')
    expect(error.textContent).toBe(enUS.community.error.upload)
    // Never fall through to publish against bytes that never landed.
    expect(publishCalls).toBe(0)
    expect(
      screen.getByTestId('community-publish-button').getAttribute('aria-disabled')
    ).toBe('true')
  })

  it('6.1-MOB-020 screens the caption and alt text in the reader’s own locale', async () => {
    await i18n.changeLanguage('fr-FR')
    const seen: Record<string, unknown> = {}
    server.use(
      http.post('*/api/v1/community/posts/allocate', async ({ request }) => {
        seen.allocateBody = await request.json()
        return HttpResponse.json({
          data: {
            postId: 'post-fr',
            uploadSessionId: 'session-fr',
            uploadUrl: UPLOAD_URL,
            uploadToken: 'token-fr',
            requiredHeaders: { 'content-type': 'image/jpeg' },
            expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
            altTextSuggestion: 'Un manteau de laine sur une maille crème.',
            altTextSuggestionLocale: 'fr-FR',
          },
        })
      }),
      http.put(UPLOAD_URL, () => new HttpResponse(null, { status: 200 })),
      http.post('*/api/v1/community/posts/publish', async ({ request }) => {
        seen.publishBody = await request.json()
        return HttpResponse.json({ data: item({ id: 'post-fr' }) })
      })
    )

    await render(<CommunityScreen />)
    press(await screen.findByTestId('community-new-post-button'))
    await screen.findByTestId('community-post-sheet')

    press(screen.getByTestId('community-pick-image-button'))
    await screen.findByTestId('community-post-preview-image')
    await waitFor(() =>
      expect(
        screen.getByTestId<HTMLTextAreaElement>('community-alt-text-input').value
      ).toContain('manteau')
    )

    press(screen.getByTestId('community-confirm-alt-text'))
    await waitFor(() =>
      expect(
        screen.getByTestId('community-publish-button').getAttribute('aria-disabled')
      ).not.toBe('true')
    )
    press(screen.getByTestId('community-publish-button'))

    await waitFor(() => expect(seen.publishBody).toBeTruthy())
    // Hardcoding 'en-US' here screened every non-English caption as English.
    expect(seen.allocateBody).toMatchObject({ locale: 'fr-FR' })
    expect(seen.publishBody).toMatchObject({ locale: 'fr-FR' })
  })

  it('6.1-MOB-021 opts a look into the weekly challenge from the banner CTA', async () => {
    let publishBody: unknown = null
    serveFeed(() => feedJson({ activeChallenge: CHALLENGE }))
    server.use(
      http.put(UPLOAD_URL, () => new HttpResponse(null, { status: 200 })),
      http.post('*/api/v1/community/posts/publish', async ({ request }) => {
        publishBody = await request.json()
        return HttpResponse.json({ data: item({ id: 'post-challenge' }) })
      })
    )

    await render(<CommunityScreen />)

    const banner = await screen.findByTestId('community-challenge-banner')
    expect(banner.textContent).toContain(CHALLENGE.title)
    press(screen.getByTestId('community-challenge-cta'))

    await screen.findByTestId('community-post-sheet')
    press(screen.getByTestId('community-pick-image-button'))
    await screen.findByTestId('community-post-preview-image')
    const altInput = screen.getByTestId<HTMLTextAreaElement>('community-alt-text-input')
    await waitFor(() => expect(altInput.value.length).toBeGreaterThan(0))

    // Opening from the banner CTA opts the look in by default.
    const toggle = screen.getByTestId('community-post-challenge-toggle')
    expect(toggle.textContent).toContain('✓')
    expect(toggle.textContent).toContain(CHALLENGE.title)

    press(screen.getByTestId('community-confirm-alt-text'))
    await waitFor(() =>
      expect(
        screen.getByTestId('community-publish-button').getAttribute('aria-disabled')
      ).not.toBe('true')
    )
    press(screen.getByTestId('community-publish-button'))

    await waitFor(() => expect(publishBody).toBeTruthy())
    expect(publishBody).toMatchObject({ challengeId: CHALLENGE.id })
  })

  // --- Image expiry ---------------------------------------------------------

  it('6.1-MOB-022 bounds the signed-URL refetch at the expiry boundary and then says the image is unavailable', async () => {
    const expiresAt = IMAGE_REFERENCE_NOW + 60_000
    let expireImage: (() => void) | undefined
    let restoreTokenResolver: (() => void) | undefined
    const schedule = globalThis.setTimeout.bind(globalThis)
    const timer = vi
      .spyOn(globalThis, 'setTimeout')
      .mockImplementation((callback, ms, ...args: unknown[]) => {
        if (ms === 60_000 && typeof callback === 'function') {
          // Capture only the image deadline. Transport, React and retry backoff
          // retain their real timers, so no service-worker I/O is frozen.
          expireImage = () => callback(...args)
        }
        return schedule(callback, ms, ...args)
      })
    serveFeed(() =>
      HttpResponse.json({
        data: feed({
          items: [
            item({
              imageAccess: { url: PIXEL, expiresAt: new Date(expiresAt).toISOString() },
            }),
          ],
        }),
      })
    )
    try {
      await render(<CommunityScreen />)
      await screen.findByTestId('community-post-card-post-a')
      // A completed load restores the retry budget, so the first load has to land
      // before the deadline fires or it would grant one extra refetch.
      await screen.findByTestId('community-card-image-loaded-post-a')
      await waitFor(() => expect(expireImage).toBeTypeOf('function'))
      expect(feedUrls).toHaveLength(1)
      expect(screen.queryByTestId('community-card-image-unavailable-post-a')).toBeNull()
      // Every feed request awaits the access-token lookup before it is sent, so
      // the card can show its fallback before its last refetch reaches the
      // network. Slow that lookup on purpose: the request count below must be
      // waited for, never read in the same tick as the fallback (CI run on
      // cb3d07b8 read 2 of 3 under a loaded coverage run).
      restoreTokenResolver = setMobileAccessTokenResolver(
        () => new Promise((resolve) => schedule(() => resolve('session-token'), 500))
      )
      // Move exactly to the captured expiry deadline and fire its real callback.
      await act(async () => {
        vi.mocked(Date.now).mockReturnValue(expiresAt)
        expireImage!()
        await Promise.resolve()
      })
      await screen.findByTestId('community-card-image-unavailable-post-a', undefined, {
        timeout: 10_000,
      })
      expect(screen.getByTestId('community-card-image-retry-post-a')).toBeTruthy()
      expect(
        screen.getByTestId('community-card-image-unavailable-post-a').textContent
      ).toContain(enUS.community.card.imageUnavailable)
      // The fallback shows as the second refetch starts; wait for that request
      // to arrive, then make sure the spent budget allows no further one.
      await waitFor(() => expect(feedUrls).toHaveLength(3))
      await new Promise((resolve) => schedule(resolve, 1_000))
      expect(feedUrls).toHaveLength(3)
      expect(Date.now()).toBe(expiresAt)
    } finally {
      restoreTokenResolver?.()
      timer.mockRestore()
      vi.mocked(Date.now).mockReturnValue(IMAGE_REFERENCE_NOW)
    }
  }, 20_000)
}
