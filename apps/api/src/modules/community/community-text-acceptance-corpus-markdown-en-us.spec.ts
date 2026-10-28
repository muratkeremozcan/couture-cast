/**
 * FROZEN CLEAN CORPUS (round 7l), part markdown-en-us. Ordinary copy that must not newly withhold.
 * Later screening reviews judge against this corpus and the adversarial matrix spec: a
 * finding is a merge blocker only if it fails one of them, or is a new transform class
 * that lets a high-severity or sexual-violence term pass outright.
 *
 * Files (test/fixtures/community-text-acceptance), split over three specs that run in
 * parallel workers: part "a" is the locale strings, the symbol snippets and the extra set;
 * parts "markdown-en-us" and "markdown-null" are the English sentences of the planning
 * artifacts, knowledge files and docs, screened under en-US and under no declared locale.
 * - clean-prose-locale-strings.json: 7,112 strings of the app locale files, by locale.
 * - clean-prose-markdown-en.json: 17,839 English sentences (8,920 en-US, 8,919 null).
 * - clean-symbol-snippets.json: 8,930 strings with prices, sizes, model numbers, emails,
 *   handles, hashtags, emoticons, code and retail lines (generate-builder-corpus.mjs.txt
 *   is the recipe; no holdout, fixture or corpus path is read).
 * - clean-extra.json: names (Saed, Saeed, Rapin in name frames), music, sewing, fit and
 *   fashion copy in seven languages, censor-lookalike punctuation (Free shipping*, t-shirt,
 *   S*, snake_case) and the rap-half sentences of the builder review.
 * expected-withheld.json lists every string withheld today. Each names a real listed term
 * (NSFW, porn, gook in a design note ...) and was withheld before round 7l; the round adds
 * none. A new entry fails these specs; a vanished one must be removed there.
 *
 * Budget: measured with coverage instrumentation on a quiet machine, part a takes 21 s,
 * each markdown part 20 s; CI runs about 2.6 times slower (measured on the round 7c
 * timeouts), so the timeout below keeps more than 4 times the CI estimate.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import {
  type CorpusPart,
  pinnedWithheld,
  screenCorpusPart,
} from './community-text-acceptance-corpus.shared'

const select = (key: string): boolean => key === 'clean-prose-markdown-en.json|en-US'
const PINNED_TOTAL = 8920
const CORPUS_TIMEOUT_MS = 300_000

describe('frozen clean corpus, markdown sentences under en-US', () => {
  let result: CorpusPart
  beforeAll(() => {
    result = screenCorpusPart(select)
  }, CORPUS_TIMEOUT_MS)

  it('has the pinned number of strings', () => {
    expect(result.total).toBe(PINNED_TOTAL)
  })

  it('withholds exactly the pinned strings, no new one', () => {
    expect(result.withheld).toEqual(pinnedWithheld(select))
  })
})
