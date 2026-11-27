// Learning path Step 77: Account style profile.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-77-account-style-profile
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, it, vi } from 'vitest'
import {
  updateStyleProfileInputSchema,
  type StyleProfile,
  type UpdateStyleProfileInput,
} from '@couture/api-client/contracts/http'
import { getI18n } from '../../i18n'
import { useWebStyleProfile } from '../../lib/style-profile'
import { useMswHandlers as registerMswHandlers } from '../../test-utils/msw/runtime'
import { StyleDayControls, StyleMemberControls } from './style-profile-controls'

const session = vi.hoisted(() => ({ scope: null as string | null }))
vi.mock('../../lib/use-web-session', () => ({
  captureWebStyleBearer: (scope: string) =>
    scope === session.scope ? 'style-controls-token' : null,
  currentWebSessionOwner: () => session.scope,
  currentWebStyleScope: () => session.scope,
  readAsMember: (_owner: string, request: () => Promise<unknown>) => request(),
  subscribeWebStyleScope: () => () => undefined,
  useWebStyleScope: () => session.scope,
}))

const PATH = '*/api/v1/personalization/style-profile'
const EMPTY: StyleProfile = {
  mood: null,
  palette: null,
  texture: null,
  fit: null,
  avoid: [],
}

function Controls({ groupTune = false }: { groupTune?: boolean }) {
  const style = useWebStyleProfile()
  return (
    <I18nextProvider i18n={getI18n()}>
      {!groupTune && <StyleMemberControls style={style} showClear />}
      <StyleDayControls style={style} showTune={groupTune} />
    </I18nextProvider>
  )
}

const control = (name: string) => screen.getByTestId(`style-${name}`)

function serveProfile(options: { failedReads?: number; failPatch?: boolean } = {}) {
  let profile = EMPTY
  let failedReads = options.failedReads ?? 0
  let shouldFailPatch = options.failPatch
  const writes: (UpdateStyleProfileInput | 'clear')[] = []
  const reply = () => HttpResponse.json({ data: profile })
  const isMember = (request: Request) =>
    request.headers.get('authorization') === 'Bearer style-controls-token'
  const failure = () => new HttpResponse(null, { status: 503 })
  const unauthorized = () => new HttpResponse(null, { status: 401 })
  registerMswHandlers(
    http.get(PATH, ({ request }) => {
      if (!isMember(request)) return unauthorized()
      if (failedReads > 0) {
        failedReads -= 1
        return failure()
      }
      return reply()
    }),
    http.patch(PATH, async ({ request }) => {
      if (!isMember(request)) return unauthorized()
      const patch = updateStyleProfileInputSchema.parse(await request.json())
      writes.push(patch)
      if (shouldFailPatch) {
        shouldFailPatch = false
        return failure()
      }
      profile = { ...profile, ...patch }
      return reply()
    }),
    http.delete(PATH, ({ request }) => {
      if (!isMember(request)) return unauthorized()
      writes.push('clear')
      profile = EMPTY
      return reply()
    })
  )
  return writes
}

