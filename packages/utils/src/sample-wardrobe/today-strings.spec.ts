// Learning path Step 71: Today's outfit as a picture.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-71-todays-outfit-as-a-picture
import { expect, it } from 'vitest'
import { formatTodayWornOn, getTodayOutfitStrings } from './today-strings'

it.each([
  'en-US',
  'en-CA',
  'de-DE',
  'es-419',
  'fr-CA',
  'fr-FR',
  'it-IT',
  'pt-BR',
  'pt-PT',
  'tr-TR',
])('renders Today copy in %s', (locale) => {
  const copy = getTodayOutfitStrings(locale)
  expect(copy.wearThis.trim()).not.toBe('')
  expect(copy.source.trim()).not.toBe('')
  expect(copy.weatherReason).toContain('{temperature}')
  expect(new Set(Object.values(copy.lookName)).size).toBe(5)
  expect(formatTodayWornOn('2026-11-20', locale)).toMatch(/20/)
})

it('uses English for unknown locale tags and keeps the worn date independent of the device clock', () => {
  expect(getTodayOutfitStrings('xx-XX')).toEqual(getTodayOutfitStrings('en-US'))
  expect(formatTodayWornOn('2026-11-20', 'en-US')).toBe('Nov 20, 2026')
})
