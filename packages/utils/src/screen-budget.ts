// Story CC-7.10 D3 to D5 owner: the screen budget limits, ratchet and verdict.
// Learning path Step 67: Screen budget guard.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-67-screen-budget-guard
/**
 * Story CC-7.10: one limits file (`screen-budget.json`) and one verdict for web and native.
 *
 * `measureScreenBudget` (`screen-budget-measure.ts`) reads a rendered screen; the home actions
 * probe adds the controls whose only effect is analytics. `evaluateScreenBudget` compares that
 * against the limits (the epic AC values) and the `known` ratchet: a violation absent from
 * `known`, a value above or below its known value, a new or vanished element of a per-element
 * rule, or a known entry that no longer reproduces each fails, naming the platform, screen,
 * fixture, rule, value and elements. `scripts/check-screen-budget-decisions.mjs` ties every
 * raised limit and every raised or added `known` entry to a recorded decision's rule, scope
 * and ceiling.
 */
import budgetFile from './screen-budget.json'
import {
  boxShadowFor,
  colorRoles,
  elevation,
  SHADOW_COLOR,
  withAlpha,
  type ColorScheme,
} from './design-tokens'
import type {
  ScreenBudgetElement,
  ScreenBudgetMeasureConfig,
  ScreenBudgetMeasurement,
  ScreenBudgetParagraph,
} from './screen-budget-measure'

export const SCREEN_BUDGET_RULES = [
  'targets-above-fold',
  'primary-buttons',
  'chip-rows',
  'nested-cards',
  'paragraph-lines',
  'today-height',
  'closet-chrome',
  'analytics-only',
] as const
export type ScreenBudgetRule = (typeof SCREEN_BUDGET_RULES)[number]

/**
 * P7: these rules list element keys in a known entry, so fixing one element and adding another
 * at the same count still fails. Every other rule matches its known value exactly. A
 * `paragraph-lines` entry lists each paragraph with its measured line count (review #8), so a
 * known paragraph that grows under the same key fails too.
 */
export const SCREEN_BUDGET_PER_ELEMENT_RULES = [
  'nested-cards',
  'paragraph-lines',
  'analytics-only',
] as const satisfies readonly ScreenBudgetRule[]

/** The Epic 7 stories that own the removal of a known violation (D5). */
export const SCREEN_BUDGET_OWNING_STORIES = [
  '7.11',
  '7.13',
  '7.15',
  '7.16',
  '7.17',
] as const

export type ScreenBudgetPlatform = 'web' | 'native'
export type ScreenBudgetScreen = 'today' | 'closet' | 'community' | 'profile'
export type ScreenBudgetFixture = 'empty' | 'populated' | 'guardian-pending'
export type ScreenBudgetLimits = Readonly<Record<ScreenBudgetRule, number>>

/** A known paragraph over the line limit and the line count CI measured for it. */
export interface ScreenBudgetKnownParagraph {
  readonly key: string
  readonly lines: number
}

export interface ScreenBudgetKnownViolation {
  readonly platform: ScreenBudgetPlatform
  readonly screen: ScreenBudgetScreen
  readonly fixture: ScreenBudgetFixture
  readonly rule: ScreenBudgetRule
  /** The measured value: a count, or px for `today-height` and `closet-chrome`. */
  readonly value: number
  /**
   * Per-element rules only: the offending element keys (P7). `paragraph-lines` lists
   * `{ key, lines }` objects; `nested-cards` and `analytics-only` list the keys.
   */
  readonly elements?: readonly string[] | readonly ScreenBudgetKnownParagraph[]
  /** The story that removes it: one of `SCREEN_BUDGET_OWNING_STORIES`. */
  readonly story: string
  /** The decision id recorded under `## Screen budget decisions` in `decidedIn`'s spec. */
  readonly decision: string
  /** The story whose spec records `decision`, such as `7.10`. */
  readonly decidedIn: string
}

