/*
 * Builds the committed text corpus for the screening false-positive and
 * obfuscation measurement.
 *
 * Story 6.2b, AC 5. One file per enabled language under
 * apps/api/test/fixtures/community-text-corpus/<lang>.json, each with two halves:
 *
 *   - clean: ordinary fashion captions and alt text, written natively in the
 *     language without reference to the term lists. Imported once from
 *     `--import-clean <dir>` (files named captions-<lang>.json) and kept as
 *     committed data thereafter; a re-run without the flag keeps the committed
 *     clean half untouched.
 *   - disallowed: ten cases per original obfuscation family, plus exhaustive
 *     doubled-letter deletion variants and reviewed context-boundary adversaries
 *     generated from the runtime lists and explicit development regressions.
 *
 * A third file per language, holdout-v1/<lang>.json, is the frozen clean
 * holdout the release gate runs on (Story 6.2b review, BH10). Its captions were
 * written after the allow list froze, independently of the clean half (other
 * authors' prompts, other subjects), and nothing in the screener, the lists or
 * the allow list was tuned against them. `--import-holdout <dir>` (files named
 * holdout-<lang>.json) writes it once and records the list hashes it froze
 * against; a holdout that already exists is never rewritten, so the only way
 * to change one is a reviewed new version.
 *
 * Usage:
 *   node scripts/build-community-text-corpus.mjs [--import-clean <dir>]
 *   node scripts/build-community-text-corpus.mjs --import-holdout <dir>
 *   node scripts/build-community-text-corpus.mjs --import-holdout <dir> --holdout-version holdout-v2
 *   node scripts/build-community-text-corpus.mjs --import-holdout <dir> --holdout-version holdout-v8 --locales pt[,xx]
 *
 * `--locales` writes only the named languages and never creates a file for another
 * one, so a version directory holds just the locales authored for it. Without it all
 * seven are written, as before.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')
const corpusDir = path.join(projectRoot, 'apps/api/test/fixtures/community-text-corpus')
const termsDir = path.join(projectRoot, 'apps/api/policies/community-screening/terms-v1')
const allowListPath = path.join(
  projectRoot,
  'apps/api/policies/community-screening/allow-list-v1.json'
)

const LANGUAGES = ['de', 'en', 'es', 'fr', 'it', 'pt', 'tr']
const CASES_PER_FAMILY = 10
const MAX_CAPTION = 280
const MAX_ALT_TEXT = 200

/**
 * The obfuscation families of Story 6.2 AC 4, each as a transform of one term.
 * A transform returns null when it cannot apply to that term (a leet transform
 * on a word with no mappable letter), and the generator moves to the next term.
 */
const FULLWIDTH_OFFSET = 0xff21 - 0x41
const ACCENTED = { a: 'á', e: 'é', i: 'í', o: 'ö', u: 'ü' }
const CYRILLIC = { a: 'а', e: 'е', o: 'о', c: 'с', p: 'р', x: 'х', y: 'у' }
const LEET = { a: '4', e: '3', i: '1', o: '0', s: '5', t: '7' }

function mapLetters(term, table, limit = Infinity) {
  let applied = 0
  let out = ''
  for (const character of term) {
    if (applied < limit && table[character]) {
      out += table[character]
      applied += 1
    } else {
      out += character
    }
  }
  return applied > 0 ? out : null
}

export const FAMILIES = {
  'nfkc-fullwidth': (term) =>
    [...term]
      .map((character) =>
        /[a-z]/.test(character)
          ? String.fromCodePoint(
              character.toUpperCase().codePointAt(0) + FULLWIDTH_OFFSET
            )
          : character
      )
      .join(''),
  'case-mixing': (term) =>
    [...term]
      .map((character, index) => (index % 2 === 0 ? character.toUpperCase() : character))
      .join(''),
  'diacritics-added': (term) => mapLetters(term, ACCENTED, 2),
  'zero-width': (term) => [...term].join('​'),
  'cyrillic-confusable': (term) => mapLetters(term, CYRILLIC, 2),
  leetspeak: (term) => mapLetters(term, LEET),
  'repeated-characters': (term) =>
    [...term]
      .map((character, index) => (index === 1 ? character.repeat(4) : character))
      .join(''),
  'internal-punctuation': (term) => [...term].join('.'),
  'spaced-letters': (term) => [...term].join(' '),
  'leet-and-spaced': (term) => {
    const leet = mapLetters(term, LEET, 2)
    return leet ? [...leet].join(' ') : null
  },
}

