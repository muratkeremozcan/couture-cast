// Story CC-7.5 D6: one alt text builder for member garment photos on web and native.
// "Blue top" in en-US; each locale keeps its own word order and adjective agreement.
import type { GarmentColorFamily } from '../garment-color'
import { formatPreviewString, resolveGuestPreviewLocale } from './format'
import type { GuestPreviewLocale } from './strings'
import type { SampleGarmentCategory } from './types'

/** Agreement slot of a color adjective: masculine, feminine, masculine plural, feminine plural. */
type Agreement = 0 | 1 | 2 | 3
/** One word for every agreement, or the four agreed forms in `Agreement` order. */
type ColorWord = string | readonly [string, string, string, string]

interface GarmentAltLocale {
  /** `{color}` and `{category}`; used only when both are known. */
  template: string
  untagged: string
  categories: Readonly<
    Record<SampleGarmentCategory, { noun: string; agreement: Agreement }>
  >
  colors: Readonly<Record<GarmentColorFamily, ColorWord>>
}

const m = 0 as const
const f = 1 as const
const mp = 2 as const
const fp = 3 as const

const EN_CATEGORIES = {
  top: { noun: 'top', agreement: m },
  bottom: { noun: 'bottom', agreement: m },
  outerwear: { noun: 'outer layer', agreement: m },
  dress: { noun: 'dress', agreement: m },
  shoes: { noun: 'shoes', agreement: m },
  accessory: { noun: 'accessory', agreement: m },
} as const

const EN_COLORS = {
  black: 'black',
  gray: 'gray',
  white: 'white',
  red: 'red',
  orange: 'orange',
  yellow: 'yellow',
  green: 'green',
  blue: 'blue',
  purple: 'purple',
  pink: 'pink',
  brown: 'brown',
} as const

const FR_CATEGORIES = {
  top: { noun: 'haut', agreement: m },
  bottom: { noun: 'bas', agreement: m },
  outerwear: { noun: 'veste', agreement: f },
  dress: { noun: 'robe', agreement: f },
  shoes: { noun: 'chaussures', agreement: fp },
  accessory: { noun: 'accessoire', agreement: m },
} as const

const FR_COLORS = {
  black: ['noir', 'noire', 'noirs', 'noires'],
  gray: ['gris', 'grise', 'gris', 'grises'],
  white: ['blanc', 'blanche', 'blancs', 'blanches'],
  red: ['rouge', 'rouge', 'rouges', 'rouges'],
  orange: 'orange',
  yellow: ['jaune', 'jaune', 'jaunes', 'jaunes'],
  green: ['vert', 'verte', 'verts', 'vertes'],
  blue: ['bleu', 'bleue', 'bleus', 'bleues'],
  purple: ['violet', 'violette', 'violets', 'violettes'],
  pink: ['rose', 'rose', 'roses', 'roses'],
  brown: 'marron',
} as const

const PT_CATEGORIES = {
  top: { noun: 'parte de cima', agreement: f },
  bottom: { noun: 'parte de baixo', agreement: f },
  outerwear: { noun: 'casaco', agreement: m },
  dress: { noun: 'vestido', agreement: m },
  shoes: { noun: 'sapatos', agreement: mp },
  accessory: { noun: 'acessório', agreement: m },
} as const

const PT_COLORS = {
  black: ['preto', 'preta', 'pretos', 'pretas'],
  gray: 'cinza',
  white: ['branco', 'branca', 'brancos', 'brancas'],
  red: ['vermelho', 'vermelha', 'vermelhos', 'vermelhas'],
  orange: 'laranja',
  yellow: ['amarelo', 'amarela', 'amarelos', 'amarelas'],
  green: ['verde', 'verde', 'verdes', 'verdes'],
  blue: ['azul', 'azul', 'azuis', 'azuis'],
  purple: ['roxo', 'roxa', 'roxos', 'roxas'],
  pink: 'rosa',
  brown: ['marrom', 'marrom', 'marrons', 'marrons'],
} as const

