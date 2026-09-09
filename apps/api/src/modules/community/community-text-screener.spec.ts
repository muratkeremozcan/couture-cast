// Learning path Step 39: Production content-screening readiness.
// Story 6.2 Task 3: reusable multilingual community text screening (ADR-013).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  communityPostAltTextSchema,
  communityPostCaptionSchema,
} from '@couture/api-client/contracts/http'
import { loadCommunityScreeningPolicy } from './community-screening-policy.js'
import {
  CANONICAL_REPRESENTATIONS,
  CommunityTextScreener,
  CommunityTextScreenerConfigError,
  CONTRACT_FIELD_CEILINGS,
  DEFAULT_COMMUNITY_TEXT_POLICY,
  LOCALE_SCREENING_LANGUAGES,
  LOCALE_UNSCREENABLE_REASON,
  SCREENING_LANGUAGES,
  TEXT_SCREENING_SEVERITIES,
  SCRIPT_MIXED_REASON,
  SCRIPT_UNSUPPORTED_REASON,
  TEXT_CLEAN_REASON,
  TEXT_INPUT_TRUNCATED_REASON,
  TEXT_POLICY_MATCH_REASON,
  toFoldedForm,
  toLiteralForm,
  type CommunityTextPolicy,
  type ScreeningLanguage,
  type TextScreeningCategory,
  type TextScreeningSeverity,
} from './community-text-screener.js'

const repoRoot = path.resolve(__dirname, '../../../../..')
const policyDirectory = path.resolve(__dirname, '../../../policies/community-screening')
const listsDirectory = path.join(policyDirectory, 'terms-v1')
const supportedLocalesPath = path.join(
  repoRoot,
  'packages/api-client/src/contracts/http/supported-locales.json'
)

interface TermEntry {
  term: string
  category: TextScreeningCategory
  severity: TextScreeningSeverity
}

interface ListFile {
  language: ScreeningLanguage
  listVersion: string
  listType: 'terms' | 'allowList'
  provenance: Record<string, string>
  entries: TermEntry[] | string[]
}

const readJson = <T>(filePath: string): T =>
  JSON.parse(fs.readFileSync(filePath, 'utf8')) as T

const termLists = Object.fromEntries(
  SCREENING_LANGUAGES.map((language) => [
    language,
    readJson<ListFile & { entries: TermEntry[] }>(
      path.join(listsDirectory, `${language}-v1.json`)
    ),
  ])
) as Record<ScreeningLanguage, ListFile & { entries: TermEntry[] }>

const allowLists = Object.fromEntries(
  SCREENING_LANGUAGES.map((language) => [
    language,
    readJson<ListFile & { entries: string[] }>(
      path.join(listsDirectory, `allow-${language}-v1.json`)
    ),
  ])
) as Record<ScreeningLanguage, ListFile & { entries: string[] }>

const supportedLocaleConfig =
  readJson<Record<string, { language: string }>>(supportedLocalesPath)

interface ApprovedPolicy {
  text: Record<string, unknown> & {
    lists: {
      language: string
      terms: string
      allowList: string
      version: string
      source: string
      licence: string
    }[]
  }
  reasonCodes: { text: Record<string, string>; cleanCodes: { text: string } }
}

const approvedPolicy = readJson<ApprovedPolicy>(
  path.join(policyDirectory, 'policy-v1.json')
)

const allowedEverywhere = new Set(
  Object.values(allowLists).flatMap((list) =>
    list.entries.map((entry) => toFoldedForm(toLiteralForm(entry)))
  )
)

/**
 * A single-word term per language that can carry every obfuscation family: long
 * enough to survive a repeat collapse, holding a Cyrillic-confusable letter and
 * a leetspeak-substitutable one, and not itself allow-listed. Throws rather than
 * skipping, so a list that cannot exercise the families fails the suite instead
 * of quietly reducing it to nothing.
 */
function pickRepresentativeTerm(language: ScreeningLanguage): TermEntry {
  const candidate = termLists[language].entries
    .filter((entry) => {
      const folded = toFoldedForm(toLiteralForm(entry.term))
      return (
        !folded.includes(' ') &&
        folded.length >= 5 &&
        !allowedEverywhere.has(folded) &&
        /[aeocpxty]/.test(folded) &&
        /[oiesat]/.test(folded)
      )
    })
    .sort((left, right) => right.term.length - left.term.length)[0]

  if (!candidate) {
    throw new Error(`${language}-v1.json has no term that can carry the obfuscations`)
  }
  return candidate
}

const representatives = Object.fromEntries(
  SCREENING_LANGUAGES.map((language) => [language, pickRepresentativeTerm(language)])
) as Record<ScreeningLanguage, TermEntry>

