import { resolveGuestPreviewLocale } from './format'
import type { GuestPreviewLocale } from './strings'

const english = {
  preview: 'Garment preview',
  pickOne: 'Pick one',
  looksRight: 'Looks right',
}

const strings: Readonly<Record<GuestPreviewLocale, typeof english>> = {
  'en-US': english,
  'en-CA': english,
  'es-419': {
    preview: 'Vista previa de la prenda',
    pickOne: 'Elige una opción',
    looksRight: 'Se ve bien',
  },
  'fr-CA': {
    preview: 'Aperçu du vêtement',
    pickOne: 'Choisis une option',
    looksRight: 'Ça me va',
  },
  'fr-FR': {
    preview: 'Aperçu du vêtement',
    pickOne: 'Choisis une option',
    looksRight: 'Ça me va',
  },
  'tr-TR': {
    preview: 'Giysi önizlemesi',
    pickOne: 'Birini seç',
    looksRight: 'Doğru görünüyor',
  },
  'de-DE': {
    preview: 'Vorschau des Kleidungsstücks',
    pickOne: 'Wähle eine Option',
    looksRight: 'Sieht richtig aus',
  },
  'it-IT': {
    preview: 'Anteprima del capo',
    pickOne: 'Scegli un’opzione',
    looksRight: 'Va bene',
  },
  'pt-BR': {
    preview: 'Prévia da peça',
    pickOne: 'Escolha uma opção',
    looksRight: 'Está certo',
  },
  'pt-PT': {
    preview: 'Pré-visualização da peça',
    pickOne: 'Escolhe uma opção',
    looksRight: 'Está certo',
  },
}

export function garmentTaggingStrings(locale: string | undefined) {
  return strings[resolveGuestPreviewLocale(locale)]
}
