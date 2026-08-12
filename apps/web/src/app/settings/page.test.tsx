// Learning path Step 33: Affiliate "Shop this look" CTA.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-33-affiliate-shop-this-look-cta
// Story 5.1 Task 7 owner: Web settings page and commerce opt-out section.
//
// These go through MSW rather than a mocked `lib/commerce`, so the request
// shape, the bearer header, and the contract parsing are all exercised by the
// same tests that cover the UI states.
import axe from 'axe-core'
import { http, HttpResponse } from 'msw'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WEB_ACCESS_TOKEN_STORAGE_KEY } from '../../lib/wardrobe'
import { useMswHandlers } from '../../test-utils/msw/runtime'
import SettingsPage from './page'

vi.mock('next/navigation', () => ({
  usePathname: () => '/settings',
}))
vi.mock('posthog-js', () => ({
  default: { capture: vi.fn() },
}))

const PREFERENCES_PATH = '/api/v1/commerce/preferences'

function signIn() {
  window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'test-access-token')
}

/** A promise the test resolves by hand, so a pending request needs no timer. */
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

function preferenceHandlers(options: {
  initial?: boolean
  onPut?: (body: unknown, request: Request) => void
  putGate?: Promise<void>
  putStatus?: number
  getStatus?: number
}) {
  const initial = options.initial ?? true
  return [
    http.get(PREFERENCES_PATH, () => {
      if (options.getStatus) {
        return HttpResponse.json(
          {
            statusCode: options.getStatus,
            message: 'Unable to reach shopping preferences.',
            error: 'Internal Server Error',
          },
          { status: options.getStatus }
        )
      }
      return HttpResponse.json({ data: { affiliateCtasEnabled: initial } })
    }),
    http.put(PREFERENCES_PATH, async ({ request }) => {
      const body: unknown = await request.clone().json()
      options.onPut?.(body, request)
      if (options.putGate) {
        await options.putGate
      }
      if (options.putStatus) {
        return HttpResponse.json(
          {
            statusCode: options.putStatus,
            message: 'Unable to store shopping preferences right now.',
            error: 'Internal Server Error',
          },
          { status: options.putStatus }
        )
      }
      const parsed = body as { affiliateCtasEnabled: boolean }
      return HttpResponse.json({
        data: { affiliateCtasEnabled: parsed.affiliateCtasEnabled },
      })
    }),
  ]
}

function toggle() {
  return screen.getByTestId('commerce-opt-out-toggle')
}

/**
 * A jsdom axe pass over the rendered tree.
 *
 * This does not replace `playwright/tests/accessibility-hardening.spec.ts`:
 * jsdom has no layout, so axe cannot evaluate `color-contrast` or target size
 * here. It does catch the failures this section is most likely to introduce
 * (an unlabelled control, a broken `aria-describedby`, content outside a
 * landmark) on every unit run instead of only in a browser run.
 */
async function expectNoAxeViolations(container: HTMLElement) {
  const results = await axe.run(container, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
    // Turned off rather than left to report "incomplete": jsdom paints nothing,
    // so this rule can only probe a canvas it does not implement. The browser
    // suite is where contrast is actually judged.
    rules: { 'color-contrast': { enabled: false } },
  })
  expect(
    results.violations,
    `Accessibility violations found:\n${JSON.stringify(results.violations, null, 2)}`
  ).toEqual([])
}

