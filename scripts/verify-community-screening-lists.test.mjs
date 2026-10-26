import { test } from 'node:test'
import assert from 'node:assert/strict'
import { literalContextProblems } from './verify-community-screening-lists.mjs'

const context = {
  language: 'it',
  terms: ['montare'],
  objects: ['fibbia'],
  connectors: ['da'],
  maxDistance: 5,
  reason: 'A bounded literal assembly clause preserves ordinary garment construction.',
}

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

test('literal context generation rejects every deliberate review term', () => {
  for (const term of ['lolita', 'baiser']) {
    assert.deepEqual(
      literalContextProblems([{ ...context, terms: [term] }], ['lolita', 'baiser']),
      ['a literal context clears a deliberate review term']
    )
  }
  assert.deepEqual(literalContextProblems([context], ['lolita', 'baiser']), [])
})
