// Learning path Step 32: Wardrobe onboarding and silhouette setup.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-32-wardrobe-onboarding-and-silhouette-setup
// Story 4.4 Task 5 owner: unit-test the web silhouette settings panel
// @vitest-environment jsdom
import React from 'react'
import { Blob as NodeBlob } from 'node:buffer'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nextProvider } from 'react-i18next'
import {
  UploadSessionChangedError,
  type SilhouetteProfileContract,
} from '@couture/api-client/contracts/http'
import { SilhouetteSettingsPanel } from './silhouette-settings-panel'
import { WEB_ACCESS_TOKEN_STORAGE_KEY, WardrobeRequestError } from '../../lib/wardrobe'
import {
  forgetAllUploadAttempts,
  setUploadAttemptAccount,
} from '../../lib/upload-attempts'
import { getI18n } from '../../i18n'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  window.sessionStorage.clear()
  setUploadAttemptAccount(null)
  forgetAllUploadAttempts()
})

function buildProfile(
  overrides: Partial<SilhouetteProfileContract> = {}
): SilhouetteProfileContract {
  return {
    mode: 'default_mannequin',
    heightSlider: 50,
    buildSlider: 50,
    myForm: null,
    revision: 0,
    updatedAt: '2026-08-09T09:00:00.000Z',
    ...overrides,
  }
}

function makeFile(name = 'photo.png', type = 'image/png') {
  return new File(['x'.repeat(20)], name, { type })
}

// An apostrophe-containing string literal cannot satisfy this project's `quotes`
// (forces single) and `prettier/prettier` (forces double to avoid escaping) rules
// at once, so these labels are regex literals instead of string literals.
const CONFIRM_CHECKBOX_LABEL = /I'm wearing plain white or black clothing/
const CONTRAST_MESSAGE =
  /We couldn't separate you from the background clearly\. Retake the photo with plainer clothing or a plainer background\./
const PRIVACY_VIOLATION_MESSAGE = /This photo can't be used\. Choose a different photo\./
const STORAGE_ERROR_MESSAGE = /We couldn't save this photo\. Try again\./

function renderPanel(props: React.ComponentProps<typeof SilhouetteSettingsPanel>) {
  return render(
    <I18nextProvider i18n={getI18n()}>
      <SilhouetteSettingsPanel {...props} />
    </I18nextProvider>
  )
}

async function confirmAndStartMyFormUpload(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByLabelText(CONFIRM_CHECKBOX_LABEL))
  await user.click(screen.getByRole('button', { name: 'Upload a full-body photo' }))
  await user.upload(
    screen.getByLabelText('My Form photo file', { selector: 'input' }),
    makeFile()
  )
}

