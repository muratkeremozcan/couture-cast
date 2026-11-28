import { resolveGuestPreviewLocale } from './format'
import type { GuestPreviewLocale } from './strings'

type MemberLookbookStrings = {
  pin: string
  reset: string
}

const labels: Record<GuestPreviewLocale, MemberLookbookStrings> = {
  'en-US': { pin: 'Pin', reset: 'Reset outfit' },
  'en-CA': { pin: 'Pin', reset: 'Reset outfit' },
  'de-DE': { pin: 'Anheften', reset: 'Outfit zurücksetzen' },
  'es-419': { pin: 'Fijar', reset: 'Restablecer conjunto' },
  'fr-CA': { pin: 'Épingler', reset: 'Réinitialiser la tenue' },
  'fr-FR': { pin: 'Épingler', reset: 'Réinitialiser la tenue' },
  'it-IT': { pin: 'Fissa', reset: 'Ripristina outfit' },
  'pt-BR': { pin: 'Fixar', reset: 'Redefinir look' },
  'pt-PT': { pin: 'Fixar', reset: 'Repor conjunto' },
  'tr-TR': { pin: 'Sabitle', reset: 'Kombini sıfırla' },
}

export function getMemberLookbookStrings(locale: string | undefined) {
  return labels[resolveGuestPreviewLocale(locale)]
}
