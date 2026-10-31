// Shared setup for the share-card dialog tests: the 6.8 save tests in
// share-card-dialog.test.tsx and the 6.9 Web Share tests in share-card-dialog.share.test.tsx.
// Each test file still declares its own `vi.mock('../../lib/web-session')` with a hoisted
// identity, because vitest hoists mocks only from the test file itself.
import { webcrypto } from 'node:crypto'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { beforeEach, vi } from 'vitest'
import { preparedShareCardFixture } from '@couture/api-client/testing/share-card-fixture'
import { ShareCardControl } from '../app/components/share-card-dialog'
import { currentI18n } from '../i18n'
import { useMswHandlers } from './msw/runtime'

export const source = {
  kind: 'outfit',
  recommendationId: 'owned-recommendation',
} as const
export const endpoint = 'http://localhost:3001/api/v1/share-cards/prepare'
export const requests: unknown[] = []
export const handoff = vi.fn()

export const handler = () =>
  http.post(endpoint, async ({ request }) => {
    requests.push(await request.json())
    return HttpResponse.json({ data: preparedShareCardFixture })
  })

/** Registers the per-test reset: member one signed in, online, en-US, approved prepare. */
export function setupShareCardDialog(identity: { member: string | null }) {
  beforeEach(async () => {
    identity.member = 'member-one'
    requests.length = 0
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'http://localhost:3001')
    vi.stubGlobal('crypto', webcrypto)
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:approved'),
    })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(handoff)
    await currentI18n().changeLanguage('en-US')
    useMswHandlers(handler())
  })
}

/** Renders the control, opens the dialog and returns the preview image (not yet loaded). */
export async function open(
  target: Parameters<typeof ShareCardControl>[0]['source'] = source
) {
  render(<ShareCardControl source={target} />)
  await userEvent.click(screen.getByTestId('share-card-open'))
  return screen.findByTestId('share-card-preview')
}