describe('SilhouetteSettingsPanel', () => {
  it('loads the current profile and renders sliders at their saved values', async () => {
    const getProfile = vi.fn().mockResolvedValue(buildProfile({ heightSlider: 30 }))
    renderPanel({ userId: 'user-1', getProfile })

    expect(screen.getByRole('status')).toHaveTextContent(/loading/i)

    await waitFor(() => {
      expect(screen.getByLabelText('Height')).toHaveValue('30')
    })
    expect(screen.getByLabelText('Build')).toHaveValue('50')
  })

  it('shows an inline error when the profile fails to load', async () => {
    const getProfile = vi.fn().mockRejectedValue(new Error('boom'))
    renderPanel({ userId: 'user-1', getProfile })

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('boom')
    })
  })

  it('auto-saves slider changes with the strong entity tag built from the loaded revision', async () => {
    const getProfile = vi.fn().mockResolvedValue(buildProfile({ revision: 2 }))
    const saveSliders = vi.fn().mockResolvedValue(buildProfile({ revision: 3 }))
    // A near-zero debounce keeps this test fast and avoids depending on the
    // real 400ms production debounce window (see sliderSaveDebounceMs).
    renderPanel({ userId: 'user-1', getProfile, saveSliders, sliderSaveDebounceMs: 5 })

    const heightSlider = await screen.findByLabelText('Height')
    fireEvent.change(heightSlider, { target: { value: '51' } })

    await waitFor(() => {
      expect(saveSliders).toHaveBeenCalledWith(
        { heightSlider: 51, buildSlider: 50 },
        '"silhouette:user-1:2"',
        expect.anything()
      )
    })
  })

  it('requires the basewear confirmation before starting a My Form upload', async () => {
    const user = userEvent.setup()
    const getProfile = vi.fn().mockResolvedValue(buildProfile())
    const uploadMyFormPhoto = vi.fn()
    renderPanel({ userId: 'user-1', getProfile, uploadMyFormPhoto })

    await screen.findByLabelText('Height')
    await user.click(screen.getByRole('button', { name: 'Upload a full-body photo' }))

    expect(
      screen.getByText('Confirm the basewear guidance before uploading.')
    ).toBeInTheDocument()
    expect(uploadMyFormPhoto).not.toHaveBeenCalled()
  })

  it('uploads a My Form photo once confirmed and retries the same photo', async () => {
    const user = userEvent.setup()
    const getProfile = vi.fn().mockResolvedValue(buildProfile())
    const uploadMyFormPhoto = vi
      .fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(
        buildProfile({
          mode: 'my_form',
          revision: 1,
          myForm: {
            status: 'processing',
            failureReason: null,
            committedAt: '2026-08-09T09:05:00.000Z',
            imageAccess: null,
          },
        })
      )
    renderPanel({ userId: 'user-1', getProfile, uploadMyFormPhoto })

    await screen.findByLabelText('Height')
    await confirmAndStartMyFormUpload(user)

    // Waiting on the call count only proves the request was issued; the alert
    // is rendered by the rejection handler a tick later, so wait on the alert.
    expect(await screen.findByRole('alert')).toHaveTextContent('network down')

    await user.click(screen.getByRole('button', { name: 'Retry upload' }))

    await waitFor(() => expect(uploadMyFormPhoto).toHaveBeenCalledTimes(2))
    const [firstCall, secondCall] = uploadMyFormPhoto.mock.calls as [
      [{ imagePreview: string }],
      [{ imagePreview: string }],
    ]
    // The lib keys the attempt by the prepared photo, so the same photo resumes it.
    expect(secondCall[0].imagePreview).toBe(firstCall[0].imagePreview)
  })

  it('polls until a processing My Form photo becomes ready', async () => {
    const user = userEvent.setup()
    const getProfile = vi
      .fn()
      .mockResolvedValueOnce(buildProfile())
      .mockResolvedValueOnce(
        buildProfile({
          mode: 'my_form',
          revision: 2,
          myForm: {
            status: 'ready',
            failureReason: null,
            committedAt: '2026-08-09T09:05:00.000Z',
            imageAccess: {
              url: 'https://example.test/me.png',
              expiresAt: '2026-08-09T10:00:00.000Z',
            },
          },
        })
      )
    const uploadMyFormPhoto = vi.fn().mockResolvedValue(
      buildProfile({
        mode: 'my_form',
        revision: 1,
        myForm: {
          status: 'processing',
          failureReason: null,
          committedAt: '2026-08-09T09:05:00.000Z',
          imageAccess: null,
        },
      })
    )
    renderPanel({
      userId: 'user-1',
      getProfile,
      uploadMyFormPhoto,
      pollIntervalsMs: [5, 5],
    })

    await screen.findByLabelText('Height')
    await confirmAndStartMyFormUpload(user)

    await waitFor(() => {
      expect(screen.getByText('My Form photo ready')).toBeInTheDocument()
    })
    expect(
      screen.getByRole('button', { name: 'Remove My Form photo' })
    ).toBeInTheDocument()
  })

  it.each([
    ['timeout', /Processing took too long\. Try again\./],
    ['storage_error', STORAGE_ERROR_MESSAGE],
  ] as const)(
    'shows the %s failure reason with a retry action, since it is safe to replay the same bytes',
    async (reason, message) => {
      const user = userEvent.setup()
      const getProfile = vi.fn().mockResolvedValue(buildProfile())
      const uploadMyFormPhoto = vi.fn().mockResolvedValue(
        buildProfile({
          revision: 1,
          myForm: {
            status: 'failed',
            failureReason: reason,
            committedAt: '2026-08-09T09:05:00.000Z',
            imageAccess: null,
          },
        })
      )
      renderPanel({ userId: 'user-1', getProfile, uploadMyFormPhoto })

      await screen.findByLabelText('Height')
      await confirmAndStartMyFormUpload(user)

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent(message)
      })
      expect(screen.getByRole('button', { name: 'Retry upload' })).toBeInTheDocument()
    }
  )

  it.each([
    ['contrast', CONTRAST_MESSAGE],
    ['privacy_violation', PRIVACY_VIOLATION_MESSAGE],
  ] as const)(
    'shows the %s failure reason WITHOUT a retry action, since decision 8 makes it a terminal outcome that needs a new photo',
    async (reason, message) => {
      const user = userEvent.setup()
      const getProfile = vi.fn().mockResolvedValue(buildProfile())
      const uploadMyFormPhoto = vi.fn().mockResolvedValue(
        buildProfile({
          revision: 1,
          myForm: {
            status: 'failed',
            failureReason: reason,
            committedAt: '2026-08-09T09:05:00.000Z',
            imageAccess: null,
          },
        })
      )
      renderPanel({ userId: 'user-1', getProfile, uploadMyFormPhoto })

      await screen.findByLabelText('Height')
      await confirmAndStartMyFormUpload(user)

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent(message)
      })
      expect(
        screen.queryByRole('button', { name: 'Retry upload' })
      ).not.toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'Upload a full-body photo' })
      ).toBeInTheDocument()
    }
  )

  it('removes the My Form photo and reverts to the saved sliders', async () => {
    const user = userEvent.setup()
    const getProfile = vi.fn().mockResolvedValue(
      buildProfile({
        mode: 'my_form',
        revision: 4,
        myForm: {
          status: 'ready',
          failureReason: null,
          committedAt: '2026-08-09T09:05:00.000Z',
          imageAccess: {
            url: 'https://example.test/me.png',
            expiresAt: '2026-08-09T10:00:00.000Z',
          },
        },
      })
    )
    const removeMyFormPhoto = vi.fn().mockResolvedValue(buildProfile({ revision: 5 }))
    renderPanel({ userId: 'user-1', getProfile, removeMyFormPhoto })

    await user.click(await screen.findByRole('button', { name: 'Remove My Form photo' }))

    await waitFor(() => {
      // Round 6: the session the profile was read under rides along, so the default remover
      // resolves the bearer for that account.
      expect(removeMyFormPhoto).toHaveBeenCalledWith(
        '"silhouette:user-1:4"',
        expect.anything(),
        expect.objectContaining({ account: null })
      )
    })
    await waitFor(() => {
      expect(screen.getByLabelText('Height')).toBeInTheDocument()
    })
  })

  it('surfaces a guardian-consent rejection for a teen actor inline', async () => {
    const user = userEvent.setup()
    const getProfile = vi.fn().mockResolvedValue(buildProfile())
    const uploadMyFormPhoto = vi
      .fn()
      .mockRejectedValue(new WardrobeRequestError('GUARDIAN_CONSENT_REQUIRED'))
    renderPanel({ userId: 'user-1', getProfile, uploadMyFormPhoto })

    await screen.findByLabelText('Height')
    await confirmAndStartMyFormUpload(user)

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('GUARDIAN_CONSENT_REQUIRED')
    })
  })

  // Learning path Step 58: Image uploads straight to storage.
  // See _bmad-output/project-knowledge/learning-path-step-by-step.md#image-uploads-straight-to-storage
  // Round 5 (Codex C4-1): an upload fenced by an account change shows the catalog's copy.
  it('shows the localized account-change message when the upload is fenced', async () => {
    const user = userEvent.setup()
    const getProfile = vi.fn().mockResolvedValue(buildProfile())
    const uploadMyFormPhoto = vi.fn().mockRejectedValue(new UploadSessionChangedError())
    renderPanel({ userId: 'user-1', getProfile, uploadMyFormPhoto })

    await screen.findByLabelText('Height')
    await confirmAndStartMyFormUpload(user)

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'You signed out or switched accounts during this upload. Choose the photo again.'
      )
    })
  })

  it('offers a fresh upload (not just retry) for a failed photo loaded after a reload', async () => {
    // Regression: the session-local `uploadPreview` doesn't exist
    // after a reload, so a naive `canRetry`-only gate hid every actionable
    // control. The upload button must still be offered.
    const getProfile = vi.fn().mockResolvedValue(
      buildProfile({
        revision: 1,
        myForm: {
          status: 'failed',
          failureReason: 'contrast',
          committedAt: '2026-08-09T09:05:00.000Z',
          imageAccess: null,
        },
      })
    )
    renderPanel({ userId: 'user-1', getProfile })

    await screen.findByLabelText('Height')
    expect(screen.getByRole('alert')).toHaveTextContent(CONTRAST_MESSAGE)
    expect(
      screen.getByRole('button', { name: 'Upload a full-body photo' })
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry upload' })).not.toBeInTheDocument()
  })

  it('resumes polling automatically when the loaded profile is still processing', async () => {
    const getProfile = vi
      .fn()
      .mockResolvedValueOnce(
        buildProfile({
          mode: 'my_form',
          revision: 1,
          myForm: {
            status: 'processing',
            failureReason: null,
            committedAt: '2026-08-09T09:05:00.000Z',
            imageAccess: null,
          },
        })
      )
      .mockResolvedValueOnce(
        buildProfile({
          mode: 'my_form',
          revision: 2,
          myForm: {
            status: 'ready',
            failureReason: null,
            committedAt: '2026-08-09T09:05:00.000Z',
            imageAccess: {
              url: 'https://example.test/me.png',
              expiresAt: '2026-08-09T10:00:00.000Z',
            },
          },
        })
      )
    renderPanel({ userId: 'user-1', getProfile, pollIntervalsMs: [5, 5] })

    await waitFor(() => {
      expect(screen.getByText('My Form photo ready')).toBeInTheDocument()
    })
    expect(getProfile).toHaveBeenCalledTimes(2)
  })

  it('surfaces a timeout once every poll attempt still reports processing', async () => {
    const user = userEvent.setup()
    const getProfile = vi
      .fn()
      .mockResolvedValueOnce(buildProfile())
      .mockResolvedValue(
        buildProfile({
          mode: 'my_form',
          revision: 1,
          myForm: {
            status: 'processing',
            failureReason: null,
            committedAt: '2026-08-09T09:05:00.000Z',
            imageAccess: null,
          },
        })
      )
    const uploadMyFormPhoto = vi.fn().mockResolvedValue(
      buildProfile({
        mode: 'my_form',
        revision: 1,
        myForm: {
          status: 'processing',
          failureReason: null,
          committedAt: '2026-08-09T09:05:00.000Z',
          imageAccess: null,
        },
      })
    )
    renderPanel({
      userId: 'user-1',
      getProfile,
      uploadMyFormPhoto,
      pollIntervalsMs: [5, 5],
    })

    await screen.findByLabelText('Height')
    await confirmAndStartMyFormUpload(user)

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Processing took too long. Try again.'
      )
    })
    expect(screen.getByRole('button', { name: 'Retry upload' })).toBeInTheDocument()
  })

  it('flushes a pending slider edit on unmount instead of discarding it', async () => {
    const getProfile = vi.fn().mockResolvedValue(buildProfile({ revision: 2 }))
    const saveSliders = vi.fn().mockResolvedValue(buildProfile({ revision: 3 }))
    const { unmount } = renderPanel({
      userId: 'user-1',
      getProfile,
      saveSliders,
      sliderSaveDebounceMs: 60_000, // long enough that only an explicit flush saves it
    })

    const heightSlider = await screen.findByLabelText('Height')
    fireEvent.change(heightSlider, { target: { value: '77' } })

    unmount()

    await waitFor(() => {
      expect(saveSliders).toHaveBeenCalledWith(
        { heightSlider: 77, buildSlider: 50 },
        '"silhouette:user-1:2"',
        expect.anything()
      )
    })
  })

  it('maps a stale-revision conflict on slider save to the translated message', async () => {
    const getProfile = vi.fn().mockResolvedValue(buildProfile({ revision: 2 }))
    const saveSliders = vi
      .fn()
      .mockRejectedValue(new Error('SILHOUETTE_REVISION_MISMATCH'))
    renderPanel({
      userId: 'user-1',
      getProfile,
      saveSliders,
      sliderSaveDebounceMs: 5,
    })

    const heightSlider = await screen.findByLabelText('Height')
    fireEvent.change(heightSlider, { target: { value: '80' } })

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'This step changed elsewhere. Review the latest version and try again.'
      )
    })
  })

  it('offers an explicit reload after a stale-revision conflict and reconciles to the reloaded revision', async () => {
    const user = userEvent.setup()
    const getProfile = vi
      .fn()
      .mockResolvedValueOnce(buildProfile({ revision: 2 }))
      .mockResolvedValueOnce(buildProfile({ revision: 5, heightSlider: 65 }))
    const saveSliders = vi
      .fn()
      .mockRejectedValue(new Error('SILHOUETTE_REVISION_MISMATCH'))
    renderPanel({
      userId: 'user-1',
      getProfile,
      saveSliders,
      sliderSaveDebounceMs: 5,
    })

    const heightSlider = await screen.findByLabelText('Height')
    fireEvent.change(heightSlider, { target: { value: '80' } })
    const reloadButton = await screen.findByRole('button', {
      name: 'Reload the latest version',
    })

    await user.click(reloadButton)

    await waitFor(() => expect(getProfile).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(heightSlider).toHaveValue('65'))
    expect(
      screen.queryByRole('button', { name: 'Reload the latest version' })
    ).not.toBeInTheDocument()

    // The next save must use the reconciled revision, not the stale one.
    fireEvent.change(heightSlider, { target: { value: '70' } })
    await waitFor(() => {
      expect(saveSliders).toHaveBeenLastCalledWith(
        { heightSlider: 70, buildSlider: 50 },
        '"silhouette:user-1:5"',
        expect.anything()
      )
    })
  })

  it('reports busy while a slider edit is debounced or its save is still in flight, not only while uploading or polling', async () => {
    const getProfile = vi.fn().mockResolvedValue(buildProfile({ revision: 2 }))
    let resolveSave: (value: SilhouetteProfileContract) => void = () => undefined
    const saveSliders = vi.fn().mockReturnValue(
      new Promise<SilhouetteProfileContract>((resolve) => {
        resolveSave = resolve
      })
    )
    const onBusyChange = vi.fn()
    renderPanel({
      userId: 'user-1',
      getProfile,
      saveSliders,
      onBusyChange,
      sliderSaveDebounceMs: 5,
    })

    const heightSlider = await screen.findByLabelText('Height')
    onBusyChange.mockClear()
    fireEvent.change(heightSlider, { target: { value: '80' } })

    // Busy the instant the edit is scheduled, before the debounce even fires.
    await waitFor(() => expect(onBusyChange).toHaveBeenCalledWith(true))

    await waitFor(() => expect(saveSliders).toHaveBeenCalled())
    expect(onBusyChange).not.toHaveBeenCalledWith(false)

    resolveSave(buildProfile({ revision: 3, heightSlider: 80 }))
    await waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(false))
  })

  it('reports busy while removing the My Form photo', async () => {
    const getProfile = vi.fn().mockResolvedValue(
      buildProfile({
        mode: 'my_form',
        revision: 4,
        myForm: {
          status: 'ready',
          failureReason: null,
          committedAt: '2026-08-09T09:05:00.000Z',
          imageAccess: {
            url: 'https://example.test/me.png',
            expiresAt: '2026-08-09T10:00:00.000Z',
          },
        },
      })
    )
    let resolveRemove: (value: SilhouetteProfileContract) => void = () => undefined
    const removeMyFormPhoto = vi.fn().mockReturnValue(
      new Promise<SilhouetteProfileContract>((resolve) => {
        resolveRemove = resolve
      })
    )
    const onBusyChange = vi.fn()
    const user = userEvent.setup()
    renderPanel({ userId: 'user-1', getProfile, removeMyFormPhoto, onBusyChange })

    onBusyChange.mockClear()
    await user.click(await screen.findByRole('button', { name: 'Remove My Form photo' }))

    await waitFor(() => expect(onBusyChange).toHaveBeenCalledWith(true))

    resolveRemove(buildProfile({ revision: 5 }))
    await waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(false))
  })

  it('does not let starting a My Form removal abort an in-flight slider save, or vice versa', async () => {
    const getProfile = vi.fn().mockResolvedValue(
      buildProfile({
        mode: 'my_form',
        revision: 4,
        myForm: {
          status: 'ready',
          failureReason: null,
          committedAt: '2026-08-09T09:05:00.000Z',
          imageAccess: {
            url: 'https://example.test/me.png',
            expiresAt: '2026-08-09T10:00:00.000Z',
          },
        },
      })
    )
    const sliderSaveSignals: AbortSignal[] = []
    const saveSliders = vi.fn(
      (
        _input: { heightSlider: number; buildSlider: number },
        _ifMatch: string,
        signal?: AbortSignal
      ) => {
        if (signal) sliderSaveSignals.push(signal)
        return new Promise<SilhouetteProfileContract>(() => undefined)
      }
    )
    const removeMyFormPhoto = vi.fn(
      () => new Promise<SilhouetteProfileContract>(() => undefined)
    )
    const user = userEvent.setup()
    renderPanel({
      userId: 'user-1',
      getProfile,
      saveSliders,
      removeMyFormPhoto,
      sliderSaveDebounceMs: 5,
    })

    const heightSlider = await screen.findByLabelText('Height')
    fireEvent.change(heightSlider, { target: { value: '80' } })
    await waitFor(() => expect(saveSliders).toHaveBeenCalled())

    await user.click(await screen.findByRole('button', { name: 'Remove My Form photo' }))
    expect(removeMyFormPhoto).toHaveBeenCalled()

    expect(sliderSaveSignals[0]?.aborted).toBe(false)
  })

  it('keeps polling a My Form photo that is still processing through an unrelated revision bump (e.g. a concurrent slider save)', async () => {
    const getProfile = vi
      .fn()
      .mockResolvedValueOnce(
        buildProfile({
          mode: 'my_form',
          revision: 1,
          myForm: {
            status: 'processing',
            failureReason: null,
            committedAt: '2026-08-09T09:05:00.000Z',
            imageAccess: null,
          },
        })
      )
      // Revision jumps from an unrelated slider save while still processing.
      .mockResolvedValueOnce(
        buildProfile({
          mode: 'my_form',
          revision: 7,
          myForm: {
            status: 'processing',
            failureReason: null,
            committedAt: '2026-08-09T09:05:00.000Z',
            imageAccess: null,
          },
        })
      )
      .mockResolvedValueOnce(
        buildProfile({
          mode: 'my_form',
          revision: 7,
          myForm: {
            status: 'ready',
            failureReason: null,
            committedAt: '2026-08-09T09:05:00.000Z',
            imageAccess: {
              url: 'https://example.test/me.png',
              expiresAt: '2026-08-09T10:00:00.000Z',
            },
          },
        })
      )
    renderPanel({ userId: 'user-1', getProfile, pollIntervalsMs: [5, 5, 5] })

    await waitFor(() => {
      expect(screen.getByText('My Form photo ready')).toBeInTheDocument()
    })
    expect(getProfile).toHaveBeenCalledTimes(3)
  })

  it('blocks a retry that would resubmit after the basewear confirmation was revoked', async () => {
    const user = userEvent.setup()
    const getProfile = vi.fn().mockResolvedValue(buildProfile())
    const uploadMyFormPhoto = vi.fn().mockResolvedValue(
      buildProfile({
        revision: 1,
        myForm: {
          status: 'failed',
          failureReason: 'timeout',
          committedAt: '2026-08-09T09:05:00.000Z',
          imageAccess: null,
        },
      })
    )
    renderPanel({ userId: 'user-1', getProfile, uploadMyFormPhoto })

    await screen.findByLabelText('Height')
    await confirmAndStartMyFormUpload(user)
    await screen.findByRole('button', { name: 'Retry upload' })

    // Revoke the confirmation that was true for the first attempt.
    await user.click(screen.getByLabelText(CONFIRM_CHECKBOX_LABEL))
    expect(uploadMyFormPhoto).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: 'Retry upload' }))

    expect(
      screen.getByText('Confirm the basewear guidance before uploading.')
    ).toBeInTheDocument()
    expect(uploadMyFormPhoto).toHaveBeenCalledTimes(1)
  })

  it('renders a mannequin that reshapes continuously with the height and build sliders', async () => {
    const getProfile = vi.fn().mockResolvedValue(buildProfile({ heightSlider: 50 }))
    renderPanel({ userId: 'user-1', getProfile })

    const heightSlider = await screen.findByLabelText('Height')
    const mannequin = screen.getByTestId('silhouette-mannequin')
    const groupBefore = mannequin.querySelector('g')
    const scaleYBefore = groupBefore?.getAttribute('style')

    fireEvent.change(heightSlider, { target: { value: '100' } })

    await waitFor(() => {
      expect(mannequin.querySelector('g')?.getAttribute('style')).not.toBe(scaleYBefore)
    })
  })
})

