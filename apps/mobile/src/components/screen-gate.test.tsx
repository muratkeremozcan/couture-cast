// Learning path Step 65: Signed-in shell without flashes.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-65-signed-in-shell-without-flashes
// Story CC-7.7 builder tests: 7.7-NAT-001 and the native gate contract (D1, D3).
// Test design: _bmad-output/test-artifacts/test-design-7-7-signed-in-shell-without-flashes.md.
import React, { useEffect } from 'react'
import { Text } from 'react-native'
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US', languageCode: 'en', regionCode: 'US' }],
}))

import i18n, { initI18n } from '@/src/lib/i18n'
import { setMobileApplicationUserId } from '@/src/lib/mobile-auth'
import type { MemberSessionState } from '@/src/lib/member-session'
import { SCREEN_GATE_DEADLINE_MS, ScreenGate, screenGateSettled } from './screen-gate'
import homeSource from '../../app/(tabs)/index.tsx?raw'
import closetSource from '../features/wardrobe/wardrobe-hub-screen.tsx?raw'
import looksSource from '../features/looks/looks-screen.tsx?raw'
import communitySource from '../features/community/community-screen.tsx?raw'
import profileSource from '../../app/(tabs)/settings.tsx?raw'
import deDE from '../../assets/locales/de-DE.json'
import enCA from '../../assets/locales/en-CA.json'
import enUS from '../../assets/locales/en-US.json'
import es419 from '../../assets/locales/es-419.json'
import frCA from '../../assets/locales/fr-CA.json'
import frFR from '../../assets/locales/fr-FR.json'
import itIT from '../../assets/locales/it-IT.json'
import ptBR from '../../assets/locales/pt-BR.json'
import ptPT from '../../assets/locales/pt-PT.json'
import trTR from '../../assets/locales/tr-TR.json'

const mounts = vi.fn<(label: string) => void>()

/** A body child that records its mount, so a test can tell "hidden" from "not mounted". */
function Body({ label }: { label: string }) {
  useEffect(() => mounts(label), [label])
  return <Text testID="gated-body">{label}</Text>
}

function Gate({ session, ready }: { session: MemberSessionState; ready: boolean }) {
  return (
    <ScreenGate screen="home" session={session} ready={ready}>
      <Body label="member outfit" />
    </ScreenGate>
  )
}

const placeholder = () => screen.queryByTestId('screen-placeholder')
const gate = () => screen.getByTestId('screen-gate')

