import { faker } from '@faker-js/faker'

export type FactoryDefaults<T extends object> = () => T
export type FactoryOverrides<T extends object> = Partial<T>
export type Factory<T extends object> = (overrides?: FactoryOverrides<T>) => T

// Keep factories as pure data builders so tests opt into persistence explicitly.
// This mirrors the plain-object builder style used by playwright-utils movie factories.
export function createFactory<T extends object>(
  defaults: FactoryDefaults<T>
): Factory<T> {
  return (overrides = {}) =>
    ({
      ...defaults(),
      ...overrides,
    }) as T
}

export { faker }
