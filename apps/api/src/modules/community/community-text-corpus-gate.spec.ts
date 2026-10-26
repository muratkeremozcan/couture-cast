import { describe, expect, it } from 'vitest'
import { passesCleanHoldoutGate, wilsonInterval } from './community-text-corpus-gate.js'

describe('Wilson interval reference values', () => {
  it('matches the unchanged two-sided 95% reference values', () => {
    expect(wilsonInterval(0, 0)).toEqual([0, 1])
    const [low, high] = wilsonInterval(0, 200)
    expect(low).toBeCloseTo(0, 12)
    expect(high).toBeCloseTo(0.01884, 4)
    const [low2, high2] = wilsonInterval(10, 100)
    expect(low2).toBeCloseTo(0.05523, 4)
    expect(high2).toBeCloseTo(0.17437, 4)
  })
})

describe('pre-registered clean holdout gate', () => {
  // Registered before any v3 result. In-sample zero-withhold and disguised-term
  // zero-pass assertions remain separate regression checks in the evaluation.
  it.each([
    { withheld: 0, total: 1000, pass: true },
    { withheld: 1, total: 1000, pass: true },
    { withheld: 2, total: 1000, pass: true },
    { withheld: 3, total: 1000, pass: true },
    { withheld: 4, total: 1000, pass: false },
    { withheld: 0, total: 400, pass: true },
    { withheld: 1, total: 400, pass: false },
    { withheld: 0, total: 200, pass: false },
  ])('$withheld of $total has gate result $pass', ({ withheld, total, pass }) => {
    expect(passesCleanHoldoutGate(withheld, total)).toBe(pass)
  })

  it('places the requested acceptance boundary on either side of 1%', () => {
    expect(wilsonInterval(3, 1000)[1]).toBeCloseTo(0.008783014053503173, 14)
    expect(wilsonInterval(4, 1000)[1]).toBeCloseTo(0.010239556277262253, 14)
    expect(wilsonInterval(1, 400)[1]).toBeCloseTo(0.014023285075823391, 14)
  })

  it.each([
    [0, 0],
    [-1, 1000],
    [1001, 1000],
    [0.5, 1000],
    [0, 1000.5],
    [0, -1],
    [Number.NaN, 1000],
    [0, Number.POSITIVE_INFINITY],
  ])('rejects invalid counts %s of %s', (withheld, total) => {
    expect(passesCleanHoldoutGate(withheld, total)).toBe(false)
  })
})
