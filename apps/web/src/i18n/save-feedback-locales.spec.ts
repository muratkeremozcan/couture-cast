// Learning path Step 59: Shared save, undo and status feedback.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-59-shared-save-undo-and-status-feedback
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { supportedLocales } from '@couture/api-client/contracts/http'
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from './index'

type FeedbackCatalog = Record<string, string>

const REQUIRED_KEYS = [
  'save',
  'saving',
  'stillSaving',
  'saved',
  'failed',
  'retry',
  'undo',
  'view',
  'dismiss',
  'savedToLooks',
  'saveFailed',
  'offlineBanner',
  'offlineAction',
  'removed',
  'undone',
  'lookUpdated',
  'pieceSwapped',
  'close',
] as const

const BUTTON_LABEL_KEYS = [
  'save',
  'saving',
  'stillSaving',
  'saved',
  'failed',
  'retry',
  'undo',
  'view',
  'dismiss',
  'close',
] as const

const json = (relative: string) =>
  JSON.parse(fs.readFileSync(new URL(relative, import.meta.url), 'utf8')) as {
    feedback?: FeedbackCatalog
  }

const catalogs = SUPPORTED_LOCALES.map((locale) => ({
  locale,
  web: json(`./locales/${locale}.json`).feedback!,
  mobile: json(`../../../mobile/assets/locales/${locale}.json`).feedback!,
}))

const baseline = catalogs.find((item) => item.locale === DEFAULT_LOCALE)!

describe('save-feedback catalog parity (web)', () => {
  it('covers all 10 supported locales', () => {
    expect([...SUPPORTED_LOCALES].sort()).toEqual([...supportedLocales].sort())
    expect(catalogs).toHaveLength(10)
  })

  it.each(catalogs)(
    '$locale has every required feedback key matching web and mobile',
    ({ locale, web, mobile }) => {
      expect(web).toBeDefined()
      expect(mobile).toBeDefined()
      expect(Object.keys(web).sort()).toEqual([...REQUIRED_KEYS].sort())
      expect(web).toEqual(mobile)

      for (const key of REQUIRED_KEYS) {
        const value = web[key]
        expect(typeof value).toBe('string')
        expect(value!.trim().length).toBeGreaterThan(0)
        expect(value).not.toContain('feedback.')
      }

      if (!locale.startsWith('en-')) {
        for (const key of REQUIRED_KEYS) {
          expect(web[key], `${locale}.${key} should be translated`).not.toBe(
            baseline.web[key]
          )
        }
      }
    }
  )

  it('keeps English button labels concise (<= 3 words) and exact required copy', () => {
    for (const key of BUTTON_LABEL_KEYS) {
      const words = baseline.web[key]!.trim().split(/\s+/)
      expect(words.length, `en-US feedback.${key}`).toBeLessThanOrEqual(3)
    }
    expect(baseline.web.save).toBe('Save')
    expect(baseline.web.stillSaving).toBe('Still saving')
    expect(baseline.web.saved).toBe('Saved')
    expect(baseline.web.failed).toBe('Failed')
    expect(baseline.web.retry).toBe('Retry')
    expect(baseline.web.undo).toBe('Undo')
    expect(baseline.web.view).toBe('View')
    expect(baseline.web.saveFailed).toBe('Could not save. Try again.')
    expect(baseline.web.offlineBanner).toBe('You are offline')
    expect(baseline.web.offlineAction).toBe('You are offline. Save when you reconnect.')
    expect(baseline.web.removed).toBe('Removed')
  })
})