/** Clean wrappers per language, so a case reads like a caption around the term. */
const WRAPPERS = {
  de: ['Heute im Park: {x}', '{x} und eine Jeansjacke'],
  en: ['Sunday market look: {x}', '{x} with a denim jacket'],
  es: ['Mi look de hoy: {x}', '{x} con chaqueta vaquera'],
  fr: ['Ma tenue du jour : {x}', '{x} avec une veste en jean'],
  it: ['Il look di oggi: {x}', '{x} con giacca di jeans'],
  pt: ['Meu look de hoje: {x}', '{x} com jaqueta jeans'],
  tr: ['Bugünkü kombinim: {x}', '{x} ve kot ceket'],
}

/**
 * The policy's deliberate review terms (text.deliberateReviewTerms): ordinary
 * copy withheld on purpose. A clean entry carrying one is labelled
 * `expected: "review"` with the policy's reason, and the clean-copy gate is
 * computed on every other entry. The labels are derived from the policy, so
 * the corpus cannot disagree with it.
 */
function deliberateReviewRules() {
  const policy = readJson(
    path.join(projectRoot, 'apps/api/policies/community-screening/policy-v2.json')
  )
  return (policy.text.deliberateReviewTerms ?? []).map((entry) => ({
    pattern: new RegExp(`(^|[^\\p{L}\\p{N}])${entry.term}($|[^\\p{L}\\p{N}])`, 'iu'),
    term: entry.term,
    reason: entry.reason,
  }))
}

