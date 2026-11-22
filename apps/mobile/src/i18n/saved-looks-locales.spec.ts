// Learning path Step 60: Saved looks follow the account.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-60-saved-looks-follow-the-account
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
  'title',
  'count',
  'empty',
  'reopen',
  'remove',
  'missingPiece',
  'missingPieceDetail',
  'needsReview',
  'needsReviewDetail',
  'photoUnavailable',
  'loadFailed',
  'retry',
  'detailTitle',
  'sourceStylePiece',
  'sourceHomeSample',
  'slotOrderLabel',
  'close',
  'showList',
  'hideList',
] as const

const catalogs = [
  { locale: 'de-DE', mobile: mobileDeDe.savedLooks, web: webDeDe.savedLooks },
  { locale: 'en-CA', mobile: mobileEnCa.savedLooks, web: webEnCa.savedLooks },
  { locale: 'en-US', mobile: mobileEnUs.savedLooks, web: webEnUs.savedLooks },
  { locale: 'es-419', mobile: mobileEs419.savedLooks, web: webEs419.savedLooks },
  { locale: 'fr-CA', mobile: mobileFrCa.savedLooks, web: webFrCa.savedLooks },
  { locale: 'fr-FR', mobile: mobileFrFr.savedLooks, web: webFrFr.savedLooks },
  { locale: 'it-IT', mobile: mobileItIt.savedLooks, web: webItIt.savedLooks },
  { locale: 'pt-BR', mobile: mobilePtBr.savedLooks, web: webPtBr.savedLooks },
  { locale: 'pt-PT', mobile: mobilePtPt.savedLooks, web: webPtPt.savedLooks },
  { locale: 'tr-TR', mobile: mobileTrTr.savedLooks, web: webTrTr.savedLooks },
] as const

const baseline = catalogs.find((item) => item.locale === 'en-US')!

describe('saved-looks catalog parity (mobile)', () => {
  it('covers all 10 supported locales', () => {
    expect(catalogs).toHaveLength(10)
  })

  it.each(catalogs)(
    '$locale matches web and provides non-empty localized copy for all savedLooks keys',
    ({ locale, mobile, web }) => {
      const mobileMap = mobile as Record<string, string>
      const webMap = web as Record<string, string>
      expect(Object.keys(mobileMap).sort()).toEqual([...REQUIRED_KEYS].sort())
      expect(mobileMap).toEqual(webMap)

      for (const key of REQUIRED_KEYS) {
        expect(mobileMap[key]!.trim().length).toBeGreaterThan(0)
        expect(mobileMap[key]).not.toContain('savedLooks.')
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
})
