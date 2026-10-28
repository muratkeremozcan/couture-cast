/**
 * Flag emoji corpus (round 7m). Regional indicator letters form flag emoji and, mapped to
 * Latin letters, also spell words, so the clean corpus holds every flag people post: each
 * valid ISO 3166-1 pair alone, every two-flag run, seeded runs of three, four, five and eight
 * flags, flags separated by spaces and commas, and flags beside words in all seven languages.
 * Generated here rather than stored: the list below is the ISO 3166-1 alpha-2 set with the
 * reserved flag codes (AC CP DG EA EU IC TA UN XK).
 */
export const FLAG_CODES: readonly string[] = (
  'AC AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ ' +
  'CA CC CD CF CG CH CI CK CL CM CN CO CP CR CU CV CW CX CY CZ DE DG DJ DK DM DO DZ EA EC EE EG EH ER ES ET EU ' +
  'FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU IC ID IE IL IM IN IO IQ IR IS IT ' +
  'JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ ' +
  'NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW ' +
  'SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TA TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ ' +
  'UA UG UM UN US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW'
).split(' ')

const flag = (code: string): string =>
  [...code]
    .map((letter) => String.fromCodePoint(0x1f1e6 + letter.charCodeAt(0) - 65))
    .join('')

const WORDS: Readonly<Record<string, readonly string[]>> = {
  'en-US': ['Team', 'Made in', 'Shipping to', 'Summer sale', 'Worldwide delivery'],
  'de-DE': ['Versand nach', 'Hergestellt in', 'Sommerkollektion', 'Weltweit'],
  'es-ES': ['Envío a', 'Hecho en', 'Colección de verano', 'Todo el mundo'],
  'fr-FR': ['Livraison en', 'Fabriqué en', 'Collection été', 'Partout'],
  'it-IT': ['Spedizione in', 'Fatto in', 'Collezione estate', 'Ovunque'],
  'pt-BR': ['Envio para', 'Feito em', 'Coleção verão', 'Mundo todo'],
  'tr-TR': ['Teslimat', 'Yapımı', 'Yaz koleksiyonu', 'Dünya geneli'],
}

/** Deterministic pseudo-random sequence so the corpus is the same on every run. */
function sequence(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648
    return state
  }
}

/** England, Scotland and Wales: a black flag, tag characters and the cancel tag. */
const SUBDIVISION_FLAGS = ['gbeng', 'gbsct', 'gbwls'].map(
  (code) =>
    '\u{1F3F4}' +
    [...code]
      .map((letter) => String.fromCodePoint(0xe0000 + letter.charCodeAt(0)))
      .join('') +
    '\u{E007F}'
)

/** Place names a caption pairs with a flag, per language. */
const PLACES: Readonly<Record<string, readonly string[]>> = {
  'en-US': ['Paris', 'London', 'Berlin', 'Tokyo', 'New York', 'Rome', 'Lisbon', 'Vienna'],
  'de-DE': ['Wien', 'Köln', 'Hamburg', 'Zürich', 'München', 'Prag', 'Rom', 'Lissabon'],
  'es-ES': ['Madrid', 'Sevilla', 'México', 'Lima', 'Bogotá', 'Roma', 'Lisboa', 'París'],
  'fr-FR': ['Paris', 'Lyon', 'Bruxelles', 'Genève', 'Québec', 'Rome', 'Lisbonne', 'Nice'],
  'it-IT': ['Roma', 'Milano', 'Napoli', 'Torino', 'Firenze', 'Parigi', 'Vienna', 'Praga'],
  'pt-BR': [
    'Lisboa',
    'Porto',
    'São Paulo',
    'Recife',
    'Brasília',
    'Roma',
    'Paris',
    'Viena',
  ],
  'tr-TR': ['İstanbul', 'Ankara', 'İzmir', 'Bursa', 'Paris', 'Roma', 'Berlin', 'Viyana'],
}

export interface FlagText {
  readonly text: string
  readonly locale: string | null
}

/** City or country lists, each name followed (or preceded) by its flag: 4 to 12 pairs. */
function placeCaptions(pick: () => string, next: () => number): FlagText[] {
  const out: FlagText[] = []
  for (const [locale, places] of Object.entries(PLACES))
    for (let list = 0; list < 60; list += 1) {
      const items = Array.from({ length: 4 + (list % 9) }, () => {
        const place = places[next() % places.length] as string
        return list % 3 === 0 ? `${pick()} ${place}` : `${place} ${pick()}`
      })
      out.push({ text: items.join(list % 2 === 0 ? ' ' : ', '), locale })
      out.push({ text: items.join(' / '), locale })
    }
  return out
}

export function flagCorpus(): FlagText[] {
  const flags = FLAG_CODES.map(flag)
  const out: FlagText[] = []
  for (const subdivision of SUBDIVISION_FLAGS) {
    out.push({ text: subdivision, locale: null })
    out.push({
      text: `${subdivision}${subdivision}${flags[0]}${subdivision}`,
      locale: null,
    })
    for (const [locale, phrases] of Object.entries(WORDS))
      for (const phrase of phrases) {
        out.push({ text: `${phrase} ${subdivision}`, locale })
        out.push({ text: `${subdivision}${phrase}`, locale })
      }
  }
  for (const single of flags) out.push({ text: single, locale: null })
  for (const first of flags)
    for (const second of flags) out.push({ text: first + second, locale: null })
  const next = sequence(12345)
  const pick = (): string => flags[next() % flags.length] as string
  for (const [count, runs] of [
    [3, 20000],
    [4, 3000],
    [5, 3000],
    [8, 3000],
  ] as const)
    for (let run = 0; run < runs; run += 1) {
      const items = Array.from({ length: count }, pick)
      out.push({ text: items.join(''), locale: null })
      if (run % 4 === 0) out.push({ text: items.join(' '), locale: 'en-US' })
      if (run % 4 === 1) out.push({ text: items.join(', '), locale: 'fr-FR' })
    }
  out.push(...placeCaptions(pick, next))
  for (const [locale, phrases] of Object.entries(WORDS))
    for (const phrase of phrases)
      for (const item of flags) {
        out.push({ text: `${phrase} ${item}`, locale })
        out.push({ text: `${item} ${phrase}`, locale })
        out.push({ text: `${phrase}${item}`, locale })
        out.push({ text: `${item}${phrase}`, locale })
      }
  return out
}
