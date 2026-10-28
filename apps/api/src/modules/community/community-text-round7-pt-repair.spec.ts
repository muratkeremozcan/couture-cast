import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
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
  'Palmilha macia para o pé do sapato.',
  'Costura reforçada no pé do tênis branco.',
  'Doce pé-de-moleque sobre a mesa do ateliê.',
  'Corrente pé-de-cabra decorativa na bolsa.',
  'Vestido de seda com barra pé de vento.',
  'Meia de lã com estampa pé de meia listrada.',
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
    'Palmilha macia para o pé do sapato.',
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

describe('round 7 complements never launder a high-severity term', () => {
  const policyDir = path.resolve(__dirname, '../../../policies/community-screening')
  const allow = JSON.parse(
    fs.readFileSync(path.join(policyDir, 'allow-list-v1.json'), 'utf8')
  ) as { scopedPhrases: { entry: string; complements: string[] }[] }
  const high = [
    ...new Set(
      ['de', 'en', 'es', 'fr', 'it', 'pt', 'tr'].flatMap((language) =>
        (
          JSON.parse(
            fs.readFileSync(path.join(policyDir, `terms-v1/${language}-v1.json`), 'utf8')
          ) as { entries: { term: string; severity: string }[] }
        ).entries
          .filter((entry) => entry.severity === 'high')
          .map((entry) => entry.term)
      )
    ),
  ]

  it('has high-severity terms and complements to combine', () => {
    expect(high.length).toBeGreaterThan(100)
    expect(allow.scopedPhrases.length).toBeGreaterThan(0)
  })

  it('keeps every high term blocked next to every complement under declared pt', () => {
    const leaked: string[] = []
    for (const { entry, complements } of allow.scopedPhrases)
      for (const complement of complements)
        for (const term of high)
          for (const text of [
            `${term} ${complement}`,
            `${complement} ${term}`,
            `${term} ${entry} ${complement}`,
            `${entry} ${complement} ${term}`,
            `${term}-${entry.replace(' ', '-')}-${complement}`,
          ])
            if (screen(text, 'pt-BR').disposition === 'pass') leaked.push(text)
    expect(leaked).toEqual([])
  }, 120_000)

  it('keeps complements to footwear, trouser, coat and rug nouns', () => {
    const people = ['bebê', 'criança', 'filho', 'menino', 'menina', 'noivo', 'atleta']
    for (const { complements } of allow.scopedPhrases)
      for (const person of people) expect(complements).not.toContain(person)
  })
})

describe('round 7 stray combining marks cannot split a term', () => {
  const terms = ['viado', 'puta', 'caralho', 'fuck', 'cabrão', 'tapette']
  const marks = ['\u0301', '\u0300', '\u0303', '\u0332', '\u20e3', '\u0301\u0301']
  it('withholds a term with a mark after any letter in every locale', () => {
    for (const term of terms)
      for (const mark of marks)
        for (let at = 1; at <= term.length; at++) {
          const text = term.slice(0, at) + mark + term.slice(at)
          for (const locale of everyLocale)
            expect(screen(text, locale).disposition, `${locale} ${text}`).not.toBe('pass')
        }
  })

  it('still passes ordinary accented Portuguese copy', () => {
    for (const text of [
      'Calça jeans com bolsos',
      'Sandália rasteira',
      'Pé de meia confortável',
    ])
      expect(screen(text).disposition, text).toBe('pass')
  })
})

describe('round 7 the pede verb is Portuguese-scoped and exact', () => {
  const shapes = ['pede', 'pe de', 'p e d e', 'pe  de', 'pe-de', 'p.e.d.e']
  it('blocks every shape for fr-FR, es-ES, en-US and no locale', () => {
    for (const text of shapes)
      for (const locale of ['fr-FR', 'es-ES', 'en-US', 'de-DE', 'it-IT', 'tr-TR', null])
        expect(screen(text, locale).disposition, `${locale} ${text}`).not.toBe('pass')
  })

  it('lets declared Portuguese pass only the exact verb token', () => {
    for (const locale of ['pt-BR', 'pt-PT']) {
      expect(screen('pede', locale).disposition).toBe('pass')
      expect(screen('O tempo pede casaco.', locale).disposition).toBe('pass')
      for (const text of shapes.slice(1))
        expect(screen(text, locale).disposition, `${locale} ${text}`).not.toBe('pass')
    }
  })
})

describe('round 7b floor play, posture, fit and print copy', () => {
  const cleanCopy = [
    'Criança sentada no tapete com blocos de montar.',
    'Menino deitado sobre o tapete lendo um livro.',
    'Duas meninas brincando no tapete da sala.',
    'Bebê engatinhando no tapete macio e colorido.',
    'Sapatos alinhados em cima do tapete bege.',
    'Menina descalça perto do tapete do quarto.',
    'Tênis branco e meias soquete ao lado do tapete de feltro.',
    'Bebê brinca num tapete de atividades.',
    'Jeans de cintura alta que valoriza o bumbum.',
    'Short de linho com bolsos no bumbum e cós elástico.',
    'Legging que modela o bumbum sem marcar.',
    'Calça de alfaiataria que levanta o bumbum.',
    'Estampa de penas de pavão em tons de azul.',
    'Vestido com print de penas e bordado manual.',
    'Eu pinto à mão cada peça da coleção.',
    'Pinto as botas de couro com tinta própria.',
    'Calça pé de elefante com cós alto e short no pé do cano.',
  ]
  it.each(cleanCopy)('passes under declared Portuguese: %s', (text) => {
    for (const locale of ['pt-BR', 'pt-PT'])
      expect(screen(text, locale).disposition, `${locale} ${text}`).toBe('pass')
  })

  it('keeps the rug frames withheld when Portuguese is not declared', () => {
    for (const text of cleanCopy.slice(0, 8))
      for (const locale of nonPortuguese)
        expect(screen(text, locale).disposition, `${locale} ${text}`).not.toBe('pass')
  })

  it('keeps bare, article-only and disguised forms withheld in every locale', () => {
    for (const text of [
      'tapete',
      'o tapete',
      'no tapete',
      'sentada no tapette',
      'sentada no tapeete',
      'sentada no t4pete',
      'sentada n o tapete',
      'sentada, no tapete',
      'sentada - no - tapete',
      'bumbum',
      'o bumbum',
      'bumbuum',
      'pinto',
      'o pinto',
      'pinto!',
    ])
      for (const locale of ['pt-BR', 'fr-FR', 'en-US', 'es-ES', null])
        expect(screen(text, locale).disposition, `${locale} ${text}`).not.toBe('pass')
  })

  it('does not let a frame launder a neighbouring term', () => {
    for (const text of [
      'sentada no tapete puta',
      'viado brincando no tapete',
      'sentada no tapete e tapette',
      'bumbum valoriza o caralho',
      'pinto à mão filho da puta',
    ])
      expect(screen(text, 'pt-BR').disposition, text).not.toBe('pass')
  })
})
