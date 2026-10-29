import fs from 'node:fs'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { FLAG_CODES } from './community-text-acceptance-flags'
import {
  CommunityTextScreener,
  toFoldedForm,
  toLiteralForm,
} from './community-text-screener'

/**
 * FROZEN ACCEPTANCE MATRIX (round 7m). Every high-severity term of the seven lists, and
 * every term of the sexual-violence family, 245 terms in all (single words, multi-word
 * phrases and the three-letter kys), is crossed with every transform class that applies to
 * it. A transformed spelling must be withheld (review or block), never pass. Later screening
 * reviews judge against this matrix and the clean corpus specs: a finding is a merge blocker
 * only if it fails one of them, or is a new transform class that lets a high-severity or
 * sexual-violence term pass outright.
 *
 * Classes (w is the folded word, n its length in letters; a phrase is transformed one word
 * at a time, any one word, and a class marked [whole] is applied to every word at once):
 * - inflection: every generated plural and inflected form, bare.
 * - leet-single / leet-all / leet-all-sym [whole]: one letter, or every letter, replaced by
 *   its digit or symbol (a 4 @, e 3, i 1 ! |, o 0, s 5 $, t 7 +, l 1 |, b 8, g 9 6, z 2).
 * - censor: one letter replaced by one of * _ - # . (a dot or hyphen replaces an inner
 *   letter only: at an edge it is sentence punctuation).
 * - confusable-single, fullwidth-all, math-bold-all, smallcaps-all [whole]: Cyrillic, Greek,
 *   small-capital, fullwidth and mathematical-bold look-alikes, one letter or all.
 * - enclosed-<alphabet>-all [whole] / -single, alphabets circled, negative-circled, squared,
 *   negative-squared, regional (regional indicators), parenthesized and tag (tag characters):
 *   one letter, or every letter, in that alphabet.
 * - latin-extended-all / -single: every letter, or one letter, replaced by a Latin Extended or IPA
 *   look-alike (ɾ ɑ ƥ ɛ ɖ ƒ ɡ ɔ ƫ ...; the whole blocks, see LATIN_EXTENDED below).
 * - flag-splice: a regional-indicator spelling with a valid flag (US, FR, JP) spliced in after
 *   every possible number of letters.
 * - stretch: one letter tripled.
 * - split2: one cut at every position with every separator - . _ / * | , · ~, the US and
 *   French flags, the England flag and a lone regional letter (all four stand between the
 *   letters like a smiley) and, across
 *   plain whitespace, only when both parts have three letters or more (a one- or two-letter
 *   word beside a space is a function word: "put a"). Phrases: words of six letters or more,
 *   symbol separators.
 * - split3: two cuts at every pair of positions, one separator per pair rotated through the
 *   same set (single words only).
 * - typo-transpose / typo-delete: two adjacent inner letters swapped, or one inner letter
 *   removed, for single words of eight letters or more.
 * - edit1: one letter added (appended, prepended, inserted), dropped, changed or two
 *   neighbours swapped, for single words of six letters or more, letters seeded per word.
 *   A variant that is an ordinary word the lists clear is listed in EDIT1_REAL_WORDS.
 * - edit1-affix: every letter a-z appended and prepended to each five-letter sexual-violence
 *   form (EDIT1_REAL_WORDS applies here too).
 * - edit1-inflection: the same edits over every generated inflection of six letters or more
 *   that the edit-distance-one index reads (EDIT1_REAL_WORDS applies here too).
 * - inflection-typo: the same two typos over every generated plural and inflected spelling of
 *   eight letters or more, except the Turkish inflections whose suffix breaks vowel harmony
 *   (PINNED_DISHARMONIC).
 * Exclusions, each stated with its reason:
 * - A term whose regional-indicator spelling (or the spelling of one of its words) is a row of
 *   valid flag pairs cannot be told from the flags (kike is Kiribati and Kenya): the grammar
 *   bound reads such a row as flags, and the term list is pinned in PINNED_FLAG_AMBIGUOUS.
 * - Whole-phrase classes leave words of one or two letters (a, te, um) untouched: a symbol or
 *   flag standing for one of them is any letter or country.
 * - Words of one or two letters inside a phrase ("a" in te voy a matar) take no per-word
 *   class: a wildcard or leet symbol there stands for any letter or function word.
 * - kys (three letters) takes no censor, split or typo class: a three-letter wildcard or cut
 *   collides with ordinary fragments (k*s, ky*, k ys).
 * - Phrases take no split3 or typo class: the re-split pass reads cuts inside phrase words,
 *   which split2 covers.
 * - Ordinary words that cannot be withheld are listed in EXCEPTIONS.
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
const ENCLOSED: Record<string, (index: number) => string> = {
  circled: (index) => String.fromCodePoint(0x24d0 + index),
  'negative-circled': (index) => String.fromCodePoint(0x1f150 + index),
  squared: (index) => String.fromCodePoint(0x1f130 + index),
  'negative-squared': (index) => String.fromCodePoint(0x1f170 + index),
  regional: (index) => String.fromCodePoint(0x1f1e6 + index),
  parenthesized: (index) => String.fromCodePoint(0x249c + index),
  tag: (index) => String.fromCodePoint(0xe0061 + index),
}
/**
 * Letters of Latin Extended-A to D, IPA and phonetic extensions that read as a-z, generated from
 * the Unicode character names (LATIN ... LETTER X WITH ..., TURNED, OPEN, BARRED, SCRIPT ...) and
 * kept here as the frozen oracle, separate from the table the engine uses.
 */
