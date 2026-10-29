import { describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { CommunityTextScreener } from './community-text-screener'

/**
 * Round 8b Portuguese repair: amador, ariano, consolo and burro are ordinary Portuguese
 * nouns that the Portuguese list also carries. They clear on grammar evidence under declared
 * Portuguese and stay withheld in insult, sexual and hate frames. Every sentence below is
 * written for this spec; none comes from a holdout or corpus fixture.
 */
vi.setConfig({ testTimeout: 180_000 })
const screener = new CommunityTextScreener()
const screen = (text: string, locale: string | null = 'pt-BR') =>
  screener.screen({ text, locale, field: 'altText' })
const portuguese = ['pt-BR', 'pt-PT']
const elsewhere = ['fr-FR', 'en-US', 'es-ES', 'de-DE', 'it-IT', 'tr-TR', null]

const allow = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, '../../../policies/community-screening/allow-list-v1.json'),
    'utf8'
  )
) as {
  literalContexts: {
    terms: string[]
    evidence?: string[]
    vetoes?: string[]
    vetoRadius?: number
    textVetoes?: string[]
  }[]
}
const contextFor = (term: string) =>
  allow.literalContexts.find(
    (context) => context.terms.includes(term) && context.evidence
  )

describe('round 8b ordinary Portuguese nouns that the Portuguese list carries', () => {
  const clean = [
    'Um amador de moda no desfile de verão.',
    'O fotógrafo amador registrou a coleção.',
    'Casaco para o amador de caminhadas.',
    'Signo de áries: o ariano veste vermelho.',
    'O ariano da turma escolhe o casaco de lã.',
    'Palavras de consolo no desfile de outono.',
    'Prêmio de consolo para a equipe do ateliê.',
    'Bolsa de couro do burro com forro de linho.',
    'O burro puxa a carroça de tecidos.',
    'Foto de um burro no pasto, com sela de feltro.',
    'Estampa de um burro em tons de cinza.',
  ]
  it.each(clean)('passes under declared Portuguese: %s', (text) => {
    for (const locale of portuguese)
      expect(screen(text, locale).disposition, `${locale} ${text}`).toBe('pass')
  })
  it.each(clean)('stays withheld without declared Portuguese: %s', (text) => {
    for (const locale of elsewhere)
      expect(screen(text, locale).disposition, `${locale} ${text}`).not.toBe('pass')
  })

  it('keeps the bare words and the insult, sexual, hate and porn frames withheld', () => {
    for (const text of [
      'amador',
      'ariano',
      'consolo',
      'burro',
      'Você é burro.',
      'Seu burro!',
      'Que burro, esqueceu a bolsa.',
      'Ele é um burro.',
      'Aquele burro de novo.',
      'O burro é um idiota.',
      'Burro e estúpido, o modelo.',
      'Um consolo realista de silicone.',
      'Um consolo sexual novo.',
      'Consolo com vibrador e prazer.',
      'Vídeo amador do desfile.',
      'Um amador nu na praia.',
      'Amador sexy no vídeo.',
      'O ariano da raça pura.',
      'Ariano nazista no desfile.',
      'O ariano superior e a morte dos outros.',
    ])
      for (const locale of [...portuguese, ...elsewhere])
        expect(screen(text, locale).disposition, `${locale} ${text}`).not.toBe('pass')
  })

  it('keeps stretched, spaced, accent-changed and leet spellings withheld', () => {
    for (const text of [
      'Um amadoor de moda no desfile.',
      'Um a m a d o r de moda no desfile.',
      'O b u r r o puxa a carroça de tecidos.',
      'O burrro puxa a carroça de tecidos.',
      'Palavras de c0nsolo no desfile de outono.',
      'O arian0 da turma escolhe o casaco de lã.',
    ])
      for (const locale of [...portuguese, ...elsewhere])
        expect(screen(text, locale).disposition, `${locale} ${text}`).not.toBe('pass')
  })

  it('does not let the evidence launder a neighbouring term', () => {
    for (const text of [
      'Um amador de moda e puta no desfile.',
      'Palavras de consolo, filho da puta.',
      'O burro puxa a carroça, seu viado.',
      'O ariano da turma, caralho.',
    ])
      for (const locale of portuguese)
        expect(screen(text, locale).disposition, `${locale} ${text}`).not.toBe('pass')
  })

  it('pins the four contexts with their veto lists', () => {
    const burro = contextFor('burro')
    expect(burro?.evidence?.length).toBeLessThan(15)
    expect(burro?.vetoes).toEqual(expect.arrayContaining(['você', 'seu', 'é', 'que']))
    expect(burro?.vetoRadius).toBe(3)
    expect(contextFor('amador')?.vetoes).toEqual(expect.arrayContaining(['vídeo']))
    expect(contextFor('amador')?.textVetoes).toEqual(
      expect.arrayContaining(['nua', 'sexo'])
    )
    expect(contextFor('ariano')?.textVetoes).toEqual(
      expect.arrayContaining(['nazista', 'raça', 'superior'])
    )
    expect(contextFor('consolo')?.textVetoes).toEqual(
      expect.arrayContaining(['vibrador', 'sexual', 'silicone'])
    )
  })

  it('clears every term beside every evidence word and withholds beside every veto', () => {
    for (const term of ['amador', 'ariano', 'consolo', 'burro']) {
      const context = contextFor(term)
      for (const word of context?.evidence ?? [])
        for (const text of [`Foto ${word} ${term} aqui`, `Foto ${term} ${word} aqui`])
          if (!(context?.vetoes ?? []).includes(word))
            for (const locale of portuguese)
              expect(screen(text, locale).disposition, `${locale} ${text}`).toBe('pass')
      for (const veto of [...(context?.vetoes ?? []), ...(context?.textVetoes ?? [])])
        for (const locale of portuguese)
          expect(
            screen(`Foto de um ${term} ${veto} aqui`, locale).disposition,
            `${locale} ${term} ${veto}`
          ).not.toBe('pass')
    }
  })
})

