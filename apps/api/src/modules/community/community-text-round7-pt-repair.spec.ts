import { describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { CommunityTextScreener } from './community-text-screener'

/**
 * Round 7 Portuguese repair. Every sentence below is generic fashion copy written for
 * this spec; none comes from a holdout or a corpus fixture.
 */
const HEAVY_TIMEOUT_MS = 180_000
const screener = new CommunityTextScreener()

// The loop tests screen thousands of texts (5 heads x 11 separators x 5 tails x every
// locale and more). Measured with coverage instrumentation, the slowest takes 19.5 s while the machine is loaded (measured with coverage; CI runs
// about 2.6 times slower, from the round 7c timeouts at 10.2 s against 3.9 s locally);
// the timeout below leaves a wide margin for the 4 vCPU runner.
vi.setConfig({ testTimeout: HEAVY_TIMEOUT_MS })
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
      'tap ete',
      'Tap ete macio',
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

describe('round 7b pinto and bumbum never launder sexual use', () => {
  // Independent reviewer and coordinator lists, with and without accents, as written.
  const sexual = [
    'minha mao no meu pinto',
    'tira a mao do meu pinto',
    'pinto na calca',
    'pinto no jeans dela',
    'empina o bumbum pra mim',
    'pega no bumbum na calca jeans',
    'meu pinto na mão',
    'seu pinto na calça',
    'tire o pinto da calça',
    'mostrei meu pinto na camisa',
    'quero ver teu bumbum no biquíni',
    'bumbum na calcinha',
    'minha mão no meu pinto',
    'tira a mão do meu pinto',
    'pinto na calça',
    'pinto no jeans dela',
    'empina o bumbum pra mim',
    'pega no bumbum na calça jeans',
    'tire pinto a camisa',
    'meu pinto a parede',
    'o pinto a parede',
    'calcinha que valoriza o bumbum',
    'biquíni que valoriza o bumbum',
    'sunga valoriza o bumbum',
    'cueca que levanta o bumbum',
    'maiô que destaca o bumbum',
    'teu bumbum',
    'quero o bumbum',
  ]
  it.each(sexual)('keeps %s withheld in pt-BR, pt-PT and elsewhere', (text) => {
    for (const locale of ['pt-BR', 'pt-PT', 'fr-FR', 'en-US', 'es-ES', null])
      expect(screen(text, locale).disposition, `${locale} ${text}`).not.toBe('pass')
  })

  it('clears pinto only as the verb and bumbum only in garment-led fit frames', () => {
    for (const text of [
      'Eu pinto à mão cada peça da coleção.',
      'Pinto a parede do ateliê de azul.',
      'Todo dia eu pinto as unhas de rosa.',
      'Jeans de cintura alta que valoriza o bumbum.',
      'Short de linho com bolsos no bumbum.',
      'Legging que modela o bumbum sem marcar.',
    ])
      for (const locale of ['pt-BR', 'pt-PT'])
        expect(screen(text, locale).disposition, `${locale} ${text}`).toBe('pass')
    // pinto is cleared by grammar alone, as its four development rows require in every
    // locale; bumbum still needs a declared Portuguese locale.
    expect(screen('Eu pinto à mão cada peça da coleção.', 'en-US').disposition).toBe(
      'pass'
    )
    for (const locale of ['fr-FR', 'en-US', 'es-ES', null])
      expect(screen('Jeans que valoriza o bumbum.', locale).disposition).not.toBe('pass')
  })
})

describe('round 7b leering tails never ride on a fit or painting frame', () => {
  const leering = [
    'calça que valoriza o bumbum dela nu',
    'legging que levanta o bumbum de criança',
    'calça que valoriza o bumbum da minha filha',
    'jeans que empina o bumbum pra mim',
    'jeans que levanta o bumbum chupa',
    'calça que valoriza o bumbum gostoso',
    'calça valoriza o bumbum e a calcinha',
    'a calça valoriza o bumbum da menina',
    'dela calça que valoriza o bumbum',
    'a gostosa com jeans que valoriza o bumbum',
    'biquíni e calça que valoriza o bumbum',
    'Pinto a mão chupa',
    'Pinto a mão dela',
    'Pinto as unhas dela',
    'pinto a parede gostosa',
    'Pinto a mão e chupa',
  ]
  it.each(leering)('keeps %s withheld in pt-BR and pt-PT', (text) => {
    for (const locale of ['pt-BR', 'pt-PT', 'fr-FR', 'en-US', null])
      expect(screen(text, locale).disposition, `${locale} ${text}`).not.toBe('pass')
  })

  const separators = [
    '. ',
    '.\n',
    '... ',
    '… ',
    '! ',
    '? ',
    '; ',
    ', ',
    ': ',
    '\n\n',
    ' - ',
    ' ) ',
  ]
  const heads = [
    'calça que valoriza o bumbum',
    'legging que levanta o bumbum',
    'Pinto a mão',
  ]
  const tails = [
    'dela nu',
    'de criança',
    'da minha filha',
    'pra mim',
    'chupa',
    'gostosa',
    'de menina',
    'bebê',
    'nua',
    'sexy',
    'novinha',
    'safada',
    'delícia',
    'rabuda',
    'gostosinha',
    'lamber',
    'sarrar',
    'menininha',
    'garotinha',
    'garota de 12 anos',
    'meninas',
    'filhas',
    'bebês',
    'tire a calça',
    'quero ver',
  ]
  it('withholds a fit or painting frame followed by anything outside the closed tails', () => {
    for (const locale of ['pt-BR', 'pt-PT'])
      for (const head of heads)
        for (const separator of separators)
          for (const tail of tails)
            expect(
              screen(`${head}${separator}${tail}`, locale).disposition,
              `${locale} ${JSON.stringify(`${head}${separator}${tail}`)}`
            ).not.toBe('pass')
  })

  it('withholds a forbidden word placed before the frame, across any sentence or line break', () => {
    for (const locale of ['pt-BR', 'pt-PT'])
      for (const head of heads)
        for (const separator of separators)
          for (const lead of tails.slice(0, 22))
            expect(
              screen(`${lead}${separator}${head}`, locale).disposition,
              `${locale} ${JSON.stringify(`${lead}${separator}${head}`)}`
            ).not.toBe('pass')
  })

  it('catches a forbidden word cut apart or stretched', () => {
    for (const text of [
      'crian ça. calça que valoriza o bumbum',
      'c r i a n ç a\ncalça que valoriza o bumbum',
      'meniiina. legging que levanta o bumbum',
      'calça que valoriza o bumbum. de gost0sa',
    ])
      expect(screen(text, 'pt-BR').disposition, text).not.toBe('pass')
  })

  it('still clears the bounded fit and painting copy, with closed tails', () => {
    for (const text of [
      'Jeans de cintura alta que valoriza o bumbum.',
      'Legging que modela o bumbum sem marcar.',
      'Calça que valoriza o bumbum com conforto e as coxas também.',
      'Calça que valoriza o bumbum.\nSem marcar. O dia todo!',
      'Legging que levanta o bumbum, com conforto…',
      'Short com bolsos no bumbum',
      'Pinto as botas de azul para renovar o conjunto.',
      'Pinto o tecido com tinta azul.',
      'Eu pinto à mão cada peça da coleção.',
      'Pinto a mão.',
    ])
      for (const locale of ['pt-BR', 'pt-PT'])
        expect(screen(text, locale).disposition, `${locale} ${text}`).toBe('pass')
  })
})

describe('round 7b fashion and sewing copy never trips the whole-word cut rule', () => {
  const sewing = [
    // English
    'You pin the pattern to the fabric before you cut.',
    'First you pin the hem then you sew it.',
    'Tack the seam in place, then baste the lining by hand.',
    'Wipe the wet back of the jacket with a soft cloth.',
    'A towel head wrap keeps hair dry after a swim.',
    'Sub-normal temperatures in winter call for a lined coat.',
    'Pin tuck blouse with a cum laude print on the cuff.',
    'Hand embroidered anchor patch on the sleeve.',
    'Here is how you pin the brooch on a lapel.',
    'Cotton towel head wrap for drying hair.',
    // Portuguese
    'Prenda o molde com alfinetes e alinhave a bainha antes de costurar.',
    'Primeiro você prende a barra e depois costura.',
    // Spanish
    'Sujeta el patrón con alfileres y hilvana el forro antes de coser.',
    'Primero marcas el dobladillo y luego lo coses a mano.',
    // French
    'Epinglez le patron sur le tissu puis faufilez la doublure.',
    "Piquez l'ourlet avant de coudre la manche.",
    // Italian
    'Fissa il modello con gli spilli e imbastisci la fodera prima di cucire.',
    'Prima appunta l’orlo e poi cuci la manica.',
    // German
    'Stecke das Schnittmuster mit Nadeln fest und hefte das Futter an.',
    'Erst den Saum feststecken, dann die Naht nähen.',
    // Turkish
    'Kalıbı iğnelerle kumaşa tutturun ve astarı elle teyelleyin.',
    'Önce etek ucunu iğneleyin, sonra dikin.',
  ]
  it.each(sewing)('passes in every locale: %s', (text) => {
    for (const locale of everyLocale)
      expect(screen(text, locale).disposition, `${locale} ${text}`).toBe('pass')
  })

  it('withholds every cut of a hate or sexual term, ordinary-word halves included', () => {
    for (const text of [
      'you pin',
      'wet back',
      'towel head',
      'sub normal',
      'sub-normal',
      'mar icon',
      'mar icona',
      'mari con',
      'cum shot',
      'cum shots',
      'fag got',
      'boll era',
      'put tana',
      'putt ana',
      'pom pino',
      'zing aro',
      'chine toque',
      'stupid towel head',
      'go home wet back',
      'you are a fag got',
      'sale you pin',
      'espece de you pin',
      'tap ete',
      'nazi sta',
      'estu pro',
      'nig ger',
      'pomp ino',
      'ter rone',
      'fro cio',
      'sal ope',
      'kan ake',
    ])
      for (const locale of everyLocale)
        expect(screen(text, locale).disposition, `${locale} ${text}`).not.toBe('pass')
  })

  it('clears a reviewed fashion pair only inside its enumerated frame', () => {
    for (const text of [
      'You pin the pattern to the fabric before you cut.',
      'First you pin the hem then you sew it.',
      'Then you pin your scarf here.',
      'A sub normal temperature calls for a lined coat.',
      'Sub-normal weather in winter.',
      'Wipe the wet back of the jacket with a soft cloth.',
      'The wet back lining dries fast.',
      'A towel head wrap keeps hair dry after a swim.',
      'Soft terry towel head drying cap.',
    ])
      for (const locale of everyLocale)
        expect(screen(text, locale).disposition, `${locale} ${text}`).toBe('pass')
  })

  it('keeps slur-leading and unlisted frames of the reviewed pairs withheld', () => {
    for (const text of [
      'stupid towel head wrap',
      'stupid you pin the hem',
      'sale you pin the pattern',
      'espece de you pin the hem',
      'go home wet back lining',
      'stupid sub normal weather',
      'you pin the jews',
      'you pin',
      'you pin.',
      'then you pin',
      'the towel head',
      'towel head turban',
      'a sub normal kid',
      'a sub normal',
      'the wet back',
      'the wet back of the neighbour',
      'wet back worker',
      'You pin the pattern. You pin',
      'then you pin the hem. sale you pin',
      'then you pin the hem sale youu pin',
    ])
      for (const locale of everyLocale)
        expect(screen(text, locale).disposition, `${locale} ${text}`).not.toBe('pass')
  })
})

describe('round 7c reviewed split pairs have a closed tail and a closed lead', () => {
  const heads = [
    'towel head wrap',
    'wet back lining',
    'send the wet back lining',
    'You pin the hem',
    'a sub normal temperature',
  ]
  const hostile = [
    'go back to your country',
    'go home',
    'send the wet back lining home',
    'you people are vermin',
    'get out of here',
  ]
  const separators = [
    ' ',
    '. ',
    '... ',
    '! ',
    '? ',
    '; ',
    ', ',
    ': ',
    '\n',
    '\n\n',
    ' - ',
  ]

  it('withholds a reviewed frame followed by anything outside the closed tails', () => {
    for (const locale of everyLocale)
      for (const head of heads)
        for (const separator of separators)
          for (const tail of hostile)
            expect(
              screen(`${head}${separator}${tail}`, locale).disposition,
              `${locale} ${JSON.stringify(`${head}${separator}${tail}`)}`
            ).not.toBe('pass')
  })

  it('withholds the coordinator sentences in every locale', () => {
    for (const text of [
      'towel head wrap go back to your country',
      'wet back lining go home',
      'send the wet back lining home',
    ])
      for (const locale of everyLocale)
        expect(screen(text, locale).disposition, `${locale} ${text}`).not.toBe('pass')
  })

  it('withholds a reviewed frame that follows hostile text', () => {
    for (const locale of everyLocale)
      for (const lead of hostile)
        for (const separator of separators)
          for (const head of heads)
            expect(
              screen(`${lead}${separator}${head}`, locale).disposition,
              `${locale} ${JSON.stringify(`${lead}${separator}${head}`)}`
            ).not.toBe('pass')
  })

  it('still passes longer real sewing and garment copy with ordinary continuations', () => {
    for (const text of [
      'First you pin the hem, then you sew it by hand.',
      'Lay the pattern flat, then you pin the pattern to the fabric before cutting.',
      'Here is how you pin the brooch on a lapel so it stays in place.',
      'You pin the seam carefully and then sew it.',
      'Cut the fabric first. Then you pin the pattern pieces, and then sew them.',
      'Sub-normal temperatures in winter call for a lined coat.',
      'A sub normal temperature calls for layers this week.',
      'Wipe the wet back of the jacket with a soft cloth, then let it dry.',
      'The wet back lining dries fast and stays dry.',
      'A towel head wrap keeps hair dry after a swim, in soft cotton.',
      'Cotton towel head wrap for drying hair in three colours.',
    ])
      for (const locale of everyLocale)
        expect(screen(text, locale).disposition, `${locale} ${text}`).toBe('pass')
  })
})

describe('round 7c both sides of every reviewed clearance are closed', () => {
  const locales = ['pt-BR', 'pt-PT', 'en-US', null]
  const separators = [' ', '. ', '... ', '! ', '? ', '; ', ', ', '\n', '\n\n', ' - ']

  it('withholds the independent reviewer sentences for the reviewed pairs', () => {
    for (const text of [
      'towel head wrap go home',
      'towel head wrap you animals',
      'kill the towel head wrap',
      'wet back panel go home',
      'wet back panel you animals',
      'kill the wet back lining',
      'kill the sub normal temperature',
      'slur the you pin the hem',
      'burn the towel head wrap',
      'the towel head wrap go home',
    ])
      for (const locale of [...locales, ...everyLocale])
        expect(screen(text, locale).disposition, `${locale} ${text}`).not.toBe('pass')
  })

  const leads = [
    'menor de idade',
    'minha prima de 12 anos',
    'peladinha',
    'sem roupa',
    'fio dental',
    'de quatro',
    'pro meu pau',
    'tarada',
    'estudante',
    'aluna',
    'mocinha',
    'gata',
    'amor',
  ]
  const fit = ['calça que valoriza o bumbum', 'legging que levanta o bumbum']

  it('withholds a bumbum fit frame led by anything outside the closed openers', () => {
    for (const locale of locales)
      for (const lead of leads)
        for (const separator of separators)
          for (const head of fit)
            expect(
              screen(`${lead}${separator}${head}`, locale).disposition,
              `${locale} ${JSON.stringify(`${lead}${separator}${head}`)}`
            ).not.toBe('pass')
  })

  it('withholds a pinto painting frame led by anything outside the closed openers', () => {
    for (const locale of locales)
      for (const lead of leads)
        for (const separator of separators)
          expect(
            screen(`${lead}${separator}Pinto a mão`, locale).disposition,
            `${locale} ${JSON.stringify(`${lead}${separator}Pinto a mão`)}`
          ).not.toBe('pass')
  })

  it('keeps fit and painting copy with closed openers clean under declared Portuguese', () => {
    for (const text of [
      'Jeans de cintura alta que valoriza o bumbum.',
      'Nova coleção. Calça que valoriza o bumbum sem marcar.',
      'Look do dia: legging que levanta o bumbum com conforto.',
      'Short com bolsos no bumbum e cintura alta.',
      'Todo dia eu pinto as unhas de rosa.',
      'Eu pinto à mão cada peça da coleção.',
      'Pinto a mão.',
    ])
      for (const locale of ['pt-BR', 'pt-PT'])
        expect(screen(text, locale).disposition, `${locale} ${text}`).toBe('pass')
  })
})

describe('round 7e ordinary pairs with an open frame route to review, not a hard block', () => {
  const english = [
    'Once you pin the pocket sew along the edge.',
    'Here is how you pin a hem on a skirt.',
    'Use a towel head wrap with a cotton lining.',
    'Sub normal wear on the hem after a year.',
    'When you pin a dart, keep the fabric flat on the table.',
    'Then you pin each sleeve to the armhole and match the notches.',
    'If you pin the zipper first, the seam sits straight.',
    'After you pin the ribbon onto the collar, stitch it in two passes.',
    'Wear a towel head wrap in the bath to keep the curls dry.',
    'A towel head wrap in soft terry is gentle on long hair.',
    'The wet back panel of this coat is bonded to the shell for rain.',
    'Hang the jacket to dry because the wet back lining takes an hour.',
    'Check the wet back seam for tape before you wear it in the rain.',
    'Sub normal stretch in the knit means the cuff keeps its shape.',
    'Sub normal shrinkage after the first wash is covered by the guarantee.',
    'Before you pin the bias tape, press the fold.',
    'Do not skip it when you pin the pleats, or the skirt will twist.',
    'Cut the lining, then you pin the facing to the neckline.',
    'Try a towel head wrap made of bamboo for a gentler dry.',
    'As you pin the brim to the crown, ease the fullness evenly.',
    'For a clean finish you pin baste and then topstitch.',
    'Where do you pin a brooch on a blazer?',
    'Do you pin before you cut the fabric or after?',
    'Does the seam hold if you pin the hem twice?',
    'Can you pin the dart before you press it?',
    'Should you pin the facing or baste it first?',
    'What would you pin on the lapel of a wool coat?',
  ]
  const foreign = [
    'Doublure en wet back lining étanche pour le manteau long.',
    'Utilisez le towel head wrap avec une doublure en coton.',
    "Le sub normal wear sur l'ourlet apparaît après un an.",
    'Puis you pin the hem avant de coudre.',
    'Un wet back panel en nylon sur le dos de la veste.',
    'Usa el towel head wrap con un forro de algodón.',
    'El sub normal wear del dobladillo aparece tras un año.',
    'Luego you pin the hem antes de coser a mano.',
    'El wet back lining del abrigo es impermeable.',
    'Un towel head wrap de rizo para secar el cabello.',
    'Usa il towel head wrap con una fodera di cotone.',
    "Il sub normal wear sull'orlo compare dopo un anno.",
    'Poi you pin the hem prima di cucire.',
    'Il wet back lining del cappotto è impermeabile.',
    'Un towel head wrap in spugna per asciugare i capelli.',
    'Das wet back lining der Jacke ist wasserdicht.',
    'Der towel head wrap aus Frottee trocknet das Haar schnell.',
    'Dann you pin the hem vor dem Nähen.',
    'Ein sub normal wear am Saum zeigt sich nach einem Jahr.',
    'Die wet back panel der Jacke ist verklebt.',
  ]
  it.each([...english, ...foreign])('never hard-blocks natural copy: %s', (text) => {
    for (const locale of everyLocale)
      expect(screen(text, locale).disposition, `${locale} ${text}`).not.toBe('block')
  })

  it('keeps block for slur-leading frames, forbidden words and cuts with a non-ordinary half', () => {
    for (const text of [
      'stupid towel head wrap',
      'stupid towel head',
      'go home wet back',
      'sale you pin',
      'espece de you pin',
      'kill the towel head wrap',
      'kill the wet back lining',
      'towel head wrap you animals',
      'wet back panel you animals',
      'towel head wrap go back to your country',
      'kill you pin the hem',
      'burn the wet back lining',
      'do kill the towel head wrap',
      'why do you hate the towel head wrap',
      'stupid you pin the hem',
      'filthy sub normal kid',
      'sale you pin the pattern',
      'tap ete',
      'nazi sta',
    ])
      for (const locale of everyLocale)
        expect(screen(text, locale).disposition, `${locale} ${text}`).toBe('block')
  })

  it('still withholds, as review, a reviewed pair with an open tail', () => {
    for (const text of [
      'towel head wrap stitched in the shop',
      'wet back panel zipped by the shop',
    ])
      for (const locale of everyLocale)
        expect(screen(text, locale).disposition, `${locale} ${text}`).toBe('review')
  })
})

describe('round 7g violent and hate sentences with the ordinary pairs always block', () => {
  const templates = [
    'hang the X',
    'gas the X',
    'burn the X',
    'shoot the X',
    'lynch the X',
    'stab the X',
    'bomb the X',
    'hurt the X',
    'beat the X',
    'deport the X',
    'exterminate the X',
    'kill the X',
    'the X are vermin',
    'those X people need to leave',
    'what a X',
    'X go home',
    'send the X back',
    'X scum',
    'all X are scum',
    'get rid of the X',
    'the X need to leave',
    'throw out the X',
    'I hate the X',
    'X people',
    'the X should die',
    'round up the X',
    'ban the X',
  ]
  const pairs = ['you pin', 'sub normal', 'wet back', 'towel head']
  const sentences = pairs.flatMap((pair) =>
    templates.map((template) => template.replaceAll('X', pair))
  )
  it('has 108 sentences', () => expect(sentences).toHaveLength(108))
  it.each(sentences)('blocks %s in every locale', (text) => {
    for (const locale of everyLocale)
      expect(screen(text, locale).disposition, `${locale} ${text}`).toBe('block')
  })
})

describe('round 7g plural and inflected hate forms meet the term, in every locale', () => {
  const hate = [
    'all towelheads are vermin',
    'deport the wetbacks',
    'no wetbacks allowed here',
    'all faggots are vermin',
    'all towel heads are vermin',
    'all nig gers are vermin',
    'the niggers and the kikes',
    'chinks gooks spics',
    'nazis everywhere',
    'he raped her and they were raping',
    'sluts and whores',
    'cunts',
    'Huren und Schlampen',
    'alle Kanaken',
    'les pédés',
    'les nazis',
    'los maricones y los nazis',
    'las putas',
    'os nazistas e as vadias',
    'le puttane e i froci',
    'gavurlar',
    'gavurları',
  ]
  it.each(hate)('withholds %s', (text) => {
    for (const locale of everyLocale)
      expect(screen(text, locale).disposition, `${locale} ${text}`).not.toBe('pass')
  })

  it('blocks the coordinator plural sentences', () => {
    for (const text of [
      'all towelheads are vermin',
      'deport the wetbacks',
      'no wetbacks allowed here',
      'all faggots are vermin',
      'all towel heads are vermin',
      'all nig gers are vermin',
    ])
      for (const locale of everyLocale)
        expect(screen(text, locale).disposition, `${locale} ${text}`).toBe('block')
  })

  const fashion = [
    'dresses skirts blouses jackets coats scarves shirts jeans shoes boots socks hats caps gloves belts bags sandals sneakers heels pumps loafers leggings shorts suits ties vests cardigans sweaters hoodies tees tanks bras briefs trunks swimsuits bikinis ponchos capes kimonos boleros clogs mules slippers wedges platforms stilettos espadrilles fedoras berets beanies bandanas turbans veils shawls stoles wraps brooches pins buttons zippers buckles beads sequins ribbons laces bows ruffles pleats darts hems seams cuffs collars sleeves pockets linings patterns stitches threads needles spiced fagoting retarding bolero',
    'robes jupes chemises vestes manteaux écharpes chaussures bottes chaussettes chapeaux gants ceintures sacs sandales baskets talons bonnets pulls gilets cravates maillots pantalons boutons rubans dentelles plis ourlets coutures manches poches doublures patrons points aiguilles pédales',
    'vestidos faldas camisas chaquetas abrigos bufandas zapatos botas calcetines sombreros guantes cinturones bolsos sandalias zapatillas tacones gorros jerseys chalecos corbatas bañadores pantalones botones cintas encajes pliegues dobladillos costuras mangas bolsillos forros patrones puntadas agujas',
    'vestiti gonne camicie giacche cappotti sciarpe scarpe stivali calzini cappelli guanti cinture borse sandali scarpe tacchi berretti maglioni gilet cravatte costumi pantaloni bottoni nastri pizzi pieghe orli cuciture maniche tasche fodere cartamodelli punti aghi',
    'vestidos saias camisas jaquetas casacos cachecóis sapatos botas meias chapéus luvas cintos bolsas sandálias tênis saltos gorros suéteres coletes gravatas biquínis calças botões fitas rendas pregas barras costuras mangas bolsos forros moldes pontos agulhas',
    'Kleider Röcke Blusen Jacken Mäntel Schals Schuhe Stiefel Socken Hüte Handschuhe Gürtel Taschen Sandalen Absätze Mützen Pullover Westen Krawatten Badeanzüge Hosen Knöpfe Bänder Spitzen Falten Säume Nähte Ärmel Taschen Futter Schnittmuster Stiche Nadeln',
    'elbiseler etekler gömlekler ceketler paltolar atkılar ayakkabılar botlar çoraplar şapkalar eldivenler kemerler çantalar sandaletler topuklar bereler kazaklar yelekler kravatlar pantolonlar düğmeler kurdeleler dantelller pileler etekler dikişler kollar cepler astarlar kalıplar iğneler',
  ]
  it('keeps the Spanish and Portuguese colour plural and the Portuguese verb clean', () => {
    for (const locale of everyLocale) {
      expect(screen('Zapatos negros y vestidos negros', locale).disposition).toBe('pass')
      expect(screen('Sapatos negros e meias negras', locale).disposition).toBe('pass')
    }
    expect(screen('Tu pedes casaco quando faz frio', 'pt-BR').disposition).toBe('pass')
    expect(screen('les pédés', 'fr-FR').disposition).not.toBe('pass')
  })

  it('keeps ordinary fashion plurals clean in every locale', () => {
    for (const group of fashion)
      for (const word of group.split(' ')) {
        for (const locale of everyLocale)
          expect(screen(word, locale).disposition, `${locale} ${word}`).toBe('pass')
        expect(screen(`New ${word} for sale`, 'en-US').disposition, word).toBe('pass')
      }
  })
})

describe('round 7h rapping and chinks of light', () => {
  it('clears rapper and rappers exactly and still blocks the generated rape forms', () => {
    for (const locale of everyLocale) {
      for (const text of [
        'A rapper in a bomber jacket',
        'Rappers wear oversized hoodies',
      ])
        expect(screen(text, locale).disposition, `${locale} ${text}`).toBe('pass')
      for (const text of [
        'raping',
        'he was raping her',
        'raped',
        'they raped her',
        'rapes',
        'r a p i n g',
        'rappping',
        'rapiing',
      ])
        expect(screen(text, locale).disposition, `${locale} ${text}`).not.toBe('pass')
    }
    for (const locale of [...everyLocale, 'en-US', 'en-GB'])
      for (const text of [
        'raping',
        'raped',
        'rapes',
        'he was raping',
        'rapping',
        'rapped',
      ])
        expect(screen(text, locale).disposition, `${locale} ${text}`).toBe('block')
    expect(screen('raping and raped', 'en-US').disposition).toBe('block')
  })

  const knock = [
    'Rapping on the door twice',
    'He is rapping about fashion',
    'She rapped on the window',
    'Someone rapped at the door and waited.',
    'The rapper rapped the verse over the beat.',
    'They kept rapping along to the beat.',
    'He rapped against the table with his knuckles.',
    'She was rapping bars on stage.',
  ]
  it.each(knock)('passes %s under declared English only', (text) => {
    for (const locale of ['en-US', 'en-GB'])
      expect(screen(text, locale).disposition, `${locale} ${text}`).toBe('pass')
    for (const locale of ['fr-FR', 'pt-BR', 'de-DE', null])
      expect(screen(text, locale).disposition, `${locale} ${text}`).not.toBe('pass')
  })

  const euphemism = [
    'he rapped her',
    'she got rapped last night',
    'rapped by a gang',
    'I rapped her in the car',
    'rapping women is fun',
    'he was rapping a girl',
    'he rapped on the door and then rapped her',
    'rapped on the door. she got rapped',
    'rapped on the door\nrapped by a gang',
    'rapping on the door, rapping women',
    'rapping her',
    'rapping a child',
    'he is rapping the girl in the dark',
    'rapping the kids',
    'she keeps rapping him',
    'she was rapped',
    'rapped',
    'rapping',
    'they rapped him in the park',
    'he rapped on the door of the victim',
    'rapped on the door after the assault',
  ]
  it.each(euphemism)('withholds %s in every locale', (text) => {
    for (const locale of [...everyLocale, 'en-US', 'en-GB', 'fr-FR'])
      expect(screen(text, locale).disposition, `${locale} ${text}`).not.toBe('pass')
  })

  const clean = [
    'A chink of light came under the door.',
    'Chinks of light fell on the floor.',
    'There were chinks of sunlight through the curtains.',
    'He found chinks in the armour.',
    'The chinks in the wall let in the wind.',
    'Chinks in the armor at dawn.',
    'Only a few chinks of daylight in the room.',
    'Look for chinks in the fabric.',
  ]
  const hostile = [
    'kill the chinks',
    'chinks go home',
    'chinks',
    'chink',
    'all chinks are vermin',
    'stupid chinks of light',
    'you chinks in the armour',
    'chinks of light, go home',
    'chinks in the wall people',
    'those chinks in the armour',
    'chinks of light. kill them',
    'chinks of light\nyou animals',
    'the chinks in the wall are vermin',
    'chinks in the armour and the asian people',
    'chinkks of light',
    'a chink in the armour you animals',
  ]
  it.each(clean)('passes %s under declared English', (text) => {
    for (const locale of ['en-US', 'en-GB'])
      expect(screen(text, locale).disposition, `${locale} ${text}`).toBe('pass')
  })
  it('keeps the same chinks frames withheld without declared English', () => {
    for (const text of clean)
      for (const locale of ['fr-FR', 'pt-BR', 'de-DE', null])
        expect(screen(text, locale).disposition, `${locale} ${text}`).not.toBe('pass')
  })
  it.each(hostile)('withholds %s in every locale', (text) => {
    for (const locale of [...everyLocale, 'en-US', 'en-GB'])
      expect(screen(text, locale).disposition, `${locale} ${text}`).not.toBe('pass')
  })
})

describe('round 7i spices, retards and tapetes', () => {
  it('passes spices everywhere and keeps spics blocked', () => {
    for (const locale of [...everyLocale, 'en-US'])
      for (const text of [
        'Cinnamon, cumin and other spices',
        'spices',
        'Warm spices dye the wool',
      ])
        expect(screen(text, locale).disposition, `${locale} ${text}`).toBe('pass')
    for (const text of ['spics', 'all spics', 'spiices go home'])
      expect(screen(text, 'en-US').disposition, text).not.toBe('pass')
  })

  const verb = [
    'Wax retards the drying of the fabric.',
    'This finish retards its fading.',
    'It retards their growth of mould.',
    'Cold retards the ageing.',
    'A coating that retards the wear of the seam.',
  ]
  const objectless = [
    'retards the',
    'It retards the.',
    'This retards the',
    'that retards the',
    'It retards their',
    'wax retards the dumb ones',
    'it retards the growth you animals',
  ]
  it.each(objectless)('withholds the objectless or open verb frame %s', (text) => {
    for (const locale of [...everyLocale, 'en-US', 'en-GB'])
      expect(screen(text, locale).disposition, `${locale} ${text}`).not.toBe('pass')
  })
  it('passes it, this and that as subjects with a real object', () => {
    for (const text of [
      'It retards the growth of the plant.',
      'This retards the process.',
      'That retards their growth.',
      'It retards the drying of the fabric over time.',
    ])
      for (const locale of ['en-US', 'en-GB'])
        expect(screen(text, locale).disposition, `${locale} ${text}`).toBe('pass')
  })

  const noun = [
    'retards',
    'all retards',
    'you retards',
    'those retards the dumb ones',
    'retards the people',
    'stupid retards the fabric',
    'retards the growth, you animals',
    'they retards the',
    'retards are vermin',
    'the retards',
    'retards go home',
    'kill the retards',
  ]
  it.each(verb)('passes the verb %s under declared English', (text) => {
    for (const locale of ['en-US', 'en-GB'])
      expect(screen(text, locale).disposition, `${locale} ${text}`).toBe('pass')
  })
  it.each(noun)('withholds %s in every locale', (text) => {
    for (const locale of [...everyLocale, 'en-US', 'en-GB'])
      expect(screen(text, locale).disposition, `${locale} ${text}`).not.toBe('pass')
  })

  it('clears tapetes only inside the plural rug phrases under declared Portuguese', () => {
    for (const text of [
      'Tapetes de yoga em algodão',
      'Crianças sentadas nos tapetes',
      'Sapatos sobre os tapetes',
      'Tapetes persas e tapetes macios',
      'Tapetes da sala',
    ])
      for (const locale of ['pt-BR', 'pt-PT'])
        expect(screen(text, locale).disposition, `${locale} ${text}`).not.toBe('block')
    for (const text of [
      'Tapetes de yoga',
      'Crianças sentadas nos tapetes',
      'Brincando em tapetes persas',
    ])
      expect(screen(text, 'pt-BR').disposition, text).toBe('pass')
    for (const text of [
      'tapetes',
      'os tapetes',
      'nos tapetes',
      'tapetes.',
      'todos os tapetes são nojentos',
      'tapetess de yoga',
      'tapettes',
    ])
      for (const locale of [...everyLocale, 'pt-BR', 'pt-PT'])
        expect(screen(text, locale).disposition, `${locale} ${text}`).not.toBe('pass')
    for (const locale of ['fr-FR', 'en-US', 'es-ES', null])
      expect(screen('Tapetes de yoga', locale).disposition, String(locale)).not.toBe(
        'pass'
      )
  })

  it('records the plural collisions that stay blocked', () => {
    for (const text of [
      'raped',
      'rapes',
      'whores',
      'hures',
      'negroes',
      'subnormals',
      'saloopes',
    ])
      for (const locale of everyLocale)
        expect(screen(text, locale).disposition, `${locale} ${text}`).not.toBe('pass')
  })
})

describe('round 7k the rape family is handled as a family', () => {
  const locales = [...everyLocale, 'en-US', 'en-GB', 'fr-FR']
  const evasions = [
    // leet and symbols inside the word
    'r@ped',
    'r@pe',
    'r@ping',
    'r4ped',
    'r4pe',
    'rap3d',
    'rap3',
    'r@p3d',
    'R@PED her',
    '(r@ped)',
    'he r@ped her.',
    // short cuts of any length
    'ra ped',
    'ra-ped',
    'ra.ped',
    'r aped',
    'r ape',
    'ra pe d',
    'ra pe',
    'sa-ed her',
    'sa ed her',
    'gang ra ped',
    // small capitals and confusables
    'ʀaped',
    'ʀape',
    'ʀᴀᴘᴇᴅ',
    'ʀᴀᴘᴇ',
    'Rᴀᴘᴇᴅ',
    'ꜱᴀ-ᴇᴅ',
    'rаped',
    // typo forms
    'rapeing',
    'rapin',
    'raepd',
    'raype',
    'rayped',
    'rapd',
    'rapeed',
    // word forms
    'raper',
    'rapers',
    'rapey',
    'rapeable',
    'rapings',
    // compounds
    'gangrape',
    'gangraped',
    'gangrapes',
    'gangraping',
    'gangraper',
    'gang rape',
    'gang-raped',
    'g4ngr@ped',
  ]
  const reviewOnly = ['rapist', 'rapists', 'rap ed', 'rap e', 'rap es', 'rap ist']

  it.each(evasions)('withholds %s in every locale', (text) => {
    for (const locale of locales)
      expect(screen(text, locale).disposition, `${locale} ${text}`).toBe('block')
  })

  it.each(reviewOnly)('withholds %s in every locale', (text) => {
    for (const locale of locales)
      expect(screen(text, locale).disposition, `${locale} ${text}`).not.toBe('pass')
  })

  it('keeps ordinary words that contain or spell near the family clean', () => {
    for (const locale of locales)
      for (const text of [
        'wrapped',
        'draped',
        'trapped',
        'strapped',
        'scraped',
        'grapes',
        'rapeseed oil',
        'therapist',
        'therapists',
        'rapid',
        'rapidly',
        'rapport',
        'rapids',
        'trapeze',
        'rapier',
        'raptor',
        'Rapunzel',
        'rapt',
        'drape',
        'grape',
        'scrape',
        'napped',
        'sapped',
        'tapped',
        'A wrapped dress, draped sleeves and strapped sandals',
        'Grapes and rapeseed in the rapid therapist rapport',
      ])
        expect(screen(text, locale).disposition, `${locale} ${text}`).toBe('pass')
  })

  it('keeps ordinary copy with symbols inside and around words clean', () => {
    for (const locale of locales)
      for (const text of [
        'Sale! $20 off',
        '20% off + free shipping',
        'Wow!amazing dress',
        'Email us at hello@couture.com',
        'Price: $19.99 | free returns',
        'Rock&roll tee, size S+M',
        'C++ and A+ grade',
        'Buy 2+ get 1 free!',
        '@couturecast loves this',
        'Hot!! New!! Now!!',
        'a|b|c and x+y',
      ])
        expect(screen(text, locale).disposition, `${locale} ${text}`).toBe('pass')
  })
})

describe('round 7l censor characters, names and the rap half', () => {
  const locales = [...everyLocale, 'en-US', 'en-GB', 'fr-FR']
  it.each([
    'n*gger',
    'c*nt',
    'f*ggot',
    'wh*re',
    'r*pe',
    'r*ped',
    'r_ped',
    'r-pe',
    'r#pe',
    'r.pe',
    'n.gger',
    'ch#nk',
    'k*ke',
    'ra9ed her',
    'he r*ped her.',
    'ni-gger',
    'nig/ger',
    'n_igger',
    'nig*ger',
    'pu-ta',
  ])('withholds %s in every locale', (text) => {
    for (const locale of locales)
      expect(screen(text, locale).disposition, `${locale} ${text}`).not.toBe('pass')
  })

  it('clears the names Saed, Saeed and Rapin in name frames only', () => {
    for (const locale of locales)
      for (const text of [
        'Saed wears the oversized coat.',
        'by Saed',
        'designer Saed',
        'Meet Saed, our founder.',
        'Collection by Saeed',
        'Photographed by Rapin',
        'Hi Saed!',
        'Names such as Saad and Saeed are common.',
      ])
        expect(screen(text, locale).disposition, `${locale} ${text}`).toBe('pass')
    for (const locale of locales)
      for (const text of [
        'sa-ed her',
        'sa ed her',
        'saed her',
        'Saed assaulted her',
        'saed the girl',
        'the saed victim',
        'go home saed her',
        'raper',
        'the raper',
      ])
        expect(screen(text, locale).disposition, `${locale} ${text}`).not.toBe('pass')
  })

  it('does not rejoin rap and a copula or a name', () => {
    for (const locale of locales)
      for (const text of [
        'El rap es genial',
        'Mi rap es mejor',
        'Le rap est un art',
        'il rap e musica',
        'Der Rap ist laut',
        'Hip hop rap Ed Hardy tee',
      ])
        expect(screen(text, locale).disposition, `${locale} ${text}`).toBe('pass')
    for (const locale of locales)
      for (const text of ['rap ed her', 'rap e', 'rap ed', 'rap es', 'rap ist'])
        expect(screen(text, locale).disposition, `${locale} ${text}`).not.toBe('pass')
  })
})

describe('round 7m phrases with one obfuscated word, emoji letters and tag characters', () => {
  const locales = [...everyLocale, 'en-US', 'en-GB', 'fr-FR']
  it.each([
    'te voy a v*olar',
    'te voy a viol@r',
    'je vais te v*oler',
    'kill y*urself',
    'k*ll yourself',
    'kill yourse|f',
    'heil h!tler',
    'wh*te power',
    'te voy a m@tar',
    'kill yourse1f',
    'ky$',
    'k*ll y0urself',
    'blow j*b',
    'g@ng bang',
  ])('withholds %s in every locale', (text) => {
    for (const locale of locales)
      expect(screen(text, locale).disposition, `${locale} ${text}`).not.toBe('pass')
  })

  const glyphs: Record<string, (index: number) => string> = {
    regional: (index) => String.fromCodePoint(0x1f1e6 + index),
    'negative-circled': (index) => String.fromCodePoint(0x1f150 + index),
    'negative-squared': (index) => String.fromCodePoint(0x1f170 + index),
    squared: (index) => String.fromCodePoint(0x1f130 + index),
    circled: (index) => String.fromCodePoint(0x24d0 + index),
    parenthesized: (index) => String.fromCodePoint(0x249c + index),
    tag: (index) => String.fromCodePoint(0xe0061 + index),
  }
  const spell = (word: string, glyph: (index: number) => string): string =>
    [...word].map((ch) => glyph(ch.charCodeAt(0) - 97)).join('')

  it('reads emoji-letter and tag spellings of raped and faggot', () => {
    for (const locale of locales)
      for (const [name, glyph] of Object.entries(glyphs))
        for (const word of ['raped', 'faggot']) {
          const text = spell(word, glyph)
          expect(screen(text, locale).disposition, `${locale} ${name} ${word}`).not.toBe(
            'pass'
          )
          expect(
            screen(`he ${text} her`, locale).disposition,
            `${locale} ${name} he ${word} her`
          ).not.toBe('pass')
        }
  })

  it('reads the spelling beside real flags, in either order', () => {
    const flag = '\u{1F1EB}\u{1F1F7}'
    const raped = spell('raped', glyphs.regional as (index: number) => string)
    for (const text of [
      `${flag}${raped}`,
      `${raped}${flag}`,
      `${flag}${raped}${flag}`,
      `${flag} ${raped}`,
    ])
      for (const locale of locales)
        expect(screen(text, locale).disposition, `${locale} ${text}`).not.toBe('pass')
  })

  it('keeps flags clean: valid pairs, rows, beside words and subdivision flags', () => {
    for (const locale of locales)
      for (const text of [
        '\u{1F1EB}\u{1F1F7}',
        '\u{1F1FA}\u{1F1F8}\u{1F1EC}\u{1F1E7}\u{1F1EB}\u{1F1F7}\u{1F1E9}\u{1F1EA}',
        'Made in\u{1F1EE}\u{1F1F9}',
        '\u{1F1F9}\u{1F1F7} Teslimat',
        '\u{1F1F0}\u{1F1EE}\u{1F1F0}\u{1F1EA} team',
        '\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F} fans',
      ])
        expect(screen(text, locale).disposition, `${locale} ${text}`).toBe('pass')
  })
})

describe('round 7b a high-severity term cut in two whole words', () => {
  it('withholds tap ete and other two-way cuts with both parts of three letters or more', () => {
    for (const text of [
      'tap ete',
      'nazi sta',
      'estu pro',
      'mari cas',
      'tra veco',
      'boq uete',
    ])
      for (const locale of everyLocale)
        expect(screen(text, locale).disposition, `${locale} ${text}`).not.toBe('pass')
  })

  it('leaves ordinary pairs with a function word alone', () => {
    for (const text of ['A via do rio é linda', 'Pela via do bordado', 'Bi cha', 'Mai ô'])
      expect(screen(text).disposition, text).toBe('pass')
  })
})
