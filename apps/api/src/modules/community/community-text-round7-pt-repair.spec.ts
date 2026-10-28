import { describe, expect, it } from 'vitest'
import { CommunityTextScreener } from './community-text-screener'

/**
 * Round 7 Portuguese repair. Every sentence below is generic fashion copy written for
 * this spec; none comes from a holdout or a corpus fixture.
 */
const screener = new CommunityTextScreener()
const screen = (text: string, locale: string | null = 'pt-BR') =>
  screener.screen({ text, locale, field: 'altText' })

// Family A: "pé" followed by "de" or "do" is rejoined by the short-token pass. Cleared only
// before an enumerated Portuguese complement.
const footCopy = [
  'Calça pé de elefante em jeans escuro.',
  'Casaco com estampa pé de galinha em lã.',
  'Meia de algodão macia até o pé do bebê.',
  'Criança sentada no chão ao pé do sofá.',
  'Doce pé-de-moleque sobre a mesa do ateliê.',
  'Corrente pé-de-cabra decorativa na bolsa.',
  'Vestido de seda com barra pé de vento.',
  'Palmilha anatômica para pé de atleta.',
]
// Family B: ordinary words that equal the repeat-collapsed spelling of a foreign term.
const collapsedCopy = [
  'Menino sentado sobre um tapete de crochê.',
  'Tapete de yoga antiderrapante na cor lilás.',
  'Tapete persa sob a mesa de jantar.',
  'Criança brincando no tapete de brincar infantil.',
  'Sapatos alinhados sobre o tapete de banho.',
  'Recital de balé com collant e sapatilhas.',
  'Saia estilo balé em tom rosa.',
]
// Family C: ordinary verbs and nouns that equal a foreign term or a backstop word.
const exactCopy = [
  'A criança brinca no chão com blocos coloridos.',
  'Ela pula corda de sapatilha e laço.',
  'Pule a poça com a galocha amarela.',
  'Boá de penas rosa para a festa.',
  'Chapéu com penas de avestruz e fita.',
  'Brincos de penas naturais para o carnaval.',
  'Ela monta o look com calça e blazer.',
  'Aprenda a montar looks com peças básicas.',
]

describe('round 7 Portuguese clean fashion copy', () => {
  it.each([...footCopy, ...collapsedCopy, ...exactCopy])('passes: %s', (text) => {
    expect(screen(text).disposition).toBe('pass')
  })

  it('also passes with a declared pt-PT locale', () => {
    for (const text of [...footCopy, ...collapsedCopy, ...exactCopy])
      expect(screen(text, 'pt-PT').disposition, text).toBe('pass')
  })
})

describe('round 7 adversaries stay screened', () => {
  it.each([
    // The French slur and its accent, spacing, stretching and leet spellings.
    'pé dé',
    'p é d é',
    'pé d é',
    'pedé',
    'pédé',
    'pé.dé',
    'pé_dé',
    'pe-dé',
    'p3d3',
    'tapette',
    'tapetee',
    'tappette',
    't a p e t t e',
    't4pette',
    'tapete',
    'tapete!',
    // Bare terms without the reviewed grammar.
    'balle',
    'bale',
    'b a l e',
    'baalle',
    'brinca',
    'pula',
    'pule',
    'penas',
    'monta',
  ])('keeps non-pass: %s', (text) => {
    expect(screen(text).disposition, text).not.toBe('pass')
  })

  it('keeps a bare foreign word withheld next to a cleared phrase', () => {
    for (const text of [
      'pé de elefante tapette',
      'pé do sofá pédé',
      'a criança brinca no chão pé dé',
      'um tapete tapette',
      'boá de penas p u t a',
    ])
      expect(screen(text).disposition, text).not.toBe('pass')
  })

  it('does not extend the hyphen tolerance to any other separator', () => {
    for (const text of ['pé.dé', 'pé_dé', 'pé/dé', 'pé,dé', 'pé*dé', 'pé–dé', 'pé—dé'])
      expect(screen(text).disposition, text).not.toBe('pass')
  })

  it('still blocks the accented slur spelled with a hyphen', () => {
    for (const text of ['pé-dé', 'pé-dê', 'pé - dé'])
      expect(screen(text).disposition, text).not.toBe('pass')
  })
})