const toUpper = (term: string) => term.toUpperCase()
const toFullwidth = (term: string) =>
  [...term]
    .map((character) =>
      /[a-z]/.test(character)
        ? String.fromCodePoint((character.codePointAt(0) as number) - 0x61 + 0xff41)
        : character
    )
    .join('')
const withZeroWidth = (term: string) => [...term].join('​')
const withRepeats = (term: string) =>
  [...term].map((character) => character.repeat(2)).join('')
const withPunctuation = (term: string) => [...term].join('.')
const withSpacedLetters = (term: string) => [...term].join(' ')
const withConfusables = (term: string) =>
  term
    .replace(/a/g, 'а')
    .replace(/e/g, 'е')
    .replace(/o/g, 'о')
    .replace(/c/g, 'с')
    .replace(/p/g, 'р')
    .replace(/x/g, 'х')
    .replace(/y/g, 'у')
    .replace(/t/g, 'т')
const DIACRITICS: Record<string, string> = {
  a: 'á',
  e: 'é',
  i: 'í',
  o: 'ó',
  u: 'ú',
  c: 'ç',
  n: 'ñ',
  s: 'ş',
  g: 'ğ',
}
const withDiacritics = (term: string) =>
  [...term].map((character) => DIACRITICS[character] ?? character).join('')
const withLeetspeak = (term: string) =>
  term
    .replace(/o/g, '0')
    .replace(/i/g, '1')
    .replace(/e/g, '3')
    .replace(/a/g, '4')
    .replace(/s/g, '5')
    .replace(/t/g, '7')

/** Every code `screen` can emit that withholds a post. */
const WITHHOLDING_REASONS = [
  TEXT_POLICY_MATCH_REASON,
  TEXT_INPUT_TRUNCATED_REASON,
  LOCALE_UNSCREENABLE_REASON,
  SCRIPT_MIXED_REASON,
  SCRIPT_UNSUPPORTED_REASON,
]

const severityRank = (severity: TextScreeningSeverity | null) =>
  severity === null ? -1 : TEXT_SCREENING_SEVERITIES.indexOf(severity)

const screener = new CommunityTextScreener()

const screenCaption = (text: string, locale: string | null = 'en-US') =>
  screener.screen({ text, field: 'caption', locale })

/** A clean caption per language, so the pass path is proved with real copy. */
const CLEAN_CAPTIONS: Record<ScreeningLanguage, string> = {
  de: 'Ein Mantel aus Wolle mit Guertel und weiten Aermeln, dazu flache Stiefel.',
  en: 'A cocktail dress in peacock silk with a cockade at the shoulder and a slit hem.',
  es: 'Un vestido de lino con cinturon de cuero y sandalias planas para el verano.',
  fr: 'Une robe en lin avec une ceinture tressee et des sandales plates pour la saison.',
  it: 'Un cappotto di lana con cintura e maniche ampie, abbinato a stivali bassi.',
  pt: 'Um vestido de linho com cinto de couro e sandalias rasas para o verao.',
  tr: 'Keten bir elbise, deri kemer ve yazlik duz sandaletlerle tamamlanan bir gorunum.',
}

function writeListFixture(
  overrides: Partial<Record<string, unknown>> = {},
  omit: string[] = []
): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'community-terms-'))
  const files: Record<string, unknown> = {}
  for (const language of SCREENING_LANGUAGES) {
    files[`${language}-v1.json`] = termLists[language]
    files[`allow-${language}-v1.json`] = allowLists[language]
  }
  for (const [name, content] of Object.entries({ ...files, ...overrides })) {
    if (omit.includes(name)) continue
    fs.writeFileSync(
      path.join(directory, name),
      typeof content === 'string' ? content : JSON.stringify(content),
      'utf8'
    )
  }
  return directory
}