const PROCESSING_MY_FORM = {
  status: 'processing',
  failureReason: null,
  committedAt: '2026-08-09T09:05:00.000Z',
  imageAccess: null,
} as const

const READY_MY_FORM = {
  status: 'ready',
  failureReason: null,
  committedAt: '2026-08-09T09:05:00.000Z',
  imageAccess: {
    url: 'https://example.test/me.png',
    expiresAt: '2026-08-09T10:00:00.000Z',
  },
} as const

const FILE_READ_FAILED_MESSAGE = 'The selected photo could not be read.'

/**
 * jsdom's FileReader always succeeds, so the panel's read-failure path is only
 * reachable by standing in a reader that produces the failing outcome.
 */
function stubFileReader(behaviour: 'nonStringResult' | 'error') {
  class StubFileReader {
    onload: ((event: { target: { result: unknown } }) => void) | null = null
    onerror: (() => void) | null = null
    readAsDataURL() {
      setTimeout(() => {
        if (behaviour === 'error') {
          this.onerror?.()
          return
        }
        this.onload?.({ target: { result: new ArrayBuffer(8) } })
      }, 0)
    }
  }
  vi.stubGlobal('FileReader', StubFileReader)
}

describe('SilhouetteSettingsPanel slider persistence edge cases', () => {
  it('saves build-slider edits with the height value left untouched', async () => {
    const getProfile = vi.fn().mockResolvedValue(buildProfile({ revision: 2 }))
    const saveSliders = vi.fn().mockResolvedValue(buildProfile({ revision: 3 }))
    renderPanel({ userId: 'user-1', getProfile, saveSliders, sliderSaveDebounceMs: 5 })

    const buildSlider = await screen.findByLabelText('Build')
    fireEvent.change(buildSlider, { target: { value: '80' } })

    await waitFor(() => {
      expect(saveSliders).toHaveBeenCalledWith(
        { heightSlider: 50, buildSlider: 80 },
        '"silhouette:user-1:2"',
        expect.anything()
      )
    })
  })

  it('coalesces a rapid drag into a single save of the final value', async () => {
    const getProfile = vi.fn().mockResolvedValue(buildProfile({ revision: 2 }))
    const saveSliders = vi.fn().mockResolvedValue(buildProfile({ revision: 3 }))
    renderPanel({ userId: 'user-1', getProfile, saveSliders, sliderSaveDebounceMs: 15 })

    const heightSlider = await screen.findByLabelText('Height')
    fireEvent.change(heightSlider, { target: { value: '60' } })
    fireEvent.change(heightSlider, { target: { value: '70' } })
    fireEvent.change(heightSlider, { target: { value: '80' } })

    // One request per gesture, not one per pixel of drag.
    await waitFor(() => expect(saveSliders).toHaveBeenCalledTimes(1))
    expect(saveSliders).toHaveBeenCalledWith(
      { heightSlider: 80, buildSlider: 50 },
      '"silhouette:user-1:2"',
      expect.anything()
    )
  })

  it('defaults both sliders to the midpoint when the server has no saved values', async () => {
    const getProfile = vi
      .fn()
      .mockResolvedValue(buildProfile({ heightSlider: null, buildSlider: null }))
    renderPanel({ userId: 'user-1', getProfile })

    // A never-configured profile must render usable controls, not empty ones.
    expect(await screen.findByLabelText('Height')).toHaveValue('50')
    expect(screen.getByLabelText('Build')).toHaveValue('50')
  })

  it('reports a non-Error slider-save rejection instead of rendering nothing', async () => {
    const getProfile = vi.fn().mockResolvedValue(buildProfile({ revision: 2 }))
    const saveSliders = vi.fn().mockRejectedValue('ECONNRESET')
    renderPanel({ userId: 'user-1', getProfile, saveSliders, sliderSaveDebounceMs: 5 })

    fireEvent.change(await screen.findByLabelText('Height'), { target: { value: '80' } })

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('ECONNRESET'))
  })

  it('ignores a superseded slider save so the newer edit is not snapped back', async () => {
    const getProfile = vi.fn().mockResolvedValue(buildProfile({ revision: 2 }))
    const settlers: ((profile: SilhouetteProfileContract) => void)[] = []
    const saveSliders = vi.fn(
      () =>
        new Promise<SilhouetteProfileContract>((resolve) => {
          settlers.push(resolve)
        })
    )
    const onProfileChange = vi.fn()
    renderPanel({
      userId: 'user-1',
      getProfile,
      saveSliders,
      onProfileChange,
      sliderSaveDebounceMs: 5,
    })

    const heightSlider = await screen.findByLabelText('Height')
    fireEvent.change(heightSlider, { target: { value: '60' } })
    await waitFor(() => expect(saveSliders).toHaveBeenCalledTimes(1))
    fireEvent.change(heightSlider, { target: { value: '70' } })
    await waitFor(() => expect(saveSliders).toHaveBeenCalledTimes(2))
    onProfileChange.mockClear()

    await act(async () => {
      settlers[0]?.(buildProfile({ revision: 3, heightSlider: 60 }))
      await Promise.resolve()
    })

    // The first request was aborted when the second started; letting its answer
    // land would drag the slider back under the user's finger.
    expect(onProfileChange).not.toHaveBeenCalled()
    expect(heightSlider).toHaveValue('70')
  })

  it('stays silent when a superseded slider save fails', async () => {
    const getProfile = vi.fn().mockResolvedValue(buildProfile({ revision: 2 }))
    const rejecters: ((reason: Error) => void)[] = []
    const saveSliders = vi.fn(
      () =>
        new Promise<SilhouetteProfileContract>((_resolve, reject) => {
          rejecters.push(reject)
        })
    )
    renderPanel({ userId: 'user-1', getProfile, saveSliders, sliderSaveDebounceMs: 5 })

    const heightSlider = await screen.findByLabelText('Height')
    fireEvent.change(heightSlider, { target: { value: '60' } })
    await waitFor(() => expect(saveSliders).toHaveBeenCalledTimes(1))
    fireEvent.change(heightSlider, { target: { value: '70' } })
    await waitFor(() => expect(saveSliders).toHaveBeenCalledTimes(2))

    await act(async () => {
      rejecters[0]?.(new Error('aborted in flight'))
      await Promise.resolve()
    })

    // An error banner for a request the client itself replaced is noise.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('surfaces a failed reload after a stale-revision conflict', async () => {
    const user = userEvent.setup()
    const getProfile = vi
      .fn()
      .mockResolvedValueOnce(buildProfile({ revision: 2 }))
      .mockRejectedValueOnce(new Error('reload rejected'))
    const saveSliders = vi
      .fn()
      .mockRejectedValue(new Error('SILHOUETTE_REVISION_MISMATCH'))
    renderPanel({ userId: 'user-1', getProfile, saveSliders, sliderSaveDebounceMs: 5 })

    fireEvent.change(await screen.findByLabelText('Height'), { target: { value: '80' } })
    await user.click(
      await screen.findByRole('button', { name: 'Reload the latest version' })
    )

    // The reconciliation route itself can fail; failing silently would leave the
    // user clicking a button that does nothing.
    expect(await screen.findByText('reload rejected')).toBeInTheDocument()
  })

  it('surfaces a non-Error reload rejection', async () => {
    const user = userEvent.setup()
    const getProfile = vi
      .fn()
      .mockResolvedValueOnce(buildProfile({ revision: 2 }))
      .mockRejectedValueOnce('reload socket closed')
    const saveSliders = vi
      .fn()
      .mockRejectedValue(new Error('SILHOUETTE_REVISION_MISMATCH'))
    renderPanel({ userId: 'user-1', getProfile, saveSliders, sliderSaveDebounceMs: 5 })

    fireEvent.change(await screen.findByLabelText('Height'), { target: { value: '80' } })
    await user.click(
      await screen.findByRole('button', { name: 'Reload the latest version' })
    )

    expect(await screen.findByText('reload socket closed')).toBeInTheDocument()
  })
})

