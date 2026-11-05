// Learning path Step 50: Moderator queue and case detail.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-50-moderator-queue-and-case-detail
// Story 6.10 test owner: U-WEB-Q-LOCALES. Ten-locale parity for the `moderation.*` tree.
// Story 6.11 test owner: U-WEB-D-LOCALES and U-D-ENUM-COVERAGE. The decision, standing and banned keys derive from the contract.
//
// Every enum the console renders derives its expected key set from the shipped contract, so a new
// report reason, finding category or media reason turns this spec red before a raw code reaches a
// moderator. The hand-pinned lists below are the closed states the console maps by `code`.
import {
  communityModerationReasonCategorySchema,
  communityReportReasonSchema,
  moderationActorKindSchema,
  moderationAliasStateSchema,
  moderationAppealStatusSchema,
  moderationAppealStepSchema,
  moderationCacheInvalidationSchema,
  moderationCaseRiskSchema,
  moderationCaseSlaStateSchema,
  moderationCaseSourceSchema,
  moderationCaseStatusSchema,
  moderationDecisionActionSchema,
  moderationDecisionDetailSchema,
  moderationDecisionErrorCodeSchema,
  moderationMediaUnavailableReasonSchema,
  moderationSanctionKindSchema,
  moderationSlaAlertKinds,
  moderationSlaDeliveryStates,
  moderationSlaFailureCodes,
} from '@couture/api-client/contracts/http'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  MODERATION_FAILURE_REASONS,
  RETRYABLE_DECISION_FAILURES,
  type ModerationDecisionFailure,
} from '../lib/moderation'
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

function tree(catalog: Catalog): Record<string, unknown> {
  return (catalog.moderation ?? {}) as Record<string, unknown>
}

function flatten(value: unknown, prefix = ''): Map<string, string> {
  const out = new Map<string, string>()
  if (typeof value !== 'object' || value === null) return out
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof child === 'object' && child !== null) {
      for (const [nested, nestedValue] of flatten(child, path))
        out.set(nested, nestedValue)
    } else out.set(path, String(child))
  }
  return out
}

function childKeys(catalog: Catalog, path: string): string[] {
  const node = path
    .split('.')
    .reduce<unknown>(
      (current, key) => (current as Record<string, unknown> | undefined)?.[key],
      tree(catalog)
    )
  return Object.keys((node ?? {}) as Record<string, unknown>).sort()
}

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1] ?? '').sort()
}

function bannedTree(catalog: Catalog): Record<string, unknown> {
  const community = (catalog.community ?? {}) as Record<string, unknown>
  return (community.banned ?? {}) as Record<string, unknown>
}

const reference = flatten(tree(enUS as Catalog))
const sorted = (values: readonly string[]) => [...values].sort()

/**
 * Values a language legitimately spells like the English source. Each entry is an admission:
 * a unit abbreviation, a loanword the product already ships, or a word that is the same in that
 * language. Anything else identical to English is an untranslated string.
 */
const APPROVED_SAME_AS_ENGLISH: Record<string, readonly SupportedLocale[]> = {
  // "d", "h" and "min" are the unit abbreviations these languages share with English.
  'duration.dh': ['es-419', 'pt-BR', 'pt-PT'],
  'duration.hm': ['es-419', 'fr-CA', 'fr-FR', 'it-IT', 'pt-BR', 'pt-PT'],
  'duration.m': ['es-419', 'fr-CA', 'fr-FR', 'it-IT', 'pt-BR', 'pt-PT'],
  // "Risk" is the Turkish word as well.
  riskLabel: ['tr-TR'],
}

