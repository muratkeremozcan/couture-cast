import { createHash } from 'node:crypto'

const scenarioIdentity = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const sha256Identity = /^[a-f0-9]{64}$/

function indexCorpusItems(entries) {
  const items = new Map()
  const fields = { caption: 0, altText: 0 }
  for (const item of entries) {
    if (
      !item ||
      typeof item.id !== 'string' ||
      item.id.trim() !== item.id ||
      item.id.length === 0 ||
      items.has(item.id)
    ) {
      throw new Error('Corpus item IDs must be nonempty, unique and canonical')
    }
    if (item.field !== 'caption' && item.field !== 'altText') {
      throw new Error(`Invalid field for ${item.id}`)
    }
    if (typeof item.text !== 'string' || item.text.trim().length === 0) {
      throw new Error(`Missing text for ${item.id}`)
    }
    fields[item.field] += 1
    items.set(item.id, createHash('sha256').update(item.text, 'utf8').digest('hex'))
  }
  if (fields.caption !== 1000 || fields.altText !== 1000) {
    throw new Error('V6 requires 1000 captions and 1000 alt texts')
  }
  return { items, fields }
}

function indexScenarios(inventory, items) {
  const seen = new Set()
  const scenarios = new Map()
  for (const record of inventory) {
    if (!record || !items.has(record.itemId) || seen.has(record.itemId)) {
      throw new Error('Scenario inventory must cover every corpus item exactly once')
    }
    if (
      typeof record.primaryScenario !== 'string' ||
      !scenarioIdentity.test(record.primaryScenario)
    ) {
      throw new Error(`Invalid primary scenario for ${record.itemId}`)
    }
    if (
      typeof record.textSha256 !== 'string' ||
      !sha256Identity.test(record.textSha256) ||
      record.textSha256 !== items.get(record.itemId)
    ) {
      throw new Error(`Scenario text hash does not match ${record.itemId}`)
    }
    seen.add(record.itemId)
    const members = scenarios.get(record.primaryScenario) ?? []
    members.push(record.itemId)
    scenarios.set(record.primaryScenario, members)
  }
  return scenarios
}

/** Validate the preregistered V6 singleton design without loading screening inputs. */
export function assertIndependentHoldoutLocale(entries, inventory) {
  if (!Array.isArray(entries) || !Array.isArray(inventory)) {
    throw new Error('Corpus entries and scenario inventory must be arrays')
  }
  if (entries.length !== 2000 || inventory.length !== entries.length) {
    throw new Error('V6 requires 2000 items and one inventory record per item')
  }
  const { items, fields } = indexCorpusItems(entries)
  const scenarios = indexScenarios(inventory, items)

  const memberships = [...scenarios.entries()]
    .sort(([left], [right]) => left.localeCompare(right, 'en'))
    .map(([primaryScenario, itemIds]) => ({ primaryScenario, itemIds }))
  const maximumItemsPerScenario = Math.max(
    ...memberships.map((group) => group.itemIds.length)
  )
  if (maximumItemsPerScenario !== 1 || scenarios.size !== 2000) {
    const repeated = memberships.filter((group) => group.itemIds.length > 1)
    throw new Error(`Primary scenario maximum must be 1: ${JSON.stringify(repeated)}`)
  }

  return {
    total: entries.length,
    fields,
    distinctPrimaryScenarios: scenarios.size,
    maximumItemsPerScenario,
    itemsPerScenarioDistribution: { 1: scenarios.size },
    memberships,
  }
}
