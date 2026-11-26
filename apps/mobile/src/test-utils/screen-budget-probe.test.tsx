// Learning path Step 67: Screen budget guard.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-67-screen-budget-guard
// Story CC-7.10 test owner (TEA): 7.10-NAT-017..023, synthetic DOM proofs of the native probe's
// rules (probeNativeScreen in screen-budget.tsx): a link counts only when the press really
// navigates, focus counts only when the press moves it, only an exclusive set's current choice
// is skipped, and only a write request counts. Each case pairs a negative control with the
// positive twin it must not look like.
// Test design: _bmad-output/test-artifacts/test-design-7-10-screen-budget-guard.md.
import React, { useEffect, useRef, useState, type ReactNode } from 'react'
import { render } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'

// screen-budget.tsx draws AppTopBar for the suites, which imports the router and the icon font.
vi.mock('expo-router', () => ({ router: { navigate: vi.fn(), replace: vi.fn() } }))
vi.mock('@expo/vector-icons/FontAwesome', () => ({ default: () => null }))

import { server } from './msw/server'
import {
  nativeAnalyticsOnly,
  nativeProbeErrors,
  probeNativeScreen,
  type NativeProbeResult,
} from './screen-budget'

/** Probes `ui` fresh for each target, as the screen suites do, with `outsideCalls` counted. */
async function probe(
  ui: () => ReactNode,
  outsideCalls: () => number = () => 0,
  exclusiveGroups: readonly string[] = []
) {
  const frame = window.location.href
  const run = await probeNativeScreen({
    mount: () => {
      const view = render(<>{ui()}</>)
      return Promise.resolve(view.unmount)
    },
    outsideCalls,
    exclusiveGroups,
  })
  // Every navigation was held: the test frame never left its page or its fragment.
  expect(window.location.href, 'the test frame stayed put').toBe(frame)
  expect(nativeProbeErrors(run.results)).toEqual([])
  return run
}

const keysOf = (results: readonly NativeProbeResult[]) =>
  nativeAnalyticsOnly(results).map((element) => element.key)

const effectsOf = (results: readonly NativeProbeResult[], key: string) =>
  results.find((result) => result.target.key === key)?.effects