export const GARMENT_ALT_STRINGS: Readonly<Record<GuestPreviewLocale, GarmentAltLocale>> =
  {
    'en-US': {
      template: '{color} {category}',
      untagged: 'Untagged garment',
      categories: EN_CATEGORIES,
      colors: EN_COLORS,
    },
    'en-CA': {
      template: '{color} {category}',
      untagged: 'Untagged garment',
      categories: EN_CATEGORIES,
      colors: { ...EN_COLORS, gray: 'grey' },
    },
    'es-419': {
      template: '{category} {color}',
      untagged: 'Prenda sin etiquetas',
      categories: {
        top: { noun: 'prenda superior', agreement: f },
        bottom: { noun: 'prenda inferior', agreement: f },
        outerwear: { noun: 'abrigo', agreement: m },
        dress: { noun: 'vestido', agreement: m },
        shoes: { noun: 'zapatos', agreement: mp },
        accessory: { noun: 'accesorio', agreement: m },
      },
      colors: {
        black: ['negro', 'negra', 'negros', 'negras'],
        gray: ['gris', 'gris', 'grises', 'grises'],
        white: ['blanco', 'blanca', 'blancos', 'blancas'],
        red: ['rojo', 'roja', 'rojos', 'rojas'],
        orange: 'naranja',
        yellow: ['amarillo', 'amarilla', 'amarillos', 'amarillas'],
        green: ['verde', 'verde', 'verdes', 'verdes'],
        blue: ['azul', 'azul', 'azules', 'azules'],
        purple: ['morado', 'morada', 'morados', 'moradas'],
        pink: 'rosa',
        brown: ['marrón', 'marrón', 'marrones', 'marrones'],
      },
    },
    'fr-CA': {
      template: '{category} {color}',
      untagged: 'Vêtement sans étiquettes',
      categories: FR_CATEGORIES,
      colors: { ...FR_COLORS, brown: ['brun', 'brune', 'bruns', 'brunes'] },
    },
    'fr-FR': {
      template: '{category} {color}',
      untagged: 'Vêtement sans étiquettes',
      categories: FR_CATEGORIES,
      colors: FR_COLORS,
    },
    'tr-TR': {
      template: '{color} {category}',
      untagged: 'Etiketsiz kıyafet',
      categories: {
        top: { noun: 'üst', agreement: m },
        bottom: { noun: 'alt', agreement: m },
        outerwear: { noun: 'dış giyim', agreement: m },
        dress: { noun: 'elbise', agreement: m },
        shoes: { noun: 'ayakkabı', agreement: m },
        accessory: { noun: 'aksesuar', agreement: m },
      },
      colors: {
        black: 'siyah',
        gray: 'gri',
        white: 'beyaz',
        red: 'kırmızı',
        orange: 'turuncu',
        yellow: 'sarı',
        green: 'yeşil',
        blue: 'mavi',
        purple: 'mor',
        pink: 'pembe',
        brown: 'kahverengi',
      },
    },
    // German names the color as a noun ("Oberteil in Blau"), which needs no declension.
    'de-DE': {
      template: '{category} in {color}',
      untagged: 'Kleidungsstück ohne Tags',
      categories: {
        top: { noun: 'Oberteil', agreement: m },
        bottom: { noun: 'Hose', agreement: m },
        outerwear: { noun: 'Jacke', agreement: m },
        dress: { noun: 'Kleid', agreement: m },
        shoes: { noun: 'Schuhe', agreement: m },
        accessory: { noun: 'Accessoire', agreement: m },
      },
      colors: {
        black: 'Schwarz',
        gray: 'Grau',
        white: 'Weiß',
        red: 'Rot',
        orange: 'Orange',
        yellow: 'Gelb',
        green: 'Grün',
        blue: 'Blau',
        purple: 'Violett',
        pink: 'Rosa',
        brown: 'Braun',
      },
    },
    'it-IT': {
      template: '{category} {color}',
      untagged: 'Capo senza etichette',
      categories: {
        top: { noun: 'parte superiore', agreement: f },
        bottom: { noun: 'parte inferiore', agreement: f },
        outerwear: { noun: 'giacca', agreement: f },
        dress: { noun: 'abito', agreement: m },
        shoes: { noun: 'scarpe', agreement: fp },
        accessory: { noun: 'accessorio', agreement: m },
      },
      colors: {
        black: ['nero', 'nera', 'neri', 'nere'],
        gray: ['grigio', 'grigia', 'grigi', 'grigie'],
        white: ['bianco', 'bianca', 'bianchi', 'bianche'],
        red: ['rosso', 'rossa', 'rossi', 'rosse'],
        orange: ['arancione', 'arancione', 'arancioni', 'arancioni'],
        yellow: ['giallo', 'gialla', 'gialli', 'gialle'],
        green: ['verde', 'verde', 'verdi', 'verdi'],
        blue: 'blu',
        purple: 'viola',
        pink: 'rosa',
        brown: ['marrone', 'marrone', 'marroni', 'marroni'],
      },
    },
    'pt-BR': {
      template: '{category} {color}',
      untagged: 'Peça sem etiquetas',
      categories: PT_CATEGORIES,
      colors: PT_COLORS,
    },
    'pt-PT': {
      template: '{category} {color}',
      untagged: 'Peça sem etiquetas',
      categories: PT_CATEGORIES,
      colors: {
        ...PT_COLORS,
        gray: ['cinzento', 'cinzenta', 'cinzentos', 'cinzentas'],
        brown: ['castanho', 'castanha', 'castanhos', 'castanhas'],
      },
    },
  }

export interface GarmentAltInput {
  colorFamily?: GarmentColorFamily | null
  category?: SampleGarmentCategory | null
}

function capitalizeFirst(text: string, locale: string): string {
  const first = text.charAt(0)
  return first ? first.toLocaleUpperCase(locale) + text.slice(1) : text
}

/** The singular, capitalized noun of one garment's category ("Top", "Outer layer"). */
export function formatGarmentCategory(
  locale: string | undefined,
  category: SampleGarmentCategory
): string {
  const resolved = resolveGuestPreviewLocale(locale)
  return capitalizeFirst(
    GARMENT_ALT_STRINGS[resolved].categories[category].noun,
    resolved
  )
}

/**
 * The alt text, or accessibility label, of a member garment photo: color plus category ("Blue
 * top"), the category alone when the color is unknown ("Top"), and "Untagged garment" when
 * the category is unknown. An unsupported locale reads as en-US.
 */
export function formatGarmentAlt(
  locale: string | undefined,
  input: GarmentAltInput
): string {
  const resolved = resolveGuestPreviewLocale(locale)
  const table = GARMENT_ALT_STRINGS[resolved]
  const category = input.category ? table.categories[input.category] : undefined
  if (!category) return table.untagged
  const word = input.colorFamily ? table.colors[input.colorFamily] : undefined
  if (!word) return capitalizeFirst(category.noun, resolved)
  const color = typeof word === 'string' ? word : word[category.agreement]
  return capitalizeFirst(
    formatPreviewString(table.template, { color, category: category.noun }),
    resolved
  )
}
