import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { assertIndependentHoldoutLocale } from './community-text-scenario-independence.mjs'

function singletonMetadata() {
  // Synthetic unit metadata only. This helper authors no holdout corpus wording.
  const text = 'Unit metadata fixture.'
  const textSha256 = createHash('sha256').update(text).digest('hex')
  const entries = Array.from({ length: 2000 }, (_, index) => ({
    id: `unit-${index}`,
    field: index < 1000 ? 'caption' : 'altText',
    text,
  }))
  const inventory = entries.map((item, index) => ({
    itemId: item.id,
    primaryScenario: `unit-scenario-${index}`,
    textSha256,
  }))
  return { entries, inventory }
}

test('accepts 2000 singleton scenarios with complete item and exact-text bindings', () => {
  const { entries, inventory } = singletonMetadata()
  const result = assertIndependentHoldoutLocale(entries, inventory.reverse())
  assert.equal(result.distinctPrimaryScenarios, 2000)
  assert.equal(result.maximumItemsPerScenario, 1)
  assert.deepEqual(result.itemsPerScenarioDistribution, { 1: 2000 })
  assert.deepEqual(result.fields, { caption: 1000, altText: 1000 })
  assert.equal(result.memberships.length, 2000)
})

test('rejects a caption and alt text describing one primary scenario', () => {
  const { entries, inventory } = singletonMetadata()
  inventory[1000].primaryScenario = inventory[0].primaryScenario
  assert.throws(
    () => assertIndependentHoldoutLocale(entries, inventory),
    /maximum must be 1/
  )
})

test('rejects four sentence variants of one scenario even with 2000 total items', () => {
  const { entries, inventory } = singletonMetadata()
  for (const index of [1, 1000, 1001]) {
    inventory[index].primaryScenario = inventory[0].primaryScenario
  }
  assert.throws(
    () => assertIndependentHoldoutLocale(entries, inventory),
    /maximum must be 1/
  )
})

for (const [name, mutate] of [
  ['missing inventory record', ({ inventory }) => inventory.pop()],
  ['extra inventory record', ({ inventory }) => inventory.push({ ...inventory[0] })],
  [
    'duplicate inventory ID',
    ({ inventory }) => (inventory[1].itemId = inventory[0].itemId),
  ],
  ['foreign inventory ID', ({ inventory }) => (inventory[0].itemId = 'foreign')],
  ['missing primary scenario', ({ inventory }) => delete inventory[0].primaryScenario],
  [
    'noncanonical primary scenario',
    ({ inventory }) => (inventory[0].primaryScenario = 'Case A'),
  ],
  ['mismatched text hash', ({ inventory }) => (inventory[0].textSha256 = '0'.repeat(64))],
  [
    'changed corpus text',
    ({ entries }) => (entries[0].text = 'Changed after annotation.'),
  ],
  ['duplicate corpus ID', ({ entries }) => (entries[1].id = entries[0].id)],
  ['empty corpus ID', ({ entries }) => (entries[0].id = '')],
  ['noncanonical corpus ID', ({ entries }) => (entries[0].id = ' padded ')],
  ['empty corpus text', ({ entries }) => (entries[0].text = ' ')],
  ['invalid field', ({ entries }) => (entries[0].field = 'comment')],
  ['unbalanced fields', ({ entries }) => (entries[0].field = 'altText')],
  ['incomplete corpus', ({ entries }) => entries.pop()],
]) {
  test(`rejects ${name}`, () => {
    const fixture = singletonMetadata()
    mutate(fixture)
    assert.throws(() =>
      assertIndependentHoldoutLocale(fixture.entries, fixture.inventory)
    )
  })
}

test('rejects non-array inputs', () => {
  assert.throws(() => assertIndependentHoldoutLocale(null, []), /must be arrays/)
  assert.throws(() => assertIndependentHoldoutLocale([], null), /must be arrays/)
})