export interface ScreenBudgetLimitDecision {
  readonly limit: ScreenBudgetRule
  /** The highest value the decision allows. */
  readonly value: number
  readonly decision: string
  readonly decidedIn: string
}

export interface ScreenBudgetAnalyticsRequest {
  /** Only a request to the page's own origin matches. */
  readonly sameOrigin?: boolean
  /** A host glob: `*` matches any run of characters except `/`. */
  readonly host?: string
  /** A path glob: `**` matches anything, `*` anything but `/`. */
  readonly path?: string
}

export interface ScreenBudgetPlatformSelectors {
  /** Null reads the document scroll height. */
  readonly todayHeight: string | null
  readonly closetAnchors: readonly string[]
}

export interface ScreenBudgetFile {
  readonly description: string
  readonly limits: ScreenBudgetLimits
  readonly limitDecisions: readonly ScreenBudgetLimitDecision[]
  readonly measure: {
    readonly viewport: { readonly width: number; readonly height: number }
    readonly minCardSizePx: number
  }
  readonly platforms: readonly ScreenBudgetPlatform[]
  readonly screens: readonly ScreenBudgetScreen[]
  readonly fixtures: readonly ScreenBudgetFixture[]
  readonly tabBarSelectors: Readonly<Record<ScreenBudgetPlatform, readonly string[]>>
  readonly tileSelectors: Readonly<Record<ScreenBudgetPlatform, readonly string[]>>
  readonly selectors: Readonly<
    Record<ScreenBudgetPlatform, ScreenBudgetPlatformSelectors>
  >
  readonly analyticsRequests: readonly ScreenBudgetAnalyticsRequest[]
  readonly known: readonly ScreenBudgetKnownViolation[]
}

/** The checked-in budget. */
export const screenBudget = budgetFile as ScreenBudgetFile

/** What one audit measured: the layout measure, the home actions probe, or both. */
export interface ScreenBudgetAuditMeasurement
  extends Partial<Omit<ScreenBudgetMeasurement, 'stats' | 'errors'>> {
  /** Controls whose only effect was an analytics request (D4), from the home actions probe. */
  readonly analyticsOnly?: readonly ScreenBudgetElement[]
  readonly errors?: readonly string[]
}

export interface ScreenBudgetAudit {
  readonly platform: ScreenBudgetPlatform
  readonly screen: ScreenBudgetScreen
  readonly fixture: ScreenBudgetFixture
  readonly measurement: ScreenBudgetAuditMeasurement
}

export type ScreenBudgetFailureKind =
  | 'new'
  | 'worse'
  | 'lower'
  | 'fixed'
  | 'new-element'
  | 'missing-element'
  | 'lines'
  | 'error'

export interface ScreenBudgetFailure {
  readonly rule: ScreenBudgetRule | 'measure'
  readonly kind: ScreenBudgetFailureKind
  readonly message: string
}

export interface ScreenBudgetMeasure {
  readonly rule: ScreenBudgetRule
  readonly value: number
  readonly limit: number
  /** Over its limit, known or not. */
  readonly violation: boolean
  /** The element keys behind the value, with their detail where the measure gave one. */
  readonly elements: readonly string[]
}

export interface ScreenBudgetEvaluation {
  readonly platform: ScreenBudgetPlatform
  readonly screen: ScreenBudgetScreen
  readonly fixture: ScreenBudgetFixture
  /** Every rule this audit measured, in `SCREEN_BUDGET_RULES` order (AC1). */
  readonly measures: readonly ScreenBudgetMeasure[]
  readonly failures: readonly ScreenBudgetFailure[]
  readonly passed: boolean
}

const PX_RULES: readonly ScreenBudgetRule[] = ['today-height', 'closet-chrome']

function isPerElement(rule: ScreenBudgetRule): boolean {
  return (SCREEN_BUDGET_PER_ELEMENT_RULES as readonly ScreenBudgetRule[]).includes(rule)
}

function label(element: ScreenBudgetElement): string {
  return element.detail ? `${element.key} (${element.detail})` : element.key
}

