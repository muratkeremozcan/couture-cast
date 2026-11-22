// Learning path Step 59: Shared save, undo and status feedback.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-59-shared-save-undo-and-status-feedback
import { describe, expect, it } from 'vitest'
import mobileDeDe from '../../assets/locales/de-DE.json'
import webDeDe from '../../../web/src/i18n/locales/de-DE.json'
import mobileEnCa from '../../assets/locales/en-CA.json'
import webEnCa from '../../../web/src/i18n/locales/en-CA.json'
import mobileEnUs from '../../assets/locales/en-US.json'
import webEnUs from '../../../web/src/i18n/locales/en-US.json'
import mobileEs419 from '../../assets/locales/es-419.json'
import webEs419 from '../../../web/src/i18n/locales/es-419.json'
import mobileFrCa from '../../assets/locales/fr-CA.json'
import webFrCa from '../../../web/src/i18n/locales/fr-CA.json'
import mobileFrFr from '../../assets/locales/fr-FR.json'
import webFrFr from '../../../web/src/i18n/locales/fr-FR.json'
import mobileItIt from '../../assets/locales/it-IT.json'
import webItIt from '../../../web/src/i18n/locales/it-IT.json'
import mobilePtBr from '../../assets/locales/pt-BR.json'
import webPtBr from '../../../web/src/i18n/locales/pt-BR.json'
import mobilePtPt from '../../assets/locales/pt-PT.json'
import webPtPt from '../../../web/src/i18n/locales/pt-PT.json'
import mobileTrTr from '../../assets/locales/tr-TR.json'
import webTrTr from '../../../web/src/i18n/locales/tr-TR.json'

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

const catalogs = [
  { locale: 'de-DE', mobile: mobileDeDe.feedback, web: webDeDe.feedback },
  { locale: 'en-CA', mobile: mobileEnCa.feedback, web: webEnCa.feedback },
  { locale: 'en-US', mobile: mobileEnUs.feedback, web: webEnUs.feedback },
  { locale: 'es-419', mobile: mobileEs419.feedback, web: webEs419.feedback },
  { locale: 'fr-CA', mobile: mobileFrCa.feedback, web: webFrCa.feedback },
  { locale: 'fr-FR', mobile: mobileFrFr.feedback, web: webFrFr.feedback },
  { locale: 'it-IT', mobile: mobileItIt.feedback, web: webItIt.feedback },
  { locale: 'pt-BR', mobile: mobilePtBr.feedback, web: webPtBr.feedback },
  { locale: 'pt-PT', mobile: mobilePtPt.feedback, web: webPtPt.feedback },
  { locale: 'tr-TR', mobile: mobileTrTr.feedback, web: webTrTr.feedback },
] as const

const baseline = catalogs.find((item) => item.locale === 'en-US')!

describe('save-feedback catalog parity (mobile)', () => {
  it('covers all 10 supported locales', () => {
    expect(catalogs).toHaveLength(10)
  })

  it.each(catalogs)(
    '$locale matches web and provides non-empty localized copy for all feedback keys',
    ({ locale, mobile, web }) => {
      const mobileMap = mobile as Record<string, string>
      const webMap = web as Record<string, string>
      expect(Object.keys(mobileMap).sort()).toEqual([...REQUIRED_KEYS].sort())
      expect(mobileMap).toEqual(webMap)

      for (const key of REQUIRED_KEYS) {
        expect(mobileMap[key]!.trim().length).toBeGreaterThan(0)
        expect(mobileMap[key]).not.toContain('feedback.')
      }

      if (!locale.startsWith('en-')) {
        const baselineMap = baseline.mobile as Record<string, string>
        for (const key of REQUIRED_KEYS) {
          expect(mobileMap[key], `${locale}.${key} should be translated`).not.toBe(
            baselineMap[key]
          )
        }
      }
    }
  )

  it('keeps English button labels concise (<= 3 words) and exact required copy', () => {
    const baselineMap = baseline.mobile as Record<string, string>
    for (const key of BUTTON_LABEL_KEYS) {
      const words = baselineMap[key]!.trim().split(/\s+/)
      expect(words.length, `en-US feedback.${key}`).toBeLessThanOrEqual(3)
    }
    expect(baselineMap.save).toBe('Save')
    expect(baselineMap.stillSaving).toBe('Still saving')
    expect(baselineMap.saved).toBe('Saved')
    expect(baselineMap.failed).toBe('Failed')
    expect(baselineMap.retry).toBe('Retry')
    expect(baselineMap.undo).toBe('Undo')
    expect(baselineMap.view).toBe('View')
    expect(baselineMap.saveFailed).toBe('Could not save. Try again.')
    expect(baselineMap.offlineBanner).toBe('You are offline')
    expect(baselineMap.offlineAction).toBe('You are offline. Save when you reconnect.')
    expect(baselineMap.removed).toBe('Removed')
  })
})
