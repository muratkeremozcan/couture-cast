// Learning path Step 58: Hosted wardrobe workers and manual tagging.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#hosted-wardrobe-workers-and-manual-tagging
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  WARDROBE_MAINTENANCE_ENV,
  assertGeneralWorkerMayConsumeMaintenance,
  wardrobeMaintenanceEnabled,
} from './wardrobe-maintenance'

describe('WARDROBE_MAINTENANCE_ENABLED', () => {
  it('is on only for the literal true', () => {
    expect(WARDROBE_MAINTENANCE_ENV).toBe('WARDROBE_MAINTENANCE_ENABLED')
    expect(wardrobeMaintenanceEnabled({ WARDROBE_MAINTENANCE_ENABLED: 'true' })).toBe(
      true
    )
    expect(wardrobeMaintenanceEnabled({ WARDROBE_MAINTENANCE_ENABLED: ' true ' })).toBe(
      true
    )
    for (const value of [undefined, '', 'false', '1', 'TRUE', 'yes']) {
      expect(wardrobeMaintenanceEnabled({ WARDROBE_MAINTENANCE_ENABLED: value })).toBe(
        false
      )
    }
  })

  it('refuses the general worker where the wardrobe worker owns the maintenance queue', () => {
    expect(() =>
      assertGeneralWorkerMayConsumeMaintenance({ WARDROBE_MAINTENANCE_ENABLED: 'true' })
    ).toThrow(/only consumer of the maintenance queue/)
    expect(() => assertGeneralWorkerMayConsumeMaintenance({})).not.toThrow()
    expect(() =>
      assertGeneralWorkerMayConsumeMaintenance({ WARDROBE_MAINTENANCE_ENABLED: 'false' })
    ).not.toThrow()
  })

  it('has the general bootstrap check it before it opens a queue', () => {
    const source = readFileSync(path.resolve(__dirname, 'bootstrap.ts'), 'utf8')
    const start = source.slice(source.indexOf('export async function startWorkers('))
    const guard = start.indexOf('assertGeneralWorkerMayConsumeMaintenance()')
    expect(guard).toBeGreaterThan(-1)
    expect(guard).toBeLessThan(start.indexOf('createQueues()'))
  })
})
