// Story 6.16: guest preview strings for the ten supported locales.
import { deDE } from './de-de'
import { enCA } from './en-ca'
import { enUS, type GuestPreviewStrings } from './en-us'
import { es419 } from './es-419'
import { frCA } from './fr-ca'
import { frFR } from './fr-fr'
import { itIT } from './it-it'
import { ptBR } from './pt-br'
import { ptPT } from './pt-pt'
import { trTR } from './tr-tr'

export type { GuestPreviewStrings }

export const GUEST_PREVIEW_LOCALES = [
  'en-US',
  'en-CA',
  'es-419',
  'fr-CA',
  'fr-FR',
  'tr-TR',
  'de-DE',
  'it-IT',
  'pt-BR',
  'pt-PT',
] as const
export type GuestPreviewLocale = (typeof GUEST_PREVIEW_LOCALES)[number]

export const GUEST_PREVIEW_STRINGS: Readonly<
  Record<GuestPreviewLocale, GuestPreviewStrings>
> = {
  'en-US': enUS,
  'en-CA': enCA,
  'es-419': es419,
  'fr-CA': frCA,
  'fr-FR': frFR,
  'tr-TR': trTR,
  'de-DE': deDE,
  'it-IT': itIT,
  'pt-BR': ptBR,
  'pt-PT': ptPT,
}