const LATIN_EXTENDED: Readonly<Record<string, string>> = {
  a: 'ȺɐᶏⱥⱯɑɒ',
  b: 'ƀƁƂƃɃɓᵬᶀꞖꞗ',
  c: 'ƇƈȻȼɕꜾꜿꞒꞓꞔꟄ',
  d: 'ƊƋƌȡɖɗᵭᶁᶑꟇꟈ',
  e: 'ƎƐǝɆɇɘɛᶒᶓꬳꬴⱸ',
  f: 'ƑƒʄᵮᶂꞘꞙɸ',
  g: 'ƓǤǥɠɡᵷᶃꞠꞡꞬꬶ',
  h: 'ɥɦʮʯꞍꞕꞪⱧⱨ',
  i: 'ƗɨᴉᶖꞮɩ',
  j: 'ȷɈɉɟʝꞲ',
  k: 'ƘƙʞᶄꝀꝁꝂꝃꝄꝅꞢꞣꞰⱩⱪ',
  l: 'ƚȴȽɫɬɭᶅꝈꝉꞀꞁꞎꞭꬷꬸꬹⱠⱡⱢ',
  m: 'ƜɯɰɱᵯᶆꬺⱮ',
  n: 'ƝƞȠȵɲɳᵰᶇꞐꞑꞤꞥꬻ',
  o: 'ƆƟɔɵᶗꝊꝋꝌꝍꬿⱺ',
  p: 'ƤƥᵱᵽᶈꝐꝑꝒꝓꝔꝕⱣ',
  q: 'ɋʠꝖꝗꝘꝙ',
  r: 'ɌɍɹɺɻɼɽɾɿᵲᵳᶉꞦꞧꭉꭋꭌꭨⱤⱹ',
  s: 'ȿʂᵴᶊꞨꞩꟅꟉꟊⱾ',
  t: 'ŦŧƫƬƭƮȶȾʇʈᵵꞱⱦ',
  u: 'ᶙꞸꞹꭎꭒ',
  v: 'ƲɅʋʌᶌꝞꝟⱱⱴ',
  w: 'ʍⱲⱳ',
  x: 'ᶍꭖꭗꭘꭙ',
  y: 'ƳƴɎɏʎꭚ',
  z: 'ƵƶȤȥɀʐʑᵶᶎꟆⱫⱬⱿ',
}
const SEPARATORS = ['-', '.', '_', '/', '*', '|', ',', '·', '~']
const CENSORS = ['*', '_', '-', '#', '.']

/** Ordinary words the matrix cannot withhold: the accent-free spelling is allow-listed. */
const EXCEPTIONS = new Set([
  'inflection|spices',
  'inflection|negros',
  ...[
    'confusable-single',
    'fullwidth-all',
    'math-bold-all',
    ...Object.keys(ENCLOSED).flatMap((name) => [
      `enclosed-${name}-all`,
      `enclosed-${name}-single`,
    ]),
  ].flatMap((cls) => [`${cls}|mongólico`, `${cls}|négro`]),
])

