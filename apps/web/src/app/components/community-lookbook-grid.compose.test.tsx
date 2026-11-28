// Community grid journeys through the real web transport and MSW.
// Learning path Step 82: Suggested Community descriptions.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-82-suggested-community-descriptions
import { http, HttpResponse } from 'msw'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  COMMUNITY_AGE_GATE_DENIED_MESSAGE,
  COMMUNITY_MEDIA_UNAVAILABLE_MESSAGE,
  COMMUNITY_POST_RATE_LIMITED_MESSAGE,
} from '@couture/api-client/contracts/http'
import { getI18n } from '../../i18n'
import { useMswHandlers } from '../../test-utils/msw/runtime'
import { signInFixtureMember } from '../../test-utils/member-session'
import {
  FEED_PATH,
  ALLOCATE_PATH,
  PUBLISH_PATH,
  UPLOAD_URL,
  FIXTURE_IMAGE_URL,
  SUGGESTED_ALT_TEXT,
  feedBody,
  feedHandler,
  errorBody,
  allocateBody,
  publishBody,
  imageFixtureHandler,
  signIn,
  renderGrid,
  installImagePrepMocks,
  choosePhoto,
  setupCommunityGridClock,
  setupCommunityGridSurface,
} from '../../test-utils/community-lookbook-grid'

vi.mock('posthog-js', () => ({
  default: { capture: vi.fn() },
}))

setupCommunityGridClock()