describe('round 8b reviewer findings: French insults and pé de leaks stay withheld', () => {
  const french = [
    'Espece de tapete va mourir ce soir',
    'quelle espece de tapete tu es',
    'mon tapete de frere est la',
    'ce vieux tapete de voisin',
    'cette tapete de directeur',
    'seu tapete gay vai morrer',
    'sale tapete de directeur ce soir',
    'ton tapete de pere est la',
    'tes tapetes sont des ordures',
    'ces tapetes de voisins sont la',
    'il est un tapete avec son copain',
    'elle et son tapete de mari',
    'nous sommes dans un tapete de merde',
    'vous et vos tapetes pour la vie',
    'Espece de tapetes et de lixo',
  ]
  it.each(french)('withholds under every locale: %s', (text) => {
    for (const locale of [...portuguese, ...elsewhere])
      expect(screen(text, locale).disposition, `${locale} ${text}`).not.toBe('pass')
  })

  const footLeaks = [
    'ele é um pé de. Vai embora',
    'você é um pé de #fora',
    'olha o pé de! Fora daqui',
    'ele é um pé de gay',
    'seu pé de bobo',
    'ele é um pé de, vai embora',
    'ela é um pé de\nvai embora',
    'ele é um pé do 😃 chefe',
    'seu pé do idiota',
    'o pé de burro mesmo',
  ]
  it.each(footLeaks)('withholds under every locale: %s', (text) => {
    for (const locale of [...portuguese, ...elsewhere])
      expect(screen(text, locale).disposition, `${locale} ${text}`).not.toBe('pass')
  })

  it('withholds every French insult frame built on the rug noun', () => {
    const leads = [
      '',
      'sale',
      'espece de',
      'quelle espece de',
      'quel',
      'ce',
      'cette',
      'ce vieux',
      'mon',
      'ton',
      'son',
      'un',
      'une',
      'le',
      'les',
      'tu es un',
      't es un',
      'vieux',
      'et ce',
    ]
    const tails = [
      '',
      'de directeur',
      'de voisin',
      'de frere',
      'est la',
      'va mourir',
      'tu es',
      'gay',
      'de merde',
      'et son copain',
      'pour la vie',
    ]
    for (const noun of ['tapete', 'tapetes'])
      for (const lead of leads)
        for (const tail of tails) {
          const text = [lead, noun, tail].filter(Boolean).join(' ')
          for (const locale of portuguese)
            expect(screen(text, locale).disposition, `${locale} ${text}`).not.toBe('pass')
        }
  })

  it('keeps the ordinary foot-of copy clearing', () => {
    for (const text of [
      'Um pé de laranja no quintal da loja.',
      'Sapatos ao pé do sofá da sala.',
      'Calça pé de elefante com cós alto.',
      'Menino sentado ao pé de uma árvore.',
      'Sandálias ao pé da cama de casal.',
    ])
      for (const locale of portuguese)
        expect(screen(text, locale).disposition, `${locale} ${text}`).toBe('pass')
  })

  it('keeps the rug copy clearing in Portuguese grammar', () => {
    for (const text of [
      'Menina descalça no tapete da sala.',
      'Duas crianças sentadas sobre o tapete.',
      'Tapete de crochê em tons neutros.',
      'Sapatos pretos sobre tapetes persas.',
      'Bebê engatinhando pelos tapetes do corredor.',
      'Tênis branco ao lado do tapete de juta.',
    ])
      for (const locale of portuguese)
        expect(screen(text, locale).disposition, `${locale} ${text}`).toBe('pass')
  })
})

