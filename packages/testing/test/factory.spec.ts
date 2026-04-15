import { describe, expect, it } from 'vitest'

import { createFactory } from '../src/factories/factory.js'

describe('createFactory', () => {
  it('merges overrides over the default fixture values', () => {
    const createExample = createFactory(() => ({
      id: 'default-id',
      label: 'default-label',
      enabled: true,
    }))

    expect(createExample({ label: 'custom-label', enabled: false })).toEqual({
      id: 'default-id',
      label: 'custom-label',
      enabled: false,
    })
  })
})
