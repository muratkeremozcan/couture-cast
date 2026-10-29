import { describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { CommunityTextScreener } from './community-text-screener'

/**
 * Round 8 Portuguese repair. The sentences are generic fashion copy written for this
 * spec; none comes from a holdout or a corpus fixture. The families are generated from
 * the policy files, so a form added to a family is tested in every position.
 */
vi.setConfig({ testTimeout: 180_000 })
const screener = new CommunityTextScreener()
const screen = (text: string, locale: string | null = 'pt-BR') =>
  screener.screen({ text, locale, field: 'altText' })
const portuguese = ['pt-BR', 'pt-PT']
const elsewhere = ['fr-FR', 'en-US', 'es-ES', 'de-DE', 'it-IT', 'tr-TR', null]

const policyDir = path.resolve(__dirname, '../../../policies/community-screening')
const readPolicy = <T>(file: string): T =>
  JSON.parse(fs.readFileSync(path.join(policyDir, file), 'utf8')) as T
const allow = readPolicy<{
  scopedPhrases: { entry: string; complements: string[]; before: string[] }[]
  literalContexts: {
    language: string
    terms: string[]
    evidence?: string[]
    evidenceRadius?: number
  }[]
}>('allow-list-v1.json')
const bank = readPolicy<{
  constructions: {
    target: string
    phrases: string[]
    contextPhrases?: string[]
    contextMinWords?: number
    textForbidden?: string[]
  }[]
}>('reviewed-occurrence-constructions-v1.json')
const family = allow.literalContexts.find((context) => context.evidence?.length)
const familyTerms = family?.terms ?? []
const evidence = family?.evidence ?? []

describe('round 8 class A: the floor-rug noun in every position', () => {
  const clean = [
    'Menina descalça no tapete da sala.',
    'No tapete, a menina escolhe o par de sandálias.',
    'Duas crianças sentadas sobre o tapete.',
    'Meias de lã espalhadas em cima do tapete.',
    'Tênis branco ao lado do tapete de juta.',
    'Bebê engatinhando pelos tapetes do corredor.',
    'Botas alinhadas sob o tapete.',
    'Sapatos pretos sobre tapetes persas.',
    'O look começa no tapete, segue na escada e termina no jardim.',
    'Menino de pé em tapetes coloridos, com chinelos nos pés.',
    'Tapete de crochê em tons neutros.',
    'Tapete bege com franjas e sapatilhas ao lado.',
    'Tapetes macios na entrada e galochas na porta.',
    'Casaco dobrado sobre o tapete de lã.',
    'Roupas separadas para doação sobre os tapetes.',
    'Sapatos pretos sobre tapetes persas que são bem leves, lá na sala, mais três pares.',
  ]
  it.each(clean)('passes under declared Portuguese: %s', (text) => {
    for (const locale of portuguese)
      expect(screen(text, locale).disposition, `${locale} ${text}`).toBe('pass')
  })
  it.each(clean)('stays withheld without declared Portuguese: %s', (text) => {
    for (const locale of elsewhere)
      expect(screen(text, locale).disposition, `${locale} ${text}`).not.toBe('pass')
  })

  it('keeps bare frames of three words or fewer withheld in every locale', () => {
    for (const text of [
      'tapete',
      'o tapete',
      'no tapete',
      'do tapete',
      'sobre o tapete',
      'tapete de',
      'Tapete.',
      'os tapetes',
    ])
      for (const locale of [...portuguese, ...elsewhere])
        expect(screen(text, locale).disposition, `${locale} ${text}`).not.toBe('pass')
  })

  it('keeps every disguised spelling and every insult frame withheld', () => {
    for (const text of [
      'Menina descalça no tapette da sala.',
      'Menina descalça no tapeete da sala.',
      'Menina descalça no t4pete da sala.',
      'Menina descalça no tap ete da sala.',
      'Menina descalça no t a p e t e da sala.',
      'Menina descalça no tapete. tapette',
      'Menina descalça no Tapete! sale tapete',
      'tu es un tapete grande',
      'todos os tapetes são nojentos',
      'odeio esse tapete sujo',
      'Menina descalça no tapete da sala puta',
      'Menina descalça sobre o tapete e viado',
    ])
      for (const locale of [...portuguese, ...elsewhere])
        expect(screen(text, locale).disposition, `${locale} ${text}`).not.toBe('pass')
  })

  it('pins the grammar-evidence phrase bank', () => {
    for (const rule of bank.constructions.filter((entry) =>
      ['tapete', 'tapetes'].includes(entry.target)
    )) {
      expect(rule.contextMinWords).toBe(4)
      expect(rule.contextPhrases?.length).toBeGreaterThan(15)
      for (const phrase of rule.contextPhrases ?? [])
        expect(phrase.split(' ').filter((word) => word === rule.target)).toHaveLength(1)
      for (const hostile of ['nojentos', 'lixo', 'odeio', 'morram'])
        expect(rule.textForbidden).toContain(hostile)
    }
  })

  it('clears each grammar-evidence phrase inside a longer text, in Portuguese only', () => {
    for (const rule of bank.constructions.filter((entry) =>
      ['tapete', 'tapetes'].includes(entry.target)
    ))
      for (const phrase of rule.contextPhrases ?? []) {
        const text = `Fotografia de sapatos ${phrase} perto da janela`
        for (const locale of portuguese)
          expect(screen(text, locale).disposition, `${locale} ${text}`).toBe('pass')
        for (const locale of elsewhere)
          expect(screen(text, locale).disposition, `${locale} ${text}`).not.toBe('pass')
      }
  })
})

describe('round 8 class B: the foot-of noun phrase in every position', () => {
  const clean = [
    'Menino sentado ao pé de uma árvore.',
    'Menina ao pé de um muro com sandálias de couro.',
    'Um pé de meia listrada sobre a cama.',
    'Um pé de chinelo velho na porta.',
    'Sapatos alinhados no pé de uma escada.',
    'Cinto largo no pé de cada manequim.',
    'Ao pé do sofá, sapatos alinhados.',
    'Tênis ao pé do muro e chinelo ao pé da porta.',
    'Calça pé de elefante com cós alto.',
    'Pé de moleque e pé de galinha na estampa.',
    'Bota com o pé de cada modelo à mostra, ao pé de uma cadeira.',
  ]
  it.each(clean)('passes under declared Portuguese: %s', (text) => {
    for (const locale of portuguese)
      expect(screen(text, locale).disposition, `${locale} ${text}`).toBe('pass')
  })
  it.each(clean)('stays withheld without declared Portuguese: %s', (text) => {
    for (const locale of elsewhere)
      expect(screen(text, locale).disposition, `${locale} ${text}`).not.toBe('pass')
  })

  it('keeps the bare, trailing and disguised shapes withheld in every locale', () => {
    for (const text of [
      'pé de',
      'ao pé de',
      'Calçar o pé de',
      'Apoie no pé do',
      'pé dé',
      'ao pé dé uma árvore',
      'ao pe de uma árvore',
      'ao pé  dé uma árvore',
      'ao pé-dé uma árvore',
      'ao pé.de uma árvore',
      'ao pé_de uma árvore',
    ])
      for (const locale of [...portuguese, ...elsewhere])
        expect(screen(text, locale).disposition, `${locale} ${text}`).not.toBe('pass')
  })

  it('names no person among the complements and keeps the left words to function words', () => {
    const people = ['bebê', 'criança', 'filho', 'menino', 'menina', 'noivo', 'atleta']
    for (const { complements, before } of allow.scopedPhrases) {
      for (const person of people) expect(complements).not.toContain(person)
      expect(before.length).toBeGreaterThan(10)
    }
  })
})

describe('round 8 classes C to G: ordinary words equal to a foreign or backstop term', () => {
  const clean = [
    // jumping, a substituted letter from the harassment term
    'A menina que pula na poça usa galocha amarela.',
    'Quem pula etapas perde o caimento da peça.',
    'O menino pula corda de tênis branco.',
    'Pule a poça com a bota de borracha.',
    // mould, the English backstop
    'Evite mofo nos sapatos de couro em dias úmidos.',
    'O mofo aparece no couro guardado sem ar.',
    'Couro com mofo pede cuidado e vinagre.',
    // playing, an Italian list term
    'O jovem brinca com o gato sobre o tapete da sala.',
    'Ela brinca com a cachorrinha de laço rosa.',
    // the water tap, a Portuguese list term
    'Teste a capa de chuva sob a torneira da pia.',
    'A água da torneira escorre pela jaqueta.',
    // hunting, the folded cedilla
    'Na caça às calças certas, o provador ajuda.',
    'A caça ao casaco ideal começa pelo tecido.',
    // the rest of the family
    'Bolo de fava com açúcar mascavo na bandeja.',
    'Estampa de vaca em preto e branco na saia.',
    'A musa da coleção veste linho cru.',
    'Um trio de blusas lisas no cabide.',
    'Camisa com estampa de porco e flores.',
    'Vestido com pompa nas mangas e laço atrás.',
  ]
  it.each(clean)('passes under declared Portuguese: %s', (text) => {
    for (const locale of portuguese)
      expect(screen(text, locale).disposition, `${locale} ${text}`).toBe('pass')
  })
  it.each(clean)('stays withheld without declared Portuguese: %s', (text) => {
    for (const locale of elsewhere)
      expect(screen(text, locale).disposition, `${locale} ${text}`).not.toBe('pass')
  })

  it('keeps the bare words withheld', () => {
    for (const word of familyTerms)
      for (const locale of [...portuguese, ...elsewhere])
        expect(screen(word, locale).disposition, `${locale} ${word}`).not.toBe('pass')
  })

  it('keeps stretched, spaced, leet and accent-stripped spellings withheld', () => {
    for (const text of [
      'O jovem brrinca com o gato.',
      'Teste a capa sob a torn3ira.',
      'Na caca às calças certas.',
    ])
      for (const locale of [...portuguese, ...elsewhere])
        expect(screen(text, locale).disposition, `${locale} ${text}`).not.toBe('pass')
  })

  it('does not let the evidence launder a neighbouring term', () => {
    for (const text of [
      'A menina que pula e puta na poça.',
      'Evite mofo nos sapatos, seu viado.',
      'Teste a capa sob a torneira e caralho.',
      'O jovem brinca com o gato, filho da puta.',
    ])
      for (const locale of portuguese)
        expect(screen(text, locale).disposition, `${locale} ${text}`).not.toBe('pass')
  })
})

describe('round 8 the family is closed over its forms and its evidence', () => {
  it('holds the reviewed term set and never a high-severity term', () => {
    expect(familyTerms).toEqual([
      'pula',
      'pule',
      'brinca',
      'monta',
      'topa',
      'fava',
      'vaca',
      'musa',
      'pataca',
      'folar',
      'rocio',
      'trio',
      'asno',
      'drogas',
      'porca',
      'porco',
      'sega',
      'pompa',
      'torneira',
      'mofo',
      'caça',
    ])
    expect(family?.language).toBe('pt')
    expect(family?.evidenceRadius).toBe(2)
  })

  it('clears every term beside every evidence word on either side, in Portuguese only', () => {
    for (const term of familyTerms)
      for (const word of evidence)
        for (const text of [`Foto ${word} ${term} aqui`, `Foto ${term} ${word} aqui`]) {
          for (const locale of portuguese)
            expect(screen(text, locale).disposition, `${locale} ${text}`).toBe('pass')
        }
  })

  it('does not reach across punctuation, a line break or an emoji', () => {
    for (const term of familyTerms)
      for (const text of [
        `Foto da. ${term}`,
        `Foto da\n${term}`,
        `Foto da 😃 ${term}`,
        `Foto da, ${term}`,
        `${term}, da foto`,
      ])
        for (const locale of portuguese)
          expect(screen(text, locale).disposition, `${locale} ${text}`).not.toBe('pass')
  })

  it('keeps every term withheld without declared Portuguese', () => {
    for (const term of familyTerms)
      for (const word of ['o', 'da', 'com'])
        for (const locale of elsewhere)
          expect(
            screen(`Foto ${word} ${term} aqui`, locale).disposition,
            `${locale} ${term}`
          ).not.toBe('pass')
  })
})
