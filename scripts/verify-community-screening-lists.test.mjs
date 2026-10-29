import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
const reviewedBank = JSON.parse(
  fs.readFileSync(
    new URL(
      '../apps/api/policies/community-screening/reviewed-occurrence-constructions-v1.json',
      import.meta.url
    ),
    'utf8'
  )
).constructions
import {
  literalContextProblems,
  globallyAllowsOccurrenceTarget,
  occurrenceConstructionProblems,
} from './verify-community-screening-lists.mjs'

const context = {
  language: 'it',
  terms: ['montare'],
  objects: ['fibbia'],
  connectors: ['da'],
  maxDistance: 5,
  reason: 'A bounded literal assembly clause preserves ordinary garment construction.',
}

describe('literal assembly contexts', () => {
  test('literal assembly rules accept bounded literal token sets', () => {
    assert.deepEqual(literalContextProblems([context]), [])
    assert.deepEqual(
      literalContextProblems([{ ...context, maxDistance: 1, connectors: [] }]),
      []
    )
    assert.deepEqual(literalContextProblems([{ ...context, maxDistance: 6 }]), [])
  })

  test('literal assembly rules reject malformed or unbounded grammar before generation', () => {
    for (const value of [null, {}, 'montare'])
      assert.ok(literalContextProblems(value).length)
    for (const mutation of [
      { terms: [] },
      { terms: ['montare', 'montare'] },
      { terms: ['m0ntare'] },
      { terms: ['Montare'] },
      { objects: ['borsa nuova'] },
      { objects: [] },
      { connectors: null },
      { connectors: ['.'] },
      { maxDistance: 0 },
      { maxDistance: 7 },
      { maxDistance: 2.5 },
      { language: 'xx' },
      { reason: 'short' },
    ])
      assert.ok(
        literalContextProblems([{ ...context, ...mutation }]).length,
        JSON.stringify(mutation)
      )
    assert.ok(literalContextProblems([null]).length)
  })

  test('grammar-evidence contexts accept a bounded evidence list and no object nouns', () => {
    const evidenceContext = {
      ...context,
      terms: ['brinca'],
      objects: [],
      connectors: [],
      maxDistance: 1,
      evidence: ['com', 'o'],
      evidenceRadius: 2,
    }
    assert.deepEqual(literalContextProblems([evidenceContext]), [])
    for (const mutation of [
      { evidence: [] },
      { evidence: ['com', 'com'] },
      { evidence: ['c0m'] },
      { evidence: ['com tudo'] },
      { evidenceRadius: 0 },
      { evidenceRadius: 5 },
      { evidenceRadius: 1.5 },
      { objects: [], evidence: undefined },
    ])
      assert.ok(
        literalContextProblems([{ ...evidenceContext, ...mutation }]).length,
        JSON.stringify(mutation)
      )
  })

  test('literal context generation rejects every deliberate review term', () => {
    for (const term of ['lolita', 'baiser']) {
      assert.deepEqual(
        literalContextProblems([{ ...context, terms: [term] }], ['lolita', 'baiser']),
        ['a literal context clears a deliberate review term']
      )
    }
    assert.deepEqual(literalContextProblems([context], ['lolita', 'baiser']), [])
  })

  test('generic context generation rejects high literal, folded and deleted aliases', () => {
    for (const term of ['retard', 'niga', 'nïga', 'krüpel'])
      assert.ok(
        literalContextProblems(
          [{ ...context, terms: [term] }],
          [],
          ['retard', 'nigga', 'krüppel']
        ).includes('generic context targets a high-severity term')
      )
    for (const term of ['n1ga', 'nіga'])
      assert.ok(
        literalContextProblems([{ ...context, terms: [term] }], [], ['nigga']).length
      )
  })
})

describe('reviewed occurrence banks', () => {
  test('only the complete reviewed occurrence bank is generated', () => {
    const bank = reviewedBank.find((rule) => rule.target === 'retard')
    assert.deepEqual(occurrenceConstructionProblems([bank]), [])
    for (const changed of [
      { ...bank, language: 'en' },
      { ...bank, target: 'nigga' },
      { ...bank, phrases: ['you retard', ...bank.phrases.slice(1)] },
      { ...bank, phrases: bank.phrases.slice(1) },
      { ...bank, phrases: [...bank.phrases, bank.phrases[0]] },
      { ...bank, requiredDeclaredLanguages: [] },
      { ...bank, rejectedPrefixFrames: [] },
    ])
      assert.ok(occurrenceConstructionProblems([changed]).length)
    for (const input of [null, {}, [bank, bank], [null]])
      assert.ok(occurrenceConstructionProblems(input).length)
  })

  test('the reviewed carpet bank is complete and cannot introduce another exemption', () => {
    const bank = reviewedBank.find((rule) => rule.target === 'tapete')
    assert.deepEqual(occurrenceConstructionProblems([bank]), [])
    for (const mutation of [
      { language: 'en' },
      { target: 'tapette' },
      { phrases: bank.phrases.slice(1) },
      { phrases: ['you tapete', ...bank.phrases.slice(1)] },
    ])
      assert.ok(occurrenceConstructionProblems([{ ...bank, ...mutation }]).length)
  })

  test('Round5 source views must match the same trusted native construction records', () => {
    const targets = ['balls', 'toppa', 'bale', 'pişen']
    const banks = reviewedBank.filter((rule) => targets.includes(rule.target))
    // A renamed or dropped target would otherwise leave the loop below with nothing to check.
    assert.deepEqual(
      banks.map((bank) => bank.target),
      targets
    )
    for (const bank of banks) {
      assert.deepEqual(occurrenceConstructionProblems([bank]), [])
      for (const changed of [
        { ...bank, language: 'de' },
        { ...bank, target: bank.target + 'x' },
        { ...bank, phrases: bank.phrases.slice(1) },
        { ...bank, phrases: ['you ' + bank.target, ...bank.phrases.slice(1)] },
      ])
        assert.ok(occurrenceConstructionProblems([changed]).length)
    }
    for (const value of [
      'balls',
      'b4lls',
      'toppa',
      't0pa',
      'bale',
      'balle',
      'b4le',
      'pişen',
      'p1şen',
    ])
      assert.equal(globallyAllowsOccurrenceTarget(value), true, value)
    for (const value of ['ballroom', 'ballerina', 'topaz'])
      assert.equal(globallyAllowsOccurrenceTarget(value), false, value)
  })
})

describe('global allowances', () => {
  test('global allowances cannot exempt a folded or disguised reviewed occurrence target', () => {
    for (const entry of [
      'retard',
      'rétard',
      'rettard',
      'r3tard',
      'en r3tard',
      'ret@rd',
      'tapete',
      't4pete',
      'um tapete',
      'tapéte',
    ])
      assert.equal(globallyAllowsOccurrenceTarget(entry), true, entry)
    for (const entry of ['retarder', 'retardation', 'train', 'cone'])
      assert.equal(globallyAllowsOccurrenceTarget(entry), false, entry)
  })
})