describe('Web settings page', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
  })

  afterEach(() => {
    window.sessionStorage.clear()
  })

  /**
   * `playwright/tests/accessibility-hardening.spec.ts` asserts this contract on
   * the real route. Pinning it here too means a redesign of this page fails in
   * the unit suite in seconds rather than in a browser run.
   */
  it('5.1-WEB-SETTINGS-01 keeps the skip-link landmark contract and the bottom nav', () => {
    render(<SettingsPage />)

    const landmarks = document.querySelectorAll('main#main-content')
    expect(landmarks).toHaveLength(1)
    expect(landmarks[0]).toHaveAttribute('tabindex', '-1')
    expect(landmarks[0]).toHaveAttribute('data-focus-surface', 'dark')
    expect(screen.getByTestId('sticky-bottom-nav')).toBeInTheDocument()
  })

  it('5.1-WEB-SETTINGS-02 renders the disclosure above the toggle, signed out, with no request', async () => {
    const seen = vi.fn()
    useMswHandlers(
      http.get(PREFERENCES_PATH, () => {
        seen()
        return HttpResponse.json({ data: { affiliateCtasEnabled: true } })
      })
    )

    render(<SettingsPage />)

    expect(
      screen.getByRole('heading', { name: 'Shopping and partners' })
    ).toBeInTheDocument()
    const disclosure = await screen.findByTestId('commerce-disclosure')
    expect(disclosure).toHaveTextContent('CoutureCast may earn a commission.')
    expect(disclosure).toHaveTextContent('No wardrobe photos or personal details')

    const hint = await screen.findByTestId('commerce-signed-out-hint')
    expect(hint).toHaveTextContent('Sign in to change this')
    expect(toggle()).toBeDisabled()
    expect(toggle()).toHaveAccessibleDescription(/Sign in to change this/)

    // Reading order: the disclosure precedes the control it describes.
    expect(
      disclosure.compareDocumentPosition(toggle()) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(seen).not.toHaveBeenCalled()
  })

  it('5.1-WEB-SETTINGS-03 loads the stored preference with a bearer token', async () => {
    signIn()
    const authorization = vi.fn<(value: string | null) => void>()
    useMswHandlers(
      http.get(PREFERENCES_PATH, ({ request }) => {
        authorization(request.headers.get('authorization'))
        return HttpResponse.json({ data: { affiliateCtasEnabled: true } })
      })
    )

    render(<SettingsPage />)

    await waitFor(() => expect(toggle()).toBeEnabled())
    expect(toggle()).toBeChecked()
    expect(authorization).toHaveBeenCalledWith('Bearer test-access-token')
    expect(screen.queryByTestId('commerce-signed-out-hint')).not.toBeInTheDocument()
  })

  it('5.1-WEB-SETTINGS-04 reflects an opted-out account as unchecked', async () => {
    signIn()
    useMswHandlers(...preferenceHandlers({ initial: false }))

    render(<SettingsPage />)

    await waitFor(() => expect(toggle()).toBeEnabled())
    expect(toggle()).not.toBeChecked()
  })

  it('5.1-WEB-SETTINGS-05 turns the opt-out off optimistically and confirms on success', async () => {
    signIn()
    const gate = deferred<void>()
    const bodies: unknown[] = []
    useMswHandlers(
      ...preferenceHandlers({
        initial: true,
        putGate: gate.promise,
        onPut: (body) => bodies.push(body),
      })
    )

    render(<SettingsPage />)
    await waitFor(() => expect(toggle()).toBeEnabled())

    fireEvent.click(toggle())

    // Optimistic: the new value shows before the request has answered.
    expect(toggle()).not.toBeChecked()
    // Busy, not disabled. Disabling mid-save drops the element out of the focus
    // order and the browser moves focus to `<body>`, which loses a keyboard
    // user's place in the page. The end-to-end keyboard journey caught that, so
    // this pins the shape of the fix.
    expect(toggle()).toBeEnabled()
    expect(toggle()).toHaveAttribute('aria-busy', 'true')

    // Re-entrancy is still refused: a second activation while the first is in
    // flight must not produce a second request.
    fireEvent.click(toggle())
    expect(toggle()).not.toBeChecked()

    gate.resolve()

    await waitFor(() =>
      expect(screen.getByTestId('commerce-status-region')).toHaveTextContent(
        'Shopping preferences updated'
      )
    )
    expect(toggle()).not.toBeChecked()
    expect(toggle()).toBeEnabled()
    expect(bodies).toEqual([{ affiliateCtasEnabled: false }])
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('5.1-WEB-SETTINGS-06 turns the opt-out back on and sends the true value', async () => {
    signIn()
    const bodies: unknown[] = []
    useMswHandlers(
      ...preferenceHandlers({ initial: false, onPut: (body) => bodies.push(body) })
    )

    render(<SettingsPage />)
    await waitFor(() => expect(toggle()).toBeEnabled())

    fireEvent.click(toggle())

    await waitFor(() =>
      expect(screen.getByTestId('commerce-status-region')).toHaveTextContent(
        'Shopping preferences updated'
      )
    )
    expect(toggle()).toBeChecked()
    expect(bodies).toEqual([{ affiliateCtasEnabled: true }])
  })

  it('5.1-WEB-SETTINGS-07 reverts the optimistic value and alerts when the save fails', async () => {
    signIn()
    useMswHandlers(...preferenceHandlers({ initial: true, putStatus: 500 }))

    render(<SettingsPage />)
    await waitFor(() => expect(toggle()).toBeEnabled())

    fireEvent.click(toggle())
    expect(toggle()).not.toBeChecked()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Unable to store shopping preferences right now.')
    // Reverted: the control must not keep claiming a state the server rejected.
    expect(toggle()).toBeChecked()
    expect(toggle()).toBeEnabled()
    expect(screen.getByTestId('commerce-status-region')).toHaveTextContent('')
  })

  it('5.1-WEB-SETTINGS-08 recovers on a retry after a failed save', async () => {
    signIn()
    let putStatus: number | undefined = 500
    useMswHandlers(
      http.get(PREFERENCES_PATH, () =>
        HttpResponse.json({ data: { affiliateCtasEnabled: true } })
      ),
      http.put(PREFERENCES_PATH, async ({ request }) => {
        const body = (await request.json()) as { affiliateCtasEnabled: boolean }
        if (putStatus) {
          const status = putStatus
          putStatus = undefined
          return HttpResponse.json(
            { statusCode: status, message: 'Temporary failure.', error: 'Server Error' },
            { status }
          )
        }
        return HttpResponse.json({ data: body })
      })
    )

    render(<SettingsPage />)
    await waitFor(() => expect(toggle()).toBeEnabled())

    fireEvent.click(toggle())
    await screen.findByRole('alert')
    await waitFor(() => expect(toggle()).toBeEnabled())

    fireEvent.click(toggle())

    await waitFor(() =>
      expect(screen.getByTestId('commerce-status-region')).toHaveTextContent(
        'Shopping preferences updated'
      )
    )
    // The stale error clears once the retry succeeds.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(toggle()).not.toBeChecked()
  })

  it('5.1-WEB-SETTINGS-09 leaves the control disabled when the preference cannot be read', async () => {
    signIn()
    useMswHandlers(...preferenceHandlers({ getStatus: 500 }))

    render(<SettingsPage />)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Unable to reach shopping preferences.')
    // Showing the `true` default would render an opted-out account as opted in.
    expect(toggle()).toBeDisabled()
    expect(screen.queryByTestId('commerce-signed-out-hint')).not.toBeInTheDocument()
  })

  it('5.1-WEB-SETTINGS-A11Y-01 passes axe signed out and after a failed save', async () => {
    const view = render(<SettingsPage />)
    await screen.findByTestId('commerce-signed-out-hint')
    await expectNoAxeViolations(view.container)
    view.unmount()

    signIn()
    useMswHandlers(...preferenceHandlers({ initial: true, putStatus: 500 }))
    const signedIn = render(<SettingsPage />)
    await waitFor(() => expect(toggle()).toBeEnabled())
    fireEvent.click(toggle())
    await screen.findByRole('alert')

    await expectNoAxeViolations(signedIn.container)
  })

  /**
   * Leaving the route mid-request must not land an error banner on a tree that
   * is already gone, and must not leave the fetch running.
   */
  it('5.1-WEB-SETTINGS-10 abandons an in-flight read when the page unmounts', async () => {
    signIn()
    const gate = deferred<void>()
    const aborted = deferred<void>()
    useMswHandlers(
      http.get(PREFERENCES_PATH, async ({ request }) => {
        request.signal.addEventListener('abort', () => aborted.resolve())
        await gate.promise
        return HttpResponse.json({ data: { affiliateCtasEnabled: true } })
      })
    )

    const view = render(<SettingsPage />)
    await waitFor(() => expect(toggle()).toBeDisabled())

    view.unmount()
    await aborted.promise
    gate.resolve()

    expect(screen.queryByTestId('commerce-preferences-section')).not.toBeInTheDocument()
  })

  it('5.1-WEB-SETTINGS-11 labels the toggle and describes it with the help text', async () => {
    signIn()
    useMswHandlers(...preferenceHandlers({}))

    render(<SettingsPage />)

    const labelled = await screen.findByRole('checkbox', {
      name: 'Show "Shop this look" suggestions',
    })
    expect(labelled).toBe(toggle())
    expect(labelled).toHaveAccessibleDescription(
      /Turn this off to hide all partner and affiliate suggestions\./
    )
  })
})
