import { describe, expect, it } from 'vitest'
import client0 from '../../assets/locales/de-DE.json'
import render0 from '../../../api/src/modules/share-cards/assets/de-DE.json'
import other0 from '../../../web/src/i18n/locales/de-DE.json'
import client1 from '../../assets/locales/en-CA.json'
import render1 from '../../../api/src/modules/share-cards/assets/en-CA.json'
import other1 from '../../../web/src/i18n/locales/en-CA.json'
import client2 from '../../assets/locales/en-US.json'
import render2 from '../../../api/src/modules/share-cards/assets/en-US.json'
import other2 from '../../../web/src/i18n/locales/en-US.json'
import client3 from '../../assets/locales/es-419.json'
import render3 from '../../../api/src/modules/share-cards/assets/es-419.json'
import other3 from '../../../web/src/i18n/locales/es-419.json'
import client4 from '../../assets/locales/fr-CA.json'
import render4 from '../../../api/src/modules/share-cards/assets/fr-CA.json'
import other4 from '../../../web/src/i18n/locales/fr-CA.json'
import client5 from '../../assets/locales/fr-FR.json'
import render5 from '../../../api/src/modules/share-cards/assets/fr-FR.json'
import other5 from '../../../web/src/i18n/locales/fr-FR.json'
import client6 from '../../assets/locales/it-IT.json'
import render6 from '../../../api/src/modules/share-cards/assets/it-IT.json'
import other6 from '../../../web/src/i18n/locales/it-IT.json'
import client7 from '../../assets/locales/pt-BR.json'
import render7 from '../../../api/src/modules/share-cards/assets/pt-BR.json'
import other7 from '../../../web/src/i18n/locales/pt-BR.json'
import client8 from '../../assets/locales/pt-PT.json'
import render8 from '../../../api/src/modules/share-cards/assets/pt-PT.json'
import other8 from '../../../web/src/i18n/locales/pt-PT.json'
import client9 from '../../assets/locales/tr-TR.json'
import render9 from '../../../api/src/modules/share-cards/assets/tr-TR.json'
import other9 from '../../../web/src/i18n/locales/tr-TR.json'
const catalogs = [
  {
    locale: 'de-DE',
    sharesEnUsTitle: false,
    client: client0.shareCard,
    render: render0,
    other: other0.shareCard,
  },
  {
    locale: 'en-CA',
    sharesEnUsTitle: true,
    client: client1.shareCard,
    render: render1,
    other: other1.shareCard,
  },
  {
    locale: 'en-US',
    sharesEnUsTitle: true,
    client: client2.shareCard,
    render: render2,
    other: other2.shareCard,
  },
  {
    locale: 'es-419',
    sharesEnUsTitle: false,
    client: client3.shareCard,
    render: render3,
    other: other3.shareCard,
  },
  {
    locale: 'fr-CA',
    sharesEnUsTitle: false,
    client: client4.shareCard,
    render: render4,
    other: other4.shareCard,
  },
  {
    locale: 'fr-FR',
    sharesEnUsTitle: false,
    client: client5.shareCard,
    render: render5,
    other: other5.shareCard,
  },
  {
    locale: 'it-IT',
    sharesEnUsTitle: false,
    client: client6.shareCard,
    render: render6,
    other: other6.shareCard,
  },
  {
    locale: 'pt-BR',
    sharesEnUsTitle: false,
    client: client7.shareCard,
    render: render7,
    other: other7.shareCard,
  },
  {
    locale: 'pt-PT',
    sharesEnUsTitle: false,
    client: client8.shareCard,
    render: render8,
    other: other8.shareCard,
  },
  {
    locale: 'tr-TR',
    sharesEnUsTitle: false,
    client: client9.shareCard,
    render: render9,
    other: other9.shareCard,
  },
]
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
  it.each(catalogs)(
    'U-LOCALES: $locale has matching keys, placeholders, render words and surface wording',
    ({ client, render, other, sharesEnUsTitle }) => {
      const values = flatten(client)
      const baseline = flatten(catalogs.find((item) => item.locale === 'en-US')!.client)
      expect(Object.keys(values).sort()).toEqual(Object.keys(baseline).sort())
      expect(client).toEqual(other)
      expect(render.outfit).toBe(client.sourceOutfit)
      expect(render.community).toBe(client.sourceCommunity)
      expect(render.scenarios).toEqual(client.scenarios)
      expect(render.climateBands).toEqual(client.climateBands)
      for (const [key, text] of Object.entries(values)) {
        expect(text.trim().length).toBeGreaterThan(0)
        expect(text).not.toContain('shareCard.')
        expect(text.match(/{{[^}]+}}/g) ?? []).toEqual(
          baseline[key]!.match(/{{[^}]+}}/g) ?? []
        )
      }
      expect(
        client.title === catalogs.find((item) => item.locale === 'en-US')!.client.title
      ).toBe(sharesEnUsTitle)
    }
  )
})