describe('6.10 moderation locale parity', () => {
  it('6.10-I18N-WEB-01 ships a non-empty moderation tree for every supported locale', () => {
    expect(SUPPORTED_LOCALES).toHaveLength(10)
    for (const locale of SUPPORTED_LOCALES) {
      const catalog = flatten(tree(CATALOGS[locale]))
      expect(catalog.size, `${locale} moderation tree`).toBeGreaterThan(0)
      for (const [key, value] of catalog)
        expect(value.trim().length, `${locale}.${key}`).toBeGreaterThan(0)
    }
  })

  it('6.10-I18N-WEB-02 uses an identical key tree in every locale', () => {
    const expected = [...reference.keys()].sort()
    for (const locale of SUPPORTED_LOCALES)
      expect(
        [...flatten(tree(CATALOGS[locale])).keys()].sort(),
        `${locale} key tree`
      ).toEqual(expected)
  })

  it('6.10-I18N-WEB-03 keeps interpolation placeholders identical across locales', () => {
    for (const locale of SUPPORTED_LOCALES)
      for (const [key, value] of flatten(tree(CATALOGS[locale])))
        expect(placeholders(value), `${locale}.${key}`).toEqual(
          placeholders(reference.get(key) ?? '')
        )
  })

  it('6.10-I18N-WEB-04 never ships a raw key, a code or a stray brace as a value', () => {
    for (const locale of SUPPORTED_LOCALES)
      for (const [key, value] of flatten(tree(CATALOGS[locale]))) {
        expect(value, `${locale}.${key}`).not.toMatch(/^moderation\./)
        expect(value.replace(/\{\{\w+\}\}/g, ''), `${locale}.${key}`).not.toMatch(/[{}]/)
      }
  })

  it('6.10-I18N-WEB-05 leaves no value in English except the approved ones', () => {
    for (const locale of SUPPORTED_LOCALES) {
      if (locale === 'en-US' || locale === 'en-CA') continue
      const same: string[] = []
      for (const [key, value] of flatten(tree(CATALOGS[locale])))
        if (
          value === reference.get(key) &&
          !APPROVED_SAME_AS_ENGLISH[key]?.includes(locale) &&
          // A single short word such as "Spam" is the same word in several languages.
          value.trim().split(/\s+/).length > 1
        )
          same.push(key)
      expect(same, `${locale} values still in English`).toEqual([])
    }
  })
})

describe('6.10 moderation enum coverage derives from the contract', () => {
  const enums: [string, readonly string[]][] = [
    ['source', moderationCaseSourceSchema.options],
    ['risk', moderationCaseRiskSchema.options],
    ['status', moderationCaseStatusSchema.options],
    ['slaState', moderationCaseSlaStateSchema.options],
    ['reason', communityReportReasonSchema.options],
    ['category', communityModerationReasonCategorySchema.options],
    ['actor', moderationActorKindSchema.options],
    ['mediaReason', moderationMediaUnavailableReasonSchema.options],
    ['alias', moderationAliasStateSchema.options.filter((state) => state !== 'alias')],
    ['state', [...MODERATION_FAILURE_REASONS]],
  ]

  it.each(enums)(
    '6.10-I18N-WEB-06 labels every member of the %s set in every locale',
    (path, options) => {
      for (const locale of SUPPORTED_LOCALES) {
        const keys = childKeys(CATALOGS[locale], path)
        for (const option of options)
          expect(keys, `${locale} moderation.${path}.${option}`).toContain(option)
      }
    }
  )

  it('6.10-I18N-WEB-07 holds no label for a value the contract no longer has', () => {
    for (const [path, options] of enums) {
      const extras = childKeys(enUS as Catalog, path).filter(
        (key) => !options.includes(key)
      )
      // `state` also carries loading, retry, stale and the states that are not failures.
      const allowed =
        path === 'state'
          ? ['loading', 'retry', 'retrying', 'stale', 'signInLink', 'caseUnavailable']
          : path === 'category'
            ? ['unknown']
            : []
      expect(
        extras.filter((key) => !allowed.includes(key)),
        `moderation.${path}`
      ).toEqual([])
    }
  })

  it('6.10-I18N-WEB-08 exposes the same enum members in the committed OpenAPI document', () => {
    const document = JSON.parse(
      readFileSync(
        path.resolve(__dirname, '../../../../packages/api-client/docs/http.openapi.json'),
        'utf8'
      )
    ) as { components: { schemas: Record<string, unknown> } }
    const roots = ['ModerationCasesResponse', 'ModerationCaseDetailResponse'].map(
      (name) => document.components.schemas[name]
    )
    for (const root of roots) expect(root, 'moderation response schema').toBeDefined()

    const byProperty = new Map<string, string[][]>()
    const walk = (node: unknown) => {
      if (Array.isArray(node)) return node.forEach(walk)
      if (typeof node !== 'object' || node === null) return
      const record = node as Record<string, unknown>
      const properties = record.properties as Record<string, unknown> | undefined
      if (properties) {
        for (const [name, schema] of Object.entries(properties)) {
          const values = (schema as { enum?: string[] } | undefined)?.enum
          if (Array.isArray(values))
            byProperty.set(name, [...(byProperty.get(name) ?? []), values])
        }
      }
      Object.values(record).forEach(walk)
    }
    walk(roots)

    const documented = (name: string) => (byProperty.get(name) ?? []).map(sorted)
    expect(documented('slaState')).toContainEqual(
      sorted(moderationCaseSlaStateSchema.options)
    )
    expect(documented('risk')).toContainEqual(sorted(moderationCaseRiskSchema.options))
    expect(documented('status')).toContainEqual(
      sorted(moderationCaseStatusSchema.options)
    )
    expect(documented('source')).toContainEqual(
      sorted(moderationCaseSourceSchema.options)
    )
    expect(documented('actorKind')).toContainEqual(
      sorted(moderationActorKindSchema.options)
    )
    expect(documented('state')).toContainEqual(sorted(moderationAliasStateSchema.options))
    // `reason` appears on the reporter (a report reason) and on the unavailable media block.
    expect(documented('reason')).toContainEqual(
      sorted(communityReportReasonSchema.options)
    )
    expect(documented('reason')).toContainEqual(
      sorted(moderationMediaUnavailableReasonSchema.options)
    )
  })
})

