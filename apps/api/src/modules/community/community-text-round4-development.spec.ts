import fs from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import os from 'node:os'
import { describe, expect, it } from 'vitest'
import data from '../../../test/fixtures/community-text-corpus/development-round4.json'
import reviewedOccurrenceBank from '../../../policies/community-screening/reviewed-occurrence-constructions-v1.json'
import { loadCommunityScreeningPolicy } from './community-screening-policy.js'
import { CommunityTextScreener } from './community-text-screener.js'

const loaded = loadCommunityScreeningPolicy()
const screener = new CommunityTextScreener({ policy: loaded.policy.text })
const locales = ['de-DE', 'en-US', 'es-419', 'fr-FR', 'it-IT', 'pt-BR', 'tr-TR']
interface AllowFixture {
  entries: string[]
  literalContexts: {
    terms: string[]
    objects: string[]
    connectors: string[]
    maxDistance: number
  }[]
  occurrenceConstructions: { target: string; phrases: string[] }[]
}
function withModifiedAllow(
  filename: string,
  modify: (list: AllowFixture) => void,
  assert: (directory: string) => void
): void {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cc68-round4-'))
  try {
    const source = path.resolve(
      __dirname,
      '../../../policies/community-screening/terms-v1'
    )
    for (const name of fs.readdirSync(source))
      fs.copyFileSync(path.join(source, name), path.join(directory, name))
    const file = path.join(directory, filename)
    const list = JSON.parse(fs.readFileSync(file, 'utf8')) as AllowFixture
    modify(list)
    fs.writeFileSync(file, JSON.stringify(list))
    assert(directory)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
}
const fromFixture = (directory: string) =>
  new CommunityTextScreener({
    listsDirectory: directory,
    policy: { ...loaded.policy.text, lists: [] },
  })

describe('round4 deletion and occurrence-bound context development regressions', () => {
  it.each(data.reported)(
    '$id preserves its original severity under every locale',
    (row) => {
      for (const locale of locales) {
        const result = screener.screen({ text: row.text, locale, field: 'caption' })
        expect(result.disposition, locale).toBe(row.expected)
        expect(result.severity, locale).toBe(row.severity)
      }
    }
  )

  it.each([
    'you retard, train',
    'shut up retard - vol',
    'mofo, roupa',
    'burro, camisa',
    'monta, borsa',
    'retard\ntrain',
    'retard 😃 train',
    'retard\t-\ttrain',
  ])('never joins clauses around %s', (text) => {
    expect(
      screener.screen({ text, locale: 'en-US', field: 'caption' }).disposition
    ).not.toBe('pass')
  })

  it.each([
    'en retard',
    'du retard',
    'un retard',
    'de retard',
    'retard de',
    'retard du',
    'retard des',
    'sans retard',
    'avec retard',
  ])('clears only the reviewed grammatical occurrence in %s', (text) => {
    for (const locale of [...locales, undefined]) {
      expect(screener.screen({ text, locale, field: 'caption' }).disposition).toBe('pass')
      for (const mixed of [`you retard. ${text}`, `${text} you retard`, `${text}. niga`])
        expect(
          screener.screen({ text: mixed, locale, field: 'caption' }).disposition
        ).toBe('block')
    }
  })

  it.each(['you retard du retard', 'you retard de retard'])(
    'allows both explicitly bound overlapping occurrences in %s',
    (text) => {
      for (const locale of [...locales, undefined]) {
        expect(screener.screen({ text, locale, field: 'caption' }).disposition).toBe(
          'pass'
        )
        expect(
          screener.screen({ text: `${text} you retard`, locale, field: 'caption' })
            .disposition
        ).toBe('block')
      }
    }
  )

  it.each(['you retard en retard', 'en retard you retard'])(
    'keeps an independent whitespace-separated bare occurrence blocked: %s',
    (text) => {
      for (const locale of [...locales, undefined])
        expect(screener.screen({ text, locale, field: 'caption' }).disposition).toBe(
          'block'
        )
    }
  )

  it.each(
    data.reported.filter((row) => row.severity === 'high' && /^\p{L}+$/u.test(row.text))
  )('rejects a generic context for high alias $id', (row) => {
    withModifiedAllow(
      'allow-it-v1.json',
      (list) => {
        list.literalContexts = [
          { terms: [row.text], objects: ['borsa'], connectors: ['di'], maxDistance: 3 },
        ]
      },
      (directory) => {
        expect(() => fromFixture(directory)).toThrow(
          'generic context targets a high-severity term'
        )
      }
    )
  })

  it('pins the approved two-target sixteen-phrase authoritative surface', () => {
    expect(reviewedOccurrenceBank.constructions.map((rule) => rule.target)).toEqual([
      'retard',
      'tapete',
    ])
    expect(
      reviewedOccurrenceBank.constructions.map((rule) => rule.phrases.length)
    ).toEqual([9, 7])
    expect(
      reviewedOccurrenceBank.constructions.map((rule) => rule.nativeLanguages)
    ).toEqual([['fr'], ['pt', 'es']])
    for (const rule of reviewedOccurrenceBank.constructions)
      expect(rule.reason.length).toBeGreaterThanOrEqual(20)
    expect(
      createHash('sha256')
        .update(
          reviewedOccurrenceBank.constructions.flatMap((rule) => rule.phrases).join('\n')
        )
        .digest('hex')
    ).toBe('8be8972f0c06a77106c2359d98a6398dad78fbe3d7c6870fad3a5f5fab260a62')
  })
  describe.each(reviewedOccurrenceBank.constructions)(
    'reviewed occurrence surface $target',
    ({ target, phrases }) => {
      it.each(phrases)('clears only the exact bound occurrence in %s', (phrase) => {
        for (const locale of [...locales, undefined]) {
          expect(
            screener.screen({ text: phrase, locale, field: 'caption' }).disposition
          ).toBe('pass')
          for (const text of [
            target,
            `${phrase} you ${target}`,
            `you ${target} here ${phrase}`,
            `${phrase} niga`,
            phrase.replaceAll(' ', ', '),
            phrase.replaceAll(' ', ' - '),
            phrase.replaceAll(' ', '\n'),
            phrase.replaceAll(' ', ' 😃 '),
            phrase.replace(target, target.replace('a', '4')),
          ])
            expect(
              screener.screen({ text, locale, field: 'caption' }).disposition,
              text
            ).toBe('block')
        }
      })
    }
  )

  it.each([
    'retard',
    'en retard',
    'rétard',
    'r3tard',
    'rettard',
    'en r3tard',
    'ret@rd',
    'tapete',
    'um tapete',
    't4pete',
    'tapéte',
  ])(
    'rejects global token/phrase allowances for reviewed occurrence target %s',
    (entry) => {
      withModifiedAllow(
        'allow-fr-v1.json',
        (list) => {
          list.entries.push(entry)
        },
        (directory) => {
          expect(() => fromFixture(directory)).toThrow(
            'reviewed occurrence target cannot be globally allow-listed'
          )
        }
      )
    }
  )

  it.each(['you retard', 'en, retard', 'en rétard', 'n i g a'])(
    'rejects unreviewed occurrence construction %s at load',
    (phrase) => {
      withModifiedAllow(
        'allow-fr-v1.json',
        (list) => {
          list.occurrenceConstructions[0]!.phrases[0] = phrase
        },
        (directory) => {
          expect(() => fromFixture(directory)).toThrow()
        }
      )
    }
  )

  it('rejects a foreign bank, duplicate bank, missing construction and changed target', () => {
    withModifiedAllow(
      'allow-en-v1.json',
      (list) => {
        list.occurrenceConstructions = reviewedOccurrenceBank.constructions
          .filter((rule) => rule.target === 'retard')
          .map(({ target, phrases }) => ({ target, phrases: [...phrases] }))
      },
      (directory) => {
        expect(() => fromFixture(directory)).toThrow('unreviewed occurrence construction')
      }
    )
    for (const change of [
      (list: AllowFixture) => {
        list.occurrenceConstructions.push(list.occurrenceConstructions[0]!)
      },
      (list: AllowFixture) => {
        list.occurrenceConstructions[0]!.phrases.pop()
      },
      (list: AllowFixture) => {
        list.occurrenceConstructions[0]!.target = 'nigga'
      },
    ])
      withModifiedAllow('allow-fr-v1.json', change, (directory) => {
        expect(() => fromFixture(directory)).toThrow()
      })
  })

  it.each([
    'en, retard',
    'en - retard',
    'en\nretard',
    'en 😃 retard',
    'e n retard',
    'en r3tard',
    'en rétard',
    'en re\u200btard',
    'ｅｎ retard',
    'xxen retard',
  ])('rejects unreviewed or obfuscated constructions %s', (text) => {
    expect(screener.screen({ text, locale: 'fr-FR', field: 'caption' }).disposition).toBe(
      'block'
    )
  })

  it.each([
    { text: 'burro de ropa', native: 'es-419' },
    { text: 'montare la fibbia', native: 'it-IT' },
    { text: 'mofo da roupa', native: 'pt-BR' },
  ])(
    'scopes ordinary generic grammar to its declared language: $native',
    ({ text, native }) => {
      expect(
        screener.screen({ text, locale: native, field: 'caption' }).disposition
      ).toBe('pass')
      expect(
        screener.screen({ text, locale: 'en-US', field: 'caption' }).disposition
      ).not.toBe('pass')
      expect(screener.screen({ text, field: 'caption' }).disposition).not.toBe('pass')
    }
  )

  it.each(locales)(
    'every added deletion/disallowed family is present and closed in %s',
    (locale) => {
      const language = locale.split('-')[0]
      const corpus = JSON.parse(
        fs.readFileSync(
          path.resolve(
            __dirname,
            `../../../test/fixtures/community-text-corpus/${language}.json`
          ),
          'utf8'
        )
      ) as {
        disallowed: {
          families: string[]
          entries: {
            id: string
            text: string
            field: 'caption' | 'altText'
            family: string
          }[]
        }
      }
      expect(corpus.disallowed.families).toContain('doubled-letter-deletion')
      expect(corpus.disallowed.families).toContain('context-separator-adversarial')
      const added = corpus.disallowed.entries.filter((row) =>
        ['doubled-letter-deletion', 'context-separator-adversarial'].includes(row.family)
      )
      expect(added.length).toBeGreaterThanOrEqual(data.reported.length)
      for (const row of added)
        expect(
          screener.screen({ text: row.text, field: row.field, locale }).disposition,
          row.id
        ).not.toBe('pass')
      for (const reported of data.reported)
        expect(
          added.some((row) => row.text === reported.text),
          reported.id
        ).toBe(true)
    }
  )
})