describe('ScreenGate (native)', () => {
  beforeAll(async () => {
    await initI18n()
    await i18n.changeLanguage('en-US')
  })

  beforeEach(() => {
    mounts.mockClear()
    setMobileApplicationUserId('member-a')
  })

  afterEach(() => {
    setMobileApplicationUserId(null)
  })

  it('7.7-NAT-001 shows the neutral placeholder while the session restores, with the body mounted but hidden', () => {
    render(<Gate session="restoring" ready />)

    const shown = placeholder()
    expect(shown).toBeVisible()
    expect(shown).toHaveAttribute('aria-busy', 'true')
    expect(shown).toHaveAttribute('aria-label', 'Loading')
    // No text, no sample, no skeleton cards: a plain surface.
    expect(shown).toBeEmptyDOMElement()
    expect(mounts).toHaveBeenCalledWith('member outfit')
    expect(screen.getByTestId('gated-body')).not.toBeVisible()
    expect(gate()).toHaveAttribute('data-screen', 'home')
    expect(gate()).not.toHaveAttribute('data-ready')
  })

  it('7.7-NAT-001 a signed-out session opens the gate at once', () => {
    render(<Gate session="signed-out" ready={false} />)

    expect(placeholder()).toBeNull()
    expect(screen.getByTestId('gated-body')).toBeVisible()
    expect(gate()).toHaveAttribute('data-ready', 'true')
  })

  it('7.7-NAT-001 a member waits for the reads, then the body appears as one unit', () => {
    const view = render(<Gate session="member" ready={false} />)
    expect(placeholder()).toBeVisible()
    expect(screen.getByTestId('gated-body')).not.toBeVisible()

    view.rerender(<Gate session="member" ready />)

    expect(placeholder()).toBeNull()
    expect(screen.getByTestId('gated-body')).toBeVisible()
    expect(gate()).toHaveAttribute('data-ready', 'true')
    // Revealing the body never remounts it: its reads started behind the placeholder.
    expect(mounts).toHaveBeenCalledTimes(1)
  })

  it('7.7-NAT-003 stays open through a refresh once it opened for the member', () => {
    const view = render(<Gate session="member" ready />)
    expect(placeholder()).toBeNull()

    view.rerender(<Gate session="member" ready={false} />)

    expect(placeholder()).toBeNull()
    expect(screen.getByTestId('gated-body')).toBeVisible()
  })

  it('7.7-NAT-001 closes again for another member until that member’s reads settle', () => {
    const view = render(<Gate session="member" ready />)
    expect(placeholder()).toBeNull()

    act(() => setMobileApplicationUserId('member-b'))
    view.rerender(<Gate session="member" ready={false} />)

    expect(placeholder()).toBeVisible()
    expect(screen.getByTestId('gated-body')).not.toBeVisible()
  })

  it('7.7-NAT-001 closes while the session restores again', () => {
    const view = render(<Gate session="member" ready />)

    view.rerender(<Gate session="restoring" ready />)

    expect(placeholder()).toBeVisible()
  })

  // CodeRabbit r1: the open latch belongs to one member visit. Member A's latch never reopens
  // the gate when A comes back over reads that have not settled yet.
  it('7.7-NAT-007 a latch from member A never reopens the gate for A’s return over unsettled reads', () => {
    const view = render(<Gate session="member" ready />)
    expect(placeholder()).toBeNull()

    act(() => setMobileApplicationUserId('member-b'))
    view.rerender(<Gate session="member" ready={false} />)
    expect(placeholder()).toBeVisible()

    act(() => setMobileApplicationUserId('member-a'))

    expect(placeholder()).toBeVisible()
    expect(screen.getByTestId('gated-body')).not.toBeVisible()
    expect(gate()).not.toHaveAttribute('data-ready')

    view.rerender(<Gate session="member" ready />)

    expect(placeholder()).toBeNull()
    expect(screen.getByTestId('gated-body')).toBeVisible()
  })

  // CodeRabbit r1: a screen resets its reads in an effect, so on the first render for a new
  // member `ready` can still describe the previous member. That readiness opens nothing.
  it('7.7-NAT-008 readiness still true from the previous member keeps the gate closed until the new member’s reads settle', () => {
    const view = render(<Gate session="member" ready />)
    expect(placeholder()).toBeNull()

    act(() => setMobileApplicationUserId('member-b'))

    // Same props, so `ready` is member A's: the gate closes at once for member B.
    expect(placeholder()).toBeVisible()
    expect(screen.getByTestId('gated-body')).not.toBeVisible()
    expect(gate()).not.toHaveAttribute('data-ready')

    // The screen reports member B's reads as unsettled, then settled.
    view.rerender(<Gate session="member" ready={false} />)
    expect(placeholder()).toBeVisible()
    view.rerender(<Gate session="member" ready />)

    expect(placeholder()).toBeNull()
    expect(gate()).toHaveAttribute('data-ready', 'true')
    // Member B's own settled reads latch the gate: a refresh keeps it open.
    view.rerender(<Gate session="member" ready={false} />)
    expect(placeholder()).toBeNull()
  })

  it('7.7-NAT-008 readiness carried through a sign-out still opens nothing for the next member', () => {
    const view = render(<Gate session="member" ready />)

    act(() => setMobileApplicationUserId(null))
    view.rerender(<Gate session="signed-out" ready />)
    // Signed out opens the gate at once, as before.
    expect(placeholder()).toBeNull()

    act(() => setMobileApplicationUserId('member-b'))
    view.rerender(<Gate session="member" ready />)

    expect(placeholder()).toBeVisible()
    expect(screen.getByTestId('gated-body')).not.toBeVisible()
  })

  // CodeRabbit r1: the session state can lag a sign-in by a render. A signed-out state seen
  // with the new member's id opens the gate, but never latches it for that member.
  it('7.7-NAT-009 a signed-out session lagging a sign-in never latches the gate for the new member', () => {
    setMobileApplicationUserId(null)
    const view = render(<Gate session="signed-out" ready={false} />)
    expect(placeholder()).toBeNull()

    act(() => setMobileApplicationUserId('member-b'))
    // Still signed out for one render, with member B's id.
    expect(placeholder()).toBeNull()

    view.rerender(<Gate session="member" ready={false} />)

    expect(placeholder()).toBeVisible()
    expect(screen.getByTestId('gated-body')).not.toBeVisible()
  })

  it('7.7-NAT-012 reports each open and close, the deadline opening included', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const onOpenChange = vi.fn<(open: boolean) => void>()
    try {
      render(
        <ScreenGate
          screen="community"
          session="member"
          ready={false}
          onOpenChange={onOpenChange}
        >
          <Body label="feed" />
        </ScreenGate>
      )
      expect(onOpenChange.mock.calls).toEqual([[false]])

      act(() => {
        vi.advanceTimersByTime(SCREEN_GATE_DEADLINE_MS)
      })

      expect(placeholder()).toBeNull()
      expect(onOpenChange.mock.calls).toEqual([[false], [true]])
    } finally {
      vi.useRealTimers()
    }
  })

  // Review triage P2-2: one stalled read never hides the sections that answered, or their Retry.
  it('7.7-NAT-001 opens at the deadline when a member read never settles', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      render(<Gate session="member" ready={false} />)
      act(() => {
        vi.advanceTimersByTime(SCREEN_GATE_DEADLINE_MS - 1)
      })
      expect(placeholder()).toBeVisible()
      expect(screen.getByTestId('gated-body')).not.toBeVisible()

      act(() => {
        vi.advanceTimersByTime(1)
      })

      expect(placeholder()).toBeNull()
      expect(screen.getByTestId('gated-body')).toBeVisible()
      // Opened once, it stays open through the late read's own answer.
      expect(mounts).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('7.7-NAT-001 keeps the placeholder past the deadline while the session still restores', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      render(<Gate session="restoring" ready={false} />)
      act(() => {
        vi.advanceTimersByTime(SCREEN_GATE_DEADLINE_MS * 2)
      })

      // Restoration has its own retries and outcome; no member content shows before it.
      expect(placeholder()).toBeVisible()
      expect(screen.getByTestId('gated-body')).not.toBeVisible()
    } finally {
      vi.useRealTimers()
    }
  })

  it('7.7-NAT-001 decides settlement from the session and the reads', () => {
    expect(screenGateSettled('restoring', true)).toBe(false)
    expect(screenGateSettled('signed-out', false)).toBe(true)
    expect(screenGateSettled('member', false)).toBe(false)
    expect(screenGateSettled('member', true)).toBe(true)
    expect(screenGateSettled('unavailable', true)).toBe(true)
    // A failed session check with its reads unsettled still opens: the sections' own error and
    // retry must show, never the placeholder over them (D3, as on web).
    expect(screenGateSettled('unavailable', false)).toBe(true)
  })

  // The tab navigator never waits for the session (the splash does not either): each tab body
  // carries its own gate, so the shell and tab bar render while every body shows the placeholder.
  it.each([
    ['Today', homeSource, 'home'],
    ['Closet', closetSource, 'closet'],
    // Story CC-7.11 D8: the Looks tab carries its own gate like the other four.
    ['Looks', looksSource, 'looks'],
    ['Community', communitySource, 'community'],
    ['Profile', profileSource, 'profile'],
  ])('7.7-NAT-001 the %s tab wraps its body in its gate', (_tab, source, name) => {
    expect(source).toMatch(new RegExp(`<ScreenGate\\s+screen="${name}"`))
  })
})