const failures: Record<string, string[]> = {}
const counts: Record<string, number> = {}
/**
 * Ordinary words that sit one edit from a listed term and that the allow list clears, each
 * with its reason in allow-list-v1.json (or an earlier allow entry: niger). The edit1
 * class cannot withhold them; every other edit of every eligible term is withheld.
 */
const EDIT1_REAL_WORDS: ReadonlySet<string> = new Set([
  'aping',
  'atate',
  'bicos',
  'borra',
  'borre',
  'chines',
  'chins',
  'crapes',
  'drapeable',
  'draped',
  'draper',
  'drapes',
  'drapey',
  'engere',
  'engeren',
  'estupor',
  'grapes',
  'lutes',
  'marca',
  'marcas',
  'marcia',
  'maria',
  'marias',
  'marion',
  'matite',
  'matte',
  'mattes',
  'mongolic',
  'narica',
  'negras',
  'negro',
  'negros',
  'niger',
  'ollera',
  'olleras',
  'paste',
  'pasti',
  'pastie',
  'pastis',
  'pasts',
  'picots',
  'pompion',
  'racing',
  'raines',
  'rains',
  'rapera',
  'rapero',
  'rapina',
  'rapine',
  'rapini',
  'rapino',
  'rayed',
  'rayes',
  'reaping',
  'retardador',
  'retarde',
  'ropings',
  'salpes',
  'sbarre',
  'slope',
  'slopes',
  'slues',
  'spass',
  'spate',
  'spats',
  'spice',
  'spies',
  'stupor',
  'terron',
  'terrosi',
  'trapes',
  'tunen',
  'tunes',
  'tuten',
  'tyranny',
  'unten',
  'vaias',
  'virados',
  'youpi',
])

function check(cls: string, term: string, text: string): void {
  counts[cls] = (counts[cls] ?? 0) + 1
  const { disposition } = screener.screen({ text, field: 'caption', locale: null })
  if (
    disposition === 'pass' &&
    !EXCEPTIONS.has(`${cls}|${term}`) &&
    !(cls.startsWith('edit1') && EDIT1_REAL_WORDS.has(text))
  )
    (failures[cls] ??= []).push(`${term} => ${text}`)
}

type Emit = (cls: string, variant: string) => void

/** Per-word classes: any one letter changed. `all` are the classes that change every letter. */
function perLetter(word: string, emit: Emit): void {
  const n = word.length
  for (let at = 0; at < n; at += 1) {
    const letter = word[at] as string
    const index = letter.charCodeAt(0) - 97
    const swap = (glyph: string): string => word.slice(0, at) + glyph + word.slice(at + 1)
    for (const symbol of LEET[letter] ?? []) emit('leet-single', swap(symbol))
    for (const symbol of CENSORS) {
      if ((at === 0 || at === n - 1) && (symbol === '-' || symbol === '.')) continue
      emit('censor', swap(symbol))
    }
    for (const look of LOOKALIKE[letter] ?? []) emit('confusable-single', swap(look))
    for (const look of LATIN_EXTENDED[letter] ?? [])
      emit('latin-extended-single', swap(look))
    emit('stretch', swap(letter.repeat(3)))
    for (const [name, glyph] of Object.entries(ENCLOSED))
      emit(`enclosed-${name}-single`, swap(glyph(index)))
  }
}

const FLAG_SET = new Set(FLAG_CODES)
/** Terms whose regional-indicator spelling is a row of valid flags (kike is Kiribati + Kenya). */
const flagAmbiguous = new Set<string>()
const isFlagRow = (letters: string): boolean =>
  letters.length % 2 === 0 &&
  [...letters.matchAll(/../g)].every((pair) => FLAG_SET.has(pair[0].toUpperCase()))

