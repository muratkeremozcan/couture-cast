// Learning path Step 65: Signed-in shell without flashes.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-65-signed-in-shell-without-flashes
// Story CC-7.7 D1, D3 and D5 test owner: the web screen gate.
// Test design: _bmad-output/test-artifacts/test-design-7-7-signed-in-shell-without-flashes.md
// (7.7-CMP-001, 7.7-CMP-002). The layout-shift budget itself is 7.7-E2E-001 to 7.7-E2E-008.
// Codex review of 8327b4fb: 7.7-CMP-008 pins the gate deadline (P2-2).
import { useEffect, useState } from 'react'
import { act, render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getI18n } from '../../i18n'
import { WEB_ACCESS_TOKEN_STORAGE_KEY } from '../../lib/browser-persistence'
import { screenSnapshot } from '../../lib/screen-snapshot'
import type * as WebSession from '../../lib/web-session'
import {
  SCREEN_GATE_DEADLINE_MS,
  ScreenGate,
  useScreenGateOpen,
  useScreenGateRead,
} from './screen-gate'

const session = vi.hoisted(() => ({
  identity: null as string | null,
  stored: false,
}))

vi.mock('../../lib/web-session', async (importOriginal) => ({
  ...(await importOriginal<typeof WebSession>()),
  webSessionIdentity: () => session.identity,
  hasStoredWebSession: () => session.stored,
  // Verification never answers here: the member is named up front or not at all.
  resolveWebSessionToken: () => new Promise<string | undefined>(() => undefined),
}))

function signIn(member: string) {
  session.identity = member
  session.stored = true
  window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, `bearer-${member}`)
  document.documentElement.setAttribute('data-session', 'member')
}

type Outcome = 'pending' | 'data' | 'empty' | 'error'

let settle: (outcome: Outcome) => void = () => undefined

/** A section with one read the gate waits for, settled by the test. */
function RitualSection() {
  const [outcome, setOutcome] = useState<Outcome>('pending')
  settle = (next) => act(() => setOutcome(next))
  useScreenGateRead('ritual', outcome !== 'pending')
  if (outcome === 'data') return <p>Member outfit</p>
  if (outcome === 'empty') return <p>No outfit yet</p>
  if (outcome === 'error')
    return (
      <div>
        <p>Outfit failed</p>
        <button type="button">Retry</button>
      </div>
    )
  return <p data-testid="section-mounted">Reading</p>
}

function renderGate(children = <RitualSection />) {
  return render(
    <I18nextProvider i18n={getI18n()}>
      <ScreenGate screen="home" reads={['ritual']}>
        {children}
      </ScreenGate>
    </I18nextProvider>
  )
}

const gate = () => screen.getByTestId('screen-gate')
const placeholder = () => screen.getByTestId('screen-placeholder')

beforeEach(async () => {
  await getI18n().changeLanguage('en-US')
  screenSnapshot.clear()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  session.identity = null
  session.stored = false
  window.sessionStorage.clear()
  document.documentElement.removeAttribute('data-session')
  screenSnapshot.clear()
})

