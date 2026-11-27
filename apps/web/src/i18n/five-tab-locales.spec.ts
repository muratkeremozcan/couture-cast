// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
// Story CC-7.11 test owner (TEA): D15, the new member-facing strings of the Looks tab (looks.*)
// and the Closet More menu (wardrobe.menu.*) ship in all ten web locales, translated, with the
// same keys. The tab labels and Profile > Style keys are profile-locales.spec.ts.
// Test design: _bmad-output/test-artifacts/test-design-7-11-five-tab-navigation-back-pattern.md
// Learning path Step 69: Looks tab for saved looks, ideas and plans.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-69-looks-tab-for-saved-looks-ideas-and-plans
// Story CC-7.12 test owner (TEA): 7.12-UNIT-070 (the looks.* tree is the 7.12 one in all ten web
// locales, placeholders matching en-US) and 7.12-UNIT-071 (the removed keys are absent).
// Test design: _bmad-output/test-artifacts/test-design-7-12-looks-tab-saved-looks-ideas-plans.md
import { describe, expect, it } from 'vitest'
import { SUPPORTED_LOCALES, type SupportedLocale } from './index'

import deDE from './locales/de-DE.json'
import enCA from './locales/en-CA.json'
import enUS from './locales/en-US.json'
import es419 from './locales/es-419.json'
import frCA from './locales/fr-CA.json'
import frFR from './locales/fr-FR.json'
import itIT from './locales/it-IT.json'
import ptBR from './locales/pt-BR.json'
import ptPT from './locales/pt-PT.json'
import trTR from './locales/tr-TR.json'

type Catalog = Record<string, unknown>

const CATALOGS: Record<SupportedLocale, Catalog> = {
  'en-US': enUS as Catalog,
  'en-CA': enCA as Catalog,
  'de-DE': deDE as Catalog,
  'es-419': es419 as Catalog,
  'fr-CA': frCA as Catalog,
  'fr-FR': frFR as Catalog,
  'it-IT': itIT as Catalog,
  'pt-BR': ptBR as Catalog,
  'pt-PT': ptPT as Catalog,
  'tr-TR': trTR as Catalog,
}

/** The leaf at a dotted path, or undefined. */
function at(catalog: Catalog, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (node, key) =>
        typeof node === 'object' && node !== null
          ? (node as Record<string, unknown>)[key]
          : undefined,
      catalog
    )
}

/** Every leaf under `root` as `root.key` to its value. */
function stringsUnder(catalog: Catalog, root: string): Map<string, string> {
  const out = new Map<string, string>()
  const walk = (prefix: string, node: unknown) => {
    if (typeof node !== 'object' || node === null) {
      out.set(prefix, String(node))
      return
    }
    for (const [key, value] of Object.entries(node as Record<string, unknown>))
      walk(`${prefix}.${key}`, value)
  }
  walk(root, at(catalog, root))
  return out
}

const ROOTS = ['looks', 'wardrobe.menu'] as const

function newStrings(catalog: Catalog): Map<string, string> {
  return new Map(ROOTS.flatMap((root) => [...stringsUnder(catalog, root)]))
}

const reference = newStrings(CATALOGS['en-US'])

/**
 * Words a locale keeps from English because they are its own word: Plan in German, Spanish,
 * French and Turkish, Capsules in French, Silhouette in German, French and Italian.
 */
const SHARED_WORDS = new Set(['Plan', 'Capsules', 'Silhouette'])

/**
 * CC-7.12: two strings equal English in exactly one locale each, Ideas in es-419 and Upgrade in
 * de-DE. Scoped to that locale and key, so every other locale must still translate them.
 */
const SHARED_KEYS: Readonly<Partial<Record<SupportedLocale, ReadonlySet<string>>>> = {
  'es-419': new Set(['looks.segments.ideas']),
  'de-DE': new Set(['looks.freePlan.upgrade']),
}