/** The element keys a known entry lists, whatever its rule's element shape. */
export function screenBudgetKnownKeys(entry: ScreenBudgetKnownViolation): string[] {
  return (entry.elements ?? []).map((element: string | ScreenBudgetKnownParagraph) =>
    typeof element === 'string' ? element : element.key
  )
}

interface RuleReading {
  readonly value: number
  readonly violation: boolean
  /** The keys a per-element known entry lists. */
  readonly keys: readonly string[]
  readonly elements: readonly string[]
  /** `paragraph-lines` only: the line count of each paragraph over the limit, by position. */
  readonly lines?: readonly number[]
}

function countReading(
  elements: readonly ScreenBudgetElement[],
  limit: number
): RuleReading {
  return {
    value: elements.length,
    violation: elements.length > limit,
    keys: elements.map((element) => element.key),
    elements: elements.map(label),
  }
}

/** The measurement field behind each counted rule. */
const COUNT_FIELDS = {
  'targets-above-fold': 'targetsAboveFold',
  'primary-buttons': 'primaryButtons',
  'chip-rows': 'chipRows',
  'nested-cards': 'nestedCards',
  'analytics-only': 'analyticsOnly',
} as const satisfies Partial<Record<ScreenBudgetRule, keyof ScreenBudgetAuditMeasurement>>

function read(
  rule: ScreenBudgetRule,
  measurement: ScreenBudgetAuditMeasurement,
  limit: number
): RuleReading | null {
  if (rule === 'paragraph-lines') {
    if (!measurement.paragraphs) return null
    // The value is the number of paragraphs over the line limit; each is listed by key.
    const over = measurement.paragraphs.filter(
      (paragraph: ScreenBudgetParagraph) => paragraph.lines > limit
    )
    return { ...countReading(over, 0), lines: over.map((paragraph) => paragraph.lines) }
  }
  if (rule === 'today-height' || rule === 'closet-chrome') {
    const [value, element] =
      rule === 'today-height'
        ? [measurement.todayHeight, measurement.todayHeightElement]
        : [measurement.closetChrome, measurement.closetChromeElement]
    if (value === undefined) return null
    // Review #12: a pixel failure names what was measured (the document or the element).
    return {
      value,
      violation: value > limit,
      keys: [],
      elements: element ? [label(element)] : [],
    }
  }
  const elements = measurement[COUNT_FIELDS[rule]]
  return elements ? countReading(elements, limit) : null
}

/** Keys in `a` beyond those in `b`, counting repeats. */
function extraKeys(a: readonly string[], b: readonly string[]): string[] {
  const remaining = new Map<string, number>()
  for (const key of b) remaining.set(key, (remaining.get(key) ?? 0) + 1)
  const extra: string[] = []
  for (const key of a) {
    const count = remaining.get(key) ?? 0
    if (count > 0) remaining.set(key, count - 1)
    else extra.push(key)
  }
  return extra
}

function unit(rule: ScreenBudgetRule): string {
  return PX_RULES.includes(rule) ? ' px' : ''
}

/** Fails `reading` of `rule` against its limit and its known entry, if any (D5, P7). */
function judge(
  rule: ScreenBudgetRule,
  limit: number,
  reading: RuleReading,
  entry: ScreenBudgetKnownViolation | undefined,
  fail: (kind: ScreenBudgetFailureKind, message: string) => void
): void {
  const px = unit(rule)
  const shown = reading.elements.length ? `: ${reading.elements.join(', ')}` : ''
  const measured =
    rule === 'paragraph-lines'
      ? `${reading.value} paragraph(s) over ${limit} lines`
      : `${reading.value}${px} > ${limit}${px}`
  if (!entry) {
    if (reading.violation) fail('new', `${measured}${shown}`)
    return
  }
  if (!reading.violation) {
    fail(
      'fixed',
      `known ${entry.value}${px} (story ${entry.story}) no longer reproduces ` +
        `(measured ${reading.value}${px}, limit ${limit}${px}): delete it from known`
    )
    return
  }
  if (isPerElement(rule)) {
    const knownKeys = screenBudgetKnownKeys(entry)
    const added = extraKeys(reading.keys, knownKeys)
    const gone = extraKeys(knownKeys, reading.keys)
    if (added.length)
      fail(
        'new-element',
        `${measured}; not in known (story ${entry.story}): ${added.join(', ')}`
      )
    if (gone.length)
      fail(
        'missing-element',
        `known element(s) no longer reproduce: ${gone.join(', ')}; remove them from known` +
          ` and lower the known value to ${reading.value}${shown}`
      )
    if (rule === 'paragraph-lines') judgeParagraphLines(reading, entry, fail)
    return
  }
  if (reading.value > entry.value)
    fail('worse', `${measured}, above known ${entry.value}${px}${shown}`)
  else if (reading.value < entry.value)
    fail(
      'lower',
      `${measured}, below known ${entry.value}${px}: lower the known value to ` +
        `${reading.value}${shown}`
    )
}