describe('CommunityTextScreener locale coverage (AC 3)', () => {
  it('maps every enabled locale onto a language whose list is loaded', () => {
    for (const locale of Object.keys(supportedLocaleConfig)) {
      expect(screener.resolveLanguage(locale)).toBe(
        supportedLocaleConfig[locale]?.language
      )
    }
  })

  it('derives the same locale-to-language map the canonical JSON declares', () => {
    const derived = Object.fromEntries(
      Object.keys(supportedLocaleConfig).map((locale) => [
        locale,
        LOCALE_SCREENING_LANGUAGES[locale],
      ])
    )
    const canonical = Object.fromEntries(
      Object.entries(supportedLocaleConfig).map(([locale, config]) => [
        locale,
        config.language,
      ])
    )
    expect(derived).toEqual(canonical)
    // Both directions. Keyed only off the JSON, an extra entry the built
    // api-client had drifted into the map would go unseen.
    expect(Object.keys(LOCALE_SCREENING_LANGUAGES).sort()).toEqual(
      Object.keys(supportedLocaleConfig).sort()
    )
  })

  it('screens exactly the set of languages the enabled locales require', () => {
    const required = new Set(
      Object.values(supportedLocaleConfig).map((config) => config.language)
    )
    expect(new Set(screener.screenedLanguages)).toEqual(required)
    expect(new Set(SCREENING_LANGUAGES)).toEqual(required)
  })

  it('routes a locale it holds no list for to human review', () => {
    const result = screenCaption('a linen shirt dress', 'ja-JP')
    expect(screener.resolveLanguage('ja-JP')).toBeNull()
    expect(result.reasons).toContain(LOCALE_UNSCREENABLE_REASON)
    expect(result.disposition).toBe('review')
  })

  it('accepts underscore and case variants of an enabled locale', () => {
    expect(screener.resolveLanguage('PT_br')).toBe('pt')
    expect(screener.resolveLanguage('  es-419 ')).toBe('es')
    expect(screener.resolveLanguage(null)).toBeNull()
  })

  it('reports the declared locale, field and list versions back as provenance', () => {
    const result = screener.screen({
      text: 'a linen shirt dress',
      field: 'altText',
      locale: 'fr-CA',
    })
    expect(result.field).toBe('altText')
    expect(result.declaredLocale).toBe('fr-CA')
    expect(result.policyVersion).toBe('community-screening-policy-v1')
    expect(Object.keys(result.listVersions).sort()).toEqual(
      [...SCREENING_LANGUAGES].sort()
    )
  })
})

describe('CommunityTextScreener policy wiring (AC 7)', () => {
  /** Rationale strings and the list manifest are the policy's, not the screener's. */
  const withoutProse = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(withoutProse)
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .filter(
            ([key]) =>
              !key.endsWith('Rationale') && key !== 'rationale' && key !== 'openQuestions'
          )
          .map(([key, nested]) => [key, withoutProse(nested)])
      )
    }
    return value
  }

  it('carries the same text policy the approved policy file declares', () => {
    const approved = withoutProse(approvedPolicy.text) as Record<string, unknown>
    delete approved.lists
    expect(withoutProse(DEFAULT_COMMUNITY_TEXT_POLICY)).toEqual(approved)
  })

  it('screens the same way when driven by the loaded policy object', () => {
    const loaded = loadCommunityScreeningPolicy()
    const wired = new CommunityTextScreener({
      policy: loaded.policy.text,
      policyVersion: loaded.identity.textEngineVersion,
    })
    const abusive = `a jacket ${representatives.en.term} indeed`

    expect(wired.screen({ text: abusive, field: 'caption', locale: 'en-US' })).toEqual({
      ...screenCaption(abusive),
      policyVersion: loaded.identity.textEngineVersion,
    })
    expect(loaded.identity.textEngineVersion).toContain(loaded.policySha256.slice(0, 12))
    expect(loaded.policy.text.limits.maxInputCharacters).toEqual(CONTRACT_FIELD_CEILINGS)
  })

  it('emits exactly the reason codes the approved policy declares', () => {
    const declared = Object.keys(approvedPolicy.reasonCodes.text)
    expect([...WITHHOLDING_REASONS].sort()).toEqual(declared.sort())
    // The pass code cannot live in that map, because the policy types every
    // entry there to a disposition that withholds a post. It has its own block.
    expect(declared).not.toContain(TEXT_CLEAN_REASON)
    expect(approvedPolicy.reasonCodes.cleanCodes.text).toBe(TEXT_CLEAN_REASON)
  })

  it('names every shipped list file in the approved policy', () => {
    const lists = approvedPolicy.text.lists
    expect(lists.map((entry) => entry.language).sort()).toEqual(
      [...SCREENING_LANGUAGES].sort()
    )
    for (const entry of lists) {
      for (const relative of [entry.terms, entry.allowList]) {
        expect(fs.existsSync(path.join(policyDirectory, relative)), relative).toBe(true)
      }
      expect(entry.source?.length).toBeGreaterThan(0)
      expect(entry.version?.length).toBeGreaterThan(0)
      expect(entry.licence?.length).toBeGreaterThan(0)
    }
  })

  it('stays inside the policy ceiling on canonical representations', () => {
    expect(CANONICAL_REPRESENTATIONS.length).toBeLessThanOrEqual(
      DEFAULT_COMMUNITY_TEXT_POLICY.limits.maxCanonicalRepresentations
    )
  })

  it('refuses a policy that would let a declared locale bypass other languages', () => {
    expect(
      () =>
        new CommunityTextScreener({
          policy: { ...DEFAULT_COMMUNITY_TEXT_POLICY, allDictionariesAlwaysRun: false },
        })
    ).toThrow(/allDictionariesAlwaysRun/)
  })

  it('refuses a policy whose representation ceiling is below what it generates', () => {
    expect(
      () =>
        new CommunityTextScreener({
          policy: {
            ...DEFAULT_COMMUNITY_TEXT_POLICY,
            limits: {
              ...DEFAULT_COMMUNITY_TEXT_POLICY.limits,
              maxCanonicalRepresentations: 2,
            },
          },
        })
    ).toThrow(/canonical representations/)
  })
})

