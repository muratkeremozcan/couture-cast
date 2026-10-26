import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { currentI18n } from '../../i18n'
import { RitualShareCardLauncher } from './ritual-share-card-launcher'

const auth = vi.hoisted(() => ({
  member: null as string | null,
  resolve: vi.fn<() => Promise<string | undefined>>(),
}))
const api = vi.hoisted(() => ({
  factory: vi.fn(),
  ritual:
    vi.fn<
      (query: { locale: string }, options: { signal: AbortSignal }) => Promise<unknown>
    >(),
}))
vi.mock('../../lib/web-session', () => ({
  resolveWebSessionToken: auth.resolve,
  webSessionIdentity: () => auth.member,
}))
vi.mock('../../lib/api-client', () => ({ createWebApiClient: api.factory }))
vi.mock('./share-card-dialog', () => ({
  ShareCardControl: ({ source }: { source: { recommendationId: string } }) => (
    <button>{source.recommendationId}</button>
  ),
}))
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
const response = {
  data: {
    weather: {
      locationKey: 'synthetic-location',
      latitude: 40,
      longitude: -74,
      timezone: 'America/New_York',
      provider: 'openweather',
      providerUpdatedAt: '2026-10-26T00:00:00.000Z',
      fetchedAt: '2026-10-26T00:00:00.000Z',
      current: { temperature: 21, condition: 'rain' },
      hourly: Array.from({ length: 48 }, (_, hour) => ({
        forecastAt: new Date(Date.UTC(2026, 9, 26, hour)).toISOString(),
        temperature: 21,
        feelsLike: 20,
        precipitationProbability: 0.25,
        precipitationAmount: 0.4,
        windSpeed: 4,
        windGust: null,
        condition: 'rain',
        providerWeatherCode: '500',
      })),
      alerts: [],
    },
    outfits: (['morning', 'midday', 'evening'] as const).map((scenario) => ({
      id: `owned-${scenario}`,
      scenario,
      garmentIds: ['owned-garment'],
      reasoningBadges: [],
      comfortNotes: '',
      shopThisLook: null,
    })),
    badges: [],
  },
}
function publish(member: string | null) {
  act(() => {
    auth.member = member
    window.dispatchEvent(new Event('couture:session'))
  })
}
function activate() {
  fireEvent.click(screen.getByRole('button', { name: 'Create my outfit card' }))
}
beforeEach(async () => {
  auth.member = null
  auth.resolve.mockReset().mockResolvedValue('verified-bearer')
  api.factory.mockReset().mockReturnValue({ apiV1RitualGet: api.ritual })
  api.ritual.mockReset().mockResolvedValue(response)
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
  await currentI18n().changeLanguage('en-US')
})
describe('ritual share launcher verified-session boundary', () => {
  it('waits for canonical profile verification before creating a bearer request on immediate activation', async () => {
    const token = deferred<string | undefined>()
    auth.resolve.mockReturnValue(token.promise)
    render(<RitualShareCardLauncher />)
    activate()
    expect(auth.resolve).toHaveBeenCalledTimes(1)
    expect(api.factory).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Preparing card' })).toBeDisabled()
    publish(null)
    publish('verified-member')
    expect(api.ritual).not.toHaveBeenCalled()
    await act(async () => {
      token.resolve('verified-bearer')
      await token.promise
    })
    expect(await screen.findByRole('combobox')).toHaveValue('morning')
    expect(api.factory).toHaveBeenCalledExactlyOnceWith({
      accessToken: 'verified-bearer',
    })
    expect(api.ritual.mock.calls[0]?.[0]).toEqual({ locale: 'en-US' })
    expect(api.ritual.mock.calls[0]?.[1].signal).toBeInstanceOf(AbortSignal)
    expect(screen.getByRole('button', { name: 'owned-morning' })).toBeInTheDocument()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'evening' } })
    expect(screen.getByRole('button', { name: 'owned-evening' })).toBeInTheDocument()
  })
  it('cancels a known member departure during token verification without issuing a request or stale error', async () => {
    auth.member = 'first-member'
    const token = deferred<string | undefined>()
    auth.resolve.mockReturnValue(token.promise)
    render(<RitualShareCardLauncher />)
    activate()
    publish(null)
    publish('second-member')
    await act(async () => {
      token.resolve('former-bearer')
      await token.promise
    })
    expect(api.factory).not.toHaveBeenCalled()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create my outfit card' })).toBeEnabled()
  })
  it('aborts an in-flight former-member ritual and ignores its late response after a new activation', async () => {
    auth.member = 'first-member'
    const former = deferred<typeof response>()
    api.ritual.mockReturnValueOnce(former.promise)
    render(<RitualShareCardLauncher />)
    activate()
    await waitFor(() => expect(api.ritual).toHaveBeenCalledTimes(1))
    const formerSignal = api.ritual.mock.calls[0]?.[1].signal
    publish('second-member')
    expect(formerSignal?.aborted).toBe(true)
    activate()
    expect(await screen.findByRole('combobox')).toBeInTheDocument()
    await act(async () => {
      former.reject(new Error('former request failed'))
      await Promise.resolve()
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    publish('second-member')
    expect(screen.getByRole('combobox')).toBeInTheDocument()
    publish(null)
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })
  it('does not send a request after unmount while verification is pending', async () => {
    const token = deferred<string | undefined>()
    auth.resolve.mockReturnValue(token.promise)
    const view = render(<RitualShareCardLauncher />)
    activate()
    view.unmount()
    await act(async () => {
      token.resolve('verified-bearer')
      await token.promise
    })
    expect(api.factory).not.toHaveBeenCalled()
  })
  it.each(['rejected', 'signed-out'] as const)(
    'reports %s verification without sending an unauthenticated request',
    async (result) => {
      if (result === 'rejected')
        auth.resolve.mockRejectedValue(new Error('profile unavailable'))
      else auth.resolve.mockResolvedValue(undefined)
      render(<RitualShareCardLauncher />)
      activate()
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'This source is unavailable.'
      )
      expect(api.factory).not.toHaveBeenCalled()
    }
  )
  it('fails offline before session resolution and lets the member retry', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    render(<RitualShareCardLauncher />)
    activate()
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(auth.resolve).not.toHaveBeenCalled()
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
    activate()
    expect(await screen.findByRole('combobox')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
