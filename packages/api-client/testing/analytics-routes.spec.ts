import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ANALYTICS_EVENT_PROPERTIES,
  MOBILE_ANALYTICS_ROUTES,
  WEB_ANALYTICS_ROUTES,
  analyticsEventNames,
  templateAnalyticsRoute,
} from '../src'

const repoRoot = path.resolve(__dirname, '../../..')

function walk(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = path.join(directory, entry)
    return statSync(full).isDirectory() ? walk(full) : [full]
  })
}

/** Next.js routes: every folder holding a page, route groups left out. */
function webRoutesOnDisk() {
  const appDirectory = path.join(repoRoot, 'apps/web/src/app')
  return walk(appDirectory)
    .filter((file) => path.basename(file) === 'page.tsx')
    .map((file) => {
      const segments = path
        .relative(appDirectory, path.dirname(file))
        .split(path.sep)
        .filter((segment) => segment !== '' && !/^\(.*\)$/.test(segment))
      return `/${segments.join('/')}`
    })
    .sort()
}

/** Expo Router routes: every screen file, route groups and special files left out. */
function mobileRoutesOnDisk() {
  const appDirectory = path.join(repoRoot, 'apps/mobile/app')
  return walk(appDirectory)
    .filter((file) => /\.tsx?$/.test(file) && !/^[_+]/.test(path.basename(file)))
    .map((file) => {
      const segments = path
        .relative(appDirectory, file)
        .replace(/\.tsx?$/, '')
        .split(path.sep)
        .filter((segment) => !/^\(.*\)$/.test(segment) && segment !== 'index')
      return `/${segments.join('/')}`
    })
    .sort()
}

describe('analytics routes match the apps', () => {
  it('lists every web route, and only those', () => {
    expect([...WEB_ANALYTICS_ROUTES].sort()).toEqual(webRoutesOnDisk())
  })

  it('lists every mobile route, and only those', () => {
    expect([...MOBILE_ANALYTICS_ROUTES].sort()).toEqual(mobileRoutesOnDisk())
  })

  it('keeps static segments, sends :param for dynamic ones and /:unknown otherwise', () => {
    expect(templateAnalyticsRoute('/', 'web')).toBe('/')
    expect(templateAnalyticsRoute('/guardian/accept/?token=x#y', 'web')).toBe(
      '/guardian/accept'
    )
    expect(templateAnalyticsRoute('/moderation/cases/alice-smith', 'web')).toBe(
      '/moderation/cases/:param'
    )
    expect(
      templateAnalyticsRoute('/profile/alice-smith/reset/guardian-secret', 'web')
    ).toBe('/:unknown')
    expect(templateAnalyticsRoute('/guardian-accept', 'web')).toBe('/:unknown')
    expect(templateAnalyticsRoute('/guardian-accept', 'mobile')).toBe('/guardian-accept')
  })
})

/** Client source that can send analytics: no tests and no test utilities. */
function clientSources() {
  return ['apps/web/src', 'apps/mobile/app', 'apps/mobile/src', 'apps/mobile/components']
    .flatMap((directory) => walk(path.join(repoRoot, directory)))
    .filter(
      (file) =>
        /\.tsx?$/.test(file) &&
        !/\.(test|spec)\.tsx?$/.test(file) &&
        !file.includes(`${path.sep}test-utils${path.sep}`) &&
        !file.includes('.test-boundary.')
    )
    .map((file) => readFileSync(file, 'utf8'))
}

// The shared track* wrappers the clients call, and the event each one sends.
const trackedEvents: Record<string, string> = {
  trackRitualCreated: 'ritual_created',
  trackWardrobeUploadStarted: 'wardrobe_upload_started',
  trackAlertReceived: 'alert_received',
  trackAffiliateCtaShown: 'affiliate_cta_shown',
  trackPremiumSubscribeTapped: 'premium_subscribe_tapped',
  trackLocaleSwitched: 'locale_switched',
  trackShareCardShared: 'share_card_shared',
}

describe('analytics event allowlist covers every client event', () => {
  const sources = clientSources()
  const literal = (pattern: RegExp) =>
    new Set(sources.flatMap((source) => [...source.matchAll(pattern)].map((m) => m[1]!)))

  it('names every event a client captures by literal, data attribute or wrapper', () => {
    const allowed = new Set([
      ...analyticsEventNames('web'),
      ...analyticsEventNames('mobile'),
    ])
    const captured = literal(/\.capture\(\s*['"]([^'"]+)['"]/g)
    const attributes = literal(/data-ph-event="([^"]+)"/g)
    // Every track* wrapper a client imports from this package must be mapped above.
    const wrapped = new Set(
      sources.flatMap((source) =>
        [
          ...source.matchAll(
            /import\s*(?:type\s*)?{([^}]*)}\s*from\s*'@couture\/api-client'/g
          ),
        ]
          .flatMap((match) => match[1]!.split(','))
          .map((name) => name.trim())
          .filter((name) => /^track[A-Z]/.test(name))
      )
    )
    expect(wrapped.size).toBeGreaterThan(0)
    for (const name of wrapped) expect(trackedEvents, name).toHaveProperty(name)
    for (const event of [...captured, ...attributes, ...Object.values(trackedEvents)])
      expect(allowed, event).toContain(event)
    expect(captured.size).toBeGreaterThan(10)
  })

  it('has a rule for every property of every allowlisted event', () => {
    for (const [event, rules] of Object.entries(ANALYTICS_EVENT_PROPERTIES))
      for (const [key, rule] of Object.entries(rules))
        expect(typeof rule, `${event}.${key}`).toBe('function')
  })
})