describe('7.11 Looks tab and Closet More menu strings (web)', () => {
  it('7.11-I18N-WEB-01 holds the exact en-US strings the tests and the spec name', () => {
    expect(Object.fromEntries(reference)).toEqual({
      'looks.empty': 'Save a look to see it here',
      // Story CC-7.12 D12: the CC-7.11 Capsules and Plan row labels (`looks.capsules`,
      // `looks.plan`) left with the rows; the segment, filter, tile and preview strings came in.
      'looks.segments.label': 'Looks sections',
      'looks.segments.saved': 'Saved',
      'looks.segments.ideas': 'Ideas',
      'looks.segments.plan': 'Plan',
      'looks.filters.label': 'Filter saved looks',
      'looks.filters.all': 'All',
      'looks.filters.today': 'Today',
      'looks.filters.capsules': 'Capsules',
      'looks.filterEmpty.today': 'No looks from Today yet',
      'looks.filterEmpty.capsules': 'No capsules yet',
      'looks.manageCapsules': 'Manage capsules',
      'looks.state.missing_one': '1 piece missing',
      'looks.state.missing_other': '{{count}} pieces missing',
      'looks.state.needsReview': 'Needs review',
      'looks.state.savedOn': 'Saved {{date}}',
      'looks.detail.gone': 'This look is no longer saved',
      'looks.detail.signIn': 'Sign in to see your saved looks',
      'looks.detail.signInAction': 'Sign in',
      'looks.freePlan.week': 'Sample week',
      'looks.freePlan.line': 'With Premium, you can plan what to wear all week.',
      'looks.freePlan.upgrade': 'Upgrade',
      'looks.loadMore': 'Show more',
      'wardrobe.menu.add': 'Add',
      'wardrobe.menu.more': 'More',
      // Codex 7.11 gap (a): the More button's name starts with its visible label (WCAG 2.5.3).
      'wardrobe.menu.moreLabel': 'More closet options',
      'wardrobe.menu.label': 'Closet options',
      'wardrobe.menu.setup': 'Closet setup',
      'wardrobe.menu.setupDone': 'Closet setup: done',
      'wardrobe.menu.silhouette': 'Silhouette',
      'wardrobe.menu.close': 'Close',
    })
  })

  it.each(SUPPORTED_LOCALES)(
    '7.11-I18N-WEB-02 %s ships every key, non-empty',
    (locale) => {
      const strings = newStrings(CATALOGS[locale])
      expect([...strings.keys()].sort()).toEqual([...reference.keys()].sort())
      for (const [key, value] of strings) {
        expect(value.trim().length, `${locale}.${key}`).toBeGreaterThan(0)
        expect(value, `${locale}.${key}`).not.toMatch(/^(looks|wardrobe)\./)
      }
    }
  )

  it.each(SUPPORTED_LOCALES.filter((tag) => !tag.startsWith('en-')))(
    '7.11-I18N-WEB-03 %s translates every string outside the shared words',
    (locale) => {
      const strings = newStrings(CATALOGS[locale])
      const untranslated = [...reference]
        .filter(([key, english]) => strings.get(key) === english)
        .filter(([, english]) => !SHARED_WORDS.has(english))
        .filter(([key]) => !SHARED_KEYS[locale]?.has(key))
        .map(([key]) => key)
      expect(untranslated).toEqual([])
    }
  )

  // The done state reads as the setup row's own name plus its status, in every locale.
  it.each(SUPPORTED_LOCALES)('7.11-I18N-WEB-04 %s setupDone extends setup', (locale) => {
    const strings = newStrings(CATALOGS[locale])
    const setup = strings.get('wardrobe.menu.setup') ?? ''
    const done = strings.get('wardrobe.menu.setupDone') ?? ''
    expect(done.startsWith(setup)).toBe(true)
    expect(done.length).toBeGreaterThan(setup.length)
  })

  /** `{{token}}` placeholders must match en-US exactly, or interpolation breaks. */
  const placeholders = (value: string) =>
    [...value.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1] ?? '').sort()

  it.each(SUPPORTED_LOCALES)(
    '7.12-UNIT-070 %s keeps every looks placeholder of en-US',
    (locale) => {
      const strings = newStrings(CATALOGS[locale])
      for (const [key, english] of reference)
        expect(placeholders(strings.get(key) ?? ''), `${locale}.${key}`).toEqual(
          placeholders(english)
        )
      // The missing-pieces line keeps its count in the plural form.
      expect(strings.get('looks.state.missing_other'), locale).toContain('{{count}}')
      expect(strings.get('looks.state.savedOn'), locale).toContain('{{date}}')
    }
  )

  it.each(SUPPORTED_LOCALES)(
    '7.12-UNIT-071 %s carries none of the removed Looks row or Planner lock keys',
    (locale) => {
      const catalog = CATALOGS[locale]
      for (const path of [
        'looks.capsules',
        'looks.plan',
        'commerce.premium.plannerLocked',
        'commerce.premium.plannerLocked.title',
        'commerce.premium.plannerLocked.cta',
      ])
        expect(at(catalog, path), `${locale}.${path}`).toBeUndefined()
    }
  )
})
