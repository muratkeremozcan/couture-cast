/*
 * Verifies, and with --write regenerates, the community text screening lists.
 *
 * Story 6.2b, AC 5. Three sources feed the runtime lists the screener loads from
 * `apps/api/policies/community-screening/terms-v1/`:
 *
 *   - vendor/ldnoobw/<lang>: the LDNOOBW lists, vendored byte for byte at one
 *     pinned commit under CC-BY-4.0, with their hashes in vendor/ldnoobw/source.json;
 *   - graded-overlay-v1/<lang>.json: the repository's own graded entries, which
 *     carry a deliberate category and severity and win over the generic grade an
 *     upstream-only term receives;
 *   - allow-list-v1.json: ordinary words the lists would otherwise flag, every
 *     entry with the reason it exists.
 *
 * The runtime files are generated from those three and nothing else, and the
 * policy file records the pinned commit plus the SHA-256 of every generated file,
 * so the policy hash, and with it the persisted engine identity, moves whenever
 * a list does.
 *
 * Default mode is verification and exits nonzero on any of:
 *   - a vendored file whose SHA-256 or git blob hash differs from source.json;
 *   - a generated list that differs from what the three sources produce now;
 *   - a policy list record whose hashes or upstream commit disagree;
 *   - an allow-list entry without a reason, or listed twice.
 *
 * Flags:
 *   --write   regenerate terms-v1/ and the policy's list records, then verify
 *   --remote  also re-fetch every vendored file from the pinned upstream commit
 *             and compare the bytes (needs network; not part of ordinary CI)
 *   --json    machine-readable report on stdout
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')
const policyRoot = path.join(projectRoot, 'apps/api/policies/community-screening')
const vendorDir = path.join(policyRoot, 'vendor/ldnoobw')
const overlayDir = path.join(policyRoot, 'graded-overlay-v1')
const termsDir = path.join(policyRoot, 'terms-v1')
const allowListPath = path.join(policyRoot, 'allow-list-v1.json')
const policyPath = path.join(policyRoot, 'policy-v2.json')

export const LANGUAGES = ['de', 'en', 'es', 'fr', 'it', 'pt', 'tr']
const reviewedOccurrencePath = path.join(
  policyRoot,
  'reviewed-occurrence-constructions-v1.json'
)
const REVIEWED_OCCURRENCE_CONSTRUCTIONS = readJson(reviewedOccurrencePath).constructions

function sameBankScope(rule, reviewed) {
  const same = (key, fallback) =>
    JSON.stringify(rule[key] ?? fallback) === JSON.stringify(reviewed[key] ?? fallback)
  return (
    same('requiredDeclaredLanguages', []) &&
    same('rejectedPrefixFrames', []) &&
    same('phraseRequiredDeclaredLanguages', {}) &&
    same('precedingWords', []) &&
    same('sentenceInitial', false) &&
    same('closedTails', []) &&
    same('textForbidden', []) &&
    same('openers', [])
  )
}

export function occurrenceConstructionProblems(rules) {
  if (!Array.isArray(rules) || rules.length > REVIEWED_OCCURRENCE_CONSTRUCTIONS.length)
    return ['unreviewed occurrence construction bank']
  const targets = new Set()
  return rules.every((rule) => {
    if (!rule || targets.has(rule.target)) return false
    targets.add(rule.target)
    const reviewed = REVIEWED_OCCURRENCE_CONSTRUCTIONS.find(
      (entry) => entry.language === rule.language && entry.target === rule.target
    )
    return (
      reviewed &&
      sameBankScope(rule, reviewed) &&
      typeof rule.reason === 'string' &&
      rule.reason.length >= 20 &&
      Array.isArray(rule.phrases) &&
      rule.phrases.length === reviewed.phrases.length &&
      reviewed.phrases.every((phrase) => rule.phrases.includes(phrase))
    )
  })
    ? []
    : ['unreviewed occurrence construction bank']
}

function contextTargetProblems(terms, deliberateTerms, highKeys) {
  if (!Array.isArray(terms)) return []
  const problems = []
  if (
    terms.some((term) => typeof term !== 'string' || !/^\p{Script=Latin}+$/u.test(term))
  )
    problems.push('literal context targets must use literal Latin letters')
  if (
    terms.some(
      (term) => typeof term === 'string' && deliberateTerms.includes(toLiteral(term))
    )
  )
    problems.push('a literal context clears a deliberate review term')
  if (
    terms.some(
      (term) =>
        typeof term === 'string' && highKeys.has(collapse(toFolded(toLiteral(term))))
    )
  )
    problems.push('generic context targets a high-severity term')
  return problems
}

/**
 * Mirrors the screener's own floor and reviewed exceptions in
 * `community-text-screener.ts`. A single-word term shorter than this collides
 * with ordinary words in the other six languages once folded, and every language
 * runs against every submission, so the screener refuses to index one and its
 * startup would fail on it. The generator drops such entries and records why
 * instead of letting startup fail.
 */