/** Whole-word classes: every letter of every word of three letters or more changed at once. */
function wholeWord(words: string[], term: string, emit: Emit): void {
  const phrase = words.length > 1
  const each = (convert: (word: string) => string): string =>
    words.map((word) => (phrase && word.length < 3 ? word : convert(word))).join(' ')
  const letters = (glyph: (index: number) => string) => (word: string) =>
    [...word].map((ch) => glyph(ch.charCodeAt(0) - 97)).join('')
  const leetAll = (pick: (options: string[]) => string) => (word: string) =>
    [...word].map((ch) => (LEET[ch] ? pick(LEET[ch]) : ch)).join('')
  const plain = words.join(' ')
  const first = each(leetAll((options) => options[0] as string))
  const last = each(leetAll((options) => options.at(-1) as string))
  if (first !== plain) emit('leet-all', first)
  if (last !== plain) emit('leet-all-sym', last)
  emit('fullwidth-all', each(letters((index) => String.fromCharCode(0xff41 + index))))
  emit('math-bold-all', each(letters((index) => String.fromCodePoint(0x1d41a + index))))
  const isSmallCapital = (look: string): boolean => {
    const code = look.codePointAt(0) as number
    return code >= 0x1d00 && code <= 0xa7ff
  }
  const small = each((word) =>
    [...word].map((ch) => LOOKALIKE[ch]?.find(isSmallCapital) ?? ch).join('')
  )
  if (small !== plain) emit('smallcaps-all', small)
  const extended = each((word) =>
    [...word].map((ch) => LATIN_EXTENDED[ch]?.[0] ?? ch).join('')
  )
  if (extended !== plain) emit('latin-extended-all', extended)
  for (const [name, glyph] of Object.entries(ENCLOSED)) {
    const converted = each(letters(glyph))
    if (
      name === 'regional' &&
      converted.split(' ').some((run, at) => {
        const word = words[at] as string
        return run !== word && isFlagRow(word)
      })
    ) {
      flagAmbiguous.add(term)
      continue
    }
    emit(`enclosed-${name}-all`, converted)
  }
}

const SPLICE_FLAGS = ['\u{1F1FA}\u{1F1F8}', '\u{1F1EB}\u{1F1F7}', '\u{1F1EF}\u{1F1F5}']
/** A regional-indicator spelling of a single word with a valid flag spliced in at every position. */
function flagSplices(word: string, emit: Emit): void {
  const regional = [...word].map(
    (ch) => ENCLOSED.regional?.(ch.charCodeAt(0) - 97) as string
  )
  for (const flag of SPLICE_FLAGS)
    for (let at = 1; at < regional.length; at += 1) {
      const text = regional.slice(0, at).join('') + flag + regional.slice(at).join('')
      const letters = [...text]
        .map((g) => String.fromCharCode(97 + (g.codePointAt(0) as number) - 0x1f1e6))
        .join('')
      if (isFlagRow(letters)) continue
      emit('flag-splice', text)
    }
}

/** Flags and a lone regional letter standing between letters cut a word like a smiley does. */
const FLAG_CUTS = [
  '\u{1F1FA}\u{1F1F8}',
  '\u{1F1EB}\u{1F1F7}',
  '\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}',
  '\u{1F1FA}',
]

function splits(word: string, emit: Emit, three: boolean, spaces: boolean): void {
  const n = word.length
  const symbols = [...SEPARATORS, ...FLAG_CUTS]
  const all = spaces ? [...symbols, ' '] : symbols
  for (let cut = 1; cut < n; cut += 1)
    for (const separator of all) {
      if (separator === ' ' && (cut < 3 || n - cut < 3)) continue
      emit('split2', word.slice(0, cut) + separator + word.slice(cut))
    }
  if (!three) return
  for (let first = 1; first < n - 1; first += 1)
    for (let second = first + 1; second < n; second += 1) {
      const separator = all[(first * 7 + second * 3 + n) % all.length] as string
      const short = first < 3 || second - first < 3 || n - second < 3
      if (separator === ' ' && short) continue
      emit(
        'split3',
        word.slice(0, first) +
          separator +
          word.slice(first, second) +
          separator +
          word.slice(second)
      )
    }
}