// Story CC-7.7: the screen gate's placeholder names itself ("Loading") to VoiceOver and
// TalkBack in all ten mobile locales.
const LOCALE_CATALOGS = {
  'en-US': enUS,
  'en-CA': enCA,
  'de-DE': deDE,
  'es-419': es419,
  'fr-CA': frCA,
  'fr-FR': frFR,
  'it-IT': itIT,
  'pt-BR': ptBR,
  'pt-PT': ptPT,
  'tr-TR': trTR,
} as const

const ENGLISH_LOCALES = ['en-US', 'en-CA'] as const
const TRANSLATED_LOCALES = Object.keys(LOCALE_CATALOGS).filter(
  (locale) => !(ENGLISH_LOCALES as readonly string[]).includes(locale)
) as (keyof typeof LOCALE_CATALOGS)[]

const placeholderLabel = (locale: keyof typeof LOCALE_CATALOGS) =>
  (LOCALE_CATALOGS[locale] as { common?: { loading?: unknown } }).common?.loading

describe('screen gate placeholder label', () => {
  it.each(ENGLISH_LOCALES)('7.7 %s reads Loading', (locale) => {
    expect(placeholderLabel(locale)).toBe('Loading')
  })

  it.each(TRANSLATED_LOCALES)(
    '7.7 %s names the placeholder in its own language',
    (locale) => {
      const text = placeholderLabel(locale)

      expect(typeof text).toBe('string')
      expect((text as string).trim()).not.toBe('')
      expect(text).not.toBe('Loading')
    }
  )
})