describe('CommunityTextScreener field bounds (AC 4)', () => {
  it('bounds each field at the length its own contract schema enforces', () => {
    expect(() =>
      communityPostCaptionSchema.parse('a'.repeat(CONTRACT_FIELD_CEILINGS.caption))
    ).not.toThrow()
    expect(() =>
      communityPostCaptionSchema.parse('a'.repeat(CONTRACT_FIELD_CEILINGS.caption + 1))
    ).toThrow()
    expect(() =>
      communityPostAltTextSchema.parse('a'.repeat(CONTRACT_FIELD_CEILINGS.altText))
    ).not.toThrow()
    expect(() =>
      communityPostAltTextSchema.parse('a'.repeat(CONTRACT_FIELD_CEILINGS.altText + 1))
    ).toThrow()
  })

  it('accepts a caption at 280 and an alt text at 200 without truncating', () => {
    expect(
      screener.screen({
        text: 'linen '.repeat(46).slice(0, CONTRACT_FIELD_CEILINGS.caption),
        field: 'caption',
        locale: 'en-US',
      }).truncated
    ).toBe(false)
    expect(
      screener.screen({
        text: 'linen '.repeat(33).slice(0, CONTRACT_FIELD_CEILINGS.altText),
        field: 'altText',
        locale: 'en-US',
      }).truncated
    ).toBe(false)
  })

  it('fails a 281-character caption and a 201-character alt text closed', () => {
    for (const [field, ceiling] of Object.entries(CONTRACT_FIELD_CEILINGS)) {
      const result = screener.screen({
        text: 'linen dress '.repeat(40).slice(0, ceiling + 1),
        field: field as 'caption' | 'altText',
        locale: 'en-US',
      })
      expect(result.truncated, field).toBe(true)
      expect(result.reasons, field).toContain(TEXT_INPUT_TRUNCATED_REASON)
      expect(result.disposition, field).toBe('review')
    }
  })

  it('does not screen the text it had to cut away', () => {
    const term = representatives.en.term
    const padded = `${'ab '.repeat(CONTRACT_FIELD_CEILINGS.caption)}${term}`
    const result = screenCaption(padded)
    expect(result.truncated).toBe(true)
    expect(result.categories).not.toContain(representatives.en.category)
  })

  it('stops expanding once the policy character budget is spent', () => {
    const tight = new CommunityTextScreener({
      policy: {
        ...DEFAULT_COMMUNITY_TEXT_POLICY,
        limits: { ...DEFAULT_COMMUNITY_TEXT_POLICY.limits, maxExpandedCharacters: 8 },
      },
    })
    const result = tight.screen({
      text: withSpacedLetters(representatives.en.term),
      field: 'caption',
      locale: 'en-US',
    })
    expect(result.truncated).toBe(true)
    expect(result.reasons).toContain(TEXT_INPUT_TRUNCATED_REASON)
    expect(
      screenCaption(withSpacedLetters(representatives.en.term)).categories
    ).toContain(representatives.en.category)
  })

  it('treats empty and absent text as clean', () => {
    for (const text of ['', '   ', null, undefined]) {
      const result = screener.screen({ text, field: 'caption', locale: 'en-US' })
      expect(result.disposition).toBe('pass')
      expect(result.reasons).toEqual([TEXT_CLEAN_REASON])
      expect(result.severity).toBeNull()
    }
  })
})