/** Every choice of `count` cut positions among 1..n-1, in order. */
function cutSets(n: number, count: number): number[][] {
  const sets: number[][] = []
  const walk = (from: number, chosen: number[]): void => {
    if (chosen.length === count) {
      sets.push(chosen)
      return
    }
    for (let at = from; at < n; at += 1) walk(at + 1, [...chosen, at])
  }
  walk(1, [])
  return sets
}

function cutWith(word: string, cuts: readonly number[], separators: readonly string[]) {
  let out = word.slice(0, cuts[0])
  cuts.forEach((cut, index) => {
    out += separators[index] + word.slice(cut, cuts[index + 1] ?? word.length)
  })
  return out
}

/**
 * Chains of four to six fragments at every placement (split4 and split5 are three and four
 * symbol cuts, one rotating symbol per cut), and seeded random chains of 2 to 12 fragments with
 * mixed symbols (chain): no cut count is special.
 */
function chains(word: string, emit: Emit): void {
  const n = word.length
  const symbols = [...SEPARATORS, ...FLAG_CUTS]
  for (const [cls, count] of [
    ['split4', 3],
    ['split5', 4],
  ] as const)
    for (const cuts of cutSets(n, count))
      emit(
        cls,
        cutWith(
          word,
          cuts,
          cuts.map(
            (cut, index) => symbols[(cut * 7 + index * 3 + n) % symbols.length] as string
          )
        )
      )
  let state = [...word].reduce(
    (sum, ch) => (sum * 31 + ch.charCodeAt(0)) % 2147483648,
    17
  )
  const next = (): number => {
    state = (state * 1103515245 + 12345) % 2147483648
    return state >>> 8
  }
  for (let round = 0; round < 6; round += 1) {
    const count = 1 + (next() % Math.min(11, n - 1))
    const cuts = [
      ...new Set(Array.from({ length: count }, () => 1 + (next() % (n - 1)))),
    ].toSorted((a, b) => a - b)
    emit(
      'chain',
      cutWith(
        word,
        cuts,
        cuts.map(() => symbols[next() % symbols.length] as string)
      )
    )
  }
}

function typos(word: string, emit: Emit): void {
  const n = word.length
  if (n < 8) return
  for (let at = 1; at < n - 2; at += 1) {
    const swapped = word.slice(0, at) + word[at + 1] + word[at] + word.slice(at + 2)
    if (swapped !== word) emit('typo-transpose', swapped)
  }
  for (let at = 1; at < n - 1; at += 1)
    emit('typo-delete', word.slice(0, at) + word.slice(at + 1))
}

/**
 * A generated inflection with one inner letter removed or two swapped: "gangrapss",
 * "hurensohen" less a letter. The forms are those the screener's typo index reads: high
 * severity, and not a Turkish inflection whose suffix breaks vowel harmony (its one-letter-less
 * spelling is an ordinary word, see the screener; their number is pinned).
 */
/**
 * Every letter a-z appended and prepended to each five-letter sexual-violence form (raped,
 * rapes, raper ...): below the six-letter edit-distance-one floor only these two edits are
 * checked, so only these are crossed.
 */
function affixFive(): void {
  for (const form of screener.affixIndexedForms())
    for (let code = 97; code <= 122; code += 1) {
      const letter = String.fromCharCode(code)
      check('edit1-affix', form, form + letter)
      check('edit1-affix', form, letter + form)
    }
}

/** edit1 over every generated inflection the edit-distance-one index reads. */
function inflectionEdit1(): void {
  const seen = new Set<string>()
  for (const entry of screener.editOneIndexedInflectionForms()) {
    const form = entry.split(':').slice(1).join(':')
    if (seen.has(form) || !/^[a-z]+$/.test(form)) continue
    seen.add(form)
    edit1(form, (_cls, variant) => check('edit1-inflection', form, variant))
  }
}

function inflectionTypos(): void {
  const seen = new Set<string>()
  for (const entry of screener.typoIndexedInflectionForms()) {
    const form = entry.split(':').slice(1).join(':')
    if (seen.has(form) || form.length < 8 || !/^[a-z]+$/.test(form)) continue
    seen.add(form)
    typos(form, (_cls, variant) => check('inflection-typo', form, variant))
  }
}

