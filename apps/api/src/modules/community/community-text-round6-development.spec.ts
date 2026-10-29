import { describe, expect, it } from 'vitest'
import data from '../../../test/fixtures/community-text-corpus/development-round6.json'
import { loadCommunityScreeningPolicy } from './community-screening-policy.js'
import { CommunityTextScreener } from './community-text-screener.js'

const screener = new CommunityTextScreener({
  policy: loadCommunityScreeningPolicy().policy.text,
})
const locales = [
  'de-DE',
  'en-US',
  'es-419',
  'fr-FR',
  'it-IT',
  'pt-BR',
  'pt-PT',
  'tr-TR',
  undefined,
]
const reported = data.reported.map((row) => row.text)
const french = ['en retard']
const carpet = ['um tapete']
const englishFrames = ['you are', 'such a', 'what a', 'stupid', 'you absolute']
const frenchFrames = [
  't es',
  'tu es',
  'espece de',
  'sale',
  'quel',
  'quelle',
  'ce',
  'c est un',
]
const screen = (text: string, locale?: string) =>
  screener.screen({ text, locale, field: 'caption' })

describe('round6 occurrence language and insult-frame boundaries', () => {
  it.each(reported)('keeps reported single-occurrence insult high: %s', (text) => {
    for (const locale of locales) {
      const result = screen(text, locale)
      expect(result.disposition, locale).toBe('block')
      expect(result.severity, locale).toBe('high')
    }
  })

  it.each(data.removedConstructions)(
    'keeps removed ambiguous construction blocked: %s',
    (phrase) => {
      for (const locale of locales)
        expect(screen(phrase, locale).disposition, locale).toBe('block')
    }
  )

  it.each(french)('requires declared French for %s', (phrase) => {
    expect(screen(phrase, 'fr-FR').disposition).toBe('pass')
    for (const locale of locales.filter((locale) => locale !== 'fr-FR'))
      expect(screen(phrase, locale).disposition, locale).toBe('block')
  })

  it.each(french)(
    'refuses English person-directed frames around %s even in French',
    (phrase) => {
      for (const frame of englishFrames)
        for (const locale of locales)
          for (const separator of [' ', ', ', ' - ', '\n', ' 😃 '])
            expect(
              screen(`${frame}${separator}${phrase}`, locale).disposition,
              `${frame}${separator}${phrase}`
            ).toBe('block')
    }
  )

  it.each(carpet)('refuses French insult frames around %s in every locale', (phrase) => {
    for (const frame of frenchFrames)
      for (const locale of locales)
        for (const separator of [' ', ', ', ' - ', '\n', ' 😃 '])
          expect(
            screen(`${frame}${separator}${phrase}`, locale).disposition,
            `${frame}${separator}${phrase}`
          ).toBe('block')
  })

  it.each(carpet)('requires a declared native carpet language for %s', (phrase) => {
    for (const locale of ['pt-BR', 'pt-PT', 'es-419'])
      expect(screen(phrase, locale).disposition, locale).toBe('pass')
    for (const locale of locales.filter(
      (locale) => !['pt-BR', 'pt-PT', 'es-419'].includes(locale ?? '')
    ))
      expect(screen(phrase, locale).disposition, locale).toBe('block')
  })
})

it.each(data.frameAdversarial)('refuses normalized person-directed frame %s', (text) => {
  for (const locale of locales) expect(screen(text, locale).disposition).toBe('block')
})

it.each([
  ['Le train est en retard.', 'fr-FR'],
  ['Sapatos azuis sobre um tapete.', 'pt-BR'],
  ['Sapatos azuis sobre um tapete.', 'pt-PT'],
  ['Sapatos azuis sobre um tapete.', 'es-419'],
])('retains evidenced ordinary occurrence %s under %s', (text, locale) => {
  expect(screen(text, locale).disposition).toBe('pass')
  expect(screen(text + ' niga', locale).disposition).toBe('block')
})
