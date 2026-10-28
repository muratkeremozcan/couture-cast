import fs from 'node:fs'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  CommunityTextScreener,
  toFoldedForm,
  toLiteralForm,
} from './community-text-screener'

/**
 * FROZEN ACCEPTANCE MATRIX (round 7l). Every high-severity term of the seven lists, and
 * every term of the sexual-violence family, is crossed with every transform class below. A
 * transformed spelling must be withheld (review or block), never pass. Later screening
 * reviews judge against this matrix and the clean corpus spec: a finding is a merge blocker
 * only if it fails one of them, or is a new transform class that lets a high-severity or
 * sexual-violence term pass outright.
 *
 * Classes and their exact definition (w is the folded term, n its length in letters):
 * - inflection: every generated plural and inflected form, bare.
 * - leet-single / leet-all / leet-all-sym: one letter, or every letter, replaced by its
 *   digit or symbol (a 4 @, e 3, i 1 ! |, o 0, s 5 $, t 7 +, l 1 |, b 8, g 9 6, z 2).
 * - censor: one letter replaced by one of * _ - # . (a dot or hyphen replaces an inner
 *   letter only: at an edge it is sentence punctuation).
 * - confusable-single, fullwidth-all, math-bold-all, smallcaps-all: Cyrillic, Greek,
 *   small-capital, fullwidth and mathematical-bold look-alikes, one letter or all.
 * - stretch: one letter tripled.
 * - split2: one cut at every position with every separator - . _ / * | , · ~ and, across
 *   plain whitespace, only when both parts have three letters or more (a one- or two-letter
 *   word beside a space is a function word: "put a").
 * - split3: two cuts at every pair of positions, one separator per pair rotated through the
 *   same set.
 * - typo-transpose / typo-delete: two adjacent inner letters swapped, or one inner letter
 *   removed, for terms of eight letters or more.
 * Accepted exceptions are listed in EXCEPTIONS and each is an ordinary word.
 */
const screener = new CommunityTextScreener()
const LANGS = ['de', 'en', 'es', 'fr', 'it', 'pt', 'tr'] as const
const policyDir = path.resolve(__dirname, '../../../policies/community-screening')

const allow = JSON.parse(
  fs.readFileSync(path.join(policyDir, 'allow-list-v1.json'), 'utf8')
) as { cutFamilies?: { terms: string[] }[] }
const family = new Set<string>((allow.cutFamilies ?? []).flatMap((entry) => entry.terms))

const terms: { lang: string; term: string }[] = []
for (const lang of LANGS) {
  const list = JSON.parse(
    fs.readFileSync(path.join(policyDir, 'terms-v1', `${lang}-v1.json`), 'utf8')
  ) as { entries: { term: string; severity: string }[] }
  for (const entry of list.entries)
    if (entry.severity === 'high' || (lang === 'en' && family.has(entry.term)))
      terms.push({ lang, term: entry.term })
}

const LEET: Record<string, string[]> = {
  a: ['4', '@'],
  b: ['8'],
  e: ['3'],
  g: ['9', '6'],
  i: ['1', '!', '|'],
  l: ['1', '|'],
  o: ['0'],
  s: ['5', '$'],
  t: ['7', '+'],
  z: ['2'],
}
const LOOKALIKE: Record<string, string[]> = {
  a: ['а', 'α', 'ᴀ', 'ａ'],
  b: ['ʙ', 'ｂ'],
  c: ['с', 'ᴄ', 'ｃ'],
  d: ['ԁ', 'ᴅ', 'ｄ'],
  e: ['е', 'ε', 'ᴇ', 'ｅ'],
  f: ['ғ', 'ꜰ', 'ｆ'],
  g: ['ɢ', 'ｇ'],
  h: ['һ', 'ʜ', 'ｈ'],
  i: ['і', 'ι', 'ɪ', 'ｉ'],
  j: ['ј', 'ᴊ', 'ｊ'],
  k: ['к', 'κ', 'ᴋ', 'ｋ'],
  l: ['ӏ', 'ʟ', 'ｌ'],
  m: ['м', 'μ', 'ᴍ', 'ｍ'],
  n: ['ɴ', 'ｎ'],
  o: ['о', 'ο', 'ᴏ', 'ｏ'],
  p: ['р', 'ρ', 'ᴘ', 'ｐ'],
  q: ['ԛ', 'ｑ'],
  r: ['ʀ', 'ｒ'],
  s: ['ѕ', 'ꜱ', 'ｓ'],
  t: ['т', 'τ', 'ᴛ', 'ｔ'],
  u: ['υ', 'ᴜ', 'ｕ'],
  v: ['ν', 'ᴠ', 'ｖ'],
  w: ['ԝ', 'ᴡ', 'ｗ'],
  x: ['х', 'χ', 'ｘ'],
  y: ['у', 'ʏ', 'ｙ'],
  z: ['ᴢ', 'ｚ'],
}
const SEPARATORS = ['-', '.', '_', '/', '*', '|', ',', '·', '~']
const CENSORS = ['*', '_', '-', '#', '.']

/** Ordinary words the matrix cannot withhold: the accent-free spelling is allow-listed. */
const EXCEPTIONS = new Set([
  'inflection|spices',
  'inflection|negros',
  ...['confusable-single', 'fullwidth-all', 'math-bold-all'].flatMap((cls) => [
    `${cls}|mongólico`,
    `${cls}|négro`,
  ]),
])