/**
 * Review #8: each known paragraph that still reproduces under its key must keep its measured
 * line count. Repeats of one key pair longest with longest.
 */
function judgeParagraphLines(
  reading: RuleReading,
  entry: ScreenBudgetKnownViolation,
  fail: (kind: ScreenBudgetFailureKind, message: string) => void
): void {
  // A function declaration, not a generic arrow: the mobile Vite transform reads `.ts` as TSX,
  // where `<T>(...) =>` parses as JSX and fails every suite that imports @couture/utils
  // (CI fe6fc7c1, 205 mobile files).
  function byKey<T>(pairs: readonly (readonly [string, T])[]) {
    const groups = new Map<string, T[]>()
    for (const [key, value] of pairs) {
      const group = groups.get(key)
      if (group) group.push(value)
      else groups.set(key, [value])
    }
    return groups
  }
  const measured = byKey(
    reading.keys.map((key, index) => [key, reading.lines?.[index] ?? 0] as const)
  )
  const known = byKey(
    (entry.elements ?? []).map((element: string | ScreenBudgetKnownParagraph) =>
      typeof element === 'string'
        ? ([element, undefined] as const)
        : ([element.key, element.lines] as const)
    )
  )
  const descending = (a: number | undefined, b: number | undefined) =>
    (b ?? -1) - (a ?? -1)
  for (const [key, counts] of measured) {
    const recorded = (known.get(key) ?? []).sort(descending)
    counts.sort(descending)
    counts.slice(0, recorded.length).forEach((lines, index) => {
      const before = recorded[index]
      if (before === undefined)
        fail(
          'lines',
          `known paragraph ${key} records no line count; measured ${lines} lines: ` +
            `record { "key": ${JSON.stringify(key)}, "lines": ${lines} } in known`
        )
      else if (lines > before)
        fail(
          'worse',
          `${key} has ${lines} lines, above known ${before} lines (story ${entry.story})`
        )
      else if (lines < before)
        fail(
          'lower',
          `${key} has ${lines} lines, below known ${before} lines: lower the known value ` +
            `to ${lines} lines`
        )
    })
  }
}

/**
 * The verdict for one audit (one platform, screen and fixture). Only the rules the audit
 * measured are judged, so the layout audit and the home actions probe of one screen each check
 * their own `known` entries.
 */
export function evaluateScreenBudget(
  audit: ScreenBudgetAudit,
  limits: ScreenBudgetLimits = screenBudget.limits,
  known: readonly ScreenBudgetKnownViolation[] = screenBudget.known
): ScreenBudgetEvaluation {
  const { platform, screen, fixture, measurement } = audit
  const where = `${platform} ${screen} (${fixture})`
  const measures: ScreenBudgetMeasure[] = []
  const failures: ScreenBudgetFailure[] = []

  for (const error of measurement.errors ?? [])
    failures.push({
      rule: 'measure',
      kind: 'error',
      message: `${where} measure: ${error}`,
    })

  for (const rule of SCREEN_BUDGET_RULES) {
    const limit = limits[rule]
    const reading = read(rule, measurement, limit)
    if (!reading) continue
    measures.push({
      rule,
      value: reading.value,
      limit,
      violation: reading.violation,
      elements: reading.elements,
    })
    const entry = known.find(
      (candidate) =>
        candidate.platform === platform &&
        candidate.screen === screen &&
        candidate.fixture === fixture &&
        candidate.rule === rule
    )
    const fail = (kind: ScreenBudgetFailureKind, message: string) =>
      failures.push({ rule, kind, message: `${where} ${rule}: ${message}` })
    judge(rule, limit, reading, entry, fail)
  }

  return { platform, screen, fixture, measures, failures, passed: failures.length === 0 }
}