describe('the native probe: links, focus and current choices', () => {
  it('[P0] [7.10-NAT-017] counts a link only when its press navigates after the handlers ran', async () => {
    const track = vi.fn()
    let routed = 0
    const ui = () => (
      <div>
        <a
          href="/budget-canceled"
          data-testid="link-canceled"
          onClick={(event) => {
            // Cancels the navigation and only tracks: the press does nothing a member sees.
            event.preventDefault()
            track('canceled')
          }}
        >
          Canceled
        </a>
        <a href="/budget-plain" data-testid="link-plain">
          Plain
        </a>
        <a
          href="/budget-stopped"
          data-testid="link-stopped"
          // As react-native-web's Pressable does: no document listener sees this click.
          onClick={(event) => event.stopPropagation()}
        >
          Stopped
        </a>
        <a
          href="/budget-routed"
          data-testid="link-routed"
          onClick={(event) => {
            // As expo-router's web Link does: the anchor is canceled and the router moves.
            event.preventDefault()
            routed += 1
          }}
        >
          Routed
        </a>
      </div>
    )

    const { results } = await probe(ui, () => routed)

    expect(track).toHaveBeenCalledWith('canceled')
    expect(keysOf(results)).toEqual(['link-canceled'])
    expect(effectsOf(results, 'link-plain')).toEqual(['link /budget-plain'])
    expect(effectsOf(results, 'link-stopped')).toEqual(['link /budget-stopped'])
    expect(effectsOf(results, 'link-routed')).toEqual(['outside call'])
  }, 30_000)

  it('[P0] [7.10-NAT-018] does not credit a fragment link that names no element', async () => {
    const ui = () => (
      <div>
        <a href="#budget-nowhere" data-testid="hash-missing">
          Missing
        </a>
        <a href="#" data-testid="hash-bare">
          Bare
        </a>
        <a href="#budget-section" data-testid="hash-present">
          Present
        </a>
        <section id="budget-section">Section</section>
      </div>
    )

    const { results } = await probe(ui)

    expect(keysOf(results)).toEqual(['hash-missing', 'hash-bare'])
    expect(effectsOf(results, 'hash-present')).toEqual(['link #budget-section'])
  }, 30_000)

  it('[P0] [7.10-NAT-019] does not credit focus that was already on another element', async () => {
    const focusedDuringPress = vi.fn()
    function Focus() {
      const search = useRef<HTMLInputElement>(null)
      const other = useRef<HTMLInputElement>(null)
      // Focus sits on a field outside the controls before any press.
      useEffect(() => search.current?.focus(), [])
      return (
        <div>
          <input ref={search} data-testid="budget-search" aria-label="Search" />
          <input ref={other} data-testid="budget-other" aria-label="Other" />
          <button
            type="button"
            data-testid="focus-unchanged"
            onClick={() => {
              focusedDuringPress(document.activeElement?.getAttribute('data-testid'))
            }}
          >
            Unchanged
          </button>
          <button
            type="button"
            data-testid="focus-moves"
            onClick={() => other.current?.focus()}
          >
            Moves
          </button>
        </div>
      )
    }

    const { results } = await probe(() => <Focus />)

    // The negative control really pressed with focus elsewhere.
    expect(focusedDuringPress).toHaveBeenCalledWith('budget-search')
    expect(keysOf(results)).toEqual(['focus-unchanged'])
    expect(effectsOf(results, 'focus-moves')).toEqual(['focus input'])
  }, 30_000)

  it('[P0] [7.10-NAT-020] probes an on switch and a checked checkbox whose off path only tracks', async () => {
    const track = vi.fn()
    const ui = () => (
      <div>
        <button
          type="button"
          role="switch"
          aria-checked="true"
          data-testid="switch-on"
          onClick={() => {
            track('switch off')
          }}
        >
          Alerts
        </button>
        <div
          role="checkbox"
          aria-checked="true"
          tabIndex={0}
          data-testid="checkbox-on"
          onClick={() => {
            track('unchecked')
          }}
        >
          Keep me posted
        </div>
      </div>
    )

    const { targets, results } = await probe(ui)

    expect(targets.map((target) => target.key)).toEqual(['switch-on', 'checkbox-on'])
    expect(track).toHaveBeenCalledWith('switch off')
    expect(track).toHaveBeenCalledWith('unchecked')
    expect(keysOf(results)).toEqual(['switch-on', 'checkbox-on'])
  }, 30_000)

  it('[P0] [7.10-NAT-021] probes a standalone pressed toggle and two pressed siblings whose presses only track', async () => {
    const track = vi.fn()
    function Toggle() {
      const [note, setNote] = useState('')
      return (
        <div>
          {/* Its only sibling control has no pressed state: no exclusive group. */}
          <button
            type="button"
            aria-pressed="true"
            data-testid="toggle-pressed"
            onClick={() => {
              track('toggle')
            }}
          >
            Favorite
          </button>
          <button
            type="button"
            data-testid="toggle-neighbor"
            onClick={() => setNote('saved')}
          >
            Save
          </button>
          <p data-testid="toggle-note">{note}</p>
          {/* Two pressed siblings are independent toggles: neither is the one current choice. */}
          <div>
            {['bold', 'italic'].map((name) => (
              <button
                key={name}
                type="button"
                aria-pressed="true"
                data-testid={`style-${name}`}
                onClick={() => {
                  track(name)
                }}
              >
                {name}
              </button>
            ))}
          </div>
        </div>
      )
    }

    const { targets, results } = await probe(() => <Toggle />)

    expect(targets.map((target) => target.key)).toEqual([
      'toggle-pressed',
      'toggle-neighbor',
      'style-bold',
      'style-italic',
    ])
    expect(track).toHaveBeenCalledWith('toggle')
    expect(track).toHaveBeenCalledWith('bold')
    expect(track).toHaveBeenCalledWith('italic')
    expect(keysOf(results)).toEqual(['toggle-pressed', 'style-bold', 'style-italic'])
  }, 30_000)

  it('[P0] [7.10-NAT-022] skips only the current choice of a named chip group and a radio group', async () => {
    function Choices() {
      const [chip, setChip] = useState('all')
      const [size, setSize] = useState('m')
      return (
        <div>
          <div data-testid="chip-group">
            {['all', 'rain', 'sun'].map((name) => (
              <button
                key={name}
                type="button"
                aria-pressed={chip === name}
                data-testid={`chip-${name}`}
                onClick={() => setChip(name)}
              >
                {name}
              </button>
            ))}
          </div>
          <p data-testid="chip-output">{chip}</p>
          <div role="radiogroup" aria-label="Size">
            {['m', 'l'].map((name) => (
              <div
                key={name}
                role="radio"
                aria-checked={size === name}
                tabIndex={0}
                data-testid={`size-${name}`}
                onClick={() => setSize(name)}
              >
                {name}
              </div>
            ))}
          </div>
          <p data-testid="size-output">{size}</p>
        </div>
      )
    }

    const { targets, results } = await probe(() => <Choices />, undefined, [
      '[data-testid="chip-group"]',
    ])

    expect(targets.map((target) => target.key)).toEqual([
      'chip-rain',
      'chip-sun',
      'size-l',
    ])
    expect(keysOf(results)).toEqual([])
  }, 30_000)

  it('[P0] [7.10-NAT-025] probes a pressed toggle beside an unpressed one without exclusive evidence', async () => {
    const track = vi.fn()
    function Pairs() {
      const [note, setNote] = useState('')
      const pair = (id: string, role?: 'radiogroup') => (
        <div role={role} data-testid={id}>
          <button
            type="button"
            aria-pressed="true"
            data-testid={`${id}-on`}
            onClick={() => {
              track(id)
            }}
          >
            Alerts
          </button>
          <button
            type="button"
            aria-pressed="false"
            data-testid={`${id}-off`}
            onClick={() => setNote(id)}
          >
            Digest
          </button>
        </div>
      )
      return (
        <div>
          {pair('independent')}
          {pair('radios', 'radiogroup')}
          {pair('named')}
          <p data-testid="pair-note">{note}</p>
        </div>
      )
    }

    const { targets, results } = await probe(() => <Pairs />, undefined, [
      '[data-testid="named"]',
    ])

    expect(targets.map((target) => target.key)).toEqual([
      'independent-on',
      'independent-off',
      'radios-off',
      'named-off',
    ])
    // The independent pressed toggle only tracks on its off path: analytics-only.
    expect(track).toHaveBeenCalledWith('independent')
    expect(keysOf(results)).toEqual(['independent-on'])
  }, 30_000)

  it('[P0] [7.10-NAT-023] counts a write request, hands a Request body on unread and flags a press whose only request is a read', async () => {
    const served = vi.fn()
    server.use(
      http.get('*/api/v1/budget-probe/read', () => {
        served('GET')
        return HttpResponse.json({ ok: true })
      }),
      http.post('*/api/v1/budget-probe/write', () => {
        served('POST')
        return HttpResponse.json({ ok: true })
      }),
      http.post('*/api/v1/budget-probe/body', async ({ request }) => {
        served('POST body', await request.json())
        return HttpResponse.json({ ok: true })
      })
    )
    const ui = () => (
      <div>
        <button
          type="button"
          data-testid="request-read"
          // A read with no DOM change: a prefetch the member never sees.
          onClick={() => void fetch('/api/v1/budget-probe/read')}
        >
          Read
        </button>
        <button
          type="button"
          data-testid="request-write"
          onClick={() => void fetch('/api/v1/budget-probe/write', { method: 'POST' })}
        >
          Write
        </button>
        <button
          type="button"
          data-testid="request-body"
          // A Request input carries its own body: the probe must hand it on unread.
          onClick={() =>
            void fetch(
              new Request(new URL('/api/v1/budget-probe/body', window.location.href), {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ look: 'saved' }),
              })
            )
          }
        >
          Body
        </button>
      </div>
    )

    const { results } = await probe(ui)

    // Both presses really reached the network.
    expect(served).toHaveBeenCalledWith('GET')
    expect(served).toHaveBeenCalledWith('POST')
    expect(keysOf(results)).toEqual(['request-read'])
    expect(effectsOf(results, 'request-write')).toEqual([
      'request POST /api/v1/budget-probe/write',
    ])
    expect(served).toHaveBeenCalledWith('POST body', { look: 'saved' })
    expect(effectsOf(results, 'request-body')).toEqual([
      'request POST /api/v1/budget-probe/body',
    ])
  }, 30_000)
})
