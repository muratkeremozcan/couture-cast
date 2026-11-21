import type { SupportedLocale } from '@couture/api-client/contracts/http'

const COLORS = [
  'black',
  'gray',
  'white',
  'red',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'pink',
  'brown',
] as const
type Color = (typeof COLORS)[number]

const COPY: Record<SupportedLocale, { sentence: string; colors: readonly string[] }> = {
  'en-US': { sentence: 'This photo features {colors} tones.', colors: COLORS },
  'en-CA': {
    sentence: 'This photo features {colors} tones.',
    colors: [
      'black',
      'grey',
      'white',
      'red',
      'orange',
      'yellow',
      'green',
      'blue',
      'purple',
      'pink',
      'brown',
    ],
  },
  'de-DE': {
    sentence: 'In diesem Foto kommen Farbtöne wie {colors} zur Geltung.',
    colors: [
      'Schwarz',
      'Grau',
      'Weiß',
      'Rot',
      'Orange',
      'Gelb',
      'Grün',
      'Blau',
      'Violett',
      'Rosa',
      'Braun',
    ],
  },
  'es-419': {
    sentence: 'En esta foto destacan tonos como {colors}.',
    colors: [
      'negro',
      'gris',
      'blanco',
      'rojo',
      'naranja',
      'amarillo',
      'verde',
      'azul',
      'morado',
      'rosa',
      'marrón',
    ],
  },
  'fr-CA': {
    sentence: 'Cette photo fait ressortir des nuances de {colors}.',
    colors: [
      'noir',
      'gris',
      'blanc',
      'rouge',
      'orange',
      'jaune',
      'vert',
      'bleu',
      'violet',
      'rose',
      'brun',
    ],
  },
  'fr-FR': {
    sentence: 'Cette photo fait ressortir des nuances de {colors}.',
    colors: [
      'noir',
      'gris',
      'blanc',
      'rouge',
      'orange',
      'jaune',
      'vert',
      'bleu',
      'violet',
      'rose',
      'brun',
    ],
  },
  'it-IT': {
    sentence: 'In questa foto spiccano tonalità come {colors}.',
    colors: [
      'nero',
      'grigio',
      'bianco',
      'rosso',
      'arancione',
      'giallo',
      'verde',
      'blu',
      'viola',
      'rosa',
      'marrone',
    ],
  },
  'pt-BR': {
    sentence: 'Nesta foto, destacam-se tons como {colors}.',
    colors: [
      'preto',
      'cinza',
      'branco',
      'vermelho',
      'laranja',
      'amarelo',
      'verde',
      'azul',
      'roxo',
      'rosa',
      'marrom',
    ],
  },
  'pt-PT': {
    sentence: 'Nesta fotografia destacam-se tons como {colors}.',
    colors: [
      'preto',
      'cinzento',
      'branco',
      'vermelho',
      'laranja',
      'amarelo',
      'verde',
      'azul',
      'roxo',
      'rosa',
      'castanho',
    ],
  },
  'tr-TR': {
    sentence: 'Bu fotoğrafta {colors} tonları öne çıkıyor.',
    colors: [
      'siyah',
      'gri',
      'beyaz',
      'kırmızı',
      'turuncu',
      'sarı',
      'yeşil',
      'mavi',
      'mor',
      'pembe',
      'kahverengi',
    ],
  },
}

function hueOf(red: number, green: number, blue: number, max: number, chroma: number) {
  if (max === red) return (360 + (60 * (green - blue)) / chroma) % 360
  if (max === green) return 120 + (60 * (blue - red)) / chroma
  return 240 + (60 * (red - green)) / chroma
}

function pixelColor(red: number, green: number, blue: number): Color {
  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  const chroma = max - min
  if (max < 45) return 'black'
  if (chroma < 24) return min > 220 ? 'white' : 'gray'
  const hue = hueOf(red, green, blue, max, chroma)
  if (hue < 20 || hue >= 345) return min > 110 ? 'pink' : 'red'
  if (hue < 50) return max < 160 ? 'brown' : 'orange'
  if (hue < 70) return 'yellow'
  if (hue < 168) return 'green'
  if (hue < 253) return 'blue'
  if (hue < 313) return 'purple'
  return 'pink'
}

export function buildCommunityPhotoCaption(
  { rgba, width, height }: { rgba: Buffer; width: number; height: number },
  locale: SupportedLocale
): string | null {
  const counts = new Map<Color, number>()
  let visible = 0
  for (let offset = 0; offset + 3 < rgba.length; offset += 4) {
    if ((rgba[offset + 3] ?? 0) < 128) continue
    // Emphasize the central and lower part of the frame, where outfits usually sit.
    const spot = offset / 4
    const x = (spot % width) / width
    const y = Math.floor(spot / width) / height
    const weight = x > 0.22 && x < 0.78 && y > 0.24 && y < 0.88 ? 4 : 1
    const color = pixelColor(
      rgba[offset] ?? 0,
      rgba[offset + 1] ?? 0,
      rgba[offset + 2] ?? 0
    )
    counts.set(color, (counts.get(color) ?? 0) + weight)
    visible += weight
  }
  if (!visible) return null

  const { sentence, colors } = COPY[locale]
  const prominent = [...counts]
    .sort((a, b) => b[1] - a[1])
    .filter(([, count], index) => index === 0 || count / visible >= 0.14)
    .slice(0, 3)
    .map(([color]) => colors[COLORS.indexOf(color)] ?? color)
  return sentence.replace('{colors}', new Intl.ListFormat(locale).format(prominent))
}