function labelExpectedReview(entries) {
  const rules = deliberateReviewRules()
  return entries.map((entry) => {
    const rest = { id: entry.id, field: entry.field, text: entry.text }
    const rule = rules.find((candidate) => candidate.pattern.test(entry.text))
    return rule
      ? {
          ...rest,
          expected: 'review',
          deliberateReviewTerm: rule.term,
          reason: rule.reason,
        }
      : rest
  })
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function candidateTerms(language, allowed) {
  const list = readJson(path.join(termsDir, `${language}-v1.json`))
  // Single words of letters only, at least five long, so every transform has room
  // to work and the case cannot fall under the screener's four-character floor.
  return list.entries
    .map((entry) => entry.term)
    .filter(
      (term) => /^\p{L}{5,}$/u.test(term) && /^[a-z]+$/.test(term) && !allowed.has(term)
    )
    .toSorted()
}

function buildDisallowed(language, allowed) {
  const terms = candidateTerms(language, allowed)
  if (terms.length < CASES_PER_FAMILY) {
    throw new Error(
      `${language} has only ${terms.length} terms usable for obfuscation cases`
    )
  }
  const cases = []
  const familyNames = Object.keys(FAMILIES)
  for (const [familyIndex, family] of familyNames.entries()) {
    const transform = FAMILIES[family]
    let produced = 0
    // Start each family at a different offset so the families do not all reuse
    // the same handful of terms, and stride through the sorted list.
    const stride = Math.max(1, Math.floor(terms.length / CASES_PER_FAMILY))
    for (
      let step = 0;
      produced < CASES_PER_FAMILY && step < terms.length * 2;
      step += 1
    ) {
      const term = terms[(familyIndex + step * stride) % terms.length]
      const disguised = transform(term)
      if (!disguised) continue
      const wrapper = WRAPPERS[language][produced % 2]
      cases.push({
        id: `${language}-${family}-${String(produced + 1).padStart(2, '0')}`,
        family,
        field: produced % 3 === 2 ? 'altText' : 'caption',
        text: wrapper.replace('{x}', disguised),
      })
      produced += 1
    }
    if (produced < CASES_PER_FAMILY) {
      throw new Error(`${language} produced only ${produced} ${family} cases`)
    }
  }
  return [
    ...cases,
    ...buildDeletionRegressionCases(language, allowed),
    ...buildInsultFrameRegressionCases(language),
  ]
}

/** Round6 reported single-occurrence attacks and every reviewed frame run in all locales. */
function buildInsultFrameRegressionCases(language) {
  const development = readJson(path.join(corpusDir, 'development-round6.json'))
  const bank = readJson(
    path.join(
      projectRoot,
      'apps/api/policies/community-screening/reviewed-occurrence-constructions-v1.json'
    )
  ).constructions
  const rows = [
    ...development.reported.map((row) => row.text),
    ...development.removedConstructions,
    ...development.frameAdversarial,
  ]
  for (const rule of bank)
    for (const phrase of rule.phrases)
      for (const frame of rule.rejectedPrefixFrames ?? [])
        for (const separator of [' ', ', ', ' - ', '\n', ' 😃 '])
          rows.push(frame + separator + phrase)
  return [...new Set(rows)].map((text, index) => ({
    id: `${language}-round6-insult-frame-${String(index + 1).padStart(3, '0')}`,
    family: 'round6-insult-frame',
    field: index % 2 ? 'altText' : 'caption',
    text,
  }))
}

/** Reviewed reports plus the full multi-dictionary deletion class run in every locale. */
function buildDeletionRegressionCases(language, allowed) {
  const regression = readJson(path.join(corpusDir, 'development-round4.json'))
  const cases = []
  const seen = new Set()
  const append = (text, family) => {
    const key = `${family}:${text}`
    if (seen.has(key) || allowed.has(text)) return
    if (text.length > MAX_ALT_TEXT)
      throw new Error('deletion regression exceeds contract')
    seen.add(key)
    cases.push({
      id: `${language}-${family}-${String(cases.length + 1).padStart(4, '0')}`,
      family,
      field: 'caption',
      text,
    })
  }
  for (const row of regression.reported) append(row.text, 'doubled-letter-deletion')
  const terms = new Set(
    LANGUAGES.flatMap((locale) =>
      readJson(path.join(termsDir, `${locale}-v1.json`)).entries.map(
        (entry) => entry.term
      )
    )
  )
  for (const term of [...terms].toSorted()) {
    if (!/^[\p{L} ]+$/u.test(term) || !/(.)\1/u.test(term)) continue
    const deleted = term.replace(/(.)\1+/gu, '$1')
    if (allowed.has(deleted)) continue
    const leet = mapLetters(deleted, LEET)
    for (const text of [
      deleted,
      leet,
      [...deleted.replaceAll(' ', '')].join(' '),
      [...deleted.replaceAll(' ', '')].join('.'),
      leet && [...leet.replaceAll(' ', '')].join(' '),
    ])
      if (text) append(text, 'doubled-letter-deletion')
  }
  for (const row of regression.contextAdversarial)
    append(row.text, 'context-separator-adversarial')
  return cases
}

function importClean(
  language,
  importDir,
  { file = `captions-${language}.json`, kind = 'clean' } = {}
) {
  const raw = readJson(path.join(importDir, file))
  const seen = new Set()
  const entries = []
  for (const item of raw) {
    const text = String(item.text ?? '').trim()
    const field = item.field === 'altText' ? 'altText' : 'caption'
    if (!text || seen.has(text)) continue
    const limit = field === 'altText' ? MAX_ALT_TEXT : MAX_CAPTION
    if ([...text].length > limit) {
      throw new Error(
        `${language} clean ${field} is over ${limit} characters: ${text.slice(0, 40)}`
      )
    }
    seen.add(text)
    entries.push({
      id: `${language}-${kind}-${String(entries.length + 1).padStart(3, '0')}`,
      field,
      text,
    })
  }
  return entries
}

async function writeCorpus(
  language,
  corpus,
  filePath = path.join(corpusDir, `${language}.json`)
) {
  const prettier = await import('prettier')
  const options = (await prettier.resolveConfig(filePath)) ?? {}
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(
    filePath,
    await prettier.format(`${JSON.stringify(corpus, null, 2)}\n`, {
      ...options,
      parser: 'json',
    })
  )
}

const sha256File = (filePath) =>
  crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')

/** Writes each language's frozen holdout once; an existing one is left alone. */
export async function importHoldout(
  importDir,
  version = 'holdout-v1',
  { outputDir = corpusDir, locales = LANGUAGES } = {}
) {
  if (!/^holdout-v[1-9]\d*$/.test(version)) {
    throw new Error('holdout version must be holdout-v followed by a positive integer')
  }
  if (
    locales.length === 0 ||
    new Set(locales).size !== locales.length ||
    !locales.every((locale) => LANGUAGES.includes(locale))
  ) {
    throw new Error(
      `locales must be a non-empty list of distinct ${LANGUAGES.join(', ')}`
    )
  }
  // Every named locale needs its input before any file is written.
  for (const language of locales) {
    const target = path.join(outputDir, version, `${language}.json`)
    if (
      !fs.existsSync(target) &&
      !fs.existsSync(path.join(importDir, `holdout-${language}.json`))
    ) {
      throw new Error(
        `${language}: no input file holdout-${language}.json in ${importDir}`
      )
    }
  }
  const policy = readJson(
    path.join(projectRoot, 'apps/api/policies/community-screening/policy-v2.json')
  )
  for (const language of locales) {
    const filePath = path.join(outputDir, version, `${language}.json`)
    if (fs.existsSync(filePath)) {
      console.log(`${language}: holdout already frozen, left unchanged`)
      continue
    }
    const pins = policy.text.lists.find((list) => list.language === language)
    const entries = labelExpectedReview(
      importClean(language, importDir, {
        file: `holdout-${language}.json`,
        kind: version === 'holdout-v1' ? 'holdout' : version,
      })
    )
    await writeCorpus(
      language,
      {
        language,
        corpusVersion: version,
        description:
          "Frozen clean holdout: ordinary fashion captions and alt text written natively in the language after the allow list froze, independently of the clean half, and never used to tune the screener, the lists or the allow list. The release gate's clean-copy figure is computed here. Entries labelled expected review carry one of the policy's deliberate review terms.",
        expected: 'pass',
        frozenAgainst: {
          allowListSha256: sha256File(allowListPath),
          termsSha256: pins?.termsSha256 ?? null,
          languageAllowListSha256: pins?.allowListSha256 ?? null,
        },
        entries,
      },
      filePath
    )
    console.log(`${language}: ${entries.length} holdout entries frozen`)
  }
}

/** The `--locales a,b` list, or undefined when the flag is absent. */
export function parseLocales(args) {
  const index = args.indexOf('--locales')
  if (index < 0) return undefined
  const value = args[index + 1]
  if (!value || value.startsWith('--'))
    throw new Error('--locales needs a comma list of locales')
  return value.split(',')
}

async function main() {
  const args = process.argv.slice(2)
  const holdoutIndex = args.indexOf('--import-holdout')
  if (holdoutIndex >= 0) {
    const versionIndex = args.indexOf('--holdout-version')
    await importHoldout(
      path.resolve(args[holdoutIndex + 1]),
      versionIndex >= 0 ? args[versionIndex + 1] : 'holdout-v1',
      { locales: parseLocales(args) }
    )
    return
  }
  const importIndex = args.indexOf('--import-clean')
  const importDir = importIndex >= 0 ? path.resolve(args[importIndex + 1]) : null
  const allowed = new Set(readJson(allowListPath).entries.map((entry) => entry.entry))

  for (const language of LANGUAGES) {
    const existingPath = path.join(corpusDir, `${language}.json`)
    const existing = fs.existsSync(existingPath) ? readJson(existingPath) : null
    const clean = importDir ? importClean(language, importDir) : existing?.clean.entries
    if (!clean)
      throw new Error(`${language} has no clean half; run with --import-clean <dir>`)

    const corpus = {
      language,
      corpusVersion: 'v1',
      clean: {
        description:
          "Ordinary fashion captions and alt text, written natively in the language as community members would write them, without reference to the term lists. Every entry is expected to pass text screening, except entries labelled expected review, which carry one of the policy's deliberate review terms and the reason it is kept.",
        expected: 'pass',
        entries: labelExpectedReview(clean),
      },
      disallowed: {
        description:
          'Disguised forms of terms from this language’s runtime list, ten per obfuscation family named in Story 6.2 AC 4, each inside an otherwise clean caption. Every entry is expected to be withheld (review or block). Generated by scripts/build-community-text-corpus.mjs.',
        expected: 'withheld',
        families: [
          ...Object.keys(FAMILIES),
          'doubled-letter-deletion',
          'context-separator-adversarial',
          'round6-insult-frame',
        ],
        entries: buildDisallowed(language, allowed),
      },
    }
    await writeCorpus(language, corpus)
    console.log(
      `${language}: ${corpus.clean.entries.length} clean, ${corpus.disallowed.entries.length} disallowed`
    )
  }
}

// Only a direct run builds; importing the module (the importer's tests) must not.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(
      `[text-corpus] ${error instanceof Error ? error.message : String(error)}`
    )
    process.exit(1)
  })
}
