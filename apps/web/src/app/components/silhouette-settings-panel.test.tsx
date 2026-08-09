// Story 4.4 Task 5 owner: unit-test the web silhouette settings panel
// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nextProvider } from 'react-i18next'
import type { SilhouetteProfileContract } from '@couture/api-client/contracts/http'
import { SilhouetteSettingsPanel } from './silhouette-settings-panel'
import { WardrobeRequestError } from '../../lib/wardrobe'
import { getI18n } from '../../i18n'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
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
    renderPanel({ userId: 'user-1', getProfile, saveSliders })

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

  it('uploads a My Form photo once confirmed and reuses one idempotency key across a retry', async () => {
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
    await user.click(screen.getByLabelText(CONFIRM_CHECKBOX_LABEL))
    await user.click(screen.getByRole('button', { name: 'Upload a full-body photo' }))
    const fileInput = screen.getByLabelText('My Form photo file', { selector: 'input' })
    await user.upload(fileInput, makeFile())

    await waitFor(() => expect(uploadMyFormPhoto).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('alert')).toHaveTextContent('network down')

    await user.click(screen.getByRole('button', { name: 'Retry upload' }))

    await waitFor(() => expect(uploadMyFormPhoto).toHaveBeenCalledTimes(2))
    const [firstCall, secondCall] = uploadMyFormPhoto.mock.calls as [
      [{ idempotencyKey: string }],
      [{ idempotencyKey: string }],
    ]
    expect(firstCall[0].idempotencyKey).toBe(secondCall[0].idempotencyKey)
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
    await user.click(screen.getByLabelText(CONFIRM_CHECKBOX_LABEL))
    await user.click(screen.getByRole('button', { name: 'Upload a full-body photo' }))
    await user.upload(
      screen.getByLabelText('My Form photo file', { selector: 'input' }),
      makeFile()
    )

    await waitFor(() => {
      expect(screen.getByText('My Form photo ready')).toBeInTheDocument()
    })
    expect(
      screen.getByRole('button', { name: 'Remove My Form photo' })
    ).toBeInTheDocument()
  })

  it.each([
    ['contrast', CONTRAST_MESSAGE],
    ['privacy_violation', PRIVACY_VIOLATION_MESSAGE],
    ['timeout', /Processing took too long\. Try again\./],
    ['storage_error', STORAGE_ERROR_MESSAGE],
  ] as const)(
    'shows the %s failure reason with a retry action',
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
      await user.click(screen.getByLabelText(CONFIRM_CHECKBOX_LABEL))
      await user.click(screen.getByRole('button', { name: 'Upload a full-body photo' }))
      await user.upload(
        screen.getByLabelText('My Form photo file', { selector: 'input' }),
        makeFile()
      )

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent(message)
      })
      expect(screen.getByRole('button', { name: 'Retry upload' })).toBeInTheDocument()
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
      expect(removeMyFormPhoto).toHaveBeenCalledWith(
        '"silhouette:user-1:4"',
        expect.anything()
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
    await user.click(screen.getByLabelText(CONFIRM_CHECKBOX_LABEL))
    await user.click(screen.getByRole('button', { name: 'Upload a full-body photo' }))
    await user.upload(
      screen.getByLabelText('My Form photo file', { selector: 'input' }),
      makeFile()
    )

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('GUARDIAN_CONSENT_REQUIRED')
    })
  })
})