describe('CommunityTextScreener obfuscation families (AC 4)', () => {
  const families: [string, (term: string) => string][] = [
    ['case folding', toUpper],
    ['diacritic folding', withDiacritics],
    ['Unicode NFKC', toFullwidth],
    ['zero-width characters', withZeroWidth],
    ['repeated characters', withRepeats],
    ['internal punctuation', withPunctuation],
    ['spaced letters', withSpacedLetters],
    ['Latin and Cyrillic confusables', withConfusables],
    ['leetspeak', withLeetspeak],
  ]

  for (const language of SCREENING_LANGUAGES) {
    describe(language, () => {
      const entry = representatives[language]

      it('flags the plain term', () => {
        const result = screenCaption(`look at this ${entry.term} of a jacket`)
        expect(result.categories).toContain(entry.category)
        expect(result.reasons).toContain(TEXT_POLICY_MATCH_REASON)
        expect(result.obfuscated).toBe(false)
      })

      it('passes ordinary copy in this language', () => {
        const result = screenCaption(CLEAN_CAPTIONS[language])
        expect(result.disposition).toBe('pass')
        expect(result.categories).toEqual([])
      })

      const plain = () => screenCaption(`a jacket ${entry.term} indeed`)

      for (const [family, disguise] of families) {
        it(`sees through ${family}`, () => {
          const result = screenCaption(`a jacket ${disguise(entry.term)} indeed`)
          expect(result.categories).toContain(entry.category)
          // Severity parity, not merely a non-pass. A long term whose disguised
          // form only reaches some shorter, milder term inside it would satisfy
          // a weaker assertion while the family itself stayed broken.
          expect(result.severity).toBe(plain().severity)
          expect(result.disposition).toBe(plain().disposition)
        })
      }

      it('marks a match that needed a canonical representation as obfuscated', () => {
        expect(screenCaption(withRepeats(entry.term)).obfuscated).toBe(true)
      })

      it('never puts the matched term in the result', () => {
        const result = screenCaption(`a jacket ${entry.term} indeed`)
        expect(JSON.stringify(result)).not.toContain(entry.term)
      })
    })
  }

  it('rebuilds the longest single-word term in every list from its spaced form', () => {
    for (const language of SCREENING_LANGUAGES) {
      const longest = termLists[language].entries
        .filter((entry) => !entry.term.includes(' '))
        .sort((left, right) => right.term.length - left.term.length)[0] as TermEntry
      const plain = screenCaption(longest.term)
      for (const disguised of [
        withSpacedLetters(longest.term),
        withPunctuation(longest.term),
      ]) {
        const result = screenCaption(disguised)
        expect(result.severity, `${language}: ${disguised}`).toBe(plain.severity)
        expect(result.categories, `${language}: ${disguised}`).toEqual(plain.categories)
      }
    }
  })

  it('sees through every obfuscation of a multi-word term, in every language', () => {
    for (const language of SCREENING_LANGUAGES) {
      const phrases = termLists[language].entries.filter((entry) =>
        entry.term.includes(' ')
      )
      expect(phrases.length, language).toBeGreaterThan(0)

      for (const entry of phrases) {
        const joined = entry.term.replace(/ /g, '')
        for (const disguised of [
          joined,
          withSpacedLetters(joined),
          withPunctuation(joined),
          withLeetspeak(entry.term),
        ]) {
          const result = screenCaption(disguised)
          const where = `${language}: ${disguised}`
          expect(result.disposition, where).not.toBe('pass')
          // The phrase's own category and grade, not the plain form's totals:
          // running the words together drops any standalone term inside the
          // phrase, which is correct and would make an equality check wrong.
          // Truncation is the crafted-amplification path and withholds the post
          // on its own, so parity is only owed when the input was fully read.
          if (!result.truncated) {
            expect(result.categories, where).toContain(entry.category)
            expect(severityRank(result.severity), where).toBeGreaterThanOrEqual(
              severityRank(entry.severity)
            )
          }
        }
      }
    }
  })

  it('folds diacritics so an accented spelling cannot slip a term through', () => {
    expect(screenCaption('que coño de vestido').categories).not.toEqual([])
    expect(screenCaption('que cono de vestido').disposition).toBe('pass')
  })
})

describe('CommunityTextScreener runs every dictionary (AC 3)', () => {
  it('flags a term from a language the declared locale did not name', () => {
    for (const language of SCREENING_LANGUAGES) {
      const entry = representatives[language]
      const result = screenCaption(`a jacket ${entry.term} indeed`, 'en-US')
      expect(result.categories, language).toContain(entry.category)
      expect(result.screenedLanguages).toEqual(expect.arrayContaining([language]))
    }
  })

  it('preserves the Story 6.1 English, Spanish and French vocabulary', () => {
    const inherited = [
      'fuck',
      'shit',
      'bitch',
      'asshole',
      'cunt',
      'whore',
      'slut',
      'nigger',
      'faggot',
      'nazi',
      'terrorist',
      'kys',
      'kill yourself',
      'puta',
      'mierda',
      'joder',
      'pendejo',
      'hijo de puta',
      'merde',
      'putain',
      'salope',
      'connard',
      'bordel',
    ]
    for (const term of inherited) {
      expect(screenCaption(`no ${term} here`).disposition, term).not.toBe('pass')
    }
  })
})

