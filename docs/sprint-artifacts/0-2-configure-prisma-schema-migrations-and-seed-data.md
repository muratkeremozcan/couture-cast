# Story 0.2: Configure Prisma schema, migrations, and seed data

Status: review

## Story

As a developer,
I want a shared database schema and migration tooling,
so that all apps use consistent data models and database changes are trackable.

## Acceptance Criteria

1. Create `packages/db/prisma/schema.prisma` with core tables: users, user_profiles, guardian_consent, weather_snapshots, forecast_segments, comfort_preferences, garment_items, palette_insights, outfit_recommendations, lookbook_posts, engagement_events, moderation_events, audit_log.
2. Define relationships per architecture Data Architecture section; enforce `user_id` column on all user-scoped tables.
3. Create initial migration (`prisma migrate dev --name init`); verify migration applies cleanly to local Postgres.
4. Implement seed scripts (`prisma/seeds/`) with coverage per test-design-system.md: 5 teens, 3 guardians, 50 wardrobe items, 20 rituals, 10 weather snapshots, 8 feature flags.
5. Provide `npm run db:migrate`, `npm run db:seed`, `npm run db:reset` scripts.

## Tasks / Subtasks

- [x] Task 1: Create Prisma package structure (AC: #1)
  - [x] Create `packages/db/` directory with package.json
  - [x] Install Prisma: `npm install prisma @prisma/client --workspace packages/db`
  - [x] Run `npx prisma init` in packages/db to create prisma directory
  - [x] Configure `schema.prisma` with datasource (PostgreSQL) and client generator

- [x] Task 2: Define core schema tables (AC: #1, #2)
  - [x] Create `users` table (id, email, created_at, updated_at)
  - [x] Create `user_profiles` table (user_id FK, display_name, birthdate, preferences JSONB)
  - [x] Create `guardian_consent` table (id, guardian_id FK, teen_id FK, consent_granted_at, ip_address, status)
  - [x] Create `weather_snapshots` table (id, location, temperature, condition, alerts JSONB, fetched_at)
  - [x] Create `forecast_segments` table (id, weather_snapshot_id FK, hour_offset, temperature, condition)
  - [x] Create `comfort_preferences` table (user_id FK, runs_cold_warm, wind_tolerance, precip_preparedness)
  - [x] Create `garment_items` table (user_id FK, image_url, category, material, comfort_range, color_palette JSONB)
  - [x] Create `palette_insights` table (garment_item_id FK, undertone, hex_codes JSONB, confidence_score)
  - [x] Create `outfit_recommendations` table (user_id FK, forecast_segment_id FK, scenario, garment_ids JSONB, reasoning_badges JSONB)
  - [x] Create `lookbook_posts` table (user_id FK, image_urls JSONB, caption, locale, climate_band, created_at)
  - [x] Create `engagement_events` table (user_id FK, post_id FK, event_type, created_at)
  - [x] Create `moderation_events` table (id, post_id FK, flagged_by FK, reviewed_by FK, action, reason, created_at)
  - [x] Create `audit_log` table (id, user_id, event_type, event_data JSONB, timestamp, ip_address) with immutable constraints

- [x] Task 3: Enforce user_id column and RLS prep (AC: #2)
  - [x] Verify all user-scoped tables include `user_id` column
  - [x] Add indexes on `user_id` columns for RLS performance
  - [x] Add `@@index([user_id])` to schema for tables: garment_items, outfit_recommendations, lookbook_posts, engagement_events
  - [x] Document RLS policy requirements in schema comments

- [x] Task 4: Create initial migration (AC: #3)
  - [x] Set DATABASE_URL environment variable (local Postgres or Supabase local)
  - [x] Run `npx prisma migrate dev --name init` to create initial migration
  - [x] Verify migration file created in `prisma/migrations/`
  - [x] Test migration applies: `npx prisma migrate reset --force` then `npx prisma migrate deploy`
  - [x] Generate Prisma Client: `npx prisma generate`

- [x] Task 5: Implement seed scripts (AC: #4)
  - [x] Create `packages/db/prisma/seeds/index.ts` as main seed entry point
  - [x] Implement user seed: 5 teens (ages 13-17) + 3 guardians using Faker.js
  - [x] Implement guardian_consent seed: link guardians to teens with consent timestamps
  - [x] Implement wardrobe seed: 50 garment_items distributed across teens (mix of shared/private)
  - [x] Implement weather seed: 10 weather_snapshots (sunny, rainy, snow, extreme heat, alerts)
  - [x] Implement ritual seed: 20 outfit_recommendations linked to users + weather
  - [x] Implement feature flag seed: 8 flags (enabled/disabled mix) in user_profiles.preferences JSONB
  - [x] Add seed script to package.json: `"seed": "tsx prisma/seeds/index.ts"`

- [x] Task 6: Create database utility scripts (AC: #5)
  - [x] Add to packages/db/package.json scripts:
    ```json
    {
      "db:migrate": "prisma migrate dev",
      "db:seed": "prisma db seed",
      "db:reset": "prisma migrate reset --force --skip-seed && prisma db seed",
      "db:studio": "prisma studio",
      "db:generate": "prisma generate"
    }
    ```
  - [x] Add to root package.json scripts:
    ```json
    {
      "db:migrate": "npm run db:migrate --workspace packages/db",
      "db:seed": "npm run db:seed --workspace packages/db",
      "db:reset": "npm run db:reset --workspace packages/db"
    }
    ```
  - [x] Test all scripts execute successfully
  - [x] Document usage in packages/db/README.md

- [x] Task 7: Validation and testing
  - [x] Verify `npm run db:reset` wipes database, applies migrations, seeds data successfully
  - [x] Verify `npm run db:migrate` detects schema changes and generates new migrations
  - [x] Check seed data in database: 5 teens, 3 guardians, 50 wardrobe items, 20 rituals, 10 weather snapshots
  - [x] Verify all relationships (FKs) are correctly established
  - [x] Test Prisma Client generation produces types for all models

## Dev Notes

### Architecture Context

**Source: docs/bmm-architecture-20251110.md**

**Data Architecture (Section: Data Architecture, lines 159-163):**
- **Core tables:** users, user_profiles, guardian_consent, weather_snapshots, forecast_segments, comfort_preferences, garment_items, palette_insights, outfit_recommendations, lookbook_posts, engagement_events, moderation_events, audit_log
- **Relationships:** user_profiles ↔ garment_items (one-to-many), lookbook_posts reference palette_insights, moderation_events link to lookbook_posts or garment_items, outfit_recommendations cached per user_id + forecast_segment_id
- **Search:** materialized view search_documents aggregates wardrobe, community, commerce metadata with locale-specific tokens

**ADR-001: Data Persistence:**
- Supabase Postgres + Prisma for unified models and migrations
- All schema changes flow through `prisma migrate dev` (not `migrate save` - deprecated in Prisma 5)

**ADR-005: Multi-Tenant Data Isolation:**
- `user_id` column required on all user-scoped tables
- Application-level checks + RLS double-layer
- Migration safety: new tables must have user_id + RLS (enforced via db:lint script)

### Testing Context

**Source: docs/test-design-system.md**

**Test Data Management Strategy (Section: Test Data Management):**
- **Seed Data Coverage:** 5 teens (ages 13-17), 3 guardians (1:1, 1:2, 1:3 ratios), 50 wardrobe items, 20 rituals, 10 weather snapshots, 8 feature flags
- **Ownership:** Platform team owns `prisma/seeds/`; changes reviewed in PRs
- **Migration Coupling:** Every schema migration triggers seed update review; CI enforces compatibility
- **Environment Parity:** Same seed scripts run in Local, CI, Dev; Staging uses anonymized snapshots

**Database Migration Testing Strategy:**
- **Pre-Merge Validation:** Schema diff review via `db:migrate:check`; RLS policy validation; backward compatibility checks; rollback testing
- **Post-Deploy Validation:** Smoke tests hit all endpoints; Grafana alerts on query time spikes; migrations logged to schema_migrations table

### Implementation Patterns

**Prisma Schema Conventions:**
- snake_case for table and column names
- id fields use `@id @default(cuid())` for globally unique IDs
- Timestamps: `created_at DateTime @default(now())`, `updated_at DateTime @updatedAt`
- Foreign keys: explicit `@relation` with onDelete cascade/restrict per business logic
- JSONB for flexible data: preferences, color_palette, reasoning_badges, alerts

**Seed Data Patterns:**
- Use Faker.js for realistic but synthetic data
- Test email pattern: `test+{uuid}@example.com`
- UUID for unique identifiers to prevent collisions
- Seed data must be idempotent (safe to run multiple times)

### Project Structure Notes

**Expected Structure After This Story:**
```
packages/db/
├── prisma/
│   ├── schema.prisma        # Complete schema with all tables
│   ├── migrations/          # Initial migration folder
│   │   └── YYYYMMDD_init/
│   │       └── migration.sql
│   └── seeds/
│       ├── index.ts         # Main seed entry
│       ├── users.ts         # User + guardian seed data
│       ├── wardrobe.ts      # Garment items seed
│       ├── weather.ts       # Weather snapshots seed
│       └── rituals.ts       # Outfit recommendations seed
├── package.json             # Prisma scripts
└── README.md                # Database setup guide
```

### References

- [Architecture: Data Architecture](docs/bmm-architecture-20251110.md#data-architecture)
- [Architecture: ADR-001 Data Persistence](docs/bmm-architecture-20251110.md#adr-001)
- [Architecture: ADR-005 Multi-Tenant Data Isolation](docs/bmm-architecture-20251110.md#adr-005)
- [Test Design: Test Data Management Strategy](docs/test-design-system.md#test-data-management-strategy)
- [Test Design: Seed Data Coverage](docs/test-design-system.md#seed-data-synchronization)
- [Epics: Epic 0 Story CC-0.2](docs/epics.md#story-cc-02-configure-prisma-schema-migrations-and-seed-data)

### Learnings from Previous Story

**From Story 0-1-initialize-turborepo-monorepo (Status: drafted)**

This is the second story in Epic 0. The previous story (CC-0.1) established the monorepo structure with packages/ directory. This story will populate `packages/db/` with Prisma schema and tooling.

**Expected from CC-0.1:**
- `packages/db/` directory exists (scaffolded but empty)
- Root package.json configured with npm workspaces
- Turborepo task graph ready for db:* scripts

## Dev Agent Record

### Context Reference

<!-- Path(s) to story context XML will be added here by context workflow -->
- No story context XML available; used docs/bmm-architecture-20251110.md, docs/epics.md, docs/ux-design-specification.md

### Agent Model Used

- Codex (GPT-5)

### Debug Log References

- 2025-11-25: Schema + seeds planned; Prisma schema authored for core tables with RLS notes
- 2025-11-25: Commands: `PATH="/opt/homebrew/opt/postgresql@15/bin:$PATH" npx prisma migrate dev --name init`
- 2025-11-25: Commands: `npm run db:seed --workspace packages/db`; `npm run db:reset --workspace packages/db`
- 2025-11-25: Postgres installed via Homebrew (`brew install postgresql@15`; service started for local testing)

### Completion Notes List

- Added @couture/db workspace with Prisma schema, migrations, and seeds aligning to ACs (5 teens, 3 guardians, 50 garments, 20 rituals, 10 weather snapshots, 8 flags)
- Created reusable db scripts (migrate/reset/seed/studio/generate) in package + root; validated migrate/reset/seed flows against local Postgres
- Documented setup and seed coverage in packages/db/README.md; RLS guidance captured in schema comments

### File List

- package.json
- package-lock.json
- packages/db/package.json
- packages/db/README.md
- packages/db/.env
- packages/db/prisma/schema.prisma
- packages/db/prisma/migrations/20251125180510_init/migration.sql
- packages/db/prisma/migrations/migration_lock.toml
- packages/db/prisma/seeds/index.ts
- packages/db/prisma/seeds/users.ts
- packages/db/prisma/seeds/wardrobe.ts
- packages/db/prisma/seeds/weather.ts
- packages/db/prisma/seeds/rituals.ts
- docs/sprint-artifacts/sprint-status.yaml
- docs/sprint-artifacts/0-2-configure-prisma-schema-migrations-and-seed-data.md

## Change Log

| Date | Author | Change |
| ---- | ------ | ------ |
| 2025-11-13 | Bob (Scrum Master) | Story drafted from Epic 0, CC-0.2 acceptance criteria |
| 2025-11-25 | BMad-user | Implemented Prisma schema, migration, seeds, and db scripts |