const everyLocale = [
  'pt-BR',
  'pt-PT',
  'fr-FR',
  'en-US',
  'es-ES',
  'de-DE',
  'it-IT',
  'tr-TR',
  null,
]
const nonPortuguese = ['fr-FR', 'en-US', 'es-ES', 'de-DE', 'it-IT', 'tr-TR', null]

describe('round 7 bare and disguised shapes stay blocked in every locale', () => {
  // The locale is client-declared, so these must not pass even as declared Portuguese.
  const bare = [
    'pé de',
    'pé do',
    'Calçar o pé de',
    'Apoie no pé do',
    'pé de.',
    'pé de!',
    'pé-de',
    'pé de aço',
    'tapete',
    'Tapete.',
    'o tapete',
    'no tapete',
    'do tapete',
    'ao tapete',
    'num tapete',
    'sobre o tapete',
    'em cima do tapete',
    'Sapatos azuis sobre o tapete.',
    'tapete de',
    'tapete da sala',
    'tapette',
    'tapeete',
    'tappette',
    't a p e t e',
    't.a.p.e.t.e',
    't4pete',
    'tapete_de yoga',
    'tapete/de yoga',
  ]
  it.each(bare)('blocks %s for every locale', (text) => {
    for (const locale of everyLocale)
      expect(screen(text, locale).disposition, `${locale} ${text}`).not.toBe('pass')
  })

  it('keeps the split accent-dropped slur blocked for every locale', () => {
    for (const text of ['pe de', 'pe do', 'pé dé', 'pé dê', 'p é d é', 'pé  dé'])
      for (const locale of everyLocale)
        if (!['pe de', 'pe do'].includes(text))
          expect(screen(text, locale).disposition, `${locale} ${text}`).not.toBe('pass')
  })

  it('does not widen the old unaccented spellings', () => {
    // pe de / pe do were cleared before this round by the existing unaccented entry and
    // are not changed by it; the new rule only concerns the accented spelling.
    for (const locale of everyLocale)
      expect(screen('pé de', locale).disposition, String(locale)).not.toBe('pass')
  })
})

describe('round 7 enumerated phrases need declared Portuguese', () => {
  const phrases = [
    'Calça pé de elefante em jeans escuro.',
    'Meia de algodão macia até o pé do bebê.',
    'Doce pé-de-moleque sobre a mesa do ateliê.',
    'Tapete de yoga antiderrapante na cor lilás.',
    'Tapete persa sob a mesa de jantar.',
  ]
  it('passes for pt-BR and pt-PT', () => {
    for (const text of phrases)
      for (const locale of ['pt-BR', 'pt-PT'])
        expect(screen(text, locale).disposition, `${locale} ${text}`).toBe('pass')
  })

  it('stays withheld when another or no locale is declared', () => {
    for (const text of phrases)
      for (const locale of nonPortuguese)
        expect(screen(text, locale).disposition, `${locale} ${text}`).not.toBe('pass')
  })

  it('keeps the Spanish reviewed rug phrase behaviour of round 6', () => {
    expect(screen('Sapatos azuis sobre um tapete.', 'es-419').disposition).toBe('pass')
    expect(screen('Sapatos azuis sobre o tapete.', 'es-419').disposition).not.toBe('pass')
    expect(screen('Tapete persa sob a mesa.', 'es-419').disposition).not.toBe('pass')
  })

  it('keeps the Portuguese verb and noun contexts out of the other locales', () => {
    for (const text of [
      'A criança brinca no chão com blocos coloridos.',
      'Ela pula corda de sapatilha e laço.',
      'Recital de balé com collant e sapatilhas.',
      'Boá de penas rosa para a festa.',
    ])
      for (const locale of nonPortuguese)
        expect(screen(text, locale).disposition, `${locale} ${text}`).not.toBe('pass')
  })
})