describe('CommunityLookbookGrid (Story 6.1)', () => {
  setupCommunityGridSurface()

  describe('compose', () => {
    let restoreObjectUrl = () => undefined as void

    afterEach(() => {
      restoreObjectUrl()
      restoreObjectUrl = () => undefined
    })

    it('keeps the composer open through Close and Escape until publishing settles', async () => {
      signIn()
      restoreObjectUrl = installImagePrepMocks()
      const started = Promise.withResolvers<AbortSignal>()
      const finish = Promise.withResolvers<void>()
      useMswHandlers(
        feedHandler(),
        imageFixtureHandler(),
        http.post(ALLOCATE_PATH, () => allocateBody()),
        http.post(PUBLISH_PATH, async ({ request }) => {
          started.resolve(request.signal)
          await finish.promise
          return publishBody()
        })
      )
      const user = userEvent.setup()
      renderGrid()
      await user.click(await screen.findByTestId('create-post-button'))
      await choosePhoto(user)
      await screen.findByDisplayValue(SUGGESTED_ALT_TEXT)
      await user.click(screen.getByTestId('confirm-alt-text-checkbox'))
      await user.click(screen.getByTestId('post-publish-submit'))

      const signal = await started.promise
      try {
        const dialog = screen.getByRole('dialog')
        expect(screen.getByTestId('post-image-file-input')).toBeDisabled()
        await user.click(
          within(dialog).getByRole('button', { name: 'Close without sharing' })
        )
        expect(dialog).toBeVisible()
        await user.keyboard('{Escape}')
        expect(dialog).toBeVisible()
        expect(signal.aborted).toBe(false)
      } finally {
        finish.resolve()
      }
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(
        await screen.findAllByText('Your look was submitted for review.')
      ).not.toHaveLength(0)
    })

    it('offers one opt-in action and carries only accepted text to a replacement photo', async () => {
      signIn()
      restoreObjectUrl = installImagePrepMocks()
      const describe = vi.fn()
      useMswHandlers(
        feedHandler(),
        imageFixtureHandler(),
        http.post(ALLOCATE_PATH, () => allocateBody()),
        http.post('/api/v1/community/posts/describe', async ({ request }) => {
          describe(await request.json())
          return HttpResponse.json({
            data: { caption: 'This photo features blue tones.' },
          })
        })
      )
      const user = userEvent.setup()
      renderGrid()
      await user.click(await screen.findByTestId('create-post-button'))
      expect(screen.queryByTestId('community-suggest-description')).toBeNull()
      await choosePhoto(user)
      const description = screen.getByTestId('post-caption-input')
      const suggest = await screen.findByTestId('community-suggest-description')
      expect(screen.getAllByRole('button', { name: 'Suggest a description' })).toEqual([
        suggest,
      ])
      expect(description).toHaveValue('')
      expect(describe).not.toHaveBeenCalled()
      await user.click(suggest)
      expect(await screen.findByDisplayValue('This photo features blue tones.')).toBe(
        description
      )
      expect(describe).toHaveBeenCalledExactlyOnceWith({
        postId: 'mock-allocated-post-id',
        uploadSessionId: 'mock-upload-session-id',
      })

      expect(screen.getByTestId('community-description-suggested')).toHaveTextContent(
        'Suggested'
      )
      const fileInput = screen.getByTestId('post-image-file-input')
      await user.upload(
        fileInput,
        new File(['another-look'], 'replacement.jpg', { type: 'image/jpeg' })
      )
      const suggestAgain = await screen.findByTestId('community-suggest-description')
      expect(description).toHaveValue('')
      expect(screen.queryByTestId('community-description-suggested')).toBeNull()
      await user.click(suggestAgain)
      await screen.findByTestId('community-description-suggested')
      await user.click(screen.getByTestId('community-accept-description'))
      expect(screen.queryByTestId('community-description-suggested')).toBeNull()
      const altText = screen.getByTestId('post-alt-text-input')
      await user.type(altText, ' The previous photo.')
      await user.upload(
        fileInput,
        new File(['third-look'], 'third.jpg', { type: 'image/jpeg' })
      )
      await waitFor(() => expect(altText).toHaveValue(SUGGESTED_ALT_TEXT))
      expect(description).toHaveValue('This photo features blue tones.')
      expect(
        screen.queryByTestId('community-suggest-description')
      ).not.toBeInTheDocument()
    })

    it.each([
      ['description', 'post-caption-input'],
      ['title', 'post-title-input'],
    ])(
      'discards a pending reply after the member types and clears the %s',
      async (_, id) => {
        signIn()
        restoreObjectUrl = installImagePrepMocks()
        const started = vi.fn<(signal: AbortSignal) => void>()
        const finish = Promise.withResolvers<void>()
        const responseReady = Promise.withResolvers<void>()
        useMswHandlers(
          feedHandler(),
          imageFixtureHandler(),
          http.post(ALLOCATE_PATH, () => allocateBody()),
          http.post('/api/v1/community/posts/describe', async ({ request }) => {
            started(request.signal)
            await finish.promise
            const response = HttpResponse.json({ data: { caption: 'A late draft.' } })
            responseReady.resolve()
            return response
          })
        )
        const user = userEvent.setup()
        renderGrid()
        await user.click(await screen.findByTestId('create-post-button'))
        await choosePhoto(user)
        await user.click(await screen.findByTestId('community-suggest-description'))
        const description = screen.getByTestId('post-caption-input')
        const editedField = screen.getByTestId(id)
        try {
          await waitFor(() => expect(started).toHaveBeenCalledOnce())
          const signal = started.mock.calls[0]![0]
          expect(signal.aborted).toBe(false)
          await user.type(editedField, 'My draft')
          await user.clear(editedField)
          await waitFor(() => expect(signal.aborted).toBe(true))
        } finally {
          finish.resolve()
        }
        await act(async () => await responseReady.promise)
        expect(description).toHaveValue('')
        expect(screen.queryByTestId('community-description-suggested')).toBeNull()
        expect(screen.getByTestId('community-suggest-description')).toBeEnabled()
      }
    )

    it('keeps manual publishing available when the server returns an invalid suggestion', async () => {
      signIn()
      restoreObjectUrl = installImagePrepMocks()
      const publish = vi.fn()
      useMswHandlers(
        feedHandler(),
        imageFixtureHandler(),
        http.post(ALLOCATE_PATH, () => allocateBody()),
        http.post('/api/v1/community/posts/describe', () =>
          HttpResponse.json({ data: { caption: '   ' } })
        ),
        http.post(PUBLISH_PATH, async ({ request }) => {
          publish(await request.json())
          return publishBody()
        })
      )
      const user = userEvent.setup()
      renderGrid()
      await user.click(await screen.findByTestId('create-post-button'))
      await choosePhoto(user)
      await user.click(await screen.findByTestId('community-suggest-description'))
      expect(await screen.findByText(/could not suggest a description/i)).toBeVisible()
      const description = screen.getByTestId('post-caption-input')
      expect(description).toHaveValue('')
      expect(screen.queryByTestId('community-description-suggested')).toBeNull()
      await user.type(description, 'My favorite layer.')
      await user.click(screen.getByTestId('confirm-alt-text-checkbox'))
      await user.click(screen.getByTestId('post-publish-submit'))
      await waitFor(() =>
        expect(publish).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({ caption: 'My favorite layer.' })
        )
      )
    })

    it.each([200, 403])(
      'keeps a prior session response with status %i out of the composer',
      async (status) => {
        signIn()
        restoreObjectUrl = installImagePrepMocks()
        const started = vi.fn()
        const finish = Promise.withResolvers<void>()
        const response =
          status === 200
            ? HttpResponse.json({
                data: { caption: 'The former member has blue tones.' },
              })
            : errorBody(status, 'The previous session ended.', 'Forbidden')
        useMswHandlers(
          feedHandler(),
          imageFixtureHandler(),
          http.post(ALLOCATE_PATH, () => allocateBody()),
          http.post('/api/v1/community/posts/describe', async () => {
            started()
            await finish.promise
            return response
          })
        )
        const user = userEvent.setup()
        renderGrid()
        await user.click(await screen.findByTestId('create-post-button'))
        await choosePhoto(user)
        const suggest = await screen.findByTestId('community-suggest-description')
        await user.click(suggest)
        try {
          await waitFor(() => expect(started).toHaveBeenCalledOnce())
          expect(suggest).toBeDisabled()
          // Same-tab storage changes can reach the transport before the composer rerenders.
          signInFixtureMember('test-token-second-member')
        } finally {
          finish.resolve()
        }
        await waitFor(() => expect(suggest).toBeEnabled())
        expect(screen.getByTestId('post-caption-input')).toHaveValue('')
        expect(screen.queryByTestId('community-description-suggested')).toBeNull()
        expect(screen.queryByText(/could not suggest a description/i)).toBeNull()
      }
    )

    it('expires a held reply at five seconds and publishes manual text', async () => {
      signIn()
      restoreObjectUrl = installImagePrepMocks()
      const started = Promise.withResolvers<AbortSignal>()
      const finish = Promise.withResolvers<void>()
      const publish = vi.fn()
      useMswHandlers(
        feedHandler(),
        imageFixtureHandler(),
        http.post(ALLOCATE_PATH, () => allocateBody()),
        http.post('/api/v1/community/posts/describe', async ({ request }) => {
          started.resolve(request.signal)
          await finish.promise
          return HttpResponse.json({
            data: { caption: 'The late photo has blue tones.' },
          })
        }),
        http.post(PUBLISH_PATH, async ({ request }) => {
          publish(await request.json())
          return publishBody()
        })
      )
      const user = userEvent.setup()
      renderGrid()
      await user.click(await screen.findByTestId('create-post-button'))
      await choosePhoto(user)
      const suggest = await screen.findByTestId('community-suggest-description')
      const description = screen.getByTestId('post-caption-input')

      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
      try {
        fireEvent.click(suggest)
        const signal = await started.promise
        await act(async () => await vi.advanceTimersByTimeAsync(4_999))
        expect(suggest).toBeDisabled()
        expect(signal.aborted).toBe(false)
        await act(async () => await vi.advanceTimersByTimeAsync(1))
        expect(signal.aborted).toBe(true)
        expect(screen.getByText(/could not suggest a description/i)).toBeVisible()
      } finally {
        vi.useRealTimers()
        finish.resolve()
      }

      expect(description).toHaveValue('')
      expect(screen.queryByTestId('community-description-suggested')).toBeNull()
      const manual = 'My caption while the request was held.'
      await user.type(description, manual)
      await user.click(screen.getByTestId('confirm-alt-text-checkbox'))
      await user.click(screen.getByTestId('post-publish-submit'))
      await waitFor(() =>
        expect(publish).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({ caption: manual })
        )
      )
    })

    it('6.1-WEB-031 publishes a confirmed, server-suggested description under one idempotency key', async () => {
      signIn()
      restoreObjectUrl = installImagePrepMocks()
      let allocateKey: string | null = null
      let publishKey: string | null = null
      let allocatePayload: unknown
      let publishPayload: unknown
      let publishCalls = 0
      let feedCalls = 0
      useMswHandlers(
        http.get(FEED_PATH, () => {
          feedCalls += 1
          return feedBody()
        }),
        imageFixtureHandler(),
        http.post(ALLOCATE_PATH, async ({ request }) => {
          allocateKey = request.headers.get('Idempotency-Key')
          allocatePayload = await request.json()
          return allocateBody()
        }),
        http.post(PUBLISH_PATH, async ({ request }) => {
          publishCalls += 1
          publishKey = request.headers.get('Idempotency-Key')
          publishPayload = await request.json()
          return publishBody()
        })
      )
      const user = userEvent.setup()
      renderGrid()

      await screen.findByTestId('community-feed-empty')
      await user.click(screen.getByTestId('create-post-button'))
      await choosePhoto(user)

      // The suggestion is server-generated and lands in an editable field.
      const altInput = await screen.findByDisplayValue(SUGGESTED_ALT_TEXT)
      expect(altInput).toBe(screen.getByTestId('post-alt-text-input'))
      expect(screen.getByTestId('post-image-preview')).toHaveAttribute(
        'src',
        FIXTURE_IMAGE_URL
      )

      const publish = screen.getByTestId('post-publish-submit')
      expect(publish).toBeDisabled()

      await user.type(altInput, ' Shot on a rainy street.')
      // Editing the description withdraws the confirmation, so the gate holds.
      expect(screen.getByTestId('confirm-alt-text-checkbox')).not.toBeChecked()
      expect(publish).toBeDisabled()

      await user.click(screen.getByTestId('confirm-alt-text-checkbox'))
      expect(publish).toBeEnabled()
      await user.click(publish)

      await waitFor(() => expect(publishCalls).toBe(1))
      expect(publishPayload).toEqual({
        postId: 'mock-allocated-post-id',
        uploadSessionId: 'mock-upload-session-id',
        altText: `${SUGGESTED_ALT_TEXT} Shot on a rainy street.`,
        altTextConfirmed: true,
        caption: null,
        locale: 'en-US',
      })
      expect(allocatePayload).toMatchObject({
        locale: 'en-US',
        contentType: 'image/jpeg',
      })
      // One attempt, one key: minting a fresh key on publish would allocate a
      // second upload session instead of replaying the first.
      expect(allocateKey).toEqual(expect.any(String))
      expect(publishKey).toBe(allocateKey)

      expect(screen.queryByTestId('post-alt-text-input')).not.toBeInTheDocument()
      const notice = await screen.findByTestId('community-action-notice')
      expect(notice).toHaveAttribute('data-tone', 'success')
      expect(notice).toHaveTextContent('Your look was submitted for review.')
      // The new post is `pending_review`, so the grid re-reads rather than
      // inserting it locally.
      await waitFor(() => expect(feedCalls).toBe(2))
    })

    it('6.1-WEB-058 sends a trimmed caption and keeps it out of the alt text', async () => {
      signIn()
      restoreObjectUrl = installImagePrepMocks()
      let publishPayload: unknown
      useMswHandlers(
        feedHandler(),
        imageFixtureHandler(),
        http.post(ALLOCATE_PATH, () => allocateBody()),
        http.post(PUBLISH_PATH, async ({ request }) => {
          publishPayload = await request.json()
          return publishBody()
        })
      )
      const user = userEvent.setup()
      renderGrid()

      await user.click(await screen.findByTestId('create-post-button'))
      await choosePhoto(user)
      await screen.findByDisplayValue(SUGGESTED_ALT_TEXT)
      await user.type(
        screen.getByTestId('post-caption-input'),
        '  Wool over merino, worth the extra layer.  '
      )
      await user.click(screen.getByTestId('confirm-alt-text-checkbox'))
      await user.click(screen.getByTestId('post-publish-submit'))

      await waitFor(() => expect(publishPayload).toBeDefined())
      expect(publishPayload).toMatchObject({
        caption: 'Wool over merino, worth the extra layer.',
        altText: SUGGESTED_ALT_TEXT,
      })
    })

    it('6.1-WEB-032 publishes in the locale the reader actually resolved to', async () => {
      signIn()
      restoreObjectUrl = installImagePrepMocks()
      const originalLanguages = Object.getOwnPropertyDescriptor(
        window.navigator,
        'languages'
      )
      let allocatePayload: unknown
      let publishPayload: unknown
      useMswHandlers(
        feedHandler(),
        imageFixtureHandler(),
        http.post(ALLOCATE_PATH, async ({ request }) => {
          allocatePayload = await request.json()
          return allocateBody()
        }),
        http.post(PUBLISH_PATH, async ({ request }) => {
          publishPayload = await request.json()
          return publishBody()
        })
      )

      try {
        Object.defineProperty(window.navigator, 'languages', {
          configurable: true,
          get: () => ['fr-FR'],
        })
        await getI18n().changeLanguage('fr-FR')

        const user = userEvent.setup()
        renderGrid()

        await screen.findByTestId('create-post-button')
        await user.click(screen.getByTestId('create-post-button'))
        await choosePhoto(user)
        await screen.findByDisplayValue(SUGGESTED_ALT_TEXT)
        await user.click(screen.getByTestId('confirm-alt-text-checkbox'))
        await user.click(screen.getByTestId('post-publish-submit'))

        await waitFor(() => expect(publishPayload).toBeDefined())
        // A hardcoded `en-US` would screen a French caption against the wrong
        // catalog and generate the suggestion in the wrong language.
        expect(allocatePayload).toMatchObject({ locale: 'fr-FR' })
        expect(publishPayload).toMatchObject({ locale: 'fr-FR', altTextConfirmed: true })
      } finally {
        if (originalLanguages) {
          Object.defineProperty(window.navigator, 'languages', originalLanguages)
        }
        await getI18n().changeLanguage('en-US')
      }
    })

    it('6.1-WEB-033 rejects a caption with a link or an email, and clears once it is clean', async () => {
      signIn()
      useMswHandlers(feedHandler())
      const user = userEvent.setup()
      renderGrid()

      await user.click(await screen.findByTestId('create-post-button'))
      const caption = await screen.findByTestId('post-caption-input')

      await user.type(caption, 'Shop it at https://example.com')
      expect(await screen.findByTestId('create-post-error')).toHaveTextContent(
        'The caption cannot contain links.'
      )

      await user.clear(caption)
      await user.type(caption, 'Reach me at style@example.com')
      expect(await screen.findByTestId('create-post-error')).toHaveTextContent(
        'The caption cannot contain email addresses.'
      )

      await user.clear(caption)
      await user.type(caption, 'Wool over merino, worth the extra layer.')
      await waitFor(() =>
        expect(screen.queryByTestId('create-post-error')).not.toBeInTheDocument()
      )
    })

    it('6.1-WEB-034 rejects a caption over the contract’s 280-character ceiling', async () => {
      signIn()
      useMswHandlers(feedHandler())
      const user = userEvent.setup()
      renderGrid()

      await user.click(await screen.findByTestId('create-post-button'))
      const caption = await screen.findByTestId('post-caption-input')
      // `maxLength` stops a typist; a paste or an autofill does not, and the
      // contract's own schema is what decides.
      fireEvent.change(caption, { target: { value: 'w'.repeat(281) } })

      expect(await screen.findByTestId('create-post-error')).toHaveTextContent(
        'Keep the caption to 280 characters or fewer.'
      )
    })

    it('6.1-WEB-035 names the gate the author has not cleared yet', async () => {
      signIn()
      restoreObjectUrl = installImagePrepMocks()
      useMswHandlers(
        feedHandler(),
        imageFixtureHandler(),
        http.post(ALLOCATE_PATH, () => allocateBody())
      )
      const user = userEvent.setup()
      renderGrid()

      await user.click(await screen.findByTestId('create-post-button'))
      const form = screen.getByRole('dialog').querySelector('form')
      expect(form).not.toBeNull()

      fireEvent.submit(form as HTMLFormElement)
      expect(await screen.findByTestId('create-post-error')).toHaveTextContent(
        'Choose a photo to share.'
      )

      await choosePhoto(user)
      await screen.findByDisplayValue(SUGGESTED_ALT_TEXT)

      await user.clear(screen.getByTestId('post-alt-text-input'))
      fireEvent.submit(form as HTMLFormElement)
      expect(await screen.findByTestId('create-post-error')).toHaveTextContent(
        'Add an image description.'
      )

      await user.type(
        screen.getByTestId('post-alt-text-input'),
        'A wool coat over denim.'
      )
      fireEvent.submit(form as HTMLFormElement)
      expect(await screen.findByTestId('create-post-error')).toHaveTextContent(
        'Confirm the image description before publishing.'
      )
    })

    it('6.1-WEB-036 aborts the publish when the byte upload fails', async () => {
      signIn()
      restoreObjectUrl = installImagePrepMocks()
      let allocateCalls = 0
      let publishCalls = 0
      useMswHandlers(
        feedHandler(),
        imageFixtureHandler(),
        http.post(ALLOCATE_PATH, () => {
          allocateCalls += 1
          return allocateBody()
        }),
        http.put(UPLOAD_URL, () => new HttpResponse(null, { status: 500 })),
        http.post(PUBLISH_PATH, () => {
          publishCalls += 1
          return publishBody()
        })
      )
      const user = userEvent.setup()
      renderGrid()

      await user.click(await screen.findByTestId('create-post-button'))
      await choosePhoto(user)

      expect(await screen.findByTestId('create-post-error')).toHaveTextContent(
        'Your photo could not be uploaded, so nothing was published. Try again.'
      )
      // A post whose object was never written renders as a permanently broken
      // card that moderation cannot screen, so nothing is published.
      expect(allocateCalls).toBe(1)
      expect(publishCalls).toBe(0)
      expect(screen.getByTestId('post-publish-submit')).toBeDisabled()
      expect(screen.queryByDisplayValue(SUGGESTED_ALT_TEXT)).not.toBeInTheDocument()
    })

    /**
     * The 256px floor is enforced client-side, before an upload session is
     * allocated, and it says WHY rather than falling back to the generic upload
     * copy: it is the one prepare failure the reader can act on. The first draft
     * classified it `unknown`, which left `community.validation.imageTooSmall`
     * shipping in all ten catalogs and never rendering.
     */
    it('6.1-WEB-037 rejects a photo under the 256px floor before allocating anything', async () => {
      signIn()
      restoreObjectUrl = installImagePrepMocks({ widthPx: 120, heightPx: 160 })
      let allocateCalls = 0
      useMswHandlers(
        feedHandler(),
        imageFixtureHandler(),
        http.post(ALLOCATE_PATH, () => {
          allocateCalls += 1
          return allocateBody()
        })
      )
      const user = userEvent.setup()
      renderGrid()

      await user.click(await screen.findByTestId('create-post-button'))
      await choosePhoto(user)

      expect(await screen.findByTestId('create-post-error')).toHaveTextContent(
        'Choose an image at least 256 pixels wide and tall.'
      )
      expect(allocateCalls).toBe(0)
      expect(screen.getByTestId('post-publish-submit')).toBeDisabled()
    })

    it('6.1-WEB-038 names the time posting reopens when the 429 carried Retry-After', async () => {
      signIn()
      restoreObjectUrl = installImagePrepMocks()
      useMswHandlers(
        feedHandler(),
        imageFixtureHandler(),
        http.post(ALLOCATE_PATH, () =>
          errorBody(429, COMMUNITY_POST_RATE_LIMITED_MESSAGE, 'Too Many Requests', {
            headers: { 'Retry-After': '900' },
          })
        )
      )
      const user = userEvent.setup()
      renderGrid()

      await user.click(await screen.findByTestId('create-post-button'))
      await choosePhoto(user)

      const error = await screen.findByTestId('create-post-error')
      expect(error).toHaveTextContent("You have reached today's limit of ten looks.")
      expect(error).toHaveTextContent(/Try again after \d{1,2}:\d{2}/)
      expect(error).not.toHaveTextContent(COMMUNITY_POST_RATE_LIMITED_MESSAGE)
    })

    it('6.1-WEB-039 falls back to the plain limit message without a usable Retry-After', async () => {
      signIn()
      restoreObjectUrl = installImagePrepMocks()
      useMswHandlers(
        feedHandler(),
        imageFixtureHandler(),
        http.post(ALLOCATE_PATH, () =>
          errorBody(429, COMMUNITY_POST_RATE_LIMITED_MESSAGE, 'Too Many Requests', {
            // Not delta-seconds, so it is dropped rather than rendered raw.
            headers: { 'Retry-After': 'tomorrow' },
          })
        )
      )
      const user = userEvent.setup()
      renderGrid()

      await user.click(await screen.findByTestId('create-post-button'))
      await choosePhoto(user)

      const error = await screen.findByTestId('create-post-error')
      expect(error).toHaveTextContent("You have reached today's limit of ten looks.")
      expect(error).not.toHaveTextContent('Try again after')
    })

    it('6.1-WEB-040 refuses an under-age author with the age-gate message', async () => {
      signIn()
      restoreObjectUrl = installImagePrepMocks()
      useMswHandlers(
        feedHandler(),
        imageFixtureHandler(),
        http.post(ALLOCATE_PATH, () =>
          errorBody(403, COMMUNITY_AGE_GATE_DENIED_MESSAGE, 'Forbidden')
        )
      )
      const user = userEvent.setup()
      renderGrid()

      await user.click(await screen.findByTestId('create-post-button'))
      await choosePhoto(user)

      const error = await screen.findByTestId('create-post-error')
      expect(error).toHaveTextContent(
        'You need to be at least 13 to post to the community.'
      )
      expect(error).not.toHaveTextContent(COMMUNITY_AGE_GATE_DENIED_MESSAGE)
    })

    it('6.1-WEB-041 explains a refused publish without leaking the server message', async () => {
      signIn()
      restoreObjectUrl = installImagePrepMocks()
      useMswHandlers(
        feedHandler(),
        imageFixtureHandler(),
        http.post(ALLOCATE_PATH, () => allocateBody()),
        http.post(
          PUBLISH_PATH,
          () => new HttpResponse('upstream moderation queue unavailable', { status: 500 })
        )
      )
      const user = userEvent.setup()
      renderGrid()

      await user.click(await screen.findByTestId('create-post-button'))
      await choosePhoto(user)
      await screen.findByDisplayValue(SUGGESTED_ALT_TEXT)
      await user.click(screen.getByTestId('confirm-alt-text-checkbox'))
      await user.click(screen.getByTestId('post-publish-submit'))

      const error = await screen.findByTestId('create-post-error')
      expect(error).toHaveTextContent('We could not publish your look.')
      expect(error).not.toHaveTextContent('upstream moderation queue unavailable')
    })

    it('6.1-WEB-073 names a look the storage layer cannot serve back', async () => {
      signIn()
      restoreObjectUrl = installImagePrepMocks()
      useMswHandlers(
        feedHandler(),
        imageFixtureHandler(),
        http.post(ALLOCATE_PATH, () => allocateBody()),
        // `requireFeedItem` raises this AFTER the state transition has committed:
        // the look is published and it is our own signed URL that failed. That
        // makes "We could not publish your look", the generic fallback this used
        // to land on, the one sentence that was not true.
        http.post(PUBLISH_PATH, () =>
          errorBody(503, COMMUNITY_MEDIA_UNAVAILABLE_MESSAGE, 'Service Unavailable')
        )
      )
      const user = userEvent.setup()
      renderGrid()

      await user.click(await screen.findByTestId('create-post-button'))
      await choosePhoto(user)
      await screen.findByDisplayValue(SUGGESTED_ALT_TEXT)
      await user.click(screen.getByTestId('confirm-alt-text-checkbox'))
      await user.click(screen.getByTestId('post-publish-submit'))

      const error = await screen.findByTestId('create-post-error')
      expect(error).toHaveTextContent(
        'This look is temporarily unavailable. Try again shortly.'
      )
      // Not the kill-switch copy: the two 503s share a status and mean opposite
      // things, and telling this author the whole community is switched off would
      // send them away rather than back.
      expect(error).not.toHaveTextContent(
        'The community feed is temporarily unavailable.'
      )
      expect(error).not.toHaveTextContent(COMMUNITY_MEDIA_UNAVAILABLE_MESSAGE)
    })

    it('6.1-WEB-060 does nothing when the file chooser is dismissed without a file', async () => {
      signIn()
      restoreObjectUrl = installImagePrepMocks()
      let allocateCalls = 0
      useMswHandlers(
        feedHandler(),
        imageFixtureHandler(),
        http.post(ALLOCATE_PATH, () => {
          allocateCalls += 1
          return allocateBody()
        })
      )
      const user = userEvent.setup()
      renderGrid()

      await user.click(await screen.findByTestId('create-post-button'))
      await user.upload(screen.getByTestId('post-image-file-input'), [])

      expect(allocateCalls).toBe(0)
      expect(screen.queryByTestId('create-post-error')).not.toBeInTheDocument()
      expect(screen.queryByTestId('post-image-preview')).not.toBeInTheDocument()

      // Closing with nothing chosen has no object URL to release.
      await user.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(screen.queryByTestId('post-alt-text-input')).not.toBeInTheDocument()
    })

    it('6.1-WEB-061 releases the previous preview when a second photo is chosen', async () => {
      signIn()
      restoreObjectUrl = installImagePrepMocks()
      const secondPreview = 'http://localhost/community-fixture-2.jpg'
      const previews = [FIXTURE_IMAGE_URL, secondPreview]
      let issued = 0
      const revoked: string[] = []
      URL.createObjectURL = (() => {
        const url = previews[issued] ?? secondPreview
        issued += 1
        return url
      }) as typeof URL.createObjectURL
      URL.revokeObjectURL = ((url: string) => {
        revoked.push(url)
      }) as typeof URL.revokeObjectURL
      useMswHandlers(
        feedHandler(),
        // Both previews read back the same fixture bytes; the object URL is the
        // only local handle on the image, and the first one has to be released.
        imageFixtureHandler(),
        http.get(secondPreview, () =>
          HttpResponse.arrayBuffer(new Uint8Array([1, 2, 3, 4]).buffer, {
            headers: { 'Content-Type': 'image/jpeg' },
          })
        ),
        http.post(ALLOCATE_PATH, () => allocateBody())
      )
      const user = userEvent.setup()
      renderGrid()

      await user.click(await screen.findByTestId('create-post-button'))
      await choosePhoto(user)
      await screen.findByDisplayValue(SUGGESTED_ALT_TEXT)
      await user.upload(
        screen.getByTestId('post-image-file-input'),
        new File(['second-look-bytes'], 'second.jpg', { type: 'image/jpeg' })
      )

      await waitFor(() =>
        expect(screen.getByTestId('post-image-preview')).toHaveAttribute(
          'src',
          secondPreview
        )
      )
      expect(revoked).toContain(FIXTURE_IMAGE_URL)
    })

    it('6.1-WEB-042 cancels the compose modal and releases the photo it was holding', async () => {
      signIn()
      restoreObjectUrl = installImagePrepMocks()
      const revoked: string[] = []
      URL.revokeObjectURL = ((url: string) => {
        revoked.push(url)
      }) as typeof URL.revokeObjectURL
      useMswHandlers(
        feedHandler(),
        imageFixtureHandler(),
        http.post(ALLOCATE_PATH, () => allocateBody())
      )
      const user = userEvent.setup()
      renderGrid()

      await user.click(await screen.findByTestId('create-post-button'))
      await choosePhoto(user)
      await screen.findByDisplayValue(SUGGESTED_ALT_TEXT)
      await user.click(screen.getByRole('button', { name: 'Cancel' }))

      expect(screen.queryByTestId('post-alt-text-input')).not.toBeInTheDocument()
      expect(revoked).toContain(FIXTURE_IMAGE_URL)
    })

    it('aborts an unfinished upload when closing, so it cannot restore a draft after reopening', async () => {
      signIn()
      restoreObjectUrl = installImagePrepMocks()
      const started = Promise.withResolvers<AbortSignal>()
      const finish = Promise.withResolvers<void>()
      useMswHandlers(
        feedHandler(),
        imageFixtureHandler(),
        http.post(ALLOCATE_PATH, async ({ request }) => {
          started.resolve(request.signal)
          await finish.promise
          return allocateBody()
        })
      )
      const user = userEvent.setup()
      renderGrid()
      await user.click(await screen.findByTestId('create-post-button'))
      await choosePhoto(user)
      const signal = await started.promise
      await user.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(signal.aborted).toBe(true)
      await user.click(await screen.findByTestId('create-post-button'))
      await act(async () => {
        finish.resolve()
        await finish.promise
      })
      expect(
        screen.queryByTestId('community-suggest-description')
      ).not.toBeInTheDocument()
      expect(screen.getByTestId('post-alt-text-input')).toHaveValue('')
    })
  })
})
