export const DEFAULT_FACTORY_REGISTRY_KEYS = [
  'users',
  'wardrobeItems',
  'rituals',
  'savedLocations',
  'weatherSnapshots',
  'alertRules',
  'notificationPreferences',
  'outfitCapsules',
  'outfitCapsuleGarments',
  'wardrobeOnboardingStates',
  'silhouetteProfiles',
  'moderationEvents',
  // Story 5.1. The first three carry no user_id, so cleanup cannot filter them
  // by tracked user ids the way every other key here is filtered; see the
  // cleanupScopeStartedAt anchor in cleanup.ts.
  'commercePartners',
  'affiliateOffers',
  'commercePreferences',
  'affiliateClicks',
  'affiliateConversions',
  // Story 5.2. Billing events may carry user_id NULL (unknown-subject webhook
  // deliveries), so cleanup pairs the tracked ids with the
  // cleanupScopeStartedAt anchor for unowned rows; see cleanup.ts.
  'premiumEntitlements',
  'billingEvents',
  'billingCustomers',
  // Story 5.3. Owner-only cosmetic preference, reachable by the user filter
  // like every other user-keyed key above.
  'premiumThemePreferences',
] as const

export type FactoryRegistryKey = (typeof DEFAULT_FACTORY_REGISTRY_KEYS)[number]

export interface FactoryRegistry<TKey extends string = FactoryRegistryKey> {
  clear(type?: TKey): void
  get(type: TKey): readonly string[]
  snapshot(): Readonly<Record<TKey, readonly string[]>>
  track(type: TKey, id: string): string
}

type RegistryState<TKey extends string> = Record<TKey, Set<string>>

function createRegistryState<TKey extends string>(
  keys: readonly TKey[]
): RegistryState<TKey> {
  const state = {} as RegistryState<TKey>

  for (const key of keys) {
    state[key] = new Set<string>()
  }

  return state
}

function createRegistrySnapshot<TKey extends string>(
  keys: readonly TKey[],
  state: RegistryState<TKey>
): Readonly<Record<TKey, readonly string[]>> {
  const snapshot = {} as Record<TKey, readonly string[]>

  for (const key of keys) {
    snapshot[key] = Object.freeze([...state[key]])
  }

  return Object.freeze(snapshot)
}

export function createFactoryRegistry<TKey extends string>(
  keys: readonly TKey[]
): FactoryRegistry<TKey> {
  const state = createRegistryState(keys)

  return {
    clear(type) {
      if (type) {
        state[type].clear()
        return
      }

      for (const key of keys) {
        state[key].clear()
      }
    },
    get(type) {
      return [...state[type]]
    },
    snapshot() {
      return createRegistrySnapshot(keys, state)
    },
    track(type, id) {
      state[type].add(id)
      return id
    },
  }
}

export const factoryRegistry = createFactoryRegistry(DEFAULT_FACTORY_REGISTRY_KEYS)

export function registerCreatedEntity(type: FactoryRegistryKey, id: string): string {
  return factoryRegistry.track(type, id)
}

export function getTrackedEntityIds(type: FactoryRegistryKey): readonly string[] {
  return factoryRegistry.get(type)
}

export function resetTrackedEntities(type?: FactoryRegistryKey): void {
  factoryRegistry.clear(type)
}

export function snapshotTrackedEntities(): Readonly<
  Record<FactoryRegistryKey, readonly string[]>
> {
  return factoryRegistry.snapshot()
}
