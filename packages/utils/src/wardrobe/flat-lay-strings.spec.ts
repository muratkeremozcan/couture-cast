// Learning path Step 86: Several garments from one flat-lay photo.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-86-several-garments-from-one-flat-lay-photo
import { describe, expect, it } from 'vitest'
import {
  GUEST_PREVIEW_LOCALES,
  type GuestPreviewLocale,
} from '../sample-wardrobe/strings'
import { flatLayStrings } from './flat-lay-strings'

const expected: Record<GuestPreviewLocale, [review: string, one: string, many: string]> =
  {
    'en-US': ['Review pieces', 'Add 1 piece', 'Add 3 pieces'],
    'en-CA': ['Review pieces', 'Add 1 piece', 'Add 3 pieces'],
    'es-419': ['Revisar prendas', 'Agregar 1 prenda', 'Agregar 3 prendas'],
    'fr-FR': ['Vérifier les pièces', 'Ajouter 1 pièce', 'Ajouter 3 pièces'],
    'fr-CA': ['Vérifier les pièces', 'Ajouter 1 pièce', 'Ajouter 3 pièces'],
    'pt-BR': ['Revisar peças', 'Adicionar 1 peça', 'Adicionar 3 peças'],
    'pt-PT': ['Rever peças', 'Adicionar 1 peça', 'Adicionar 3 peças'],
    'de-DE': ['Teile prüfen', '1 Teil hinzufügen', '3 Teile hinzufügen'],
    'it-IT': ['Controlla i capi', 'Aggiungi 1 capo', 'Aggiungi 3 capi'],
    'tr-TR': ['Parçaları incele', '1 parça ekle', '3 parça ekle'],
  }

describe('CC-7.29 flat-lay localization', () => {
  it.each(GUEST_PREVIEW_LOCALES)(
    '[P1] [7.29-REVIEW] localizes the review and confirmation in %s',
    (locale) => {
      const { add, ...copy } = flatLayStrings(locale)

      expect([copy.review, add(1), add(3)]).toEqual(expected[locale])
      expect(add(0)).toBe(expected[locale][2].replace('3', '0'))
      for (const label of Object.values(copy)) expect(label.trim()).not.toBe('')
    }
  )

  it.each([undefined, 'xx-ZZ'])(
    '[P1] [7.29-REVIEW] has English copy without a supported locale (%s)',
    (locale) => {
      const copy = flatLayStrings(locale)

      expect(copy.review).toBe('Review pieces')
      expect(copy.add(3)).toBe('Add 3 pieces')
    }
  )
})
