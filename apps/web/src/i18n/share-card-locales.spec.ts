import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { supportedLocales } from '@couture/api-client/contracts/http'
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from './index'
type Catalog = Record<string, unknown> & {
  title: string
  sourceOutfit: string
  sourceCommunity: string
  scenarios: unknown
  climateBands: unknown
}
const json = (relative: string) =>
  JSON.parse(fs.readFileSync(new URL(relative, import.meta.url), 'utf8')) as Record<
    string,
    unknown
  >
const catalogFiles = (relative: string) =>
  fs
    .readdirSync(new URL(relative, import.meta.url))
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.slice(0, -'.json'.length))
    .sort()
// Every supported locale owns all three catalogs, so a new locale cannot skip parity.
const catalogs = SUPPORTED_LOCALES.map((locale) => ({
  locale,
  client: json(`./locales/${locale}.json`).shareCard as Catalog,
  render: json(
    `../../../api/src/modules/share-cards/assets/${locale}.json`
  ) as Catalog & {
    outfit: string
    community: string
  },
  other: json(`../../../mobile/assets/locales/${locale}.json`).shareCard as Catalog,
}))
const baseline = catalogs.find((item) => item.locale === DEFAULT_LOCALE)!
function flatten(value: unknown, prefix = ''): Record<string, string> {
  if (typeof value === 'string') return { [prefix]: value }
  if (!value || typeof value !== 'object') return {}
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, child]) =>
      Object.entries(flatten(child, prefix ? `${prefix}.${key}` : key))
    )
  )
}
describe('share-card catalog parity', () => {
  it('U-LOCALES: the catalogs cover exactly the supported locales on every surface', () => {
    const expected = [...supportedLocales].sort()
    expect([...SUPPORTED_LOCALES].sort()).toEqual(expected)
    expect(catalogFiles('./locales/')).toEqual(expected)
    expect(catalogFiles('../../../api/src/modules/share-cards/assets/')).toEqual(expected)
    expect(catalogFiles('../../../mobile/assets/locales/')).toEqual(expected)
  })
  it.each(catalogs)(
    'U-LOCALES: $locale has render words, surface wording and no unresolved keys',
    ({ client, render, other }) => {
      expect(client).toEqual(other)
      expect(render.outfit).toBe(client.sourceOutfit)
      expect(render.community).toBe(client.sourceCommunity)
      expect(render.scenarios).toEqual(client.scenarios)
      expect(render.climateBands).toEqual(client.climateBands)
      for (const text of Object.values(flatten(client))) {
        expect(text.trim().length).toBeGreaterThan(0)
        expect(text).not.toContain('shareCard.')
      }
    }
  )
  it.each(catalogs.filter(({ locale }) => locale !== DEFAULT_LOCALE))(
    'U-LOCALES: $locale matches the en-US keys and placeholders',
    ({ locale, client }) => {
      const values = flatten(client)
      const reference = flatten(baseline.client)
      expect(Object.keys(values).sort()).toEqual(Object.keys(reference).sort())
      for (const [key, text] of Object.entries(values))
        expect(text.match(/{{[^}]+}}/g) ?? []).toEqual(
          reference[key]!.match(/{{[^}]+}}/g) ?? []
        )
      if (!locale.startsWith('en')) expect(client.title).not.toBe(baseline.client.title)
    }
  )
})
