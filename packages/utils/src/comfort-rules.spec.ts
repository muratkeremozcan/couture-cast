import { describe, expect, it } from 'vitest'
import {
  adjustFeelsLike,
  CLOSE_COMFORT_MATCHES,
  COMFORT_RANGES,
  getRainAmountThreshold,
  getRainProbThreshold,
  getWindThreshold,
  needsOuterwear,
  OUTERWEAR_THRESHOLD_CELSIUS,
  resolveComfortRangeFromTemperature,
} from './comfort-rules'

describe('comfort rules (shared by the ritual engine and the 6.16 sample policy)', () => {
  it('keeps the wind and rain thresholds the engine has always used', () => {
    expect(getWindThreshold('low')).toBe(3)
    expect(getWindThreshold('medium')).toBe(5)
    expect(getWindThreshold('high')).toBe(8)
    expect(getRainProbThreshold('high')).toBe(0.2)
    expect(getRainProbThreshold('medium')).toBe(0.4)
    expect(getRainProbThreshold('low')).toBe(0.7)
    expect(getRainAmountThreshold('high')).toBe(0.1)
    expect(getRainAmountThreshold('medium')).toBe(0.5)
    expect(getRainAmountThreshold('low')).toBe(2)
  })

  it('falls back like the engine for an unknown tolerance', () => {
    expect(getWindThreshold('unknown' as never)).toBe(5)
    expect(getRainProbThreshold('unknown' as never)).toBe(0.3)
    expect(getRainAmountThreshold('unknown' as never)).toBe(0.1)
  })

  it('shifts feels-like by three degrees for cold and warm runners only', () => {
    expect(adjustFeelsLike(16, 'cold')).toBe(13)
    expect(adjustFeelsLike(16, 'neutral')).toBe(16)
    expect(adjustFeelsLike(16, 'warm')).toBe(19)
  })

  it('resolves comfort ranges on the half-open band edges', () => {
    expect(
      [9.9, 10, 14.9, 15, 19.9, 20, 24.9, 25].map(resolveComfortRangeFromTemperature)
    ).toEqual(['cold', 'cool', 'cool', 'mild', 'mild', 'warm', 'warm', 'hot'])
    expect(COMFORT_RANGES).toEqual(['cold', 'cool', 'mild', 'warm', 'hot'])
  })

  it('needs outerwear strictly below 15 degrees', () => {
    expect(OUTERWEAR_THRESHOLD_CELSIUS).toBe(15)
    expect(needsOuterwear(14.9)).toBe(true)
    expect(needsOuterwear(15)).toBe(false)
  })

  it('orders close comfort matches the way the engine falls back', () => {
    expect(CLOSE_COMFORT_MATCHES).toEqual({
      cold: ['cool'],
      cool: ['mild', 'cold'],
      mild: ['cool', 'warm'],
      warm: ['mild', 'hot'],
      hot: ['warm'],
    })
  })
})