const MIN_SINGLE_TERM_LENGTH = 4
const SHORT_TERM_EXCEPTIONS = new Set(['kys', 'amk'])

/** The grade an upstream-only term receives: a human looks, nothing blocks. */
const UPSTREAM_DEFAULT_GRADE = { category: 'profanity', severity: 'medium' }

const GENERATED_LIST_VERSION = 'ldnoobw-5faf2ba4+overlay-v1'
const RETRIEVED_AT = '2026-10-16'
const CURATOR = 'couture-cast repository owner'

const IGNORABLE_PATTERN = /[\p{Default_Ignorable_Code_Point}\p{Cf}]/gu
const COMBINING_MARK_PATTERN = /\p{M}/gu
const TOKEN_SPLIT_PATTERN = /[^\p{L}\p{N}]+/u
const REPEAT_PATTERN = /(.)\1+/gu
const LITERAL_EXPANSIONS = [
  [/ß/g, 'ss'],
  [/æ/g, 'ae'],
  [/œ/g, 'oe'],
]
const FOLD_SINGLETONS = {
  ı: 'i',
  ø: 'o',
  đ: 'd',
  ð: 'd',
  ł: 'l',
  ħ: 'h',
  ŋ: 'n',
  þ: 'th',
}

export function toLiteral(raw) {
  let value = raw.normalize('NFKC').replace(IGNORABLE_PATTERN, '').toLowerCase()
  for (const [pattern, replacement] of LITERAL_EXPANSIONS) {
    value = value.replace(pattern, replacement)
  }
  return value.trim()
}

function toFolded(literal) {
  const stripped = literal.normalize('NFD').replace(COMBINING_MARK_PATTERN, '')
  let folded = ''
  for (const character of stripped) folded += FOLD_SINGLETONS[character] ?? character
  return folded.normalize('NFC')
}

function tokenize(value) {
  return value.split(TOKEN_SPLIT_PATTERN).filter(Boolean)
}

const collapse = (value) => value.replace(REPEAT_PATTERN, '$1')

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex')
}

function gitBlobSha1(bytes) {
  return crypto
    .createHash('sha1')
    .update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes]))
    .digest('hex')
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function relative(filePath) {
  return path.relative(projectRoot, filePath)
}

