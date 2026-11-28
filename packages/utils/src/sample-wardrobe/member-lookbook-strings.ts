import { resolveGuestPreviewLocale } from './format'
import type { GuestPreviewLocale } from './strings'

type MemberLookbookStrings = {
  pin: string
  reset: string
  newIdeas: string
}

const labels: Record<GuestPreviewLocale, MemberLookbookStrings> = {
  'en-US': { pin: 'Pin', reset: 'Reset outfit', newIdeas: 'New ideas ready' },
  'en-CA': { pin: 'Pin', reset: 'Reset outfit', newIdeas: 'New ideas ready' },
  'de-DE': { pin: 'Anheften', reset: 'Outfit zurücksetzen', newIdeas: 'Neue Ideen' },
  'es-419': { pin: 'Fijar', reset: 'Restablecer conjunto', newIdeas: 'Nuevas ideas' },
  'fr-CA': {
    pin: 'Épingler',
    reset: 'Réinitialiser la tenue',
    newIdeas: 'Nouvelles idées',
  },
  'fr-FR': {
    pin: 'Épingler',
    reset: 'Réinitialiser la tenue',
    newIdeas: 'Nouvelles idées',
  },
  'it-IT': { pin: 'Fissa', reset: 'Ripristina outfit', newIdeas: 'Nuove idee' },
  'pt-BR': { pin: 'Fixar', reset: 'Redefinir look', newIdeas: 'Novas ideias' },
  'pt-PT': { pin: 'Fixar', reset: 'Repor conjunto', newIdeas: 'Novas ideias' },
  'tr-TR': { pin: 'Sabitle', reset: 'Kombini sıfırla', newIdeas: 'Yeni fikirler' },
}

export function getMemberLookbookStrings(locale: string | undefined) {
  return labels[resolveGuestPreviewLocale(locale)]
}