describe('CC-7.20 web style profile controls', () => {
  it('recovers a failed initial read inline, then saves and clears a mood', async () => {
    session.scope = 'style-load-and-clear'
    const writes = serveProfile({ failedReads: 1 })
    const user = userEvent.setup()
    render(<Controls />)

    const retry = await screen.findByTestId('style-profile-retry')
    expect(control('mood-classic')).toBeDisabled()
    await user.click(retry)
    await waitFor(() => expect(control('mood-classic')).toBeEnabled())
    expect(screen.queryByTestId('style-profile-retry')).toBeNull()

    await user.click(control('mood-classic'))
    await waitFor(() =>
      expect(control('mood-classic')).toHaveAttribute('aria-pressed', 'true')
    )
    await user.click(control('profile-clear'))
    await waitFor(() =>
      expect(control('mood-classic')).toHaveAttribute('aria-pressed', 'false')
    )
    expect(writes).toEqual([{ mood: 'classic' }, 'clear'])
  })

  it('retries a read from inside Tune and returns focus to its trigger on close', async () => {
    session.scope = 'style-modal-read-retry'
    const writes = serveProfile({ failedReads: 2 })
    const user = userEvent.setup()
    render(<Controls />)

    await screen.findByTestId('style-profile-retry')
    const open = control('tune-open')
    await user.click(open)
    const dialog = screen.getByRole('dialog', { name: 'Tune my style' })
    expect(await within(dialog).findByRole('alert')).toBeVisible()
    await user.click(within(dialog).getByRole('button', { name: 'Try again' }))
    expect(await within(dialog).findByTestId('style-palette-neutral')).toBeVisible()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(open).toHaveFocus())
    expect(writes).toEqual([])
  })

  it('clears an inline save error when Tune opens and accepts a subsequent save', async () => {
    session.scope = 'style-mood-write-recovery'
    const writes = serveProfile({ failPatch: true })
    const user = userEvent.setup()
    render(<Controls />)
    await waitFor(() => expect(control('mood-active')).toBeEnabled())

    await user.click(control('mood-active'))
    expect(await screen.findByRole('alert')).toBeVisible()
    await user.click(control('tune-open'))
    const dialog = screen.getByRole('dialog', { name: 'Tune my style' })
    expect(screen.queryByRole('alert')).toBeNull()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(dialog).not.toBeInTheDocument())
    await user.click(control('mood-active'))
    await waitFor(() =>
      expect(control('mood-active')).toHaveAttribute('aria-pressed', 'true')
    )
    expect(writes).toEqual([{ mood: 'active' }, { mood: 'active' }])
  })

  it('preserves a Tune draft on failure, supports Skip, and finishes with a piece toggle', async () => {
    session.scope = 'style-tune-retry'
    const writes = serveProfile({ failPatch: true })
    const user = userEvent.setup()
    render(<Controls />)
    await waitFor(() => expect(control('mood-active')).toBeEnabled())
    await user.click(control('tune-open'))
    const dialog = screen.getByRole('dialog', { name: 'Tune my style' })
    const palette = within(dialog).getByRole('button', { name: 'Colorful' })
    await user.click(palette)
    await user.click(control('tune-next'))
    expect(await within(dialog).findByRole('alert')).toBeVisible()
    expect(palette).toHaveAttribute('aria-pressed', 'true')
    await user.click(control('tune-next'))
    expect(await screen.findByTestId('style-fit-relaxed')).toBeVisible()
    expect(within(dialog).queryByRole('alert')).toBeNull()
    await user.click(control('tune-skip'))
    const cropTop = within(dialog).getByRole('button', { name: 'Crop tops' })
    await user.click(cropTop)
    expect(cropTop).toHaveAttribute('aria-pressed', 'true')
    await user.click(control('tune-next'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(writes).toEqual([
      { palette: 'colorful' },
      { palette: 'colorful' },
      { avoid: ['crop-top'] },
    ])
  })

  it('changes and resets day choices without writing the profile', async () => {
    session.scope = 'style-day-local'
    const writes = serveProfile()
    const user = userEvent.setup()
    render(<Controls />)
    await waitFor(() => expect(control('mood-active')).toBeEnabled())
    await user.click(control('day-open'))
    const cool = control('day-temperature-cool')
    const cozy = control('day-mood-cozy')
    const reset = control('day-reset')
    expect(reset).toBeDisabled()
    await user.click(cool)
    await user.click(cozy)
    expect(cool).toHaveAttribute('aria-pressed', 'true')
    expect(cozy).toHaveAttribute('aria-pressed', 'true')
    expect(control('mood-cozy')).toHaveAttribute('aria-pressed', 'false')
    await user.click(cool)
    expect(cool).toHaveAttribute('aria-pressed', 'false')
    expect(cozy).toHaveAttribute('aria-pressed', 'true')
    await user.click(reset)
    expect(cool).toHaveAttribute('aria-pressed', 'false')
    expect(cozy).toHaveAttribute('aria-pressed', 'false')
    expect(reset).toBeDisabled()
    expect(writes).toEqual([])
  })

  it('opens Tune from the populated Today disclosure', async () => {
    session.scope = 'style-grouped-actions'
    const user = userEvent.setup()
    render(<Controls groupTune />)
    expect(control('tune-open')).not.toBeVisible()
    await user.click(control('day-open'))
    await user.click(control('tune-open'))
    expect(await screen.findByTestId('style-palette-neutral')).toBeVisible()
    expect(screen.queryByTestId('style-mood-active')).toBeNull()
  })
})
