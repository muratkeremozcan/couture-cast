// R11: rendered settings use the real HTTP wrapper and verified-session boundary.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useMswHandlers } from '../../test-utils/msw/runtime'
import { getI18n } from '../../i18n'
const session = vi.hoisted(() => ({ owner: null as string | null }))
vi.mock(
  '@couture/api-client',
  async () => import('../../../../../packages/api-client/src/index')
)
vi.mock('../../lib/web-session', () => ({
  webSessionIdentity: () => session.owner,
  resolveWebSessionToken: () =>
    Promise.resolve(session.owner ? `verified-${session.owner}` : undefined),
  signOutWebSession: vi.fn(),
}))
import NotificationSettingsPage from './page'
const settings = (revision = 'revision-1') => ({
  enabled: false,
  pushEnabled: true,
  quietHoursEnabled: false,
  quietHoursStart: '22:00',
  quietHoursEnd: '07:00',
  timezone: 'Europe/London',
  timezoneConfigured: true,
  revision,
})
const label = (key: string) => getI18n().t(`community.notifications.${key}`)
beforeEach(async () => {
  session.owner = null
  await getI18n().changeLanguage('en-US')
})
function identify(owner: string | null) {
  act(() => {
    session.owner = owner
    window.dispatchEvent(new Event('couture:session'))
  })
}
describe('R11 verified settings journeys', () => {
  it('waits for verified identity, replaces account settings and clears them on signout', async () => {
    const requests: string[] = []
    useMswHandlers(
      http.get('*/api/v1/community/notification-preferences', ({ request }) => {
        const bearer = request.headers.get('authorization')!
        requests.push(bearer)
        return HttpResponse.json({
          data: {
            ...settings(),
            timezone: bearer.endsWith('member-b') ? 'Europe/Paris' : 'Europe/London',
          },
        })
      })
    )
    render(<NotificationSettingsPage />)
    expect(screen.queryByLabelText(label('timezone'))).toBeNull()
    expect(requests).toHaveLength(0)
    identify('member-a')
    await screen.findByDisplayValue('Europe/London')
    identify('member-b')
    expect(screen.queryByDisplayValue('Europe/London')).toBeNull()
    await screen.findByDisplayValue('Europe/Paris')
    identify(null)
    expect(screen.queryByLabelText(label('timezone'))).toBeNull()
    expect(requests).toEqual(['Bearer verified-member-a', 'Bearer verified-member-b'])
  })
  it('rebases a conflict without discarding edits and sends only changed fields', async () => {
    let reads = 0
    const writes: unknown[] = []
    useMswHandlers(
      http.get('*/api/v1/community/notification-preferences', () => {
        reads++
        return HttpResponse.json({
          data:
            reads === 1
              ? settings()
              : { ...settings('revision-2'), quietHoursEnabled: true },
        })
      }),
      http.patch('*/api/v1/community/notification-preferences', async ({ request }) => {
        writes.push(await request.json())
        return writes.length === 1
          ? HttpResponse.json({ code: 'revision_conflict' }, { status: 409 })
          : HttpResponse.json({
              data: { ...settings('revision-3'), enabled: true, quietHoursEnabled: true },
            })
      })
    )
    session.owner = 'member-a'
    render(<NotificationSettingsPage />)
    const enabled = await screen.findByLabelText(label('enabled'))
    fireEvent.click(enabled)
    fireEvent.click(screen.getByRole('button', { name: label('save') }))
    await waitFor(() => expect(reads).toBe(2))
    await waitFor(() => expect(screen.getByLabelText(label('quiet'))).toBeChecked())
    expect(screen.getByLabelText(label('enabled'))).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: label('save') }))
    await screen.findByText(label('saved'))
    expect(writes).toEqual([
      { baseRevision: 'revision-1', enabled: true },
      { baseRevision: 'revision-2', enabled: true },
    ])
  })
})
