import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { describe, expect, it } from 'vitest'
import { supportedLocales } from '@couture/api-client/contracts/http'
import { loadCommunityScreeningPolicy } from './community-screening-policy.js'
import {
  CommunityTextScreener,
  type TextScreeningField,
} from './community-text-screener.js'
import { wilsonInterval } from './community-text-corpus-gate.js'

const loaded = loadCommunityScreeningPolicy()
const screener = new CommunityTextScreener({ policy: loaded.policy.text })
const root = path.resolve(__dirname, '../../../test/fixtures/community-text-corpus')
const read = <T>(file: string): T =>
  JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')) as T
interface CorpusRow {
  id: string
  text: string
  field: TextScreeningField
  expected?: string
  family?: string
}
interface Corpus {
  entries: CorpusRow[]
}
const locales = {
  de: 'de-DE',
  en: 'en-US',
  es: 'es-419',
  fr: 'fr-FR',
  it: 'it-IT',
  pt: 'pt-BR',
  tr: 'tr-TR',
}
const clean = (text: string, locale: string, field: TextScreeningField = 'caption') =>
  screener.screen({ text, locale, field }).disposition

describe('round 3 development data, including released v4', () => {
  it.each(Object.entries(locales))(
    '%s keeps the unchanged released-v4 development limit',
    (language, locale) => {
      const development = read<Corpus>(`holdout-v4/${language}.json`).entries
      const withheld = development
        .filter((row) => clean(row.text, locale, row.field) !== 'pass')
        .map((row) => row.id)
      console.log(
        JSON.stringify({
          evidence: 'round3-v4-development',
          language,
          total: development.length,
          withheld: withheld.length,
          upper: wilsonInterval(withheld.length, development.length)[1],
        })
      )
      expect(
        wilsonInterval(withheld.length, development.length)[1],
        JSON.stringify(withheld)
      ).toBeLessThanOrEqual(0.01)
    }
  )
  it.each(Object.entries(locales))(
    '%s preserves in-sample clean copy',
    (language, locale) => {
      const corpus = read<{ clean: Corpus }>(`${language}.json`)
      expect(corpus.clean.entries).toHaveLength(420)
      expect(
        corpus.clean.entries.filter(
          (row: { text: string; field: TextScreeningField; expected?: string }) =>
            row.expected !== 'review' && clean(row.text, locale, row.field) !== 'pass'
        )
      ).toEqual([])
    }
  )
  describe.each(Object.entries(locales))(
    '%s disguised training families',
    (language, locale) => {
      const corpus = read<{ disallowed: Corpus & { families: string[] } }>(
        `${language}.json`
      )
      it.each(corpus.disallowed.families)('withholds every %s input', (family) => {
        const rows = corpus.disallowed.entries.filter((row) => row.family === family)
        expect(rows.length).toBeGreaterThan(0)
        expect(
          rows
            .filter((row) => clean(row.text, locale, row.field) === 'pass')
            .map((row) => row.id)
        ).toEqual([])
      })
    }
  )

  it.each([
    ['development-v2.json', 6],
    ['development-v3.json', 24],
  ] as const)('preserves every earlier %s case', (file, size) => {
    const entries = read<{ entries: { text: string; locale: string }[] }>(file).entries
    expect(entries).toHaveLength(size)
    for (const row of entries) expect(clean(row.text, row.locale), row.text).toBe('pass')
  })

  it.each(Object.entries(locales))(
    '%s preserves all retired development corpora',
    (language, locale) => {
      const allFailures: string[] = []
      for (const [version, size] of [
        [1, 420],
        [2, 400],
        [3, 1000],
      ] as const) {
        const entries = read<Corpus>(`holdout-v${version}/${language}.json`).entries
        expect(entries, `holdout-v${version}/${language}`).toHaveLength(size)
        const failures = entries
          .filter(
            (row) =>
              (clean(row.text, locale, row.field) === 'pass') ===
              (row.expected === 'review')
          )
          .map((row) => row.id)
        allFailures.push(...failures.map((id) => `v${version}:${id}`))
      }
      expect(allFailures).toEqual([])
    },
    // Round6 measured seven locale loops: 4.83..5.02 s plain, 5.59..6.48 s
    // covered. This 20 s batch-only deadline leaves 3.0x measured headroom;
    // ordinary tests retain Vitest's default and product budgets stay unchanged.
    20_000
  )

  const literalCohort = [
    'Bänder am Ärmel ergeben einen lockeren Verschluss.',
    'Le pieghe mosse danno volume alle maniche.',
    'Ein Mantel für das Büro und ein Buro Outfit.',
    'Une silhouette de la tête aux pieds, en rose pâle.',
    'Uma bolsa em forma de pera.',
    'Un putto ricamato sulla giacca.',
    'Sikke kolye bu kumaşa yakışır ve şıktır.',
  ]
  it.each(supportedLocales)(
    'recognizes literal lexical collisions across contexts under %s',
    (locale) => {
      for (const text of literalCohort) {
        expect(clean(text, locale), text).toBe('pass')
        for (const suffix of [' fuck', ' f u c k', ' f.u.c.k'])
          expect(clean(text + suffix, locale)).not.toBe('pass')
      }
    }
  )

  it.each(['cone', 'pipa', 'lo fa'])(
    'clears the reviewed literal ordinary collision %s',
    (text) => {
      expect(clean(text, 'pt-BR')).toBe('pass')
    }
  )
  it.each([
    'conne',
    'connne',
    'pippa',
    'pippaa',
    'loffa',
    'lo ff a',
    'c0nne',
    'p1ppa',
    'bander',
    'b a n d e r',
    'möse',
    'möööse',
    'm0sse',
    'coneee',
    'piiipa',
    'lofa',
    'l o f a',
    'lo-fa',
    'lo,fa',
  ])('continues withholding the actual or disguised term %s', (text) => {
    expect(clean(text, 'en-US')).not.toBe('pass')
  })

  it('preserves every canonical run variant and its worst applicable severity', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cc68-round3-runs-'))
    try {
      const source = path.resolve(
        __dirname,
        '../../../policies/community-screening/terms-v1'
      )
      for (const name of fs.readdirSync(source))
        fs.copyFileSync(path.join(source, name), path.join(directory, name))
      const file = path.join(directory, 'en-v1.json')
      const list = JSON.parse(fs.readFileSync(file, 'utf8')) as {
        entries: { term: string; category: string; severity: string }[]
      }
      list.entries.push(
        { term: 'qazzef', category: 'hate', severity: 'high' },
        { term: 'qazeff', category: 'profanity', severity: 'low' },
        { term: 'penas', category: 'profanity', severity: 'low' },
        { term: 'mofo', category: 'profanity', severity: 'low' },
        { term: 'montare la fibbia', category: 'hate', severity: 'high' }
      )
      fs.writeFileSync(file, JSON.stringify(list))
      const isolated = new CommunityTextScreener({ listsDirectory: directory })
      for (const text of ['qazzef', 'qazzzefff', 'q4zzzefff', 'qa zz ze ff f'])
        expect(isolated.screen({ text, field: 'caption' }).severity, text).toBe('high')
      for (const text of ['qazeff', 'qa ze ff'])
        expect(isolated.screen({ text, field: 'caption' }).severity, text).toBe('low')
      for (const text of ['qazef', 'q4zef', 'qa ze f', 'qazefff', 'q4zefff'])
        expect(isolated.screen({ text, field: 'caption' }).severity, text).toBe('high')
      // The production backstop's penas/mofo entries have no leet index.
      // Supplying indexed terms proves contextual grammar never clears a
      // disguised target when such an index is present.
      for (const text of ['p3nas de casaco', 'm0fo da roupa'])
        expect(
          isolated.screen({ text, field: 'caption', locale: 'pt-BR' }).disposition,
          text
        ).not.toBe('pass')
      // A contextually ordinary target must still participate in unsafe phrases.
      expect(
        isolated.screen({ text: 'montare la fibbia', field: 'caption', locale: 'it-IT' })
          .severity
      ).toBe('high')
    } finally {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })

  it.each(['lolita', 'baiser'])(
    'refuses a contextual allowance for deliberate review term %s at load',
    (term) => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cc68-round3-context-'))
      try {
        const source = path.resolve(
          __dirname,
          '../../../policies/community-screening/terms-v1'
        )
        for (const name of fs.readdirSync(source))
          fs.copyFileSync(path.join(source, name), path.join(directory, name))
        const file = path.join(directory, 'allow-en-v1.json')
        const list = JSON.parse(fs.readFileSync(file, 'utf8')) as {
          literalContexts: {
            terms: string[]
            objects: string[]
            connectors: string[]
            maxDistance: number
          }[]
        }
        list.literalContexts = [
          { terms: [term], objects: ['borsa'], connectors: ['di'], maxDistance: 3 },
        ]
        fs.writeFileSync(file, JSON.stringify(list))
        expect(
          () =>
            new CommunityTextScreener({
              listsDirectory: directory,
              policy: { ...loaded.policy.text, lists: [] },
            })
        ).toThrow('a deliberate review term is allow-listed')
      } finally {
        fs.rmSync(directory, { recursive: true, force: true })
      }
    }
  )

  const assembly = [
    'La fibbia è ancora da montare.',
    'Devo montare la nuova cerniera.',
    'Montare quei piccoli bottoni sul cappotto richiede pazienza.',
    'Il manico è pronto per montare.',
    'Ela monta uma gola no casaco.',
    'A manga fica pronta e monta o punho.',
    'O tecido forma uma dobra e monta uma prega.',
    'Monta o novo fecho na bolsa.',
  ]

  const ordinaryHomographs = [
    'Las chaquetas cuelgan del burro de ropa.',
    'Tengo un burro para las camisas.',
    'Le train est en retard.',
    'Un retard du métro me laisse sous la pluie.',
    'Due orecchini di corno con piccoli ganci.',
    'I bottoni in corno sono lucidati.',
    'O colete de penas fica leve.',
    'Brincos com penas para o passeio.',
    'Retirei o mofo da camisa.',
    'O tecido está sem mofo.',
  ]
  it.each(supportedLocales)(
    'keeps bounded storage/material/transport/care senses under %s',
    (locale) => {
      for (const [index, text] of ordinaryHomographs.entries()) {
        const native = index < 2 ? 'es' : index < 4 ? 'fr' : index < 6 ? 'it' : 'pt'
        // Round6 removes the ambiguous article construction even in French.
        if (text.startsWith('Un retard')) expect(clean(text, locale), text).toBe('block')
        else if (locale.startsWith(native)) expect(clean(text, locale), text).toBe('pass')
        else expect(clean(text, locale), text).not.toBe('pass')
        expect(clean(text + ' fuck', locale), text).not.toBe('pass')
      }
      for (const text of [
        'burro',
        'retard',
        'corno',
        'penas',
        'mofo',
        'burr0 de ropa',
        'ret4rd du tram',
        'c0rno di bottone',
        'p3nis de casaco',
        'm0therfucker da roupa',
        'camisa. mofo',
      ])
        expect(clean(text, locale), text).not.toBe('pass')
    }
  )
  it.each(supportedLocales)('recognizes bounded assembly syntax under %s', (locale) => {
    for (const [index, text] of assembly.entries()) {
      if (locale.startsWith(index < 4 ? 'it' : 'pt'))
        expect(clean(text, locale), text).toBe('pass')
      else expect(clean(text, locale), text).not.toBe('pass')
      expect(clean(text + ' fuck', locale)).not.toBe('pass')
      expect(clean(text + ' monta', locale)).not.toBe('pass')
    }
  })
  it.each([
    'monta',
    'montare',
    'm0nta la fibbia',
    'monta. La fibbia.',
    'monta\nla fibbia',
    'montare; la fibbia',
    'La fibbia. Montare.',
    'La fibbia si vede oggi mentre raccontiamo tante altre cose prima di montare.',
    'monta una persona vicino alla fibbia',
    'La fibbia è pronta. monta una persona.',
    'monta fuck una fibbia',
  ])('keeps context boundaries and independent terms closed: %s', (text) => {
    expect(clean(text, 'it-IT')).not.toBe('pass')
  })

  it('enforces the exact distance bound on both sides and does not clear unsafe phrases', () => {
    expect(clean('montare tutte quelle nuove piccole fibbie', 'it-IT')).toBe('pass')
    expect(clean('montare ancora tutte quelle nuove piccole fibbie', 'it-IT')).not.toBe(
      'pass'
    )
    expect(clean('fibbia nuova ancora pronta da montare', 'it-IT')).toBe('pass')
    expect(clean('fibbia nuova ancora nuova pronta da montare', 'it-IT')).not.toBe('pass')
    for (const text of [
      'montare la fibbia concha de tu madre',
      'montare la fibbia kill yourself',
      'montare la fibbia montare',
    ])
      expect(clean(text, 'it-IT'), text).not.toBe('pass')
  })
})
