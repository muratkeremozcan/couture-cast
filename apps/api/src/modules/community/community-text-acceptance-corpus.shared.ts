import fs from 'node:fs'
import path from 'node:path'
import { CommunityTextScreener } from './community-text-screener'

/**
 * Shared by the three frozen clean-corpus specs (community-text-acceptance-corpus-*.spec.ts).
 * See the first of them for the corpus description. A part is one file/locale selection, so
 * the three parts run in parallel workers.
 */
export const FIXTURE_DIR = path.resolve(
  __dirname,
  '../../../test/fixtures/community-text-acceptance'
)

export interface CorpusPart {
  readonly total: number
  readonly withheld: Record<string, string[]>
}

/** Screens the selected `file|locale` keys and returns what was withheld. */
export function screenCorpusPart(select: (key: string) => boolean): CorpusPart {
  const screener = new CommunityTextScreener()
  const withheld: Record<string, string[]> = {}
  let total = 0
  for (const file of fs
    .readdirSync(FIXTURE_DIR)
    .filter((name) => name.startsWith('clean-') && name.endsWith('.json'))) {
    const corpus = JSON.parse(
      fs.readFileSync(path.join(FIXTURE_DIR, file), 'utf8')
    ) as Record<string, string[]>
    for (const [locale, strings] of Object.entries(corpus)) {
      if (!select(`${file}|${locale}`)) continue
      for (const text of strings) {
        total += 1
        const { disposition } = screener.screen({
          text,
          field: 'caption',
          locale: locale === 'null' ? null : locale,
        })
        if (disposition !== 'pass')
          (withheld[`${file}|${locale}`] ??= []).push(`${disposition[0]} ${text}`)
      }
    }
  }
  return { total, withheld }
}

/** The pinned withheld strings of the selected keys. */
export function pinnedWithheld(
  select: (key: string) => boolean
): Record<string, string[]> {
  const expected = JSON.parse(
    fs.readFileSync(path.join(FIXTURE_DIR, 'expected-withheld.json'), 'utf8')
  ) as Record<string, string[]>
  return Object.fromEntries(Object.entries(expected).filter(([key]) => select(key)))
}