describe('CommunityTextScreener word boundaries and allow lists (AC 4)', () => {
  it('leaves ordinary words that merely contain a term alone', () => {
    const ordinary = [
      'a cocktail dress for the evening',
      'peacock feathers on the collar',
      'a cockade pinned at the brim',
      'classic analysis of the assassin silhouette',
      'shipped from Scunthorpe on Tuesday',
      'a slit hem over flat boots',
      'the bias cut skims the hip',
    ]
    for (const caption of ordinary) {
      const result = screenCaption(caption)
      expect(result.disposition, caption).toBe('pass')
      expect(result.categories, caption).toEqual([])
    }
  })

  it('does not rejoin ordinary hyphenated and short-word copy into a term', () => {
    const ordinary = [
      'an off-the-shoulder a-line dress with a v-neck',
      'a la mode, de la saison',
      'up to 20 % off on all of it',
    ]
    for (const caption of ordinary) {
      expect(screenCaption(caption).disposition, caption).toBe('pass')
    }
  })

  it('honours every shipped allow-list entry across all seven lists', () => {
    for (const language of SCREENING_LANGUAGES) {
      expect(allowLists[language].entries.length, language).toBeGreaterThan(0)
      for (const entry of allowLists[language].entries) {
        const result = screenCaption(`a garment ${entry} in the collection`)
        expect(result.categories, `${language}: ${entry}`).toEqual([])
      }
    }
  })

  it('runs the bad-words backstop for English the repository lists miss', () => {
    const result = screenCaption('what a load of crap this is')
    expect(result.categories).toEqual(['profanity'])
    expect(result.severity).toBe('low')
    expect(result.disposition).toBe('review')
  })

  it('keeps the backstop off garment names it would otherwise flag', () => {
    for (const caption of [
      'a fanny pack in matte leather',
      'a boob tube under a sheer shirt',
      'brass knob buttons down the front',
      'screw-back pearl earrings with a satin slip',
      'a sexy black slip dress for the evening',
    ]) {
      expect(screenCaption(caption).disposition, caption).toBe('pass')
    }
  })

  /*
   * The backstop's vocabulary was never reviewed against fashion copy, so this
   * pins what it still holds against the words a caption on this product
   * actually uses. Measured on 2026-09-08 against bad-words 4.1.5: of the
   * ordinary fashion vocabulary probed, `sexy` and `screw` were the two the
   * filter flagged that name a register or a fastening rather than an insult,
   * and the image policy already records why Sexy is not unsafe on this
   * product. The intensifiers it also flags (`bloody`, `hell`, `damn`) stay
   * routed to review at low severity, which is a moderator's call and not a
   * defect. A new bad-words release that starts flagging one of these fails
   * here by name instead of as a false-positive rate nobody measures.
   */
  it('lets the fashion register through the English backstop', () => {
    for (const caption of [
      'nude heels with a thong sandal strap',
      'a lingerie-inspired bodysuit and bikini top',
      'the crotch seam on the trousers sits high',
      'sexy is the register, satin is the fabric',
    ]) {
      const result = screenCaption(caption)
      expect(result.disposition, caption).toBe('pass')
      expect(result.categories, caption).toEqual([])
    }
  })

  it('clears an ordinary word a term collapses onto without losing the term', () => {
    // `gook` folds onto `gok`, the umlaut-less spelling Turkish writers use for
    // "sky". The allow list clears the plain word; the slur stays indexed under
    // its own spelling and under every stretched one.
    expect(screenCaption('gok mavisi bir elbise').disposition).toBe('pass')
    expect(screenCaption('you gook').categories).toContain('hate')
    expect(screenCaption('you gooook').categories).toContain('hate')
  })

  it('records which terms are deliberately allow-listed as well', () => {
    const allowedLiterals = new Set(
      Object.values(allowLists).flatMap((list) => list.entries.map(toLiteralForm))
    )
    const alsoAllowed = SCREENING_LANGUAGES.flatMap((language) =>
      termLists[language].entries
        .filter((entry) => allowedLiterals.has(toLiteralForm(entry.term)))
        .map((entry) => `${language}:${entry.term}`)
    )
    // Portuguese `pica` is on both lists on purpose: the plain spelling is
    // ordinary sewing vocabulary and clears, while the term still catches a
    // disguised one. Anything else appearing here nullifies a term by accident.
    expect(alsoAllowed).toEqual(['pt:pica'])
    expect(screenCaption('uma pica de costura fina').disposition).toBe('pass')
  })

  it('rebuilds a spaced-letter form across an allow-listed single character', () => {
    const term = representatives.en.term
    const withShortEntry = structuredClone(allowLists.en)
    withShortEntry.entries.push(term[1] as string)
    const directory = writeListFixture({ 'allow-en-v1.json': withShortEntry })
    const seeded = new CommunityTextScreener({ listsDirectory: directory })

    expect(
      seeded.screen({
        text: withSpacedLetters(term),
        field: 'caption',
        locale: 'en-US',
      }).categories
    ).toContain(representatives.en.category)
  })

  it('allows a literal spelling without allowing its accented vulgar twin', () => {
    expect(screenCaption('a puttee wrapped over the boot').disposition).toBe('pass')
    expect(screenCaption('quelle pute').categories).not.toEqual([])
  })
})

