// Learning path Step 63: Garment detail and tag edit.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-63-garment-detail-and-tag-edit
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
  'back',
  'category',
  'material',
  'comfort',
  'noMaterial',
  'editTags',
  'done',
  'cancel',
  'noChanges',
  'conflict',
  'notAllowed',
  'undoFailed',
  'missing',
  'loading',
  'loadFailed',
] as const

const catalogs = [
  {
    locale: 'de-DE',
    mobile: mobileDeDe.wardrobe.detail,
    web: webDeDe.wardrobe.detail,
  },
  {
    locale: 'en-CA',
    mobile: mobileEnCa.wardrobe.detail,
    web: webEnCa.wardrobe.detail,
  },
  {
    locale: 'en-US',
    mobile: mobileEnUs.wardrobe.detail,
    web: webEnUs.wardrobe.detail,
  },
  {
    locale: 'es-419',
    mobile: mobileEs419.wardrobe.detail,
    web: webEs419.wardrobe.detail,
  },
  {
    locale: 'fr-CA',
    mobile: mobileFrCa.wardrobe.detail,
    web: webFrCa.wardrobe.detail,
  },
  {
    locale: 'fr-FR',
    mobile: mobileFrFr.wardrobe.detail,
    web: webFrFr.wardrobe.detail,
  },
  {
    locale: 'it-IT',
    mobile: mobileItIt.wardrobe.detail,
    web: webItIt.wardrobe.detail,
  },
  {
    locale: 'pt-BR',
    mobile: mobilePtBr.wardrobe.detail,
    web: webPtBr.wardrobe.detail,
  },
  {
    locale: 'pt-PT',
    mobile: mobilePtPt.wardrobe.detail,
    web: webPtPt.wardrobe.detail,
  },
  {
    locale: 'tr-TR',
    mobile: mobileTrTr.wardrobe.detail,
    web: webTrTr.wardrobe.detail,
  },
] as const

const baseline = catalogs.find((item) => item.locale === 'en-US')!

describe('wardrobe.detail catalog parity (mobile)', () => {
  it('covers all 10 supported locales', () => {
    expect(catalogs).toHaveLength(10)
  })

  it.each(catalogs)(
    '$locale matches web and has non-empty localized copy for every wardrobe.detail key',
    ({ locale, mobile, web }) => {
      const mobileMap = mobile as Record<string, string>
      const webMap = web as Record<string, string>
      expect(Object.keys(mobileMap).sort()).toEqual([...REQUIRED_KEYS].sort())
      expect(mobileMap).toEqual(webMap)

      for (const key of REQUIRED_KEYS) {
        expect(mobileMap[key]!.trim().length).toBeGreaterThan(0)
        expect(mobileMap[key]).not.toContain('wardrobe.detail.')
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