describe('U-D-ENUM-COVERAGE: the 6.11 key set derives from the exported contract arrays', () => {
  const ACTIONS = moderationDecisionActionSchema.options
  const KINDS = moderationSanctionKindSchema.options
  const APPEAL = moderationAppealStatusSchema.options
  const STEPS = moderationAppealStepSchema.options
  /** Failures the client adds to the closed codes, because no body carried a code. */
  const CLIENT_FAILURES: readonly ModerationDecisionFailure[] = [
    'signed_out',
    'forbidden',
    'rate_limited',
    'offline',
    'unavailable',
  ]
  const FAILURES = [...moderationDecisionErrorCodeSchema.options, ...CLIENT_FAILURES]
  const capitalized = (kind: string) => `${kind[0]?.toUpperCase()}${kind.slice(1)}`
  const OUTCOMES = [
    ...ACTIONS.filter((action) => action !== 'ban'),
    ...KINDS.map((kind) => `ban${capitalized(kind)}`),
    ...moderationCacheInvalidationSchema.options.filter((value) => value !== 'completed'),
  ]
  const CONFIRMS = [
    ...ACTIONS.filter((action) => action === 'takedown'),
    ...KINDS.map((kind) => `ban_${kind}`),
  ]
  const closedSets: [string, readonly string[]][] = [
    ['decision.action', ACTIONS],
    ['decision.hint', ACTIONS],
    ['decision.outcome', OUTCOMES],
    ['decision.confirm', CONFIRMS],
    ['decision.detail', moderationDecisionDetailSchema.options],
    ['decision.error', FAILURES],
    ['standing.kind', KINDS],
    ['standing.appeal', APPEAL],
    ['standing.step', STEPS],
    ['standing.outcome', STEPS],
    ['alias', moderationAliasStateSchema.options.filter((state) => state !== 'alias')],
    ['actor', moderationActorKindSchema.options],
  ]

  it.each(closedSets)(
    'moderation.%s holds exactly the contract set in every locale',
    (keyPath, options) => {
      for (const locale of SUPPORTED_LOCALES)
        expect(childKeys(CATALOGS[locale], keyPath), locale).toEqual(sorted(options))
    }
  )

  it('every retryable failure is a failure the catalog labels', () => {
    for (const failure of RETRYABLE_DECISION_FAILURES) expect(FAILURES).toContain(failure)
  })

  it('moderation.action labels every action a prior action row can hold', () => {
    const appealRows = STEPS.map((step) => `appeal_${step}`)
    for (const locale of SUPPORTED_LOCALES) {
      const keys = childKeys(CATALOGS[locale], 'action')
      for (const key of [...ACTIONS, ...appealRows, 'unknown'])
        expect(keys, `${locale} moderation.action.${key}`).toContain(key)
    }
  })

  it('community.banned.appeal holds exactly the contract set in every locale', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const banned = bannedTree(CATALOGS[locale])
      expect(Object.keys(banned.appeal as object).sort(), locale).toEqual(sorted(APPEAL))
    }
  })
})

