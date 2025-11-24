# Story 0.10: Implement test fixture factories and seed data

Status: drafted

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

- [ ] Task 1: Create factory infrastructure (AC: #1)
  - [ ] Create ` directory
  - [ ] Install dependencies: `npm install @faker-js/faker --save-dev --workspace   - [ ] Create base factory helper `    ```typescript
    import { faker } from '@faker-js/faker';

    export function createFactory<T>(defaults: () => T) {
      return (overrides?: Partial<T>): T => ({
        ...defaults(),
        ...overrides,
      });
    }
    ```
  - [ ] Create factory registry to track created entities for cleanup

- [ ] Task 2: Implement User factory (AC: #1)
  - [ ] Create `    ```typescript
    import { createFactory } from './factory';
    import { faker } from '@faker-js/faker';

    export const createUser = createFactory(() => ({
      id: faker.string.uuid(),
      email: faker.internet.email(),
      password: faker.internet.password(),
      role: 'user' as const,
      age: faker.number.int({ min: 16, max: 65 }),
      createdAt: new Date(),
      updatedAt: new Date(),
    }));

    export const createTeenUser = (overrides?: Partial<ReturnType<typeof createUser>>) =>
      createUser({ role: 'teen', age: 15, ...overrides });

    export const createGuardianUser = (overrides?: Partial<ReturnType<typeof createUser>>) =>
      createUser({ role: 'guardian', age: 42, ...overrides });
    ```
  - [ ] Add Prisma integration: persist to database if `{ persist: true }`

- [ ] Task 3: Implement WardrobeItem factory (AC: #1)
  - [ ] Create `    ```typescript
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

- [ ] Task 4: Implement Ritual and Weather factories (AC: #1)
  - [ ] Create ` for outfit rituals
  - [ ] Create ` for weather snapshots:
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
    }));
    ```

- [ ] Task 5: Implement cleanup discipline (AC: #2)
  - [ ] Create `    ```typescript
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
  - [ ] Create test template with cleanup in `  - [ ] Document cleanup pattern in `
- [ ] Task 6: Create Prisma seed scripts (AC: #3)
  - [ ] Create ` directory
  - [ ] Create `    ```typescript
    import { PrismaClient } from '@prisma/client';
    import { createTeenUser, createGuardianUser } from '@couture-cast/testing/__factories__';

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
  - [ ] Create seed scripts for wardrobe (50 items), rituals (20), weather (10), feature flags (8)
  - [ ] Create master seed script `    ```typescript
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
  - [ ] Add seed script to `    ```json
    {
      "scripts": {
        "seed": "tsx prisma/seed.ts"
      }
    }
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
    const teen = createTeenUser({ age: 14 });

    // Create wardrobe item for user
    const item = createWardrobeItem({ userId: teen.id, category: 'top' });

    // Persist to database
    const persistedUser = await prisma.user.create({ data: createUser() });
    ```
  - [ ] Document anti-patterns: hardcoded test data, shared mutable state

- [ ] Task 8: Create test template (AC: #4)
  - [ ] Create `    ```typescript
    import { describe, it, expect, afterEach } from 'vitest';
    import { cleanup, registerForCleanup } from '@couture-cast/testing/cleanup';
    import { createUser, createWardrobeItem } from '@couture-cast/testing/__factories__';
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
  - [ ] Document in `docs/testing-standards.md`
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

**Source: docs/bmm-architecture-20251110.md**

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
});
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
}));

// Specialized factories
const createTeen = (overrides) => createUser({ role: 'teen', age: 15, ...overrides });
const createGuardian = (overrides) => createUser({ role: 'guardian', age: 42, ...overrides });
```

**Cleanup Pattern:**
```typescript
afterEach(async () => {
  await cleanup(); // Reverse-order deletion
});
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
docs/
└── testing-standards.md
```

### References

- [Architecture: Data Architecture](docs/bmm-architecture-20251110.md#data-architecture)
- [Epics: Epic 0 Story CC-0.10](docs/epics.md#epic-0--platform-foundation--infrastructure-sprint-0)
- [Baseline Reference: playwright-utils factories](file:///Users/murat.ozcan/opensource/playwright-utils-flat.txt)
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

<!-- Path(s) to story context XML will be added here by context workflow -->

### Agent Model Used

<!-- Will be filled by dev agent -->

### Debug Log References

<!-- Will be filled by dev agent during implementation -->

### Completion Notes List

<!-- Will be filled by dev agent upon completion -->

### File List

<!-- Will be filled by dev agent with NEW/MODIFIED/DELETED files -->

## Change Log

| Date | Author | Change |
| ---- | ------ | ------ |
| 2025-11-13 | Bob (Scrum Master) | Story drafted from Epic 0, CC-0.10 acceptance criteria |