describe('round 8c reviewer findings: mixed French, ariano and burro frames', () => {
  const mixed = [
    'Regardez o tapete danser devant tout le monde',
    'Hier o tapete marchait derriere la boulangerie',
    'Nous avons vu o tapete dans une rue',
    'Elle dit que o tapete est sale ici',
    'Voila um tapete avec des amis',
    'Quand o tapete arrive chez nous',
    'Il faut ne pas laisser o tapete sur le sol',
    'Notre tapete est aussi grand comme votre sol',
    'Alors o tapete sous la table',
    'Cet homme et o tapete sans leur chien',
  ]
  it.each(mixed)('withholds mixed French under every locale: %s', (text) => {
    for (const locale of [...portuguese, ...elsewhere])
      expect(screen(text, locale).disposition, `${locale} ${text}`).not.toBe('pass')
  })

  it('keeps ordinary Portuguese copy with ou, três, pás and que clearing', () => {
    for (const text of [
      'Sapatos sobre o tapete ou sobre o piso da sala.',
      'Três pares de sapatos sobre o tapete da sala.',
      'Sapatos que ficam sobre o tapete da sala todo dia.',
    ])
      for (const locale of portuguese)
        expect(screen(text, locale).disposition, `${locale} ${text}`).toBe('pass')
  })

  it('withholds ariano beside white, nation, pride, blood, power and ideology words', () => {
    for (const text of [
      'O ariano da raça branca no desfile.',
      'O ariano branco e o orgulho da nação.',
      'O ariano de sangue puro no desfile.',
      'O ariano do movimento nacionalista no desfile.',
      'O ariano e a ideologia do poder no desfile.',
      'O ariano e a pureza no desfile.',
      'O ariano da nacao no desfile.',
    ])
      for (const locale of portuguese)
        expect(screen(text, locale).disposition, `${locale} ${text}`).not.toBe('pass')
  })

  it('withholds the article plus burro plus do or da plus a person frame', () => {
    for (const text of [
      'Foto do burro do chefe no escritório.',
      'Foto do burro do vizinho no quintal.',
      'O burro da professora no pasto da escola.',
      'O burro dos irmãos no quintal da loja.',
      'Um burro do gerente na reunião de moda.',
    ])
      for (const locale of portuguese)
        expect(screen(text, locale).disposition, `${locale} ${text}`).not.toBe('pass')
    for (const text of [
      'O burro do pasto puxa a carroça de tecidos.',
      'O burro da fazenda usa sela de feltro.',
    ])
      for (const locale of portuguese)
        expect(screen(text, locale).disposition, `${locale} ${text}`).toBe('pass')
  })
})