describe('SilhouetteSettingsPanel lifecycle guards', () => {
  it('discards an initial profile that arrives after the panel unmounts', async () => {
    let settleLoad: (profile: SilhouetteProfileContract) => void = () => undefined
    const getProfile = vi.fn().mockReturnValue(
      new Promise<SilhouetteProfileContract>((resolve) => {
        settleLoad = resolve
      })
    )
    const onProfileChange = vi.fn()
    const { unmount } = renderPanel({ userId: 'user-1', getProfile, onProfileChange })

    await screen.findByTestId('silhouette-loading')
    unmount()

    await act(async () => {
      settleLoad(buildProfile({ revision: 9 }))
      await Promise.resolve()
    })

    // The parent modal was already torn down; notifying it now would apply a
    // profile change nothing is listening for.
    expect(onProfileChange).not.toHaveBeenCalled()
  })

  it('discards an initial profile failure that arrives after the panel unmounts', async () => {
    let failLoad: (reason: Error) => void = () => undefined
    const failingGetProfile = vi.fn().mockReturnValue(
      new Promise<SilhouetteProfileContract>((_resolve, reject) => {
        failLoad = reject
      })
    )
    const { unmount } = renderPanel({ userId: 'user-1', getProfile: failingGetProfile })
    await screen.findByTestId('silhouette-loading')
    unmount()

    await act(async () => {
      failLoad(new Error('late load failure'))
      await Promise.resolve()
    })

    renderPanel({
      userId: 'user-1',
      getProfile: vi.fn().mockResolvedValue(buildProfile({ revision: 1 })),
    })

    // A fresh panel must not inherit the discarded failure.
    expect(await screen.findByLabelText('Height')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('reports a non-Error initial load rejection', async () => {
    const getProfile = vi.fn().mockRejectedValue('profile socket closed')
    renderPanel({ userId: 'user-1', getProfile })

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('profile socket closed')
    )
  })

  it('discards a poll response that arrives after the panel unmounts', async () => {
    let settlePoll: (profile: SilhouetteProfileContract) => void = () => undefined
    const getProfile = vi
      .fn()
      .mockResolvedValueOnce(
        buildProfile({ mode: 'my_form', revision: 1, myForm: PROCESSING_MY_FORM })
      )
      .mockReturnValueOnce(
        new Promise<SilhouetteProfileContract>((resolve) => {
          settlePoll = resolve
        })
      )
    const onProfileChange = vi.fn()
    const { unmount } = renderPanel({
      userId: 'user-1',
      getProfile,
      onProfileChange,
      pollIntervalsMs: [1, 1],
    })

    await waitFor(() => expect(getProfile).toHaveBeenCalledTimes(2))
    onProfileChange.mockClear()
    unmount()

    await act(async () => {
      settlePoll(buildProfile({ mode: 'my_form', revision: 2, myForm: READY_MY_FORM }))
      await Promise.resolve()
    })

    expect(onProfileChange).not.toHaveBeenCalled()
  })

  it('surfaces the reason when a poll request fails outright', async () => {
    const getProfile = vi
      .fn()
      .mockResolvedValueOnce(
        buildProfile({ mode: 'my_form', revision: 1, myForm: PROCESSING_MY_FORM })
      )
      .mockRejectedValue(new Error('poll request failed'))
    renderPanel({ userId: 'user-1', getProfile, pollIntervalsMs: [1, 1] })

    // A dead poll must not leave the panel showing "processing" forever.
    expect(await screen.findByText('poll request failed')).toBeInTheDocument()
  })

  it('surfaces a non-Error poll rejection', async () => {
    const getProfile = vi
      .fn()
      .mockResolvedValueOnce(
        buildProfile({ mode: 'my_form', revision: 1, myForm: PROCESSING_MY_FORM })
      )
      .mockRejectedValue('poll socket closed')
    renderPanel({ userId: 'user-1', getProfile, pollIntervalsMs: [1, 1] })

    expect(await screen.findByText('poll socket closed')).toBeInTheDocument()
  })
})

describe('SilhouetteSettingsPanel My Form file handling', () => {
  it('does nothing when the file picker is dismissed without a choice', async () => {
    const user = userEvent.setup()
    const getProfile = vi.fn().mockResolvedValue(buildProfile())
    const uploadMyFormPhoto = vi.fn()
    renderPanel({ userId: 'user-1', getProfile, uploadMyFormPhoto })

    await screen.findByLabelText('Height')
    await user.click(screen.getByLabelText(CONFIRM_CHECKBOX_LABEL))
    fireEvent.change(screen.getByLabelText('My Form photo file', { selector: 'input' }))

    expect(uploadMyFormPhoto).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('reports a photo whose bytes could not be decoded', async () => {
    stubFileReader('nonStringResult')
    const user = userEvent.setup()
    const getProfile = vi.fn().mockResolvedValue(buildProfile())
    const uploadMyFormPhoto = vi.fn()
    renderPanel({ userId: 'user-1', getProfile, uploadMyFormPhoto })

    await screen.findByLabelText('Height')
    await confirmAndStartMyFormUpload(user)

    expect(await screen.findByText(FILE_READ_FAILED_MESSAGE)).toBeInTheDocument()
    // Nothing is sent when the local read never produced an image.
    expect(uploadMyFormPhoto).not.toHaveBeenCalled()
  })

  it('reports a photo the reader failed on outright', async () => {
    stubFileReader('error')
    const user = userEvent.setup()
    const getProfile = vi.fn().mockResolvedValue(buildProfile())
    const uploadMyFormPhoto = vi.fn()
    renderPanel({ userId: 'user-1', getProfile, uploadMyFormPhoto })

    await screen.findByLabelText('Height')
    await confirmAndStartMyFormUpload(user)

    expect(await screen.findByText(FILE_READ_FAILED_MESSAGE)).toBeInTheDocument()
    expect(uploadMyFormPhoto).not.toHaveBeenCalled()
  })

  it('reports a non-Error upload rejection', async () => {
    const user = userEvent.setup()
    const getProfile = vi.fn().mockResolvedValue(buildProfile())
    const uploadMyFormPhoto = vi.fn().mockRejectedValue('upload socket closed')
    renderPanel({ userId: 'user-1', getProfile, uploadMyFormPhoto })

    await screen.findByLabelText('Height')
    await confirmAndStartMyFormUpload(user)

    expect(await screen.findByText('upload socket closed')).toBeInTheDocument()
  })

  it('renders actionable copy for a failure reason this client does not recognize', async () => {
    const getProfile = vi.fn().mockResolvedValue(
      buildProfile({
        revision: 1,
        myForm: {
          status: 'failed',
          // Deliberately out of contract: the commit response is not schema
          // validated at the call site, so a newer backend can hand this client
          // a reason it has no translation for.
          failureReason: 'moderation_hold',
          committedAt: '2026-08-09T09:05:00.000Z',
          imageAccess: null,
        },
      } as unknown as Partial<SilhouetteProfileContract>)
    )
    renderPanel({ userId: 'user-1', getProfile })

    await screen.findByLabelText('Height')
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Something went wrong with this photo. Try again.'
    )
  })
})

/**
 * Production follow-up 2026-11-19, review round 5 (C4-1): the picked photo, its Retry and the
 * basewear confirmation belong to the account signed in when the picker opened. An account
 * change drops all three, so Retry can never send one account's photo under the next.
 */
describe('SilhouetteSettingsPanel My Form account epoch', () => {
  /** FileReader loads held until the test finishes them, so a switch can land mid-read. */
  function holdFileReads() {
    const pending: (() => void)[] = []
    class HeldFileReader {
      onload: ((event: { target: { result: unknown } }) => void) | null = null
      onerror: (() => void) | null = null
      readAsDataURL() {
        pending.push(() =>
          this.onload?.({ target: { result: 'data:image/png;base64,ZmFrZQ==' } })
        )
      }
    }
    vi.stubGlobal('FileReader', HeldFileReader)
    // The read resolves a promise; act flushes what the panel does after it.
    return () =>
      act(async () => {
        for (const load of pending.splice(0)) load()
        await Promise.resolve()
      })
  }

  const myFormFileInput = () =>
    screen.getByLabelText('My Form photo file', { selector: 'input' })

  // Learning path Step 58: Image uploads straight to storage.
  // See _bmad-output/project-knowledge/learning-path-step-by-step.md#image-uploads-straight-to-storage
  it('drops a photo the picker returns after the account changed and clears the confirmation', async () => {
    const user = userEvent.setup()
    const finishReads = holdFileReads()
    const uploadMyFormPhoto = vi.fn()
    setUploadAttemptAccount('member-a')
    renderPanel({
      userId: 'user-1',
      getProfile: vi.fn().mockResolvedValue(buildProfile()),
      uploadMyFormPhoto,
    })
    await screen.findByLabelText('Height')

    await user.click(screen.getByLabelText(CONFIRM_CHECKBOX_LABEL))
    await user.click(screen.getByRole('button', { name: 'Upload a full-body photo' }))
    act(() => setUploadAttemptAccount('member-b'))
    fireEvent.change(myFormFileInput(), { target: { files: [makeFile()] } })
    await finishReads()

    expect(uploadMyFormPhoto).not.toHaveBeenCalled()
    expect(screen.getByLabelText(CONFIRM_CHECKBOX_LABEL)).not.toBeChecked()
    expect(screen.queryByRole('button', { name: 'Retry upload' })).not.toBeInTheDocument()
  })

  it('drops a photo whose read finishes after the account changed', async () => {
    const user = userEvent.setup()
    const finishReads = holdFileReads()
    const uploadMyFormPhoto = vi.fn()
    setUploadAttemptAccount('member-a')
    renderPanel({
      userId: 'user-1',
      getProfile: vi.fn().mockResolvedValue(buildProfile()),
      uploadMyFormPhoto,
    })
    await screen.findByLabelText('Height')

    await confirmAndStartMyFormUpload(user)
    act(() => setUploadAttemptAccount('member-b'))
    await finishReads()

    expect(uploadMyFormPhoto).not.toHaveBeenCalled()
    expect(screen.getByLabelText(CONFIRM_CHECKBOX_LABEL)).not.toBeChecked()
  })

  it("clears A's photo waiting on Retry and the confirmation, so Retry cannot upload it under B", async () => {
    const user = userEvent.setup()
    const uploadMyFormPhoto = vi.fn().mockRejectedValue(new Error('network down'))
    setUploadAttemptAccount('member-a')
    renderPanel({
      userId: 'user-1',
      getProfile: vi.fn().mockResolvedValue(buildProfile()),
      uploadMyFormPhoto,
    })
    await screen.findByLabelText('Height')
    await confirmAndStartMyFormUpload(user)
    expect(
      await screen.findByRole('button', { name: 'Retry upload' })
    ).toBeInTheDocument()

    act(() => setUploadAttemptAccount('member-b'))

    expect(screen.queryByRole('button', { name: 'Retry upload' })).not.toBeInTheDocument()
    expect(screen.queryByText('network down')).not.toBeInTheDocument()
    expect(screen.getByLabelText(CONFIRM_CHECKBOX_LABEL)).not.toBeChecked()
    expect(uploadMyFormPhoto).toHaveBeenCalledOnce()
    expect(uploadMyFormPhoto).toHaveBeenCalledWith(
      expect.objectContaining({
        uploadSession: expect.objectContaining({ account: 'member-a' }) as unknown,
      })
    )
  })
})

// Learning path Step 58: Image uploads straight to storage.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#image-uploads-straight-to-storage
//
// Production follow-up 2026-11-19 (review round 6, Codex C5-1): an account change clears
// everything read for the previous account (profile, revision, signed photo URL, a running poll)
// and reads the profile again for the account signed in now. Remove comes back only once that
// account's own read landed, and sends its revision with the session it was read under.
describe('SilhouetteSettingsPanel round 6 account switch with a My Form photo on screen', () => {
  const MEMBER_A_PHOTO = 'https://example.test/member-a.png'
  const MEMBER_B_PHOTO = 'https://example.test/member-b.png'

  function readyPhotoProfile(url: string, revision: number) {
    return buildProfile({
      mode: 'my_form',
      revision,
      myForm: { ...READY_MY_FORM, imageAccess: { ...READY_MY_FORM.imageAccess, url } },
    })
  }

  const myFormImage = () => screen.queryByRole('img', { name: 'My Form' })

  it("clears A's ready photo on the switch and removes with B's revision and session only", async () => {
    const user = userEvent.setup()
    let landMemberBRead: (profile: SilhouetteProfileContract) => void = () => undefined
    const getProfile = vi
      .fn()
      .mockResolvedValueOnce(readyPhotoProfile(MEMBER_A_PHOTO, 4))
      .mockReturnValueOnce(
        new Promise<SilhouetteProfileContract>((resolve) => {
          landMemberBRead = resolve
        })
      )
    const removeMyFormPhoto = vi.fn().mockResolvedValue(buildProfile({ revision: 10 }))
    setUploadAttemptAccount('member-a')
    renderPanel({ userId: 'member-a', getProfile, removeMyFormPhoto })
    expect(await screen.findByRole('img', { name: 'My Form' })).toHaveAttribute(
      'src',
      MEMBER_A_PHOTO
    )

    act(() => setUploadAttemptAccount('member-b'))

    // Nothing of A's is left while B's own read is still on the wire.
    expect(myFormImage()).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Remove My Form photo' })
    ).not.toBeInTheDocument()
    expect(getProfile).toHaveBeenCalledTimes(2)

    await act(async () => {
      landMemberBRead(readyPhotoProfile(MEMBER_B_PHOTO, 9))
      await Promise.resolve()
    })
    expect(await screen.findByRole('img', { name: 'My Form' })).toHaveAttribute(
      'src',
      MEMBER_B_PHOTO
    )
    await user.click(screen.getByRole('button', { name: 'Remove My Form photo' }))

    expect(removeMyFormPhoto).toHaveBeenCalledOnce()
    expect(removeMyFormPhoto).toHaveBeenCalledWith(
      '"silhouette:member-b:9"',
      expect.anything(),
      expect.objectContaining({ account: 'member-b' })
    )
  })

  it("drops A's poll answer that lands after the switch", async () => {
    let landMemberAPoll: (profile: SilhouetteProfileContract) => void = () => undefined
    const getProfile = vi
      .fn()
      .mockResolvedValueOnce(
        buildProfile({
          mode: 'my_form',
          myForm: {
            status: 'processing',
            failureReason: null,
            committedAt: '2026-08-09T09:05:00.000Z',
            imageAccess: null,
          },
        })
      )
      .mockReturnValueOnce(
        new Promise<SilhouetteProfileContract>((resolve) => {
          landMemberAPoll = resolve
        })
      )
      .mockResolvedValue(buildProfile({ revision: 2 }))
    const onProfileChange = vi.fn()
    setUploadAttemptAccount('member-a')
    renderPanel({
      userId: 'member-a',
      getProfile,
      onProfileChange,
      pollIntervalsMs: [1, 1],
    })
    // A's poll read is on the wire when the account changes.
    await waitFor(() => expect(getProfile).toHaveBeenCalledTimes(2))

    act(() => setUploadAttemptAccount('member-b'))
    await waitFor(() =>
      expect(onProfileChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ mode: 'default_mannequin', revision: 2 })
      )
    )
    onProfileChange.mockClear()

    await act(async () => {
      landMemberAPoll(readyPhotoProfile(MEMBER_A_PHOTO, 3))
      await Promise.resolve()
    })

    expect(onProfileChange).not.toHaveBeenCalled()
    expect(myFormImage()).not.toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  // Learning path Step 58: Image uploads straight to storage.
  // See _bmad-output/project-knowledge/learning-path-step-by-step.md#image-uploads-straight-to-storage
  //
  // Final review F-1: a sign-out leaves no account to read for, so the panel reads nothing.
  it("reads nothing after a sign-out and keeps nothing of A's on screen", async () => {
    const getProfile = vi.fn().mockResolvedValue(readyPhotoProfile(MEMBER_A_PHOTO, 4))
    setUploadAttemptAccount('member-a')
    renderPanel({ userId: 'member-a', getProfile })
    expect(await screen.findByRole('img', { name: 'My Form' })).toHaveAttribute(
      'src',
      MEMBER_A_PHOTO
    )

    act(() => setUploadAttemptAccount(null))

    expect(getProfile).toHaveBeenCalledOnce()
    expect(myFormImage()).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Remove My Form photo' })
    ).not.toBeInTheDocument()
  })

  // Learning path Step 58: Image uploads straight to storage.
  // See _bmad-output/project-knowledge/learning-path-step-by-step.md#image-uploads-straight-to-storage
  //
  // Pre-existing reload bug (real-session AS-0): a panel whose first read ran before this tab
  // held a verified bearer recovers when the verified account is reported, with no reload.
  it('reads again when the verified account arrives after a signed-out first read', async () => {
    const getProfile = vi
      .fn()
      .mockRejectedValueOnce(
        new WardrobeRequestError(
          'Your session expired. Sign in again before adding a garment.',
          'SIGNED_OUT'
        )
      )
      .mockResolvedValue(buildProfile({ heightSlider: 64 }))
    renderPanel({ userId: 'member-a', getProfile })
    expect(
      await screen.findByText(/Your session expired\. Sign in again/)
    ).toBeInTheDocument()

    act(() => setUploadAttemptAccount('member-a'))

    expect(await screen.findByLabelText('Height')).toHaveValue('64')
    expect(screen.queryByText(/Your session expired/)).not.toBeInTheDocument()
    expect(getProfile).toHaveBeenCalledTimes(2)
  })

  // Final review F-2: A's manual Reload after a revision conflict answers after B loaded.
  it("drops A's delayed conflict Reload answer that lands after B's profile loaded", async () => {
    const user = userEvent.setup()
    let landMemberAReload: (profile: SilhouetteProfileContract) => void = () => undefined
    const getProfile = vi
      .fn()
      .mockResolvedValueOnce(readyPhotoProfile(MEMBER_A_PHOTO, 4))
      .mockReturnValueOnce(
        new Promise<SilhouetteProfileContract>((resolve) => {
          landMemberAReload = resolve
        })
      )
      .mockResolvedValueOnce(buildProfile({ revision: 9, heightSlider: 23 }))
    const saveSliders = vi
      .fn()
      .mockRejectedValue(new Error('SILHOUETTE_REVISION_MISMATCH'))
    const onProfileChange = vi.fn()
    setUploadAttemptAccount('member-a')
    renderPanel({
      userId: 'member-a',
      getProfile,
      saveSliders,
      onProfileChange,
      sliderSaveDebounceMs: 5,
    })
    const heightSlider = await screen.findByLabelText('Height')
    fireEvent.change(heightSlider, { target: { value: '80' } })
    await user.click(
      await screen.findByRole('button', { name: 'Reload the latest version' })
    )
    // A's Reload is on the wire when B signs in, and B's own read lands first.
    await waitFor(() => expect(getProfile).toHaveBeenCalledTimes(2))
    act(() => setUploadAttemptAccount('member-b'))
    await waitFor(() => expect(heightSlider).toHaveValue('23'))
    onProfileChange.mockClear()

    await act(async () => {
      landMemberAReload(readyPhotoProfile(MEMBER_A_PHOTO, 5))
      await Promise.resolve()
    })

    expect(onProfileChange).not.toHaveBeenCalled()
    expect(myFormImage()).not.toBeInTheDocument()
    expect(heightSlider).toHaveValue('23')
  })
})

describe('SilhouetteSettingsPanel My Form removal failures', () => {
  function readyProfile() {
    return buildProfile({ mode: 'my_form', revision: 4, myForm: READY_MY_FORM })
  }

  it('maps a stale-revision conflict on removal to the translated message with a reload', async () => {
    const user = userEvent.setup()
    const getProfile = vi.fn().mockResolvedValue(readyProfile())
    const removeMyFormPhoto = vi
      .fn()
      .mockRejectedValue(new Error('SILHOUETTE_REVISION_MISMATCH'))
    renderPanel({ userId: 'user-1', getProfile, removeMyFormPhoto })

    await user.click(await screen.findByRole('button', { name: 'Remove My Form photo' }))

    expect(
      await screen.findByText(
        'This step changed elsewhere. Review the latest version and try again.'
      )
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Reload the latest version' })
    ).toBeInTheDocument()
  })

  it('surfaces the reason when removal fails for an ordinary error', async () => {
    const user = userEvent.setup()
    const getProfile = vi.fn().mockResolvedValue(readyProfile())
    const removeMyFormPhoto = vi.fn().mockRejectedValue(new Error('storage unavailable'))
    renderPanel({ userId: 'user-1', getProfile, removeMyFormPhoto })

    await user.click(await screen.findByRole('button', { name: 'Remove My Form photo' }))

    expect(await screen.findByText('storage unavailable')).toBeInTheDocument()
    // The photo is still there, so the remove affordance has to come back.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Remove My Form photo' })).toBeEnabled()
    )
  })

  it('surfaces a non-Error removal rejection', async () => {
    const user = userEvent.setup()
    const getProfile = vi.fn().mockResolvedValue(readyProfile())
    const removeMyFormPhoto = vi.fn().mockRejectedValue('remove socket closed')
    renderPanel({ userId: 'user-1', getProfile, removeMyFormPhoto })

    await user.click(await screen.findByRole('button', { name: 'Remove My Form photo' }))

    expect(await screen.findByText('remove socket closed')).toBeInTheDocument()
  })

  it('discards a removal result that arrives after the panel unmounts', async () => {
    const user = userEvent.setup()
    const getProfile = vi.fn().mockResolvedValue(readyProfile())
    let settleRemove: (profile: SilhouetteProfileContract) => void = () => undefined
    const removeMyFormPhoto = vi.fn().mockReturnValue(
      new Promise<SilhouetteProfileContract>((resolve) => {
        settleRemove = resolve
      })
    )
    const onProfileChange = vi.fn()
    const { unmount } = renderPanel({
      userId: 'user-1',
      getProfile,
      removeMyFormPhoto,
      onProfileChange,
    })

    await user.click(await screen.findByRole('button', { name: 'Remove My Form photo' }))
    await waitFor(() => expect(removeMyFormPhoto).toHaveBeenCalled())
    onProfileChange.mockClear()
    unmount()

    await act(async () => {
      settleRemove(buildProfile({ revision: 5 }))
      await Promise.resolve()
    })

    expect(onProfileChange).not.toHaveBeenCalled()
  })

  it('discards a removal failure that arrives after the panel unmounts', async () => {
    const user = userEvent.setup()
    const getProfile = vi.fn().mockResolvedValue(readyProfile())
    let failRemove: (reason: Error) => void = () => undefined
    const removeMyFormPhoto = vi.fn().mockReturnValue(
      new Promise<SilhouetteProfileContract>((_resolve, reject) => {
        failRemove = reject
      })
    )
    const onBusyChange = vi.fn()
    const { unmount } = renderPanel({
      userId: 'user-1',
      getProfile,
      removeMyFormPhoto,
      onBusyChange,
    })

    await user.click(await screen.findByRole('button', { name: 'Remove My Form photo' }))
    await waitFor(() => expect(onBusyChange).toHaveBeenCalledWith(true))
    unmount()
    onBusyChange.mockClear()

    await act(async () => {
      failRemove(new Error('late removal failure'))
      await Promise.resolve()
    })

    // Nothing left to tell; reporting busy=false into a torn-down parent would
    // be a state update on a component that no longer exists.
    expect(onBusyChange).not.toHaveBeenCalled()
  })
})

