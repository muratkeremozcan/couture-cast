import { resolveGuestPreviewLocale } from '../sample-wardrobe/format'
import type { GuestPreviewLocale } from '../sample-wardrobe/strings'
import { garmentPhotoBatchStrings } from './garment-photo-batch-strings'

const en = {
  choose: 'Add from flat-lay photo',
  review: 'Review pieces',
  remove: 'Remove',
  edit: 'Edit tags',
  piece: 'Piece',
  unset: 'Not set',
  scanning: 'Checking photo…',
  saving: 'Saving pieces…',
  retry: 'Try again',
  person: 'Choose a photo with only clothing laid flat.',
  uncertain:
    'Choose a JPEG, PNG, or WebP up to 4 MB with two to five pieces spaced apart on a plain surface.',
  unavailable: 'Could not check the photo. Choose it again to retry.',
  expired: 'This review expired. Choose the photo again.',
  saveFailed: 'Could not confirm the save.',
}

const es = {
  choose: 'Agregar prendas desde una foto plana',
  review: 'Revisar prendas',
  remove: 'Quitar',
  edit: 'Editar etiquetas',
  piece: 'Prenda',
  unset: 'Sin seleccionar',
  scanning: 'Revisando foto…',
  saving: 'Guardando prendas…',
  retry: 'Inténtalo de nuevo',
  person: 'Elige una foto que solo muestre ropa extendida.',
  uncertain:
    'Elige un JPEG, PNG o WebP de hasta 4 MB con dos a cinco prendas separadas sobre una superficie lisa.',
  unavailable: 'No se pudo revisar la foto. Vuelve a elegirla.',
  expired: 'La revisión caducó. Vuelve a elegir la foto.',
  saveFailed: 'No se pudo confirmar el guardado.',
}

const fr = {
  choose: 'Ajouter des vêtements photographiés à plat',
  review: 'Vérifier les pièces',
  remove: 'Retirer',
  edit: 'Modifier les étiquettes',
  piece: 'Pièce',
  unset: 'Non défini',
  scanning: 'Vérification de la photo…',
  saving: 'Enregistrement des pièces…',
  retry: 'Réessayer',
  person: 'Choisis une photo qui montre uniquement des vêtements posés à plat.',
  uncertain:
    'Choisis un JPEG, PNG ou WebP de 4 Mo maximum avec deux à cinq pièces espacées sur une surface unie.',
  unavailable: 'Impossible de vérifier la photo. Choisis-la à nouveau.',
  expired: 'La vérification a expiré. Choisis à nouveau la photo.',
  saveFailed: 'Impossible de confirmer l’enregistrement.',
}

const pt = {
  choose: 'Adicionar peças de uma foto em superfície plana',
  review: 'Rever peças',
  remove: 'Remover',
  edit: 'Editar etiquetas',
  piece: 'Peça',
  unset: 'Não definido',
  scanning: 'A verificar a foto…',
  saving: 'A guardar as peças…',
  retry: 'Tentar novamente',
  person: 'Escolhe uma foto com roupas estendidas sem pessoas.',
  uncertain:
    'Escolhe um JPEG, PNG ou WebP até 4 MB com duas a cinco peças separadas numa superfície lisa.',
  unavailable: 'Não foi possível verificar a foto. Escolhe-a novamente.',
  expired: 'A revisão expirou. Escolhe novamente a foto.',
  saveFailed: 'Não foi possível confirmar a gravação.',
}

const copy: Record<GuestPreviewLocale, typeof en> = {
  'en-US': en,
  'en-CA': en,
  'es-419': es,
  'fr-FR': fr,
  'fr-CA': fr,
  'pt-PT': pt,
  'pt-BR': {
    ...pt,
    review: 'Revisar peças',
    scanning: 'Verificando a foto…',
    saving: 'Salvando as peças…',
    person: 'Escolha uma foto com roupas estendidas sem pessoas.',
    uncertain:
      'Escolha um JPEG, PNG ou WebP de até 4 MB com duas a cinco peças separadas em uma superfície lisa.',
    unavailable: 'Não foi possível verificar a foto. Escolha a foto novamente.',
    expired: 'A revisão expirou. Escolha a foto novamente.',
    saveFailed: 'Não foi possível confirmar o salvamento.',
  },
  'de-DE': {
    choose: 'Kleidung aus einem Flatlay-Foto hinzufügen',
    review: 'Teile prüfen',
    remove: 'Entfernen',
    edit: 'Tags bearbeiten',
    piece: 'Teil',
    unset: 'Nicht ausgewählt',
    scanning: 'Foto wird geprüft…',
    saving: 'Teile werden gespeichert…',
    retry: 'Erneut versuchen',
    person: 'Wähle ein Foto, das nur flach ausgelegte Kleidung zeigt.',
    uncertain:
      'Wähle ein JPEG, PNG oder WebP bis 4 MB mit zwei bis fünf getrennt liegenden Teilen auf einer einfarbigen Fläche.',
    unavailable: 'Das Foto konnte nicht geprüft werden. Wähle es erneut aus.',
    expired: 'Die Prüfung ist abgelaufen. Wähle das Foto erneut aus.',
    saveFailed: 'Das Speichern konnte nicht bestätigt werden.',
  },
  'it-IT': {
    choose: 'Aggiungi capi da una foto dall’alto',
    review: 'Controlla i capi',
    remove: 'Rimuovi',
    edit: 'Modifica i tag',
    piece: 'Capo',
    unset: 'Non impostato',
    scanning: 'Verifica della foto…',
    saving: 'Salvataggio dei capi…',
    retry: 'Riprova',
    person: 'Scegli una foto con solo abiti distesi su una superficie.',
    uncertain:
      'Scegli un JPEG, PNG o WebP fino a 4 MB con due a cinque capi distanziati su uno sfondo uniforme.',
    unavailable: 'Impossibile verificare la foto. Selezionala di nuovo.',
    expired: 'La verifica è scaduta. Seleziona di nuovo la foto.',
    saveFailed: 'Impossibile confermare il salvataggio.',
  },
  'tr-TR': {
    choose: 'Düz zemindeki fotoğraftan kıyafet ekle',
    review: 'Parçaları incele',
    remove: 'Kaldır',
    edit: 'Etiketleri düzenle',
    piece: 'Parça',
    unset: 'Seçilmedi',
    scanning: 'Fotoğraf kontrol ediliyor…',
    saving: 'Parçalar kaydediliyor…',
    retry: 'Tekrar dene',
    person: 'Yalnızca düz zemine serilmiş kıyafetlerin olduğu bir fotoğraf seç.',
    uncertain:
      'Düz renkte bir zemine aralıklı yerleştirilmiş iki ila beş parça içeren, en fazla 4 MB boyutunda JPEG, PNG veya WebP seç.',
    unavailable: 'Fotoğraf kontrol edilemedi. Yeniden seç.',
    expired: 'İnceleme süresi doldu. Fotoğrafı yeniden seç.',
    saveFailed: 'Kayıt onaylanamadı.',
  },
}

export function flatLayStrings(locale: string | undefined) {
  return {
    ...copy[resolveGuestPreviewLocale(locale)],
    add: garmentPhotoBatchStrings(locale).add,
  }
}