function runMatrix(): void {
  for (const form of screener.generatedInflectionForms()) {
    const [, ...rest] = form.split(':')
    check('inflection', rest.join(':'), rest.join(':'))
  }
  inflectionTypos()
  inflectionEdit1()
  affixFive()
  const seen = new Set<string>()
  for (const { term } of terms) {
    if (seen.has(term)) continue
    seen.add(term)
    const words = toFoldedForm(toLiteralForm(term))
      .split(/[^a-z]+/)
      .filter(Boolean)
    const phrase = words.length > 1
    const emitTerm: Emit = (cls, variant) => check(cls, term, variant)
    wholeWord(words, term, emitTerm)
    for (const [index, word] of words.entries()) {
      if (phrase && word.length < 3) continue
      const around = (variant: string): string =>
        words.map((other, at) => (at === index ? variant : other)).join(' ')
      wordClasses(word, phrase, (cls, variant) => emitTerm(cls, around(variant)))
    }
  }
}

/** Every per-word class for one word of a term (a whole term when it is a single word). */
/**
 * One letter added (appended, prepended or inserted at every inner position), dropped,
 * changed, or two neighbours swapped, for single words of six letters or more. The added
 * and changed letters are seeded per word, so the class is the same on every run.
 */
function edit1(word: string, emit: Emit): void {
  const n = word.length
  if (n < 6) return
  let state = [...word].reduce(
    (sum, ch) => (sum * 31 + ch.charCodeAt(0)) % 2147483648,
    29
  )
  const letter = (avoid?: string): string => {
    for (;;) {
      state = (state * 1103515245 + 12345) % 2147483648
      const candidate = String.fromCharCode(97 + ((state >>> 8) % 26))
      if (candidate !== avoid) return candidate
    }
  }
  emit('edit1', word + letter())
  emit('edit1', letter() + word)
  for (let at = 1; at < n; at += 1)
    emit('edit1', word.slice(0, at) + letter() + word.slice(at))
  for (let at = 0; at < n; at += 1) {
    emit('edit1', word.slice(0, at) + word.slice(at + 1))
    emit('edit1', word.slice(0, at) + letter(word[at]) + word.slice(at + 1))
    if (at < n - 1 && word[at] !== word[at + 1])
      emit('edit1', word.slice(0, at) + word[at + 1] + word[at] + word.slice(at + 2))
  }
}

/**
 * Several letters censored at once with * _ # (n*gg*r, v**d*, r*p*st): every inner vowel,
 * every other inner letter, and every pair of inner letters, for single words of four letters
 * or more. The first letter always shows, and at least two letters and 40 percent of the
 * word show, which is the floor the screener applies.
 */
function multiCensor(word: string, emit: Emit): void {
  const n = word.length
  const feasible = (hidden: ReadonlySet<number>): boolean =>
    hidden.size >= 2 && n - hidden.size >= Math.max(2, Math.ceil(n * 0.4))
  /** One symbol per hidden letter, taken in turn; a dot or hyphen never ends the word. */
  const render = (hidden: ReadonlySet<number>, symbols: readonly string[]): string => {
    let used = 0
    return [...word]
      .map((letter, at) =>
        hidden.has(at) ? (symbols[used++ % symbols.length] as string) : letter
      )
      .join('')
  }
  const lastHidden = (hidden: ReadonlySet<number>): boolean => hidden.has(n - 1)
  const masks: Set<number>[] = [
    new Set(
      [...word].flatMap((letter, at) => (at > 0 && 'aeiou'.includes(letter) ? [at] : []))
    ),
    new Set([...word].flatMap((_, at) => (at > 0 && at % 2 === 1 ? [at] : []))),
  ]
  for (const mask of masks) {
    if (!feasible(mask)) continue
    for (const symbol of ['*', '_', '#']) emit('multi-censor', render(mask, [symbol]))
    if (!lastHidden(mask)) {
      emit('multi-censor', render(mask, ['*', '.']))
      emit('multi-censor', render(mask, ['#', '-']))
    }
  }
  for (let first = 1; first < n; first += 1)
    for (let second = first + 1; second < n; second += 1) {
      const pair = new Set([first, second])
      if (!feasible(pair)) continue
      emit('multi-censor', render(pair, ['*']))
      if (second < n - 1) {
        emit('multi-censor', render(pair, ['*', '.']))
        emit('multi-censor', render(pair, ['_', '-']))
      }
    }
}