describe('U-WEB-D-LOCALES: decision, standing and banned copy in ten locales', () => {
  const sub = (catalog: Catalog, name: string) =>
    new Map(
      [...flatten(tree(catalog)).entries()].filter(([key]) => key.startsWith(`${name}.`))
    )
  const groups: [string, (catalog: Catalog) => Map<string, string>][] = [
    ['moderation.decision', (catalog) => sub(catalog, 'decision')],
    ['moderation.standing', (catalog) => sub(catalog, 'standing')],
    ['community.banned', (catalog) => flatten(bannedTree(catalog))],
  ]
  it.each(groups)('%s has the same keys and placeholders everywhere', (_name, read) => {
    const english = read(enUS as Catalog)
    expect(english.size).toBeGreaterThan(0)
    for (const locale of SUPPORTED_LOCALES) {
      const catalog = read(CATALOGS[locale])
      expect([...catalog.keys()].sort(), locale).toEqual([...english.keys()].sort())
      for (const [key, value] of catalog) {
        expect(value.trim().length, `${locale}.${key}`).toBeGreaterThan(0)
        expect(placeholders(value), `${locale}.${key}`).toEqual(
          placeholders(english.get(key) ?? '')
        )
      }
    }
  })

  it.each(groups)('%s holds no English-only value outside English', (_name, read) => {
    const english = read(enUS as Catalog)
    for (const locale of SUPPORTED_LOCALES) {
      if (locale === 'en-US' || locale === 'en-CA') continue
      const same: string[] = []
      for (const [key, value] of read(CATALOGS[locale]))
        if (value === english.get(key) && value.trim().split(/\s+/).length > 1)
          same.push(key)
      expect(same, `${locale} values still in English`).toEqual([])
    }
  })

  it('community.banned keeps the support directive and names no reason or moderator', () => {
    const english = flatten(bannedTree(enUS as Catalog))
    expect(english.get('appeal.not_requested')).toContain('support')
    for (const value of english.values())
      expect(value).not.toMatch(/moderator|operator|reason/i)
  })
})

describe('U-WEB-LOCALES: the SLA page copy in ten locales', () => {
  it.each([
    ['sla.alertKind', moderationSlaAlertKinds],
    ['sla.delivery', moderationSlaDeliveryStates],
    ['sla.failure', moderationSlaFailureCodes],
  ] as const)('%s labels exactly the contract set in every locale', (path, members) => {
    for (const locale of SUPPORTED_LOCALES)
      expect(childKeys(CATALOGS[locale], path), `${locale} ${path}`).toEqual(
        sorted(members)
      )
  })

  it('holds no moderation.sla value equal to its key', () => {
    for (const locale of SUPPORTED_LOCALES)
      for (const [key, value] of flatten(tree(CATALOGS[locale])))
        if (key.startsWith('sla.'))
          expect(value, `${locale} ${key}`).not.toBe(key.split('.').at(-1))
  })

  it('tells the moderator in every locale that a stale monitor sends nothing', () => {
    const stale = flatten(tree(enUS as Catalog)).get('sla.monitorStale')
    expect(stale).toContain('{{time}}')
    for (const locale of SUPPORTED_LOCALES)
      expect(
        placeholders(flatten(tree(CATALOGS[locale])).get('sla.monitorStale') ?? ''),
        locale
      ).toEqual(['time'])
  })
})