describe('CommunityTextScreener script inspection (AC 4)', () => {
  it('routes mixed Latin and non-Latin script to human review', () => {
    const result = screenCaption('a linen dress притален silhouette')
    expect(result.observedScripts).toEqual(['Common', 'Cyrillic', 'Latin'])
    expect(result.reasons).toContain(SCRIPT_MIXED_REASON)
    expect(result.disposition).toBe('review')
  })

  it('routes a script it holds no list for to human review', () => {
    const result = screenCaption('リネンのワンピース')
    expect(result.reasons).toContain(SCRIPT_UNSUPPORTED_REASON)
    expect(result.disposition).toBe('review')
  })

  it('treats Latin, Common and Inherited as the supported set', () => {
    expect(screenCaption('a linen shirt dress').observedScripts).toEqual([
      'Common',
      'Latin',
    ])
    expect(screenCaption('12 34 56').observedScripts).toEqual(['Common'])
  })

  it('reaches no verdict from language detection, only from the lists', () => {
    const german = screenCaption(CLEAN_CAPTIONS.de, 'tr-TR')
    expect(german.disposition).toBe('pass')
    expect(german.screenedLanguages).toEqual([...SCREENING_LANGUAGES])
  })
})

describe('CommunityTextScreener severity mapping (AC 7)', () => {
  it('blocks a high-severity term and reviews a low one', () => {
    expect(screenCaption('you nigger').disposition).toBe('block')
    expect(screenCaption('that is bullshit').disposition).toBe('review')
  })

  it('reports the highest severity a submission reached', () => {
    expect(screenCaption('that is bullshit').severity).toBe('low')
    expect(screenCaption('bullshit and nigger').severity).toBe('high')
    expect(screenCaption('a linen shirt dress').severity).toBeNull()
  })

  it('takes the harshest grade when two lists grade the same term differently', () => {
    const lenient = structuredClone(termLists.en)
    lenient.entries.push({ term: 'graded', category: 'harassment', severity: 'low' })
    const strict = structuredClone(termLists.tr)
    strict.entries.push({ term: 'graded', category: 'harassment', severity: 'high' })
    const directory = writeListFixture({
      'en-v1.json': lenient,
      'tr-v1.json': strict,
    })
    const split = new CommunityTextScreener({ listsDirectory: directory })

    const result = split.screen({ text: 'graded', field: 'caption', locale: 'en-US' })
    expect(result.severity).toBe('high')
    expect(result.disposition).toBe('block')
  })

  it('follows an injected policy rather than the default map', () => {
    const permissive: CommunityTextPolicy = {
      ...DEFAULT_COMMUNITY_TEXT_POLICY,
      severityDisposition: { low: 'pass', medium: 'pass', high: 'review' },
      unscreenableLocaleDisposition: 'pass',
    }
    const relaxed = new CommunityTextScreener({
      policy: permissive,
      policyVersion: 'test-policy-v9',
    })
    const result = relaxed.screen({
      text: 'you nigger',
      field: 'caption',
      locale: 'en-US',
    })
    expect(result.disposition).toBe('review')
    expect(result.policyVersion).toBe('test-policy-v9')
  })
})