/** One line per failure, for a test's assertion message. */
export function formatScreenBudgetFailures(evaluation: ScreenBudgetEvaluation): string {
  return evaluation.failures.map((failure) => failure.message).join('\n')
}

/**
 * The measure config for one platform and screen (D3, P4). Web resolves the tokens through the
 * live `--cc-*` variables the Tailwind plugin emits; native through the role values that
 * react-native-web paints, and the card shadow in the form react-native-web writes for
 * `elevationStyle('card')` (`shadowRadius` is half the blur).
 */
export function screenBudgetMeasureConfig(
  platform: ScreenBudgetPlatform,
  screen: ScreenBudgetScreen,
  options: { readonly budget?: ScreenBudgetFile; readonly scheme?: ColorScheme } = {}
): ScreenBudgetMeasureConfig {
  const budget = options.budget ?? screenBudget
  const scheme = options.scheme ?? 'light'
  const selectors = budget.selectors[platform]
  const card = elevation.card
  const tokens =
    platform === 'web'
      ? {
          primary: 'rgb(var(--cc-primary))',
          card: 'rgb(var(--cc-card))',
          cardMuted: 'rgb(var(--cc-card-muted))',
          cardShadow: boxShadowFor('card'),
        }
      : {
          primary: colorRoles[scheme].primary,
          card: colorRoles[scheme].card,
          cardMuted: colorRoles[scheme].cardMuted,
          cardShadow: `0px ${card.offsetY}px ${card.blur / 2}px ${withAlpha(SHADOW_COLOR, card.opacity)}`,
        }
  return {
    viewport: budget.measure.viewport,
    minCardSizePx: budget.measure.minCardSizePx,
    tabBarSelectors: budget.tabBarSelectors[platform],
    tileSelectors: budget.tileSelectors[platform],
    tokens,
    ...(screen === 'today' ? { todayHeight: { selector: selectors.todayHeight } } : {}),
    ...(screen === 'closet'
      ? { closetChrome: { anchors: selectors.closetAnchors } }
      : {}),
  }
}

function globToRegExp(glob: string, separator: string): RegExp {
  let pattern = ''
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob.charAt(index)
    if (char === '*' && glob.charAt(index + 1) === '*') {
      pattern += '.*'
      index += 1
    } else if (char === '*') pattern += `[^${separator}]*`
    else pattern += char.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${pattern}$`, 'i')
}

/**
 * D4, P6: whether a request is analytics (PostHog capture, telemetry), which a control may
 * send without that counting as an effect. Anything the allow list does not match is an effect.
 */
export function isAnalyticsRequest(
  requestUrl: string,
  pageUrl: string,
  allowList: readonly ScreenBudgetAnalyticsRequest[] = screenBudget.analyticsRequests
): boolean {
  let request: URL
  let page: URL
  try {
    page = new URL(pageUrl)
    request = new URL(requestUrl, page)
  } catch {
    return false
  }
  return allowList.some(
    (entry) =>
      (!entry.sameOrigin || request.origin === page.origin) &&
      (!entry.host || globToRegExp(entry.host, '/').test(request.hostname)) &&
      (!entry.path || globToRegExp(entry.path, '/').test(request.pathname)) &&
      Boolean(entry.sameOrigin || entry.host || entry.path)
  )
}