/** Reads one vendored list: one term per line, blank lines ignored. */
function readVendorList(language) {
  return fs
    .readFileSync(path.join(vendorDir, language), 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

/**
 * Why the screener could not index a term, or null when it can. Mirrors the
 * checks `buildLanguageIndex` performs at startup.
 */
export function unindexableReason(literal, allowSingles) {
  const tokens = tokenize(toFolded(literal))
  if (tokens.length === 0) {
    return 'normalizes to no letters or digits, so the screener cannot index it'
  }
  const joined = tokens.join('')
  if (tokens.length === 1 && joined.length < MIN_SINGLE_TERM_LENGTH) {
    if (SHORT_TERM_EXCEPTIONS.has(joined)) return null
    return `shorter than the screener's ${MIN_SINGLE_TERM_LENGTH}-character single-term floor, which exists because every language runs against every submission and short words collide across the seven languages`
  }
  const collapsed = collapse(joined)
  if (
    collapsed.length < MIN_SINGLE_TERM_LENGTH &&
    !SHORT_TERM_EXCEPTIONS.has(collapsed) &&
    !allowSingles.has(collapsed)
  ) {
    return `collapses to "${collapsed}", under the ${MIN_SINGLE_TERM_LENGTH}-character floor, and that spelling is not cleared by the allow list`
  }
  return null
}

function validLiteralTokens(values, required) {
  return (
    Array.isArray(values) &&
    (!required || values.length > 0) &&
    values.every(
      (value) =>
        typeof value === 'string' && /^\p{L}+$/u.test(value) && value === toLiteral(value)
    ) &&
    new Set(values).size === values.length
  )
}

export function literalContextProblems(contexts, deliberateTerms = [], highTerms = []) {
  const problems = []
  const highKeys = new Set(
    highTerms.map((term) => collapse(tokenize(toFolded(toLiteral(term))).join('')))
  )
  if (!Array.isArray(contexts)) return ['literal contexts must be an array']
  for (const context of contexts) {
    if (!context || typeof context !== 'object') {
      problems.push('a literal context must be an object')
      continue
    }
    if (
      !LANGUAGES.includes(context.language) ||
      typeof context.reason !== 'string' ||
      context.reason.trim().length < 20
    )
      problems.push('a literal context has no valid language or reason')
    for (const key of ['terms', 'objects', 'connectors']) {
      const values = context[key]
      if (!validLiteralTokens(values, key !== 'connectors'))
        problems.push(`a literal context has invalid ${key}`)
    }
    problems.push(...contextTargetProblems(context.terms, deliberateTerms, highKeys))
    if (
      !Number.isInteger(context.maxDistance) ||
      context.maxDistance < 1 ||
      context.maxDistance > 6
    )
      problems.push('a literal context must bound distance to 1..6 tokens')
  }
  return problems
}

function occurrenceAlias(value) {
  const leet = {
    0: 'o',
    1: 'l',
    i: 'l',
    '!': 'l',
    '|': 'l',
    2: 'z',
    3: 'e',
    4: 'a',
    '@': 'a',
    5: 's',
    $: 's',
    6: 'g',
    9: 'g',
    7: 't',
    '+': 't',
    8: 'b',
  }
  return [...toFolded(toLiteral(value))].map((letter) => leet[letter] ?? letter).join('')
}
export function globallyAllowsOccurrenceTarget(value) {
  return tokenize(occurrenceAlias(value)).some((token) =>
    REVIEWED_OCCURRENCE_CONSTRUCTIONS.some(
      (entry) => collapse(token) === collapse(occurrenceAlias(entry.target))
    )
  )
}

function scopedWordProblems(scopedWords) {
  return scopedWords.flatMap((scoped) => {
    const literal = toLiteral(scoped.entry ?? '')
    return !LANGUAGES.includes(scoped.language) ||
      tokenize(literal).length !== 1 ||
      typeof scoped.reason !== 'string' ||
      scoped.reason.length < 20
      ? [`scoped allow word "${scoped.entry}" needs a language, one word and a reason`]
      : []
  })
}

function isLetterWords(words) {
  return Array.isArray(words) && words.every((word) => /^\p{L}+$/u.test(toLiteral(word)))
}

function isPhraseList(phrases) {
  return (
    Array.isArray(phrases) &&
    phrases.every((phrase) => tokenize(toLiteral(phrase)).length > 0)
  )
}

function splitPairShapeValid(frame) {
  return (
    LANGUAGES.includes(frame.language) &&
    tokenize(toLiteral(frame.entry ?? '')).length === 2 &&
    typeof frame.atStart === 'boolean' &&
    isLetterWords(frame.before) &&
    (frame.atStart || frame.before.length > 0) &&
    isPhraseList(frame.after) &&
    frame.after.length > 0
  )
}

function splitPairListsValid(frame) {
  return (
    isPhraseList(frame.leads) &&
    isPhraseList(frame.tails) &&
    isLetterWords(frame.reviewBefore) &&
    isLetterWords(frame.reviewForbidden) &&
    typeof frame.reason === 'string' &&
    frame.reason.length >= 20
  )
}

function splitPairProblems(pairs) {
  return pairs.flatMap((frame) =>
    splitPairShapeValid(frame) && splitPairListsValid(frame)
      ? []
      : [
          `reviewed split pair "${frame.entry}" needs a language, two words, a bounded before, closed leads, after, tails and review lists, and a reason`,
        ]
  )
}

function scopedPhraseProblems(scopedPhrases) {
  const problems = []
  for (const scoped of scopedPhrases) {
    const literal = toLiteral(scoped.entry ?? '')
    if (
      !LANGUAGES.includes(scoped.language) ||
      tokenize(literal).length < 2 ||
      !Array.isArray(scoped.complements) ||
      scoped.complements.length === 0 ||
      typeof scoped.reason !== 'string' ||
      scoped.reason.length < 20
    )
      problems.push(
        `scoped allow phrase "${scoped.entry}" needs a language, two words, complements and a reason`
      )
    if (globallyAllowsOccurrenceTarget(literal))
      problems.push('reviewed occurrence target cannot be globally allow-listed')
  }
  return problems
}

function scopedAndSplitProblems(allow) {
  return [
    ...scopedPhraseProblems(allow.scopedPhrases ?? []),
    ...scopedWordProblems(allow.scopedWords ?? []),
    ...splitPairProblems(allow.reviewedSplitPairs ?? []),
  ]
}

function loadAllowList() {
  const allow = readJson(allowListPath)
  const problems = []
  const seen = new Set()
  for (const entry of allow.entries ?? []) {
    const literal = toLiteral(entry.entry ?? '')
    if (!literal) problems.push('an allow-list entry is empty')
    if (!LANGUAGES.includes(entry.language)) {
      problems.push(
        `allow-list entry "${entry.entry}" names unknown language ${entry.language}`
      )
    }
    if (typeof entry.reason !== 'string' || entry.reason.trim().length < 20) {
      problems.push(`allow-list entry "${entry.entry}" has no reason recorded`)
    }
    if (seen.has(literal))
      problems.push(`allow-list entry "${entry.entry}" is listed twice`)
    seen.add(literal)
    if (globallyAllowsOccurrenceTarget(literal))
      problems.push('reviewed occurrence target cannot be globally allow-listed')
  }
  problems.push(
    ...literalContextProblems(
      allow.literalContexts ?? [],
      (readJson(policyPath).text.deliberateReviewTerms ?? []).map((entry) =>
        toLiteral(entry.term)
      )
    )
  )
  problems.push(...scopedAndSplitProblems(allow))
  if ('occurrenceConstructions' in allow)
    problems.push('reviewed constructions must use the authoritative bank')
  problems.push(...occurrenceConstructionProblems(REVIEWED_OCCURRENCE_CONSTRUCTIONS))
  const singles = new Set(
    [...seen]
      .map((literal) => tokenize(literal))
      .filter((tokens) => tokens.length === 1)
      .map((tokens) => tokens[0])
  )
  return { allow, singles, literals: seen, problems }
}

/**
 * The overlay entry an upstream term extends, when there is one: the longest
 * graded term its spaceless folded form begins with. LDNOOBW lists inflected and
 * agglutinated forms of words the overlay grades (Turkish götverenlerden from
 * götveren, English `blow job` written apart from the graded `blowjob`), and
 * grading those with the generic upstream default made a plain inflection milder
 * than its own stem. A disguised spelling is then rebuilt into the stem and
 * graded harsher than the undisguised word, which inverts the point of grading.
 */
function gradedStem(literal, overlayEntries) {
  const joined = tokenize(toFolded(literal)).join('')
  let best = null
  for (const entry of overlayEntries) {
    const stem = tokenize(toFolded(toLiteral(entry.term))).join('')
    if (stem.length < MIN_SINGLE_TERM_LENGTH || !joined.startsWith(stem)) continue
    if (!best || stem.length > best.length) best = { ...entry, length: stem.length }
  }
  return best
}

function buildTermsFile(language, allowState, hashes) {
  const overlay = readJson(path.join(overlayDir, `${language}.json`))
  const upstream = readVendorList(language)

  const entries = new Map()
  for (const entry of overlay.entries) {
    entries.set(toLiteral(entry.term), {
      term: toLiteral(entry.term),
      category: entry.category,
      severity: entry.severity,
      source: 'overlay',
    })
  }

  const excluded = []
  for (const raw of upstream) {
    const literal = toLiteral(raw)
    const existing = entries.get(literal)
    if (existing) {
      existing.source = 'overlay+ldnoobw'
      continue
    }
    if (allowState.literals.has(literal)) {
      excluded.push({
        term: literal,
        reason: 'cleared by the repository allow list as an ordinary word',
      })
      continue
    }
    const unindexable = unindexableReason(literal, allowState.singles)
    if (unindexable) {
      excluded.push({ term: literal, reason: unindexable })
      continue
    }
    const stem = gradedStem(literal, overlay.entries)
    entries.set(
      literal,
      stem
        ? {
            term: literal,
            category: stem.category,
            severity: stem.severity,
            source: 'ldnoobw',
            gradeFrom: toLiteral(stem.term),
          }
        : { term: literal, ...UPSTREAM_DEFAULT_GRADE, source: 'ldnoobw' }
    )
  }

  const sortedEntries = [...entries.values()].toSorted((a, b) =>
    a.term < b.term ? -1 : a.term > b.term ? 1 : 0
  )
  const dedupedExclusions = [
    ...new Map(excluded.map((entry) => [entry.term, entry])).values(),
  ].toSorted((a, b) => (a.term < b.term ? -1 : a.term > b.term ? 1 : 0))

  return {
    language,
    listVersion: GENERATED_LIST_VERSION,
    listType: 'terms',
    provenance: {
      source: `LDNOOBW (${hashes.upstreamSource}) at commit ${hashes.upstreamCommit}, file ${language}, merged with the repository graded overlay graded-overlay-v1/${language}.json`,
      version: `ldnoobw@${hashes.upstreamCommit.slice(0, 12)}+graded-overlay-v1`,
      licence:
        'CC-BY-4.0 for the LDNOOBW entries (see vendor/ldnoobw/ATTRIBUTION.md); UNLICENSED repository-owned for the overlay entries',
      retrievedAt: RETRIEVED_AT,
      curator: CURATOR,
      notes:
        "GENERATED by `npm run verify:community-screening-lists -- --write`; do not edit by hand. Overlay entries keep their deliberate grading. An upstream entry that extends a graded overlay term (an inflection, or a compound written apart) takes that term's grading and names it in gradeFrom. Every other upstream entry carries no grading upstream and is recorded as profanity at medium severity, which routes a match to human review and never blocks automatically. Entries the allow list clears or the screener cannot index are listed under excludedUpstreamTerms with the reason.",
    },
    generated: {
      generator: 'scripts/verify-community-screening-lists.mjs',
      upstreamCommit: hashes.upstreamCommit,
      upstreamFileSha256: hashes.vendor[language],
      overlaySha256: sha256(fs.readFileSync(path.join(overlayDir, `${language}.json`))),
      allowListSha256: hashes.allowList,
      reviewedOccurrenceSha256: hashes.reviewedOccurrence,
      counts: {
        upstreamLines: upstream.length,
        overlayEntries: overlay.entries.length,
        entries: sortedEntries.length,
        excludedUpstreamTerms: dedupedExclusions.length,
      },
    },
    entries: sortedEntries,
    excludedUpstreamTerms: dedupedExclusions,
  }
}

function buildAllowFile(language, allowState, hashes) {
  return {
    language,
    listVersion: 'allow-list-v1',
    listType: 'allowList',
    provenance: {
      source: 'repository-owned allow list, allow-list-v1.json',
      version: 'v1',
      licence: 'UNLICENSED (repository-owned)',
      retrievedAt: RETRIEVED_AT,
      curator: CURATOR,
      notes:
        'GENERATED from allow-list-v1.json, where every entry records why it exists; do not edit by hand. Allow lists apply across all seven languages, so an entry here clears the word whichever list would have flagged it. Literal contexts clear only their exact target token within bounded grammatical object context; other tokens and unsafe phrases remain screened.',
    },
    generated: {
      generator: 'scripts/verify-community-screening-lists.mjs',
      allowListSha256: hashes.allowList,
      reviewedOccurrenceSha256: hashes.reviewedOccurrence,
    },
    entries: allowState.allow.entries
      .filter((entry) => entry.language === language)
      .map((entry) => toLiteral(entry.entry))
      .toSorted(),
    splitFrames: (allowState.allow.reviewedSplitPairs ?? [])
      .filter((entry) => entry.language === language)
      .map((entry) => ({
        pair: toLiteral(entry.entry),
        atStart: entry.atStart,
        before: entry.before.map(toLiteral),
        leads: entry.leads.map(toLiteral),
        after: entry.after.map(toLiteral),
        tails: entry.tails.map(toLiteral),
        reviewBefore: entry.reviewBefore.map(toLiteral),
        reviewForbidden: entry.reviewForbidden.map(toLiteral),
      })),
    scopedWords: (allowState.allow.scopedWords ?? [])
      .filter((entry) => entry.language === language)
      .map((entry) => toLiteral(entry.entry)),
    scopedPhrases: (allowState.allow.scopedPhrases ?? [])
      .filter((entry) => entry.language === language)
      .map((entry) => ({
        phrase: toLiteral(entry.entry),
        complements: entry.complements.map(toLiteral),
      })),
    literalContexts: (allowState.allow.literalContexts ?? [])
      .filter((context) => context.language === language)
      .map(({ terms, objects, connectors, maxDistance }) => ({
        terms,
        objects,
        connectors,
        maxDistance,
      })),
    occurrenceConstructions: REVIEWED_OCCURRENCE_CONSTRUCTIONS.filter(
      (rule) => rule.language === language
    ).map(({ target, phrases }) => ({ target, phrases })),
  }
}

async function formatJson(filePath, value) {
  const prettier = await import('prettier')
  const options = (await prettier.resolveConfig(filePath)) ?? {}
  return prettier.format(`${JSON.stringify(value, null, 2)}\n`, {
    ...options,
    parser: 'json',
  })
}

function verifyVendor(source, problems) {
  const vendor = {}
  for (const [file, expected] of Object.entries(source.files)) {
    const filePath = path.join(vendorDir, file)
    if (!fs.existsSync(filePath)) {
      problems.push(`vendored file ${relative(filePath)} is missing`)
      continue
    }
    const bytes = fs.readFileSync(filePath)
    const digest = sha256(bytes)
    if (digest !== expected.sha256) {
      problems.push(
        `vendored file ${relative(filePath)} drifted from the pinned commit: sha256 ${digest}, expected ${expected.sha256}`
      )
    }
    if (gitBlobSha1(bytes) !== expected.gitBlobSha1) {
      problems.push(
        `vendored file ${relative(filePath)} does not match its upstream blob hash`
      )
    }
    vendor[file] = digest
  }
  return vendor
}

async function verifyRemote(source, problems) {
  for (const file of Object.keys(source.files)) {
    const url = source.rawUrlTemplate
      .replace('{commit}', source.commit)
      .replace('{file}', file)
    const response = await fetch(url)
    if (!response.ok) {
      problems.push(
        `could not fetch ${file} from the pinned commit (HTTP ${response.status})`
      )
      continue
    }
    const remote = Buffer.from(await response.arrayBuffer())
    const local = fs.readFileSync(path.join(vendorDir, file))
    if (!remote.equals(local)) {
      problems.push(
        `vendored ${file} differs from the upstream bytes at ${source.commit}`
      )
    }
  }
}

/**
 * The model manifest pins the policy file's SHA-256, and startup refuses a
 * policy that no longer matches it. A list change rewrites the policy's list
 * records, so `--write` re-pins the hash in the same step; the change is visible
 * in the diff of both files, which is where a reviewer approves it.
 */
function repinPolicyHash() {
  const manifestPath = path.join(
    projectRoot,
    'apps/api/model-manifests/community-nsfw-mobilenet-v2-mid-nsfwjs-4.3.0.json'
  )
  const digest = sha256(fs.readFileSync(policyPath))
  const text = fs.readFileSync(manifestPath, 'utf8')
  const updated = text.replace(
    /("policy": \{[^}]*?"sha256": ")[a-f0-9]{64}(")/s,
    (_match, before, after) => `${before}${digest}${after}`
  )
  if (updated === text && !text.includes(digest)) {
    throw new Error('Could not find the policy hash pin in the model manifest')
  }
  fs.writeFileSync(manifestPath, updated)
}

function policyListRecord(language, hashes) {
  return {
    language,
    terms: `terms-v1/${language}-v1.json`,
    allowList: `terms-v1/allow-${language}-v1.json`,
    version: GENERATED_LIST_VERSION,
    source: `LDNOOBW at ${hashes.upstreamCommit} merged with graded-overlay-v1/${language}.json; allow list allow-list-v1.json`,
    licence:
      'CC-BY-4.0 (LDNOOBW upstream entries); UNLICENSED repository-owned (overlay and allow list)',
    upstreamCommit: hashes.upstreamCommit,
    termsSha256: hashes.terms[language],
    allowListSha256: hashes.allowFiles[language],
  }
}

function readIfPresent(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null
}

/** Generates one language's two files, writes them when asked, and compares. */
async function processLanguage(language, context) {
  const { allowState, hashes, write, problems } = context
  const termsPath = path.join(termsDir, `${language}-v1.json`)
  const allowPath = path.join(termsDir, `allow-${language}-v1.json`)
  const termsText = await formatJson(
    termsPath,
    buildTermsFile(language, allowState, hashes)
  )
  const allowText = await formatJson(
    allowPath,
    buildAllowFile(language, allowState, hashes)
  )
  if (write) {
    fs.writeFileSync(termsPath, termsText)
    fs.writeFileSync(allowPath, allowText)
  }
  if (readIfPresent(termsPath) !== termsText) {
    problems.push(
      `${relative(termsPath)} is not what the vendored list, overlay and allow list generate; run with --write`
    )
  }
  if (readIfPresent(allowPath) !== allowText) {
    problems.push(
      `${relative(allowPath)} is not what allow-list-v1.json generates; run with --write`
    )
  }
  hashes.terms[language] = sha256(Buffer.from(termsText))
  hashes.allowFiles[language] = sha256(Buffer.from(allowText))
  return JSON.parse(termsText).generated.counts
}

async function reconcilePolicy(hashes, write, problems) {
  const expectedLists = LANGUAGES.map((language) => policyListRecord(language, hashes))
  if (write) {
    const policy = readJson(policyPath)
    policy.text.lists = expectedLists
    fs.writeFileSync(policyPath, await formatJson(policyPath, policy))
    repinPolicyHash()
  }
  const recorded = readJson(policyPath).text.lists
  if (JSON.stringify(recorded) !== JSON.stringify(expectedLists)) {
    problems.push(
      `${relative(policyPath)} text.lists does not record the current list hashes and upstream commit; run with --write`
    )
  }
}

function printReport(report) {
  for (const [language, counts] of Object.entries(report.languages)) {
    console.log(
      `${language}: ${counts.entries} entries (${counts.overlayEntries} graded overlay, ${counts.upstreamLines} upstream lines, ${counts.excludedUpstreamTerms} upstream excluded)`
    )
  }
  for (const problem of report.problems) console.error(problem)
  const remote = report.remoteChecked ? ' (remote bytes compared)' : ''
  console.log(
    report.problems.length === 0
      ? `Community screening lists verified against LDNOOBW ${report.upstreamCommit}${remote}.`
      : `Community screening list verification failed with ${report.problems.length} problem(s).`
  )
}

async function main() {
  const write = process.argv.includes('--write')
  const remote = process.argv.includes('--remote')
  const problems = []

  const source = readJson(path.join(vendorDir, 'source.json'))
  const vendor = verifyVendor(source, problems)
  if (remote) await verifyRemote(source, problems)

  const allowState = loadAllowList()
  if (allowState.problems.length) throw new Error(allowState.problems.join('; '))
  problems.push(...allowState.problems)

  const hashes = {
    upstreamCommit: source.commit,
    upstreamSource: source.source,
    vendor,
    allowList: sha256(fs.readFileSync(allowListPath)),
    reviewedOccurrence: sha256(fs.readFileSync(reviewedOccurrencePath)),
    terms: {},
    allowFiles: {},
  }

  const languages = {}
  const highTerms = LANGUAGES.flatMap(
    (language) => buildTermsFile(language, allowState, hashes).entries
  )
    .filter((entry) => entry.severity === 'high')
    .map((entry) => entry.term)
  const highProblems = literalContextProblems(
    allowState.allow.literalContexts ?? [],
    [],
    highTerms
  )
  if (highProblems.length) throw new Error(highProblems.join('; '))
  for (const language of LANGUAGES) {
    languages[language] = await processLanguage(language, {
      allowState,
      hashes,
      write,
      problems,
    })
  }
  await reconcilePolicy(hashes, write, problems)

  const report = {
    status: problems.length === 0 ? 'verified' : 'failed',
    upstreamCommit: source.commit,
    remoteChecked: remote,
    languages,
    allowListEntries: allowState.allow.entries.length,
    problems,
  }
  if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2))
  else printReport(report)
  process.exit(problems.length === 0 ? 0 : 1)
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) {
  main().catch((error) => {
    console.error('Community screening list verification error:', error)
    process.exit(1)
  })
}
