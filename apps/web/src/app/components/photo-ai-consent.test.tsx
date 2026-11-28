// Learning path Step 81: Photo AI consent and processor approval.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-81-photo-ai-consent-and-processor-approval
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ResponseError } from '@couture/api-client'
import type * as ApiClient from '@couture/api-client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getI18n } from '../../i18n'
import { PhotoAiConsent } from './photo-ai-consent'

type Consent = Awaited<ReturnType<typeof ApiClient.requestPhotoAiConsent>>
type Grant = Consent['grants'][number]
const FIRST: Grant = {
  id: 'web-grant-a',
  feature: 'garment-tags',
  inputClass: 'garment-photo',
  provider: 'fixture-processor',
  policyVersion: 'fixture-v1',
  expiresAt: '2090-12-01T00:00:00.000Z',
}
const SECOND: Grant = { ...FIRST, id: 'web-grant-b', feature: 'garment-cutout' }

const { requestConsent, session, createClient } = vi.hoisted(() => ({
  requestConsent: vi.fn<typeof ApiClient.requestPhotoAiConsent>(),
  session: { owner: null as string | null, scope: null as string | null },
  createClient: vi.fn((options: { accessToken: string }) => options),
}))
vi.mock('@couture/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  requestPhotoAiConsent: requestConsent,
}))
vi.mock('../../lib/api-client', () => ({ createWebApiClient: createClient }))
vi.mock('../../lib/use-web-session', () => ({
  captureWebStyleBearer: (scope: string) =>
    scope === session.scope ? `verified-${session.owner}` : null,
  currentWebSessionOwner: () => session.owner,
  currentWebStyleScope: () => session.scope,
  readAsMember: async (
    _owner: string,
    run: () => Promise<unknown>,
    isDenial: (error: unknown) => boolean
  ) => {
    try {
      return await run()
    } catch (error) {
      if (isDenial(error)) return run()
      throw error
    }
  },
  useWebStyleScope: () => session.scope,
}))

function identify(owner: string | null) {
  session.owner = owner
  session.scope = owner ? `verified:${owner}` : null
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function consent(...grants: Grant[]): Consent {
  return { externalProcessingEnabled: false, grants }
}

const revokeButton = (grant: Grant) => `photo-ai-revoke-${grant.id}`
const message = (key: string) => getI18n().t(`settings.photoAi.${key}`)

describe('CC-7.24 web photo AI consent', () => {
  beforeEach(async () => {
    await getI18n().changeLanguage('en-US')
    identify('member-a')
    requestConsent.mockReset()
    createClient.mockClear()
  })

  it('clears the panel and avoids member reads when signed out', async () => {
    requestConsent.mockResolvedValueOnce(consent(FIRST))
    const view = render(<PhotoAiConsent />)
    await screen.findByTestId(revokeButton(FIRST))

    identify(null)
    view.rerender(<PhotoAiConsent />)

    expect(screen.queryByTestId('photo-ai-consent')).toBeNull()
    expect(requestConsent).toHaveBeenCalledTimes(1)
  })

  it('offers a retry after a read error and keeps the grant on a failed revocation', async () => {
    requestConsent
      .mockRejectedValueOnce(new Error('read unavailable'))
      .mockResolvedValueOnce(consent(FIRST))
      .mockRejectedValueOnce(new Error('write unavailable'))
      .mockResolvedValueOnce(consent())
    const user = userEvent.setup()
    render(<PhotoAiConsent />)

    const retry = await screen.findByRole('button', { name: message('retry') })
    expect(screen.getByRole('status')).toHaveTextContent(message('loadError'))
    await user.click(retry)
    const button = await screen.findByTestId(revokeButton(FIRST))
    expect(screen.queryByRole('status')).toBeNull()
    await user.click(button)

    expect(await screen.findByRole('status')).toHaveTextContent(message('revokeError'))
    expect(button).toBeEnabled()
    await user.click(button)
    await waitFor(() => expect(screen.queryByTestId(revokeButton(FIRST))).toBeNull())
    expect(screen.getByRole('status')).toHaveTextContent(message('revoked'))
    expect(requestConsent.mock.calls.map(([, , id]) => id)).toEqual([
      undefined,
      undefined,
      FIRST.id,
      FIRST.id,
    ])
  })

  it('classifies a 401 as a bearer denial for the member-read retry', async () => {
    requestConsent
      .mockRejectedValueOnce(new ResponseError(new Response(null, { status: 401 })))
      .mockResolvedValueOnce(consent(FIRST))

    render(<PhotoAiConsent />)

    expect(await screen.findByTestId(revokeButton(FIRST))).toBeEnabled()
    expect(requestConsent).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('discards a previous member’s late revocation and keeps the new member’s grant', async () => {
    const pending = deferred<Consent>()
    requestConsent
      .mockResolvedValueOnce(consent(FIRST))
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(consent(SECOND))
    const user = userEvent.setup()
    const view = render(<PhotoAiConsent />)
    await user.click(await screen.findByTestId(revokeButton(FIRST)))
    await waitFor(() => expect(requestConsent.mock.calls[1]?.[2]).toBe(FIRST.id))

    identify('member-b')
    view.rerender(<PhotoAiConsent />)
    expect(screen.queryByTestId(revokeButton(FIRST))).toBeNull()
    await screen.findByTestId(revokeButton(SECOND))
    await act(async () => {
      pending.resolve(consent())
      await pending.promise
    })

    expect(requestConsent.mock.calls[1]?.[1].aborted).toBe(true)
    expect(createClient.mock.calls.map(([options]) => options.accessToken)).toEqual([
      'verified-member-a',
      'verified-member-a',
      'verified-member-b',
    ])
    expect(screen.getByTestId(revokeButton(SECOND))).toBeEnabled()
  })
})
