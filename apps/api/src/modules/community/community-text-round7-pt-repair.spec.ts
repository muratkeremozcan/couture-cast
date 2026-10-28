import { describe, expect, it } from 'vitest'
import { CommunityTextScreener } from './community-text-screener'

/**
 * Round 7 Portuguese repair. Every sentence below is generic fashion copy written for
 * this spec; none comes from a holdout or a corpus fixture.
 */
const screener = new CommunityTextScreener()
const screen = (text: string, locale: string | null = 'pt-BR') =>
  screener.screen({ text, locale, field: 'altText' })

// Family A: "pé" followed by "de" or "do" is rejoined by the short-token pass.
const footCopy = [
  'Calça pé de elefante em jeans escuro.',
  'Casaco com estampa pé de galinha em lã.',
  'Sapato de salto com tira no pé de cima.',
  'Mocassim confortável para calçar o pé de qualquer tamanho.',
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

describe('round 7 locale reach', () => {
  const rugCopy = 'Menino sentado sobre um tapete de crochê.'
  it('lets the rug phrases clear only for declared Portuguese or Spanish', () => {
    for (const locale of ['pt-BR', 'pt-PT', 'es-ES', 'es-MX'])
      expect(screen(rugCopy, locale).disposition, locale).toBe('pass')
    for (const locale of ['en-US', 'de-DE', 'fr-FR', 'it-IT', 'tr-TR', null])
      expect(screen(rugCopy, locale).disposition, String(locale)).not.toBe('pass')
  })

  it('keeps the Portuguese verb and noun contexts out of the other locales', () => {
    for (const text of [
      'A criança brinca no chão com blocos coloridos.',
      'Ela pula corda de sapatilha e laço.',
      'Recital de balé com collant e sapatilhas.',
      'Boá de penas rosa para a festa.',
    ])
      for (const locale of ['en-US', 'de-DE', 'fr-FR', 'it-IT', 'tr-TR', null])
        expect(screen(text, locale).disposition, `${locale} ${text}`).not.toBe('pass')
  })
})
