// Learning path Step 65: Signed-in shell without flashes.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-65-signed-in-shell-without-flashes
// Story CC-7.7 (AC5): unit proofs for the layout-shift meter that gates the signed-in shell.
// Test design: _bmad-output/test-artifacts/test-design-7-7-signed-in-shell-without-flashes.md.
// The browser half runs in playwright/tests/signed-in-shell-layout-shift.spec.ts, whose
// positive control (7.7-E2E-007) proves the observer sees a real shift.
import { describe, expect, it } from 'vitest'
import {
  describeShifts,
  firstRectMove,
  isSettled,
  shiftScore,
  sightingsBeforeReady,
  type MeterRect,
  type MeterSnapshot,
  type ShellFrame,
  type ShiftEntry,
} from './layout-shift-meter'

const shift = (startTime: number, value: number, hadRecentInput = false): ShiftEntry => ({
  startTime,
  value,
  hadRecentInput,
  sources: [`div in [data-testid="s-${startTime}"]`],
})
const rect = (y: number, height = 56): MeterRect => ({ x: 0, y, width: 390, height })
const frame = (t: number, overrides: Partial<ShellFrame> = {}): ShellFrame => ({
  t,
  header: rect(0),
  nav: rect(788),
  visible: [],
  ready: [],
  present: [],
  scrollY: 0,
  texts: [],
  ...overrides,
})

describe('7.7-UNIT-001 shiftScore counts every entry', () => {
  it('includes entries the browser marks as after input', () => {
    const shifts = [shift(10, 0.04), shift(20, 0.05, true), shift(30, 0.02, true)]

    // The browser's own score would be 0.04: hadRecentInput entries are excluded there.
    expect(shiftScore(shifts, 0)).toBeCloseTo(0.11, 10)
  })

  it('is 0 with no entries', () => {
    expect(shiftScore([], 0)).toBe(0)
  })
})

describe('7.7-UNIT-002 shiftScore measures only the window', () => {
  it('drops entries before the start and after the end', () => {
    const shifts = [shift(99, 0.5), shift(100, 0.03), shift(250, 0.04), shift(301, 0.7)]

    expect(shiftScore(shifts, 100, 300)).toBeCloseTo(0.07, 10)
  })

  it('names the shifted nodes, largest first, with their offset from the window start', () => {
    const lines = describeShifts([shift(150, 0.01), shift(120, 0.2, true)], 100)

    expect(lines).toEqual([
      '0.2000 at 20 ms (after input): div in [data-testid="s-120"]',
      '0.0100 at 50 ms: div in [data-testid="s-150"]',
    ])
  })
})

describe('7.7-UNIT-003 isSettled', () => {
  const snapshot = (overrides: Partial<MeterSnapshot>): MeterSnapshot => ({
    now: 3000,
    shifts: [],
    frames: [
      frame(1000),
      frame(1500, { ready: ['home'] }),
      frame(2990, { ready: ['home'] }),
    ],
    ...overrides,
  })
  const settled = (s: MeterSnapshot, inflight = 0, screen = 'home') =>
    isSettled({ snapshot: s, fromMs: 1000, screen, inflight, quietMs: 1000 })

  it('settles once the gate is ready, nothing is in flight and the page has been quiet', () => {
    expect(settled(snapshot({}))).toBe(true)
  })

  it('waits while the active screen gate is not ready', () => {
    expect(settled(snapshot({}), 0, 'closet')).toBe(false)
    expect(settled(snapshot({ frames: [frame(1000), frame(2990, { ready: [] })] }))).toBe(
      false
    )
  })

  it('waits while a stubbed request is in flight', () => {
    expect(settled(snapshot({}), 1)).toBe(false)
  })

  it('restarts the quiet period on a late shift', () => {
    expect(settled(snapshot({ shifts: [shift(2500, 0.001)] }))).toBe(false)
    expect(settled(snapshot({ now: 3501, shifts: [shift(2500, 0.001)] }))).toBe(true)
  })

  it('counts the quiet period from the moment the gate opened', () => {
    expect(
      settled(
        snapshot({
          frames: [
            frame(1000),
            frame(2500, { ready: ['home'] }),
            frame(2990, { ready: ['home'] }),
          ],
        })
      )
    ).toBe(false)
  })

  it('ignores a shift from before the window', () => {
    expect(settled(snapshot({ shifts: [shift(900, 0.3)] }))).toBe(true)
  })
})

describe('7.7-UNIT-004 firstRectMove (AC2)', () => {
  it('is null while the header and tab bar hold still', () => {
    const frames = [frame(0), frame(16), frame(32)]

    expect(firstRectMove(frames, 'header', 0)).toBeNull()
    expect(firstRectMove(frames, 'nav', 0)).toBeNull()
  })

  it('reports the first frame where the header moves, with both rects', () => {
    const frames = [
      frame(0),
      frame(16),
      frame(32, { header: rect(24) }),
      frame(48, { header: rect(40) }),
    ]

    expect(firstRectMove(frames, 'header', 0)).toEqual({
      t: 32,
      from: rect(0),
      to: rect(24),
    })
  })

  it('ignores sub-pixel noise and catches a height change', () => {
    expect(
      firstRectMove([frame(0), frame(16, { nav: rect(788.3) })], 'nav', 0)
    ).toBeNull()
    expect(
      firstRectMove([frame(0), frame(16, { nav: rect(788, 64) })], 'nav', 0)
    ).toEqual({
      t: 16,
      from: rect(788),
      to: rect(788, 64),
    })
  })

  it('waits for the first rendered rect, then counts a disappearance as a move', () => {
    const frames = [
      frame(0, { header: null }),
      frame(16, { header: rect(0) }),
      frame(32, { header: null }),
    ]

    expect(firstRectMove(frames, 'header', 0)).toEqual({ t: 32, from: rect(0), to: null })
  })

  it('measures only inside the window', () => {
    const frames = [frame(0, { header: rect(30) }), frame(100), frame(116)]

    expect(firstRectMove(frames, 'header', 100)).toBeNull()
  })
})

describe('sightingsBeforeReady (AC1)', () => {
  it('reports content seen before the gate opened and ignores it afterwards', () => {
    const frames = [
      frame(0, { visible: ['screen-placeholder'] }),
      frame(16, { visible: ['landing-sign-in'] }),
      frame(32, { visible: ['member-sample-outfit'], ready: ['home'] }),
    ]

    expect(
      sightingsBeforeReady(frames, ['landing-sign-in', 'member-sample-outfit'], 'home', 0)
    ).toEqual({ 'landing-sign-in': 16 })
  })
})
