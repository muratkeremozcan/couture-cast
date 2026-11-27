// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
// Story CC-7.11 test owner (TEA): 7.11-CMP-SIL-01 to 7.11-CMP-SIL-06 (D6, D10: Silhouette is a
// route under Closet with the top bar back; the panel's own states are
// components/silhouette-settings-panel.test.tsx).
// Test design: _bmad-output/test-artifacts/test-design-7-11-five-tab-navigation-back-pattern.md
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as WardrobeModule from '../../../lib/wardrobe'
import { WEB_ACCESS_TOKEN_STORAGE_KEY } from '../../../lib/wardrobe'
import { signInFixtureMember } from '../../../test-utils/member-session'
import WardrobeSilhouettePage from './page'

const router = vi.hoisted(() => ({
  back: vi.fn(),
  replace: vi.fn(),
  push: vi.fn(),
  prefetch: vi.fn(),
}))
vi.mock('next/navigation', () => ({
  usePathname: () => '/wardrobe/silhouette',
  useRouter: () => router,
}))
vi.mock('posthog-js', () => ({ default: { capture: vi.fn() } }))

const resolveCurrentUserId = vi.hoisted(() => vi.fn())
vi.mock('../../../lib/wardrobe', async (importOriginal) => ({
  ...(await importOriginal<typeof WardrobeModule>()),
  resolveCurrentUserId,
}))

// The panel is the existing Silhouette editor; this route only owns what surrounds it.
vi.mock('../../components/silhouette-settings-panel', () => ({
  SilhouetteSettingsPanel: ({
    userId,
    onBusyChange,
  }: {
    userId: string
    onBusyChange: (busy: boolean) => void
  }) => (
    <div data-testid="silhouette-panel-stub" data-user-id={userId}>
      <button type="button" onClick={() => onBusyChange(true)}>
        start saving
      </button>
      <button type="button" onClick={() => onBusyChange(false)}>
        stop saving
      </button>
    </div>
  ),
}))

/** A read the test answers by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  resolveCurrentUserId.mockReset()
})

afterEach(() => {
  window.sessionStorage.removeItem(WEB_ACCESS_TOKEN_STORAGE_KEY)
})

describe('7.11 Silhouette route (D6)', () => {
  it('7.11-CMP-SIL-01 titles the screen Silhouette with a back link to Closet, under the Closet tab', () => {
    render(<WardrobeSilhouettePage />)

    expect(screen.getByTestId('app-top-bar-title')).toHaveTextContent('Silhouette')
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    const back = screen.getByTestId('app-top-bar-back')
    expect(back).toHaveAttribute('href', '/wardrobe')
    expect(back).toHaveTextContent('Back')
    expect(screen.getByTestId('bottom-nav-wardrobe')).toHaveAttribute(
      'aria-current',
      'page'
    )
  })

  it('7.11-CMP-SIL-02 signed out offers Sign in and reads no account', () => {
    render(<WardrobeSilhouettePage />)

    const signIn = screen.getByTestId('silhouette-sign-in')
    expect(signIn).toHaveAttribute('href', '/signin')
    expect(signIn).toHaveTextContent('Sign in')
    expect(screen.queryByTestId('silhouette-panel-stub')).toBeNull()
    expect(resolveCurrentUserId).not.toHaveBeenCalled()
  })

  it('7.11-CMP-SIL-03 a member sees the loading line, then the panel for their account', async () => {
    signInFixtureMember()
    const account = deferred<string>()
    resolveCurrentUserId.mockReturnValueOnce(account.promise)

    render(<WardrobeSilhouettePage />)

    expect(screen.getByText('Loading your closet')).toHaveAttribute('role', 'status')
    expect(screen.queryByTestId('silhouette-panel-stub')).toBeNull()

    await act(async () => {
      account.resolve('member-1')
      await account.promise
    })

    expect(screen.getByTestId('silhouette-panel-stub')).toHaveAttribute(
      'data-user-id',
      'member-1'
    )
    expect(screen.queryByText('Loading your closet')).toBeNull()
    expect(screen.queryByTestId('silhouette-sign-in')).toBeNull()
  })

  it('7.11-CMP-SIL-04 announces a save in progress and clears it when the panel is done', async () => {
    signInFixtureMember()
    resolveCurrentUserId.mockResolvedValueOnce('member-1')

    render(<WardrobeSilhouettePage />)
    await screen.findByTestId('silhouette-panel-stub')

    fireEvent.click(screen.getByRole('button', { name: 'start saving' }))
    expect(screen.getByText('Saving changes. Please wait.')).toHaveClass('sr-only')

    fireEvent.click(screen.getByRole('button', { name: 'stop saving' }))
    expect(screen.queryByText('Saving changes. Please wait.')).toBeNull()
  })

  it('7.11-CMP-SIL-05 an account read failure shows the alert, and Retry reads again into the panel', async () => {
    signInFixtureMember()
    resolveCurrentUserId.mockRejectedValueOnce(new Error('offline'))
    resolveCurrentUserId.mockResolvedValueOnce('member-1')

    render(<WardrobeSilhouettePage />)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(
      "We can't load your account. Reload the page to change your fit settings."
    )
    expect(screen.queryByTestId('silhouette-panel-stub')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByTestId('silhouette-panel-stub')).toHaveAttribute(
      'data-user-id',
      'member-1'
    )
    expect(screen.queryByRole('alert')).toBeNull()
    expect(resolveCurrentUserId).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['answers', (read: ReturnType<typeof deferred<string>>) => read.resolve('member-1')],
    [
      'fails',
      (read: ReturnType<typeof deferred<string>>) => read.reject(new Error('gone')),
    ],
  ])(
    '7.11-CMP-SIL-06 an account read that %s after sign-out changes nothing',
    async (_label, settle) => {
      signInFixtureMember()
      const account = deferred<string>()
      resolveCurrentUserId.mockReturnValueOnce(account.promise)

      render(<WardrobeSilhouettePage />)
      expect(screen.getByText('Loading your closet')).toBeVisible()

      act(() => {
        window.sessionStorage.removeItem(WEB_ACCESS_TOKEN_STORAGE_KEY)
        window.dispatchEvent(new Event('couture:session'))
      })
      expect(screen.getByTestId('silhouette-sign-in')).toBeVisible()
      await act(async () => {
        settle(account)
        await account.promise.catch(() => undefined)
      })

      expect(screen.getByTestId('silhouette-sign-in')).toBeVisible()
      expect(screen.queryByRole('alert')).toBeNull()
      expect(screen.queryByTestId('silhouette-panel-stub')).toBeNull()
    }
  )
})
