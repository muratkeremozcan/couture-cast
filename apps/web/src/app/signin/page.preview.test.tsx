// Story 6.16 D7, D8: sign-in from the guest preview goes to the review step; any other
// sign-in deletes guest state. `from` is honored only as the literal `preview`.
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createGuestPreviewStore,
  GUEST_PREVIEW_STRINGS,
  SAMPLE_CATALOG,
} from '@couture/utils'
import { getI18n } from '../../i18n'
import type * as WebSession from '../../lib/web-session'
import { setWebGuestPreviewStoreForTests } from '../../lib/guest-preview'

const auth = vi.hoisted(() => ({ request: vi.fn(), verify: vi.fn() }))
vi.mock('../../lib/web-session', async (importOriginal) => ({
  ...(await importOriginal<typeof WebSession>()),
  requestWebOtp: auth.request,
  verifyWebOtp: auth.verify,
}))
import SignInPage from './page'

const label = (key: string) => getI18n().t(`community.notifications.${key}`)
const realLocation = window.location
let assign: ReturnType<typeof vi.fn>

function memoryAdapter() {
  let value: string | null = null
  return {
    value: () => value,
    read: () => Promise.resolve(value),
    write: (text: string) => {
      value = text
      return Promise.resolve()
    },
    remove: () => {
      value = null
      return Promise.resolve()
    },
  }
}

function at(search: string) {
  assign = vi.fn()
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...realLocation, search, assign },
  })
}

async function signIn() {
  render(<SignInPage />)
  fireEvent.change(screen.getByLabelText(label('email')), {
    target: { value: 'member@example.test' },
  })
  fireEvent.click(screen.getByRole('button', { name: label('sendCode') }))
  fireEvent.change(await screen.findByLabelText(label('code')), {
    target: { value: '123456' },
  })
  fireEvent.click(screen.getByRole('button', { name: label('verify') }))
}

beforeEach(async () => {
  await getI18n().changeLanguage('en-US')
  auth.request.mockResolvedValue(undefined)
  auth.verify.mockResolvedValue(undefined)
})

afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: realLocation })
  setWebGuestPreviewStoreForTests(undefined)
})

describe('sign-in after the guest preview', () => {
  it('goes to the review step when a carryover intent is stored', async () => {
    at('?from=preview')
    const adapter = memoryAdapter()
    const store = createGuestPreviewStore({ adapter, catalog: SAMPLE_CATALOG })
    setWebGuestPreviewStoreForTests(store)
    store.start()
    store.update((state) => ({
      ...state,
      conversion: { intent: 'guest-preview-carryover' },
    }))
    await store.flush()
    await signIn()
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/preview/continue'))
    expect(adapter.value()).not.toBeNull()
  })

  it('deletes guest state after a sign-in that did not come from the preview (L-G-SIGNIN)', async () => {
    at('')
    const adapter = memoryAdapter()
    const store = createGuestPreviewStore({ adapter, catalog: SAMPLE_CATALOG })
    setWebGuestPreviewStoreForTests(store)
    store.start()
    await store.flush()
    await signIn()
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/'))
    expect(adapter.value()).toBeNull()
  })

  it('clears a stored intent when the sign-in did not come from the preview (L-G-THEN-A-ELSEWHERE)', async () => {
    at('')
    const adapter = memoryAdapter()
    const store = createGuestPreviewStore({ adapter, catalog: SAMPLE_CATALOG })
    setWebGuestPreviewStoreForTests(store)
    store.start()
    store.update((state) => ({
      ...state,
      conversion: { intent: 'guest-preview-carryover' },
    }))
    await store.flush()
    await signIn()
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/'))
    expect(adapter.value()).toBeNull()
  })

  it('offers the way back to the preview only for the exact literal', async () => {
    at('?from=preview')
    const { unmount } = render(<SignInPage />)
    expect((await screen.findByTestId('signin-back-to-preview')).textContent).toBe(
      GUEST_PREVIEW_STRINGS['en-US'].conversionDetail.backToPreview
    )
    unmount()
    at('?from=https://evil.example')
    render(<SignInPage />)
    await waitFor(() => expect(screen.queryByTestId('signin-back-to-preview')).toBeNull())
  })
})