function wordClasses(word: string, phrase: boolean, emitWord: Emit): void {
  const short = !phrase && word.length < 4
  const dropShort: Emit = (cls, variant) => {
    if (short && (cls === 'censor' || cls.startsWith('split') || cls.startsWith('typo')))
      return
    emitWord(cls, variant)
  }
  perLetter(word, dropShort)
  if (!short) multiCensor(word, emitWord)
  if (!short && (!phrase || word.length >= 6)) splits(word, dropShort, !phrase, !phrase)
  if (phrase || short) return
  chains(word, dropShort)
  edit1(word, dropShort)
  typos(word, dropShort)
  flagSplices(word, emitWord)
}

// The matrix screens about 125,000 spellings. Measured locally the run takes 73 s; the 4 vCPU
// runner is about 2.6 times slower (190 s), and the budget keeps 2.4 times that.
const MATRIX_TIMEOUT_MS = 450_000

describe('frozen adversarial matrix', () => {
  beforeAll(runMatrix, MATRIX_TIMEOUT_MS)

  it('covers the pinned number of terms and checks', () => {
    expect(new Set(terms.map((entry) => entry.term)).size).toBe(PINNED_TERMS)
    expect(counts).toEqual(PINNED_COUNTS)
  })

  it('skips only the pinned number of harmony-breaking Turkish inflections', () => {
    expect(screener.disharmonicInflectionForms().length).toBe(PINNED_DISHARMONIC)
  })

  it('lists the terms whose regional spelling is a row of valid flags', () => {
    expect([...flagAmbiguous].toSorted()).toEqual(PINNED_FLAG_AMBIGUOUS)
  })

  for (const cls of Object.keys(PINNED_COUNTS))
    it(`withholds every ${cls} spelling`, () => {
      expect(failures[cls] ?? []).toEqual([])
    })
})

const PINNED_FLAG_AMBIGUOUS: string[] = [
  'boiola',
  'canına kıy',
  'deep throat',
  'figlio di puttana',
  'fils de pute',
  'gang bang',
  'gangbang',
  'hure',
  'ich bringe dich um',
  'je vais te tuer',
  'je vais te violer',
  'kike',
  'macaco de merda',
  'mata te',
  'morte agli ebrei',
  'nigger',
  'nique ta mère',
  'ojalá te mueras',
  'orospu çocuğu',
  'pédé',
  'seni öldüreceğim',
  'sieg heil',
  'töte dich selbst',
]
const PINNED_TERMS = 298
const PINNED_DISHARMONIC = 350

const PINNED_COUNTS: Record<string, number> = {
  censor: 11262,
  'confusable-single': 8493,
  'enclosed-circled-all': 298,
  'enclosed-circled-single': 2553,
  'enclosed-negative-circled-all': 298,
  'enclosed-negative-circled-single': 2553,
  'enclosed-negative-squared-all': 298,
  'enclosed-negative-squared-single': 2553,
  'enclosed-parenthesized-all': 298,
  'enclosed-parenthesized-single': 2553,
  'enclosed-regional-all': 275,
  'enclosed-regional-single': 2553,
  'enclosed-squared-all': 298,
  'enclosed-squared-single': 2553,
  'enclosed-tag-all': 298,
  'enclosed-tag-single': 2553,
  'fullwidth-all': 298,
  inflection: 1065,
  'flag-splice': 4731,
  'latin-extended-all': 298,
  'latin-extended-single': 28437,
  'leet-all': 298,
  'leet-all-sym': 298,
  'leet-single': 2626,
  'math-bold-all': 298,
  'smallcaps-all': 298,
  split2: 24923,
  split3: 5150,
  split4: 12481,
  split5: 20235,
  chain: 1344,
  stretch: 2553,
  'inflection-typo': 9438,
  edit1: 6583,
  'edit1-affix': 468,
  'edit1-inflection': 12923,
  'typo-delete': 1040,
  'typo-transpose': 892,
  'multi-censor': 18643,
}