const failures: Record<string, string[]> = {}
const counts: Record<string, number> = {}
function check(cls: string, term: string, text: string): void {
  counts[cls] = (counts[cls] ?? 0) + 1
  const { disposition } = screener.screen({ text, field: 'caption', locale: null })
  if (disposition === 'pass' && !EXCEPTIONS.has(`${cls}|${term}`))
    (failures[cls] ??= []).push(`${term} => ${text}`)
}

function checkPerLetter(term: string, word: string): void {
  const n = word.length
  for (let at = 0; at < n; at += 1) {
    const letter = word[at] as string
    for (const symbol of LEET[letter] ?? [])
      check('leet-single', term, word.slice(0, at) + symbol + word.slice(at + 1))
    for (const symbol of CENSORS) {
      if ((at === 0 || at === n - 1) && (symbol === '-' || symbol === '.')) continue
      check('censor', term, word.slice(0, at) + symbol + word.slice(at + 1))
    }
    for (const look of LOOKALIKE[letter] ?? [])
      check('confusable-single', term, word.slice(0, at) + look + word.slice(at + 1))
    check('stretch', term, word.slice(0, at) + letter.repeat(3) + word.slice(at + 1))
  }
}

function checkWholeWord(term: string, word: string): void {
  const leetAll = (pick: (options: string[]) => string): string =>
    [...word].map((ch) => (LEET[ch] ? pick(LEET[ch]) : ch)).join('')
  const first = leetAll((options) => options[0] as string)
  const last = leetAll((options) => options.at(-1) as string)
  if (first !== word) check('leet-all', term, first)
  if (last !== word) check('leet-all-sym', term, last)
  check(
    'fullwidth-all',
    term,
    [...word].map((ch) => String.fromCharCode(ch.charCodeAt(0) + 0xfee0)).join('')
  )
  check(
    'math-bold-all',
    term,
    [...word].map((ch) => String.fromCodePoint(0x1d41a + ch.charCodeAt(0) - 97)).join('')
  )
  const isSmallCapital = (look: string): boolean => {
    const code = look.codePointAt(0) as number
    return code >= 0x1d00 && code <= 0xa7ff
  }
  const small = [...word].map((ch) => LOOKALIKE[ch]?.find(isSmallCapital) ?? ch).join('')
  if (small !== word) check('smallcaps-all', term, small)
}

function checkSplits(term: string, word: string): void {
  const n = word.length
  const all = [...SEPARATORS, ' ']
  for (let cut = 1; cut < n; cut += 1)
    for (const separator of all) {
      if (separator === ' ' && (cut < 3 || n - cut < 3)) continue
      check('split2', term, word.slice(0, cut) + separator + word.slice(cut))
    }
  for (let first = 1; first < n - 1; first += 1)
    for (let second = first + 1; second < n; second += 1) {
      const separator = all[(first * 7 + second * 3 + n) % all.length] as string
      const short = first < 3 || second - first < 3 || n - second < 3
      if (separator === ' ' && short) continue
      check(
        'split3',
        term,
        word.slice(0, first) +
          separator +
          word.slice(first, second) +
          separator +
          word.slice(second)
      )
    }
}

function checkTypos(term: string, word: string): void {
  const n = word.length
  if (n < 8) return
  for (let at = 1; at < n - 2; at += 1) {
    const swapped = word.slice(0, at) + word[at + 1] + word[at] + word.slice(at + 2)
    if (swapped !== word) check('typo-transpose', term, swapped)
  }
  for (let at = 1; at < n - 1; at += 1)
    check('typo-delete', term, word.slice(0, at) + word.slice(at + 1))
}

function runMatrix(): void {
  for (const form of screener.generatedInflectionForms()) {
    const [, ...rest] = form.split(':')
    check('inflection', rest.join(':'), rest.join(':'))
  }
  const seen = new Set<string>()
  for (const { term } of terms) {
    if (seen.has(term)) continue
    seen.add(term)
    const word = toFoldedForm(toLiteralForm(term))
    if (!/^[a-z]{4,}$/.test(word)) continue
    checkPerLetter(term, word)
    checkWholeWord(term, word)
    checkSplits(term, word)
    checkTypos(term, word)
  }
}

// The matrix screens about 26,000 spellings. Measured with coverage instrumentation the
// run takes 7 s (CI about 2.6 times slower); the budget keeps a wide margin for the 4 vCPU runner.
const MATRIX_TIMEOUT_MS = 120_000

describe('frozen adversarial matrix', () => {
  beforeAll(runMatrix, MATRIX_TIMEOUT_MS)

  it('covers the pinned number of terms and checks', () => {
    expect(seenTerms()).toBe(PINNED_TERMS)
    expect(counts).toEqual(PINNED_COUNTS)
  })

  for (const cls of Object.keys(PINNED_COUNTS))
    it(`withholds every ${cls} spelling`, () => {
      expect(failures[cls] ?? []).toEqual([])
    })
})

function seenTerms(): number {
  return new Set(terms.map((entry) => entry.term)).size
}
const PINNED_TERMS = 245
const PINNED_COUNTS: Record<string, number> = {
  censor: 6036,
  'confusable-single': 4438,
  'fullwidth-all': 176,
  inflection: 964,
  'leet-all': 176,
  'leet-all-sym': 176,
  'leet-single': 1374,
  'math-bold-all': 176,
  'smallcaps-all': 176,
  split2: 11029,
  split3: 3493,
  stretch: 1348,
  'typo-delete': 670,
  'typo-transpose': 571,
}
