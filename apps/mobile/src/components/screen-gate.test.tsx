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
import { ScreenGate, screenGateSettled } from './screen-gate'
import homeSource from '../../app/(tabs)/index.tsx?raw'
import closetSource from '../features/wardrobe/wardrobe-hub-screen.tsx?raw'
import communitySource from '../features/community/community-screen.tsx?raw'
import profileSource from '../../app/(tabs)/settings.tsx?raw'

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
    ['Home', homeSource, 'home'],
    ['Closet', closetSource, 'closet'],
    ['Community', communitySource, 'community'],
    ['Profile', profileSource, 'profile'],
  ])('7.7-NAT-001 the %s tab wraps its body in its gate', (_tab, source, name) => {
    expect(source).toMatch(new RegExp(`<ScreenGate\\s+screen="${name}"`))
  })
})
