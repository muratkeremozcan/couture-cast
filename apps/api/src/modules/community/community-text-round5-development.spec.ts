import fs from 'node:fs'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import data from '../../../test/fixtures/community-text-corpus/development-round5.json'
import reviewedBank from '../../../policies/community-screening/reviewed-occurrence-constructions-v1.json'
import { loadCommunityScreeningPolicy } from './community-screening-policy.js'
import { CommunityTextScreener, toLiteralForm } from './community-text-screener.js'
import { wilsonInterval } from './community-text-corpus-gate.js'

const screener = new CommunityTextScreener({
  policy: loadCommunityScreeningPolicy().policy.text,
})
const languages = {
  de: 'de-DE',
  en: 'en-US',
  es: 'es-419',
  fr: 'fr-FR',
  it: 'it-IT',
  pt: 'pt-BR',
  tr: 'tr-TR',
}
const locales = [...Object.values(languages), undefined]
const screen = (
  text: string,
  locale?: string,
  field: 'caption' | 'altText' = 'caption'
) => screener.screen({ text, locale, field })
const newRules = reviewedBank.constructions.filter((rule) =>
  ['balls', 'toppa', 'bale', 'pişen'].includes(rule.target)
)

describe('round5 retired development and native occurrence classes', () => {
  // One-time warm-up under its own budget, so no locale case pays it. Measured
  // 2026-10-27: the first screen() per locale costs 24 ms cold against 11 ms warm,
  // and the first 1000-row locale pass about 0.1 s plain and up to 0.7 s covered
  // above a warm pass. 10 s is over 10x the covered cost on a contended host, and a
  // setup that hangs fails this hook by name.
  beforeAll(() => {
    for (const locale of Object.values(languages))
      for (const text of [
        'A wool coat for the office, in pale rose.',
        'Ein leichter Mantel für das Büro.',
        'Una chaqueta ligera para la lluvia.',
        'Une robe longue en lin pour l’été.',
        'Una borsa in pelle per il fine settimana.',
        'Uma camisa de algodão para o calor.',
        'Bu ceket yağmurda da şık durur.',
      ])
        screen(text, locale)
  }, 10_000)
  it.each(data.entries)('$id preserves ordinary submitted copy', (row) => {
    expect(
      screen(row.text, row.locale, row.field as 'caption' | 'altText').disposition
    ).toBe('pass')
  })

  it.each(Object.entries(languages))(
    '%s retired v5 development has zero withholds and retains its Wilson bound',
    (language, locale) => {
      const corpus = JSON.parse(
        fs.readFileSync(
          path.resolve(
            __dirname,
            `../../../test/fixtures/community-text-corpus/holdout-v5/${language}.json`
          ),
          'utf8'
        )
      ) as { entries: { id: string; text: string; field: 'caption' | 'altText' }[] }
      const withheld = corpus.entries
        .filter((row) => screen(row.text, locale, row.field).disposition !== 'pass')
        .map((row) => row.id)
      console.log(
        JSON.stringify({
          evidence: 'round5-retired-v5-development',
          language,
          total: corpus.entries.length,
          withheld: withheld.length,
          upper: wilsonInterval(withheld.length, corpus.entries.length)[1],
        })
      )
      expect(withheld).toEqual([])
      expect(
        wilsonInterval(withheld.length, corpus.entries.length)[1]
      ).toBeLessThanOrEqual(0.01)
    }
  )

  it('keeps a finite reviewed surface with native provenance', () => {
    expect(newRules.map((rule) => rule.target)).toEqual([
      'balls',
      'toppa',
      'bale',
      'pişen',
    ])
    expect(newRules.map((rule) => rule.phrases.length)).toEqual([3, 2, 2, 1])
    for (const rule of newRules) {
      expect(rule.nativeLanguages).toContain(rule.language)
      expect(rule.reason.length).toBeGreaterThanOrEqual(20)
      const evidence =
        'developmentEvidence' in rule ? (rule.developmentEvidence ?? []) : []
      for (const phrase of rule.phrases) {
        const rows = evidence.filter((row) => row.phrase === phrase)
        expect(rows.length, phrase).toBeGreaterThan(0)
        for (const row of rows) {
          expect(row.source).toMatch(
            /^apps\/api\/test\/fixtures\/community-text-corpus\/holdout-v5\/(en|it|tr)\.json$/
          )
          expect(row.baselineDisposition).toBe('review')
          expect(row.reasonCode).toBe('text_policy_match')
        }
      }
    }
  })

  describe.each(newRules)('reviewed native class $target', ({ target, phrases }) => {
    it.each(phrases)('binds only the exact target occurrence in %s', (phrase) => {
      for (const locale of locales) {
        expect(screen(phrase, locale).disposition, phrase).toBe('pass')
        expect(screen(phrase.replaceAll(' ', '  '), locale).disposition).toBe('pass')
        for (const text of [
          target,
          `${phrase} you ${target}`,
          `you ${target} here ${phrase}`,
          phrase.replaceAll(' ', ', '),
          phrase.replaceAll(' ', ' - '),
          phrase.replaceAll(' ', '\n'),
          phrase.replaceAll(' ', '\t'),
          phrase.replaceAll(' ', '\u00a0'),
          phrase.replaceAll(' ', ' 😃 '),
        ])
          expect(screen(text, locale).disposition, text).not.toBe('pass')
        expect(screen(`${phrase} niga`, locale).disposition).toBe('block')
      }
    })

    it.each(phrases)(
      'does not mark obfuscated or separated raw words in %s',
      (phrase) => {
        const mark = Reflect.get(screener, 'markOccurrenceConstructions') as (
          raw: string,
          tokens: string[],
          allowed: boolean[]
        ) => void
        const obfuscated = target.replace(
          /[aeiou]/,
          (vowel) => ({ a: '4', e: '3', i: '1', o: '0', u: 'ü' })[vowel]!
        )
        for (const text of [
          phrase.replace(target, obfuscated),
          phrase.replace(target, `${target[0]}\u200b${target.slice(1)}`),
          phrase.replace(target, target.split('').join(' ')),
          phrase.replace(target, target + target.at(-1)),
          phrase.replace(
            target,
            target.replace(/[a-z]/g, (letter) =>
              String.fromCharCode(letter.charCodeAt(0) + 0xfee0)
            )
          ),
          phrase.replaceAll(' ', '\n'),
          phrase.replaceAll(' ', '\t'),
          phrase.replaceAll(' ', '\u00a0'),
          phrase.replaceAll(' ', ' 😃 '),
        ]) {
          const tokens = toLiteralForm(text)
            .split(/[^\p{L}\p{N}]+/u)
            .filter(Boolean)
          const allowed = tokens.map(() => false)
          mark.call(screener, text, tokens, allowed)
          expect(allowed.some(Boolean), text).toBe(false)
        }
      }
    )
  })

  it.each([
    'We wind balls of wool before weaving.',
    'Two balls of yarn sit beside the knitting needles.',
    'The basket contains wool balls in several colours.',
    'Una toppa protegge il gomito.',
    'Il bordo della toppa è blu.',
    'Bale ayakkabımın tabanı esnektir.',
    'Bale ayakkabısının kurdelesi yenidir.',
    'Yüzeyde pişen ekmek küçük resimde görünüyor.',
  ])('supports independent class copy %s', (text) => {
    for (const locale of locales) expect(screen(text, locale).disposition).toBe('pass')
  })

  it('preserves the preexisting English backstop boundary without expanding its dictionary', () => {
    for (const locale of locales) {
      expect(screen('balls', locale).disposition).toBe('review')
      for (const text of ['b4lls', 'ballss', 'b a l l s', 'bals'])
        expect(screen(text, locale).disposition, text).toBe('pass')
    }
  })
})