describe('round 8d: minors, toys, hate frames, job nouns and French letters', () => {
  const everywhere = (text: string) => {
    for (const locale of [...portuguese, ...elsewhere])
      expect(screen(text, locale).disposition, `${locale} ${text}`).not.toBe('pass')
  }
  const inPortuguese = (text: string) => {
    for (const locale of portuguese)
      expect(screen(text, locale).disposition, `${locale} ${text}`).not.toBe('pass')
  }

  it.each([
    'Um amador de moda e as menores no desfile.',
    'Um amador de moda com uma menor no desfile.',
    'Um amador de moda e a teen do ateliê.',
    'Um amador de moda e a novinha do ateliê.',
    'Um amador de moda e as novinhas do ateliê.',
    'Um amador de moda e o novinho do ateliê.',
    'Um amador de moda e o incesto no desfile.',
    'Um amador de moda e a enteada do ateliê.',
    'Um amador de moda e o enteado do ateliê.',
    'Um amador de moda e a safada do ateliê.',
    'Um amador de moda e o safado do ateliê.',
    'Um amador de moda e a menina do ateliê.',
    'Um amador de moda e a criança do ateliê.',
    'Um amador de moda e a adolescente do ateliê.',
    'Um amador de moda e a colegial do ateliê.',
  ])('withholds amador beside minor and incest words: %s', inPortuguese)

  it.each([
    'Palavras de consolo e látex no desfile.',
    'Palavras de consolo e latex no desfile.',
    'Palavras de consolo de vidro no desfile.',
    'Palavras de consolo e cinta no desfile.',
    'Palavras de consolo e cu no desfile.',
    'Un consolo de goma en la tienda.',
    'Compre un consolo de goma hoje.',
  ])('withholds consolo beside toy words and the Spanish frame: %s', inPortuguese)

  it.each([
    'Heil o ariano no desfile.',
    'O ariano heil no desfile.',
    'Orgullo de ser ariano no desfile.',
    'O orgullo de ser ariano no desfile.',
  ])('withholds ariano beside heil and the Spanish frame: %s', inPortuguese)

  it.each([
    'Pureza ariana',
    'Raça ariana pura',
    'A raça ariana no desfile',
    'As raças arianas',
    'Supremacia ariana',
    'Nação ariana',
  ])('withholds the ariana hate phrases in every locale: %s', everywhere)

  it('keeps the given name Ariana and the star sign copy clearing', () => {
    for (const text of [
      'Ariana Grande usa casaco longo no desfile.',
      'Signo de áries: o ariano veste vermelho.',
    ])
      for (const locale of portuguese)
        expect(screen(text, locale).disposition, `${locale} ${text}`).toBe('pass')
  })

  it.each([
    'Foto do burro do carteiro no quintal.',
    'Foto do burro da motorista no quintal.',
    'Foto do burro do porteiro no quintal.',
    'Foto do burro do garçom no quintal.',
    'Foto do burro do gerente no quintal.',
    'Foto do burro do entregador no quintal.',
    'Foto do burro dos carteiros no quintal.',
    'Foto do burro da atendente no quintal.',
    'Foto de un hijo de burro en la calle.',
  ])('withholds burro beside a job noun used for a person: %s', inPortuguese)

  it.each([
    'Sapatos sobre o tapete pas la sala.',
    'Sapatos sobre o tapete, très beau.',
    'Sapatos sobre o tapete où ça.',
    'Sapatos sobre o tapete, bœuf.',
    'Sapatos sobre o tapete naïf.',
    'Sapatos sobre o tapete, déjà û.',
    'Sapatos sobre o tapete e ë.',
    'Sapatos sobre o tapete ÿ ü.',
    'Sapatos sobre o tapete î è.',
  ])('withholds the rug noun beside a French sign: %s', inPortuguese)

  it('keeps Portuguese copy with accents, ou and três clearing', () => {
    for (const text of [
      'Sapatos sobre o tapete ou sobre o piso da sala.',
      'Três pares de sapatos sobre o tapete da sala, à noite.',
      'Calçado côncavo sobre o tapete da sala, após o café.',
    ])
      for (const locale of portuguese)
        expect(screen(text, locale).disposition, `${locale} ${text}`).toBe('pass')
  })
})
