# Story 0.10: Implement test fixture factories and seed data

Status: in-progress

## Story

As a test engineer,
I want composable fixture factories,
so that tests don't hardcode data and become brittle, and seed data is consistent across environments.

## Acceptance Criteria

1. Create factory pattern in ` for core entities: User (teen/guardian variants), WardrobeItem, Ritual, Weather using pure function → fixture → merge composition per test-design-system.md fixture-architecture guidance.
2. Implement cleanup discipline pattern: `afterEach` cleanup template with reverse-order deletion (items → users).
3. Create Prisma seed scripts using factories in ` with coverage: 5 teens, 3 guardians, 50 wardrobe items, 20 rituals, 10 weather snapshots, 8 feature flags.
4. Document factory usage in test templates with examples (e.g., `createUser({ role: 'teen', age: 15 })`).
5. Enforce factory usage in test code review checklist (no hardcoded test data allowed).

## Tasks / Subtasks

- [x] Task 1: Create factory infrastructure (AC: #1)
  - [x] Create the package directory
  - [x] Install dependencies:
        `npm install @faker-js/faker --save-dev --workspace @couture/testing`
  - [x] Create base factory helper:

    ```typescript
    import { faker } from '@faker-js/faker'

    export function createFactory<T extends object>(defaults: () => T) {
      return (overrides: Partial<T> = {}): T => ({
        ...defaults(),
        ...overrides,
      })
    }
    ```

  - [x] Create factory registry to track created entities for cleanup

- [x] Task 2: Implement User factory (AC: #1)
  - [x] Create the user factory module:

    ```typescript
    export const createUser = (overrides?: UserFactoryOverrides) =>
      composeUserFixture(overrides)

    export const createTeenUser = (overrides?: UserVariantOverrides) =>
      createUser({ ...overrides, role: 'teen' })

    export const createGuardianUser = (overrides?: UserVariantOverrides) =>
      createUser({ ...overrides, role: 'guardian' })
    ```

  - [x] Add Prisma integration: persist to database if `{ persist: true }`

- [x] Task 3: Implement WardrobeItem factory (AC: #1)
  - [x] Create ` ```typescript
        export const createWardrobeItem = createFactory(() => ({
        id: faker.string.uuid(),
        userId: faker.string.uuid(),
        name: faker.commerce.productName(),
        category: faker.helpers.arrayElement(['top', 'bottom', 'outerwear', 'shoes']),
        color: faker.color.human(),
        material: faker.helpers.arrayElement(['cotton', 'wool', 'synthetic', 'leather']),
        tempRangeMin: faker.number.int({ min: -20, max: 10 }),
        tempRangeMax: faker.number.int({ min: 15, max: 35 }),
        imageUrl: faker.image.url(),
        createdAt: new Date(),
        }));

    ```

    ```

- [x] Task 4: Implement Ritual and Weather factories (AC: #1)
  - [x] Create ` for outfit rituals
  - [x] Create ` for weather snapshots:
    ```typescript
    export const createWeatherSnapshot = createFactory(() => ({
      id: faker.string.uuid(),
      locationId: faker.string.uuid(),
      temperature: faker.number.int({ min: -10, max: 35 }),
      feelsLike: faker.number.int({ min: -10, max: 35 }),
      conditions: faker.helpers.arrayElement(['clear', 'cloudy', 'rain', 'snow']),
      windSpeed: faker.number.int({ min: 0, max: 50 }),
      humidity: faker.number.int({ min: 0, max: 100 }),
      timestamp: new Date(),
    }))
    ```

- [ ] Task 5: Implement cleanup discipline (AC: #2)
  - [ ] Create ` ```typescript
        type CleanupRegistry = {
        users: string[];
        wardrobeItems: string[];
        rituals: string[];
        weatherSnapshots: string[];
        };

    const registry: CleanupRegistry = {
    users: [],
    wardrobeItems: [],
    rituals: [],
    weatherSnapshots: [],
    };

    export function registerForCleanup(type: keyof CleanupRegistry, id: string) {
    registry[type].push(id);
    }

    export async function cleanup() {
    // Delete in reverse dependency order
    await prisma.wardrobeItem.deleteMany({ where: { id: { in: registry.wardrobeItems } } });
    await prisma.ritual.deleteMany({ where: { id: { in: registry.rituals } } });
    await prisma.weatherSnapshot.deleteMany({ where: { id: { in: registry.weatherSnapshots } } });
    await prisma.user.deleteMany({ where: { id: { in: registry.users } } });

    // Clear registry
    Object.keys(registry).forEach(key => registry[key as keyof CleanupRegistry] = []);
    }

    ```

    ```

  - [ ] Create test template with cleanup in ` - [ ] Document cleanup pattern in`

- [ ] Task 6: Create Prisma seed scripts (AC: #3)
  - [ ] Create ` directory
  - [ ] Create ` ```typescript
        import { PrismaClient } from '@prisma/client';
        import { createTeenUser, createGuardianUser } from '@couture-cast/testing/**factories**';

    export async function seedUsers(prisma: PrismaClient) {
    const teens = Array.from({ length: 5 }, (_, i) =>
    createTeenUser({ email: `teen${i + 1}@example.com` })
    );
    const guardians = Array.from({ length: 3 }, (_, i) =>
    createGuardianUser({ email: `guardian${i + 1}@example.com` })
    );

    for (const user of [...teens, ...guardians]) {
    await prisma.user.create({ data: user });
    }
    }

    ```

    ```

  - [ ] Create seed scripts for wardrobe (50 items), rituals (20), weather (10), feature flags (8)
  - [ ] Create master seed script ` ```typescript
        import { PrismaClient } from '@prisma/client';
        import { seedUsers } from './seeds/users.seed';
        import { seedWardrobeItems } from './seeds/wardrobe.seed';
        import { seedRituals } from './seeds/rituals.seed';
        import { seedWeather } from './seeds/weather.seed';
        import { seedFeatureFlags } from './seeds/feature-flags.seed';

    const prisma = new PrismaClient();

    async function main() {
    await seedUsers(prisma);
    await seedWardrobeItems(prisma);
    await seedRituals(prisma);
    await seedWeather(prisma);
    await seedFeatureFlags(prisma);
    }

    main()
    .catch((e) => {
    console.error(e);
    process.exit(1);
    })
    .finally(async () => {
    await prisma.$disconnect();
    });

    ```

    ```

  - [ ] Add seed script to ` ```json
        {
        "scripts": {
        "seed": "tsx prisma/seed.ts"
        }
        }

    ```

    ```

- [ ] Task 7: Document factory usage (AC: #4)
  - [ ] Create ` with sections:
    - Factory philosophy (pure functions, composition)
    - Basic usage examples
    - Cleanup discipline
    - Best practices
  - [ ] Add examples for each factory:

    ```typescript
    // Create teen user with specific age
    const teen = createTeenUser({ age: 14 })

    // Create wardrobe item for user
    const item = createWardrobeItem({ userId: teen.id, category: 'top' })

    // Persist to database
    const persistedUser = await prisma.user.create({ data: createUser() })
    ```

  - [ ] Document anti-patterns: hardcoded test data, shared mutable state

- [ ] Task 8: Create test template (AC: #4)
  - [ ] Create ` ```typescript
        import { describe, it, expect, afterEach } from 'vitest';
        import { cleanup, registerForCleanup } from '@couture-cast/testing/cleanup';
        import { createUser, createWardrobeItem } from '@couture-cast/testing/**factories**';
        import { prisma } from '@couture-cast/db';

    describe('Example Test Suite', () => {
    afterEach(async () => {
    await cleanup();
    });

    it('should demonstrate factory usage', async () => {
    const user = await prisma.user.create({ data: createUser() });
    registerForCleanup('users', user.id);

        const item = await prisma.wardrobeItem.create({
          data: createWardrobeItem({ userId: user.id }),
        });
        registerForCleanup('wardrobeItems', item.id);

        expect(item.userId).toBe(user.id);

    });
    });

    ```

    ```

  - [ ] Add template to docs

- [ ] Task 9: Reference playwright-utils patterns (AC: #1)
  - [ ] Review `playwright-utils` factory patterns from baseline reference
  - [ ] Adapt `movie-factories.ts` pattern for CoutureCast entities
  - [ ] Reference playwright-utils cleanup patterns
  - [ ] Document learnings in `
- [ ] Task 10: Create code review checklist (AC: #5)
  - [ ] Add to `.github/PULL_REQUEST_TEMPLATE.md`:

    ```markdown
    ## Test Quality Checklist

    - [ ] No hardcoded test data (use factories)
    - [ ] Tests clean up created entities (registerForCleanup)
    - [ ] Factories used for all test fixtures
    - [ ] Test data is deterministic (no random data in assertions)
    ```

  - [ ] Document in `_bmad-output/test-artifacts/testing-standards.md`
  - [ ] Add to team onboarding docs

- [ ] Task 11: Write factory tests (AC: #1, #2)
  - [ ] Test user factory creates valid user
  - [ ] Test teen factory sets correct age range
  - [ ] Test wardrobe factory generates valid items
  - [ ] Test cleanup removes all registered entities
  - [ ] Test factory override merges correctly

- [ ] Task 12: Integrate factories in existing tests (AC: #5)
  - [ ] Refactor any existing tests to use factories
  - [ ] Remove hardcoded test data
  - [ ] Add cleanup to all test suites
  - [ ] Verify tests still pass

## Dev Notes

### Architecture Context

**Source: \_bmad-output/planning-artifacts/architecture.md**

**Data Architecture (lines 160-163):**

- Core tables: users, user_profiles, guardian_consent, weather_snapshots, forecast_segments, comfort_preferences, garment_items, palette_insights, outfit_recommendations, lookbook_posts, engagement_events, moderation_events, audit_log
- Relationships defined in Prisma schema

**Implementation Patterns (line 148):**

- Tests colocated `*.test.ts` except E2E in `
  **Consistency Rules (line 157):**
- Testing gates: Turborepo runs lint → unit (Vitest) → API schema check → e2e on every PR

### Reference: playwright-utils Factory Patterns

**Source: /Users/murat.ozcan/opensource/playwright-utils-flat.txt**

**Factory Pattern (movie-factories.ts):**

```typescript
// Pure function composition
export const createMovie = (overrides?: Partial<Movie>): Movie => ({
  id: faker.string.uuid(),
  title: faker.lorem.words(3),
  genre: faker.helpers.arrayElement(['action', 'comedy', 'drama']),
  ...overrides,
})
```

**CRUD Helper Fixture Pattern:**
Reference: `playwright/support/fixtures/crud-helper-fixture.ts`

- Composable helpers for create/read/update/delete operations
- Automatic cleanup registration
- Reusable across tests

### Implementation Patterns

**Factory Composition Pattern:**

```typescript
// Base factory
const createUser = createFactory(() => ({
  id: faker.string.uuid(),
  email: faker.internet.email(),
  role: 'user',
}))

// Specialized factories
const createTeen = (overrides) => createUser({ role: 'teen', age: 15, ...overrides })
const createGuardian = (overrides) =>
  createUser({ role: 'guardian', age: 42, ...overrides })
```

**Cleanup Pattern:**

```typescript
afterEach(async () => {
  await cleanup() // Reverse-order deletion
})
```

### Project Structure Notes

**New Directories:**

```
├── __factories__/
│   ├── factory.ts              # Base factory helper
│   ├── user.factory.ts
│   ├── wardrobe-item.factory.ts
│   ├── ritual.factory.ts
│   └── weather.factory.ts
├── cleanup.ts                  # Cleanup discipline
├── templates/
│   └── test-template.spec.ts
└── README.md
├── seeds/
│   ├── users.seed.ts
│   ├── wardrobe.seed.ts
│   ├── rituals.seed.ts
│   ├── weather.seed.ts
│   └── feature-flags.seed.ts
└── seed.ts                     # Master seed script
_bmad-output/
└── test-artifacts/
    └── testing-standards.md
```

### References

- [Architecture: Data Architecture](../planning-artifacts/architecture.md#data-architecture)
- [Epics: Epic 0 Story CC-0.10](../planning-artifacts/epics.md#epic-0--platform-foundation--infrastructure-sprint-0)
- Baseline Reference: playwright-utils factories (local reference used during implementation; not committed as a portable repo link)
- [Faker.js Documentation](https://fakerjs.dev/)

### Learnings from Previous Stories

**From CC-0.2 (Prisma):**

- Seed scripts must align with schema
- Foreign key constraints affect deletion order

**For this story:**

- Factories prevent brittle tests
- Cleanup discipline prevents test pollution
- Seed data must be consistent across environments
- Factory composition enables specialized fixtures
- Test templates enforce best practices

## Dev Agent Record

### Context Reference

- No story context XML was linked from this story file during task 1 implementation.

### Agent Model Used

- GPT-5 Codex

### Debug Log References

- `npm install --workspace @couture/testing` failed under Node `v22.12.0` because the repo preinstall guard requires Node 24.x.
- `source "$HOME/.nvm/nvm.sh" && nvm use 24 >/dev/null && npm install --workspace @couture/testing`
- `source "$HOME/.nvm/nvm.sh" && nvm use 24 >/dev/null && npm run build --workspace @couture/testing`
- `source "$HOME/.nvm/nvm.sh" && nvm use 24 >/dev/null && npm run typecheck --workspace @couture/testing`
- `source "$HOME/.nvm/nvm.sh" && nvm use 24 >/dev/null && npm run lint --workspace @couture/testing`
- `source "$HOME/.nvm/nvm.sh" && nvm use 24 >/dev/null && npx tsx -e "import { buildUserCreateInput, createGuardianUser, createTeenUser } from './packages/testing/src/factories/user.factory.ts'; const teen = createTeenUser({ age: 14 }); const guardian = createGuardianUser(); const teenInput = buildUserCreateInput(teen); console.log(JSON.stringify({ teenRole: teen.role, teenAge: teen.age, guardianRole: guardian.role, teenProfileRole: teenInput.profile.create.preferences.role }))"`
- `source "$HOME/.nvm/nvm.sh" && nvm use 24 >/dev/null && npx tsx -e "import { buildWardrobeItemCreateInput, createWardrobeItem } from './packages/testing/src/factories/wardrobe-item.factory.ts'; const fixture = createWardrobeItem({ userId: 'user-123', category: 'top' }); const input = buildWardrobeItemCreateInput(fixture); console.log(JSON.stringify({ category: fixture.category, userId: fixture.userId, connectId: input.user.connect.id, paletteSize: fixture.colorPalette.length }))"`
- `source "$HOME/.nvm/nvm.sh" && nvm use 24 >/dev/null && npx tsx -e "import { buildRitualCreateInput, createRitual } from './packages/testing/src/factories/ritual.factory.ts'; import { buildWeatherSnapshotCreateInput, createWeatherSnapshot } from './packages/testing/src/factories/weather.factory.ts'; const ritual = createRitual({ userId: 'user-123', forecastSegmentId: 'segment-456' }); const ritualInput = buildRitualCreateInput(ritual); const weather = createWeatherSnapshot({ location: 'Chicago, IL', conditions: 'snow' }); const weatherInput = buildWeatherSnapshotCreateInput(weather); console.log(JSON.stringify({ ritualScenario: ritual.scenario, ritualConnectId: ritualInput.user.connect.id, ritualSegmentId: ritualInput.forecast_segment?.connect?.id, weatherLocation: weatherInput.location, weatherCondition: weatherInput.condition, weatherHasAlerts: Boolean(weatherInput.alerts) }))"`

### Completion Notes List

- Implemented task 1 by creating a new `@couture/testing` workspace for shared test fixture utilities.
- Added a base `createFactory` helper plus a re-exported `faker` entrypoint for future entity-specific factories.
- Added a typed cleanup registry with default buckets for `users`, `wardrobeItems`, `rituals`, and `weatherSnapshots`.
- Implemented task 2 with role-aware `createUser`, `createTeenUser`, and `createGuardianUser` helpers plus Prisma persistence support.
- Mapped fixture-level `role` and `age` into nested `UserProfile` and `ComfortPreferences` create input so the factory matches the actual schema.
- Implemented task 3 with a schema-aligned `createWardrobeItem` factory, exported wardrobe constants/types, and Prisma persistence that maps the fixture API onto `GarmentItem`.
- Implemented task 4 with a `createRitual` factory mapped onto `OutfitRecommendation` and a `createWeatherSnapshot` factory mapped onto `WeatherSnapshot`.
- Kept the weather fixture API richer than the current schema (`feelsLike`, `windSpeed`, `humidity`, `locationId`) while restricting persistence helpers to the columns Prisma currently supports.
- Updated `package-lock.json` through npm workspace installs run under Node 24.x.
- Verified the new workspace with targeted `build`, `typecheck`, `lint`, and a runtime smoke check.

### File List

- New: `packages/testing/package.json`
- New: `packages/testing/tsconfig.json`
- New: `packages/testing/tsconfig.build.json`
- New: `packages/testing/src/index.ts`
- New: `packages/testing/src/factories/index.ts`
- New: `packages/testing/src/factories/factory.ts`
- New: `packages/testing/src/factories/registry.ts`
- New: `packages/testing/src/factories/user.factory.ts`
- New: `packages/testing/src/factories/wardrobe-item.factory.ts`
- New: `packages/testing/src/factories/ritual.factory.ts`
- New: `packages/testing/src/factories/weather.factory.ts`
- New: `packages/testing/dist/*`
- New: `packages/testing/tsconfig.build.tsbuildinfo`
- New: `packages/testing/tsconfig.tsbuildinfo`
- Modified: `package-lock.json`
- Modified: `packages/testing/src/factories/index.ts`

## Change Log

| Date       | Author             | Change                                                                                             |
| ---------- | ------------------ | -------------------------------------------------------------------------------------------------- |
| 2025-11-13 | Bob (Scrum Master) | Story drafted from Epic 0, CC-0.10 acceptance criteria                                             |
| 2026-04-13 | Codex (Dev Agent)  | Implemented tasks 1-2 for shared factory infrastructure and the user factory in `@couture/testing` |
| 2026-04-13 | Codex (Dev Agent)  | Implemented task 3 with a wardrobe item factory and Prisma persistence/export wiring               |
| 2026-04-13 | Codex (Dev Agent)  | Implemented task 4 with ritual/weather factories and schema-aware persistence helpers              |