describe('ScreenGate', () => {
  it('7.7-CMP-002 shows one neutral, busy placeholder while the body mounts hidden underneath', () => {
    signIn('member-1')
    renderGate()

    expect(gate()).toHaveAttribute('data-screen', 'home')
    expect(gate()).not.toHaveAttribute('data-ready')
    expect(placeholder()).toBeVisible()
    expect(placeholder()).toHaveAttribute('aria-busy', 'true')
    // One visually hidden label and nothing else: no text, sample or skeleton cards.
    expect(placeholder().children).toHaveLength(1)
    expect(placeholder()).toHaveTextContent(/^Loading$/)
    expect(placeholder().firstElementChild).toHaveClass('sr-only')
    // The body is mounted (its reads have started) and hidden.
    const body = screen.getByTestId('section-mounted')
    expect(body).toBeInTheDocument()
    expect(body).not.toBeVisible()
  })

  it.each([
    ['data', 'Member outfit'],
    ['empty', 'No outfit yet'],
    ['error', 'Outfit failed'],
  ] as const)(
    '7.7-CMP-002 opens once its read settles with %s, and never hides what it settled to',
    (outcome, text) => {
      signIn('member-1')
      renderGate()
      settle(outcome)

      expect(gate()).toHaveAttribute('data-ready', 'true')
      expect(placeholder()).not.toBeVisible()
      expect(screen.getByText(text)).toBeVisible()
      if (outcome === 'error')
        expect(screen.getByRole('button', { name: 'Retry' })).toBeVisible()
    }
  )

  it('7.7-CMP-002 a signed-out session opens the gate at once and never shows the placeholder', () => {
    document.documentElement.setAttribute('data-session', 'none')
    renderGate()

    expect(gate()).toHaveAttribute('data-ready', 'true')
    expect(placeholder()).not.toBeVisible()
    expect(screen.getByTestId('section-mounted')).toBeVisible()
  })

  it('7.7-CMP-002 stays open while the same member refreshes', () => {
    signIn('member-1')
    renderGate()
    settle('data')
    settle('pending')

    expect(gate()).toHaveAttribute('data-ready', 'true')
    expect(placeholder()).not.toBeVisible()
  })

  it('7.7-CMP-001 a tab with a snapshot opens at once, restores its scroll before paint, and refreshes without the placeholder', () => {
    signIn('member-1')
    screenSnapshot.markSettled('member-1', 'home')
    screenSnapshot.rememberScroll('member-1', 'home', 480)
    const order: string[] = []
    vi.spyOn(window, 'scrollTo').mockImplementation(((x: number, y: number) => {
      order.push(`scrollTo:${x},${y}`)
    }) as typeof window.scrollTo)
    function PaintProbe() {
      // A passive effect runs after paint; the restore must come before it.
      useEffect(() => {
        order.push('painted')
      }, [])
      return <RitualSection />
    }

    renderGate(<PaintProbe />)

    expect(gate()).toHaveAttribute('data-ready', 'true')
    expect(placeholder()).not.toBeVisible()
    expect(order).toEqual(['scrollTo:0,480', 'painted'])

    // The refresh answers in place: the placeholder never comes back.
    settle('data')
    expect(placeholder()).not.toBeVisible()
    expect(screen.getByText('Member outfit')).toBeVisible()
  })

  it('7.7-CMP-001 a first visit starts at the top, and another member never opens on a snapshot', () => {
    signIn('member-1')
    screenSnapshot.markSettled('member-1', 'home')
    screenSnapshot.rememberScroll('member-1', 'home', 480)
    signIn('member-2')
    act(() => {
      window.dispatchEvent(new Event('couture:session'))
    })
    const scrollTo = vi
      .spyOn(window, 'scrollTo')
      .mockImplementation((() => undefined) as typeof window.scrollTo)

    renderGate()

    expect(gate()).not.toHaveAttribute('data-ready')
    expect(placeholder()).toBeVisible()
    expect(scrollTo).toHaveBeenCalledExactlyOnceWith(0, 0)
  })

  it('7.7-CMP-008 a read that never answers opens the gate at the deadline, with a finished section and its Retry shown (Codex review P2-2)', () => {
    vi.useFakeTimers()
    signIn('member-1')
    const openSeen: boolean[] = []
    /** The account header's profile read, stalled for good. */
    function StalledAccount() {
      useScreenGateRead('account', false)
      openSeen.push(useScreenGateOpen())
      return <p data-testid="account-pending">Account</p>
    }
    /** A section whose read already failed fast, with its Retry. */
    function FailedLocations() {
      useScreenGateRead('locations', true)
      return (
        <div>
          <p>Locations failed</p>
          <button type="button">Retry</button>
        </div>
      )
    }
    render(
      <I18nextProvider i18n={getI18n()}>
        <ScreenGate screen="profile" reads={['account', 'locations']}>
          <StalledAccount />
          <FailedLocations />
        </ScreenGate>
      </I18nextProvider>
    )
    const retry = screen.getByRole('button', { name: 'Retry', hidden: true })

    act(() => {
      vi.advanceTimersByTime(SCREEN_GATE_DEADLINE_MS - 1)
    })
    expect(gate()).not.toHaveAttribute('data-ready')
    expect(placeholder()).toBeVisible()
    expect(retry).not.toBeVisible()
    expect(openSeen.at(-1)).toBe(false)

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(gate()).toHaveAttribute('data-ready', 'true')
    expect(placeholder()).not.toBeVisible()
    expect(screen.getByText('Locations failed')).toBeVisible()
    expect(retry).toBeVisible()
    expect(openSeen.at(-1)).toBe(true)
    // Only reads that settled mark the tab settled: a return waits for its reads again.
    expect(screenSnapshot.isSettled('member-1', 'profile')).toBe(false)
  })

  it('7.7-CMP-008 a gate whose reads settle before the deadline never waits for it', () => {
    vi.useFakeTimers()
    signIn('member-1')
    renderGate()
    settle('error')

    expect(gate()).toHaveAttribute('data-ready', 'true')
    expect(screenSnapshot.isSettled('member-1', 'home')).toBe(true)
    // No timer is left to fire for a gate that opened from its reads.
    expect(vi.getTimerCount()).toBe(0)
  })
})