describe('CommunityTextScreener startup validation (AC 3, AC 7)', () => {
  it('gives every shipped list a provenance record with source, version and licence', () => {
    for (const language of SCREENING_LANGUAGES) {
      for (const list of [termLists[language], allowLists[language]]) {
        expect(list.provenance.source?.length, language).toBeGreaterThan(0)
        expect(list.provenance.version?.length, language).toBeGreaterThan(0)
        expect(list.provenance.licence?.length, language).toBeGreaterThan(0)
      }
      expect(termLists[language].entries.length, language).toBeGreaterThan(0)
    }
  })

  it('rejects a missing terms file and a missing allow list', () => {
    for (const name of ['tr-v1.json', 'allow-tr-v1.json']) {
      const directory = writeListFixture({}, [name])
      expect(
        () => new CommunityTextScreener({ listsDirectory: directory }),
        name
      ).toThrow(/missing list file/)
    }
  })

  it('rejects a list that is not valid JSON', () => {
    const directory = writeListFixture({ 'it-v1.json': '{ not json' })
    expect(() => new CommunityTextScreener({ listsDirectory: directory })).toThrow(
      /is not valid JSON/
    )
  })

  it('rejects a list whose provenance omits source, version or licence', () => {
    for (const field of ['source', 'version', 'licence']) {
      const broken = structuredClone(termLists.de)
      delete (broken.provenance as Record<string, unknown>)[field]
      const directory = writeListFixture({ 'de-v1.json': broken })
      expect(
        () => new CommunityTextScreener({ listsDirectory: directory }),
        field
      ).toThrow(new RegExp(`provenance.${field}`))
    }
  })

  it('rejects an allow list with no provenance at all', () => {
    const broken = structuredClone(allowLists.pt) as unknown as Record<string, unknown>
    delete broken.provenance
    const directory = writeListFixture({ 'allow-pt-v1.json': broken })
    expect(() => new CommunityTextScreener({ listsDirectory: directory })).toThrow(
      CommunityTextScreenerConfigError
    )
  })

  it('rejects a terms file that claims to be an allow list', () => {
    const broken = structuredClone(termLists.en) as unknown as Record<string, unknown>
    broken.listType = 'allowList'
    const directory = writeListFixture({ 'en-v1.json': broken })
    expect(() => new CommunityTextScreener({ listsDirectory: directory })).toThrow(
      /listType/
    )
  })

  it('rejects a term category the policy does not define', () => {
    const broken = structuredClone(termLists.en)
    broken.entries.push({
      term: 'unlisted',
      category: 'spam' as TextScreeningCategory,
      severity: 'low',
    })
    const directory = writeListFixture({ 'en-v1.json': broken })
    expect(() => new CommunityTextScreener({ listsDirectory: directory })).toThrow(
      CommunityTextScreenerConfigError
    )
  })

  it('rejects a category the file declares but the injected policy omits', () => {
    expect(
      () =>
        new CommunityTextScreener({
          policy: { ...DEFAULT_COMMUNITY_TEXT_POLICY, categories: ['profanity'] },
        })
    ).toThrow(/the policy does not define/)
  })

  it('rejects a single-word term short enough to collide across languages', () => {
    const broken = structuredClone(termLists.tr)
    broken.entries.push({ term: 'got', category: 'profanity', severity: 'low' })
    const directory = writeListFixture({ 'tr-v1.json': broken })
    expect(() => new CommunityTextScreener({ listsDirectory: directory })).toThrow(
      /reviewed exception/
    )
  })

  it('rejects a term collapsing under the floor with no allow-list guard', () => {
    const unguarded = structuredClone(termLists.en)
    unguarded.entries.push({ term: 'zooo', category: 'hate', severity: 'high' })
    expect(
      () =>
        new CommunityTextScreener({
          listsDirectory: writeListFixture({ 'en-v1.json': unguarded }),
        })
    ).toThrow(/collapses to under/)

    const guarded = structuredClone(allowLists.en)
    guarded.entries.push('zo')
    expect(
      () =>
        new CommunityTextScreener({
          listsDirectory: writeListFixture({
            'en-v1.json': unguarded,
            'allow-en-v1.json': guarded,
          }),
        })
    ).not.toThrow()
  })

  it('rejects a term that normalizes to nothing', () => {
    const broken = structuredClone(termLists.fr)
    broken.entries.push({ term: '!!!', category: 'profanity', severity: 'low' })
    const directory = writeListFixture({ 'fr-v1.json': broken })
    expect(() => new CommunityTextScreener({ listsDirectory: directory })).toThrow(
      /normalizes to nothing/
    )
  })

  it('rejects a file whose declared language is not the one its name claims', () => {
    const directory = writeListFixture({ 'es-v1.json': termLists.it })
    expect(() => new CommunityTextScreener({ listsDirectory: directory })).toThrow(
      /declares language it/
    )
  })

  it('honours a multi-word allow-list entry over a multi-word term', () => {
    const phraseAllowed = structuredClone(allowLists.en)
    phraseAllowed.entries.push('kill yourself')
    const directory = writeListFixture({ 'allow-en-v1.json': phraseAllowed })
    const lenient = new CommunityTextScreener({ listsDirectory: directory })

    expect(screenCaption('kill yourself').categories).toContain('self_harm')
    expect(
      lenient.screen({ text: 'kill yourself', field: 'caption', locale: 'en-US' })
        .categories
    ).toEqual([])
  })

  it('reports a policy directory it cannot find on disk', () => {
    const exists = vi.spyOn(fs, 'existsSync').mockReturnValue(false)
    try {
      expect(() => new CommunityTextScreener()).toThrow(/term lists not found in/)
    } finally {
      exists.mockRestore()
    }
  })

  it('rejects a directory that holds no lists at all', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'community-terms-empty-'))
    expect(() => new CommunityTextScreener({ listsDirectory: empty })).toThrow(
      /missing list file/
    )
  })

  it('keeps the shipped lists loadable from the packaged policy directory', () => {
    expect(() => new CommunityTextScreener()).not.toThrow()
  })
})
