# @couture/testing

Shared fixture factories and cleanup helpers for CoutureCast tests.

## Starter template

The starter example lives in
[`packages/testing/templates/test-template.spec.ts`](./templates/test-template.spec.ts). Use the
package root for factories and `@couture/testing/cleanup` for manual cleanup registration:

```ts
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, createTeenUser, createWardrobeItem } from '@couture/testing'
import { registerForCleanup } from '@couture/testing/cleanup'

afterEach(async () => {
  await cleanup({ prisma })
})

it('creates a wardrobe item for a teen', async () => {
  const teen = await createTeenUser(
    { age: 15, email: 'template-teen@example.com' },
    { persist: true, prisma }
  )

  const item = await createWardrobeItem(
    { userId: teen.id, category: 'top' },
    { persist: true, prisma }
  )

  // Manual registration still exists for direct Prisma setup.
  // registerForCleanup('users', customUser.id)

  expect(item.userId).toBe(teen.id)
})
```

## Factory philosophy

Factories in this package are pure data builders first. A factory call should give the test a fresh
fixture object that can be asserted on, modified, or persisted without mutating shared state.

- Use overrides to express the scenario the test cares about.
- Keep persistence explicit by passing `{ persist: true, prisma }`.
- Prefer specialized factories like `createTeenUser()` over broad one-off object literals.
- Set IDs, timestamps, and other asserted values explicitly when a test depends on them.

## Basic usage

```ts
import {
  createRitual,
  createTeenUser,
  createWardrobeItem,
  createWeatherSnapshot,
} from '@couture/testing'

const teen = createTeenUser({ age: 14 })
const top = createWardrobeItem({ userId: teen.id, category: 'top' })
const weather = createWeatherSnapshot({ location: 'Chicago, IL', conditions: 'snow' })
const ritual = createRitual({
  userId: teen.id,
  garmentIds: [top.id],
  scenario: 'school',
})
```

Persist only when the test actually needs database rows:

```ts
const persistedTeen = await createTeenUser(
  { age: 15, email: 'teen15@example.com' },
  { persist: true, prisma }
)
```

## Factory examples

### User factories

Use `createUser()` for generic fixtures, `createTeenUser()` for the teen path, and
`createGuardianUser()` for guardian-specific setup.

```ts
import { createGuardianUser, createTeenUser, createUser } from '@couture/testing'

const user = createUser()
const teen = createTeenUser({ age: 14, profilePreferences: { onboarding_state: 'new' } })
const guardian = createGuardianUser({ email: 'guardian@example.com' })
```

### Wardrobe item factory

Attach wardrobe items to a known user ID so relationship assertions stay simple.

```ts
import { createWardrobeItem } from '@couture/testing'

const item = createWardrobeItem({
  userId: teen.id,
  category: 'top',
  material: 'cotton',
  comfortRange: 'mild',
})
```

### Ritual factory

Outfit recommendation fixtures model the recommendation layer without forcing the test to hand-roll
JSON badge arrays or garment ID lists.

```ts
import { createRitual } from '@couture/testing'

const ritual = createRitual({
  userId: teen.id,
  forecastSegmentId: 'segment-123',
  garmentIds: [item.id],
  reasoningBadges: [{ label: 'weather-aware' }],
})
```

### Weather snapshot factory

Weather fixtures keep the richer test-facing shape even though persistence only writes the schema
fields Prisma currently supports.

```ts
import { createWeatherSnapshot } from '@couture/testing'

const weather = createWeatherSnapshot({
  location: 'Seattle, WA',
  temperature: 48,
  conditions: 'rain',
  alerts: [{ type: 'wind' }],
})
```

## Cleanup discipline

Persisted factory helpers register created IDs automatically. If a test creates rows outside the
factory persistence helpers, register them manually so teardown remains deterministic.

```ts
import { afterEach } from 'vitest'
import {
  buildUserCreateInput,
  buildWardrobeItemCreateInput,
  cleanup,
  createTeenUser,
  createWardrobeItem,
} from '@couture/testing'
import { registerForCleanup } from '@couture/testing/cleanup'

afterEach(async () => {
  await cleanup({ prisma })
})

it('creates a wardrobe item for a teen', async () => {
  const teenFixture = createTeenUser({
    age: 15,
    email: 'cleanup-teen@example.com',
  })

  const teen = await prisma.user.create({
    data: buildUserCreateInput(teenFixture),
  })
  registerForCleanup('users', teen.id)

  const topFixture = createWardrobeItem({ userId: teen.id, category: 'top' })
  const top = await prisma.garmentItem.create({
    data: buildWardrobeItemCreateInput(topFixture),
  })
  registerForCleanup('wardrobeItems', top.id)
})
```

The cleanup helper deletes in reverse dependency order:

1. User-adjacent dependents such as engagement events, lookbook posts, audit logs, and push tokens
2. Outfit recommendations and palette insights
3. Wardrobe items and forecast segments
4. Weather snapshots
5. Guardian consent, comfort preferences, user profiles, and finally users

## Best practices

- Override only the fields a test actually needs to care about.
- Use specialized factories (`createTeenUser`, `createGuardianUser`) instead of hand-setting role
  fields in every test.
- Keep assertions focused on explicit overrides, not on random Faker output.
- Reuse fixture IDs between related entities instead of hardcoding parallel literals in each create.
- Use persistence helpers for setup that should participate in automatic cleanup.

## Anti-patterns

- Hardcoded test payloads copied inline across suites.
- Shared mutable fixture objects reused between tests.
- Random values in assertions without overriding the asserted fields first.
- Direct Prisma setup with no cleanup registration when the factory can express the same setup.

## Pattern lineage

These helpers were shaped by the local `../playwright-utils` reference set:

- `../playwright-utils/playwright/support/utils/movie-factories.ts` reinforced the plain-object
  builder approach: generate a full fixture, then let each test override only the fields it cares
  about.
- `../playwright-utils/playwright/support/fixtures/crud-helper-fixture.ts` reinforced keeping test
  setup and teardown behind reusable helpers instead of scattering ad hoc cleanup in each suite.

CoutureCast intentionally diverges in two places:

- Factories can optionally persist through Prisma because many tests need schema-valid nested create
  payloads, not just in-memory objects.
- Cleanup deletes in reverse dependency order and clears the registry in `finally` because Prisma
  relations make teardown stricter than the generic API-helper flow in `playwright-utils`.
