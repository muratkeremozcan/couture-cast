import { resolveGuestPreviewLocale } from './format'
import type { GuestPreviewLocale } from './strings'

type MemberLookbookStrings = {
  pin: string
  unpin: string
  reset: string
}

const labels: Record<GuestPreviewLocale, MemberLookbookStrings> = {
  'en-US': { pin: 'Pin', unpin: 'Unpin', reset: 'Reset outfit' },
  'en-CA': { pin: 'Pin', unpin: 'Unpin', reset: 'Reset outfit' },
  'de-DE': { pin: 'Anheften', unpin: 'Lösen', reset: 'Outfit zurücksetzen' },
  'es-419': { pin: 'Fijar', unpin: 'Desfijar', reset: 'Restablecer conjunto' },
  'fr-CA': { pin: 'Épingler', unpin: 'Détacher', reset: 'Réinitialiser la tenue' },
  'fr-FR': { pin: 'Épingler', unpin: 'Détacher', reset: 'Réinitialiser la tenue' },
  'it-IT': { pin: 'Fissa', unpin: 'Sblocca', reset: 'Ripristina outfit' },
  'pt-BR': { pin: 'Fixar', unpin: 'Desafixar', reset: 'Redefinir look' },
  'pt-PT': { pin: 'Fixar', unpin: 'Desafixar', reset: 'Repor conjunto' },
  'tr-TR': { pin: 'Sabitle', unpin: 'Sabitlemeyi kaldır', reset: 'Kombini sıfırla' },
}

export function getMemberLookbookStrings(locale: string | undefined) {
  return labels[resolveGuestPreviewLocale(locale)]
}