/**
 * Production follow-up 2026-11-19, review round 4 (C3-8): these drive the real upload lib
 * through the panel's own Retry button, with only the network and jsdom's missing image
 * decoder and canvas stood in for. Retry resumes the attempt while its outcome is ambiguous;
 * when the server has ended it, that same Retry tap starts one fresh attempt with fresh keys.
 */
describe('SilhouetteSettingsPanel My Form Retry through the real upload', () => {
  type Leg = 'allocate' | 'upload' | 'commit'
  const STAGING_URL = 'https://storage.test/staging/my-form-session'
  const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

  const json = (status: number, body: unknown) => () =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      })
    )
  const allocated = json(200, {
    data: {
      uploadSessionId: 'my-form-session',
      uploadUrl: STAGING_URL,
      uploadToken: 'upload-token',
      requiredHeaders: { 'content-type': 'image/jpeg' },
      expiresAt: '2026-11-19T10:15:00.000Z',
    },
  })
  const stored = () => Promise.resolve(new Response(null, { status: 200 }))
  const networkDown = () => Promise.reject(new TypeError('Failed to fetch'))
  const committed = json(200, {
    data: buildProfile({
      mode: 'my_form',
      revision: 1,
      myForm: {
        status: 'processing',
        failureReason: null,
        committedAt: '2026-11-19T10:01:00.000Z',
        imageAccess: null,
      },
    }),
  })

  /** Every prepared photo encodes to the same bytes, as a re-encode of one photo does. */
  function standInForImagePreparation() {
    class DecodedImage {
      naturalWidth = 900
      naturalHeight = 1200
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      set src(_value: string) {
        queueMicrotask(() => this.onload?.())
      }
    }
    vi.stubGlobal('Image', DecodedImage as unknown as typeof Image)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
      fillRect: vi.fn(),
    } as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(
      (callback: BlobCallback, type?: string) => {
        callback(
          new NodeBlob(['same-full-body-photo'], {
            type: type ?? 'image/jpeg',
          }) as unknown as Blob
        )
      }
    )
  }

  /** Answers each leg from its own queue and records the idempotency key of every call. */
  function installLegs(queues: Record<Leg, (() => Promise<Response>)[]>) {
    const keys: Record<Leg, (string | undefined)[]> = {
      allocate: [],
      upload: [],
      commit: [],
    }
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : String(input)
        const leg: Leg | null = url.includes('/silhouette/my-form/upload-url')
          ? 'allocate'
          : url === STAGING_URL
            ? 'upload'
            : url.includes('/silhouette/my-form/commit')
              ? 'commit'
              : null
        if (!leg) return Promise.reject(new Error(`Unhandled fetch in test: ${url}`))
        keys[leg].push(
          (init?.headers as Record<string, string> | undefined)?.['idempotency-key']
        )
        const answer = queues[leg].shift()
        if (!answer) return Promise.reject(new Error(`No answer left for ${leg}`))
        return answer()
      })
    )
    return keys
  }

  async function renderWithRealUpload() {
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'test-access-token')
    standInForImagePreparation()
    const getProfile = vi
      .fn()
      .mockResolvedValueOnce(buildProfile())
      .mockResolvedValue(
        buildProfile({
          mode: 'my_form',
          revision: 2,
          myForm: {
            status: 'ready',
            failureReason: null,
            committedAt: '2026-11-19T10:01:00.000Z',
            imageAccess: {
              url: 'https://storage.test/signed/my-form.jpg',
              expiresAt: '2026-11-19T11:01:00.000Z',
            },
          },
        })
      )
    renderPanel({ userId: 'user-1', getProfile, pollIntervalsMs: [1] })
    await screen.findByLabelText('Height')
    return getProfile
  }

  it('starts one fresh attempt in the same Retry tap once the commit it resumed answers UPLOAD_SESSION_EXPIRED', async () => {
    const user = userEvent.setup()
    const keys = installLegs({
      allocate: [allocated, allocated],
      upload: [stored, stored],
      commit: [networkDown, json(409, { message: 'UPLOAD_SESSION_EXPIRED' }), committed],
    })
    await renderWithRealUpload()

    await confirmAndStartMyFormUpload(user)
    await screen.findByRole('alert')
    expect(keys.commit).toHaveLength(1)

    // One Retry tap: it commits the open attempt again with its key, the server says the
    // session expired, and the same tap allocates, uploads and commits with fresh keys.
    await user.click(screen.getByRole('button', { name: 'Retry upload' }))

    expect(await screen.findByText('My Form photo ready')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry upload' })).not.toBeInTheDocument()
    expect(keys.allocate).toHaveLength(2)
    expect(keys.allocate[1]).toMatch(UUID_V4)
    expect(keys.allocate[1]).not.toBe(keys.allocate[0])
    expect(keys.upload).toHaveLength(2)
    expect(keys.commit).toHaveLength(3)
    expect(keys.commit[0]).toMatch(UUID_V4)
    expect(keys.commit[1]).toBe(keys.commit[0])
    expect(keys.commit[2]).toMatch(UUID_V4)
    expect(keys.commit[2]).not.toBe(keys.commit[0])
  })

  it('keeps the attempt on Retry after UPLOAD_IN_PROGRESS and shows a retryable message', async () => {
    const user = userEvent.setup()
    const keys = installLegs({
      allocate: [allocated],
      upload: [stored],
      commit: [json(409, { message: 'UPLOAD_IN_PROGRESS' }), committed],
    })
    await renderWithRealUpload()

    await confirmAndStartMyFormUpload(user)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This photo is still being saved. Try again in a moment.'
    )

    await user.click(screen.getByRole('button', { name: 'Retry upload' }))
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Retry upload' })
      ).not.toBeInTheDocument()
    )
    expect(keys.allocate).toHaveLength(1)
    expect(keys.upload).toHaveLength(1)
    expect(keys.commit[0]).toMatch(UUID_V4)
    expect(keys.commit).toEqual([keys.commit[0], keys.commit[0]])
  })
})
