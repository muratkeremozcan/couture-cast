# Story 0.3: Set up Supabase projects (dev/prod)

Status: drafted

## Story

As a platform team,
I want Supabase infrastructure across environments,
so that developers can test locally and deploy to production with proper isolation.

## Acceptance Criteria

1. Create two Supabase projects: dev (wiped weekly) and prod (live user data); staging deferred due to free plan limits. Use Americas region.
2. Configure Storage buckets: `wardrobe-images`, `derived-assets`, `community-uploads` with RLS policies per ADR-004.
3. Set up Supabase local development via Supabase CLI (`npx supabase start`); document access in README.
4. Configure database connection pooling (max 100 connections per environment) and backups (PITR enabled for prod).
5. Document environment URLs, service keys, and access credentials in Doppler (or Supabase Vault).

## Tasks / Subtasks

- [x] Task 1: Create Supabase cloud projects (AC: #1)
  - [x] Sign up for Supabase account at https://supabase.com
  - [x] Create two projects: `couturecast-dev` (Free, auto-pause after 1 week) and `couturecast-prod` (Pro preferred; Free if budget-constrained)
  - [x] Configure project settings: region Americas (closest to target users), pricing tier per above
  - [x] Document project URLs and ref IDs in project documentation and secrets manager
  - [x] Staging deferred due to free plan limits; add when an extra slot is available or upgraded

- [ ] Task 2: Configure Storage buckets (AC: #2)
  - [x] Create `wardrobe-images` bucket in dev and prod (private, 10MB, JPEG/PNG only)
  - [x] Create `derived-assets` bucket (private, for color extraction outputs)
  - [x] Create `community-uploads` bucket (private, 5MB limit)
  - [x] Enable RLS on all buckets (users can only access own files)
  - [x] Configure bucket policies per ADR-004:
    - Teen users: can upload to wardrobe-images only if guardian consent granted
    - Guardians: can view linked teen's wardrobe-images
    - Admins: can access all buckets for moderation
  - [x] Set up signed URL expiration (1 hour for uploads, 24 hours for views) — enforced via app code using expiresIn on signed URL generation (no UI toggle)

- [x] Task 3: Install and configure Supabase CLI (AC: #3)
  - [x] Install Supabase CLI: `npm install supabase --save-dev --workspace-root`
  - [x] Run `npx supabase init` to create `supabase/` directory with config
  - [x] Configure `supabase/config.toml` with local development settings
  - [x] Run `npx supabase start` to start local Supabase stack (Postgres, Auth, Storage, Studio)
  - [x] Verify local services accessible: Studio at http://localhost:54323, Postgres at localhost:54322
  - [x] Link local to dev project: `npx supabase link --project-ref {dev-project-ref}`
  - [x] Test migration sync: `npx supabase db push` applies Prisma schema to local instance

- [ ] Task 4: Configure database connection pooling and backups (AC: #4)
  - [ ] Set connection pooling in Supabase dashboard: max 100 connections per project (dev: 50, prod: 100)
  - [ ] Configure connection pool mode: transaction pooling for serverless functions, session pooling for long-lived connections
  - [ ] Enable PITR (Point-In-Time Recovery) for production project (7-day retention)
  - [ ] Configure automated backups: weekly for dev; daily for prod
  - [ ] Test connection pool: verify target concurrent connections can be established without errors

- [ ] Task 5: Document environment configuration (AC: #5)
  - [ ] Create `.env.example` template with Supabase environment variables:
    ```
    # Supabase Configuration
    SUPABASE_URL=https://{project-ref}.supabase.co
    SUPABASE_ANON_KEY={anon-key}
    SUPABASE_SERVICE_KEY={service-key}
    DATABASE_URL=postgresql://postgres:{password}@db.{project-ref}.supabase.co:5432/postgres
    ```
  - [ ] Create Doppler projects (or Supabase Vault secrets): local, ci, dev, prod (staging deferred until available)
  - [ ] Store credentials securely in Doppler for each environment
  - [ ] Document in README.md: how to access Supabase projects, how to sync env vars, how to run local development
  - [ ] Add to root README.md: "Prerequisites: Supabase CLI, Docker (for local Postgres)"

- [ ] Task 6: Configure Supabase Auth settings
  - [ ] Enable email/password authentication in Supabase Auth settings
  - [ ] Configure magic link email templates (branded CoutureCast styling)
  - [ ] Set JWT expiration: 7 days (refresh token), 1 hour (access token)
  - [ ] Configure redirect URLs for dev/prod environments
  - [ ] Test magic link flow in local environment

- [ ] Task 7: Set up RLS scaffolding (partial - full policies in CC-0.11)
  - [ ] Enable RLS on all tables in Supabase Studio
  - [ ] Create placeholder RLS policies (allow service_key full access for now)
  - [ ] Document RLS policy requirements for CC-0.11 (guardian consent story)
  - [ ] Note: Full RLS implementation deferred to CC-0.11

- [ ] Task 8: Validation and testing
  - [ ] Verify local Supabase stack starts with `npx supabase start`
  - [ ] Verify Prisma migrations apply to local Supabase: `npm run db:migrate`
  - [ ] Verify seed data loads: `npm run db:seed`
  - [ ] Test Storage bucket upload (manual via Supabase Studio)
  - [ ] Test Auth magic link (send test email, verify link works)
  - [ ] Verify dev/prod project dashboards are accessible

## Dev Notes

### Architecture Context

**Source: docs/bmm-architecture-20251110.md**

**ADR-001: Data Persistence:**
- Supabase Postgres + Prisma for unified models and migrations
- Free tier, RLS, familiar tooling, easy migration to Fly/AWS later

**ADR-002: Media Pipeline:**
- Supabase Storage + NestJS color-analysis worker keeps wardrobe assets private
- Webhook-triggered processing on upload

**ADR-004: Auth & Roles:**
- Supabase Auth + NextAuth bridge + Postgres RBAC
- Guardian consent stored and checked before enabling uploads for under-16 accounts
- RLS policies enforce tenant isolation

**Deployment Architecture (Section: Deployment Architecture):**
- Custom domain: `couturecast.app` with `app.` (Vercel) and `api.` (Fly) subdomains
- Supabase projects: dev (auto-pause after 1 week), prod (live users); staging deferred due to free plan limits

### Testing Context

**Source: docs/test-design-system.md**

**Deployment & Environment Strategy (Section: Deployment & Environment Strategy):**
- **Local:** Docker Compose (Postgres, Redis, Supabase local); Prisma seed scripts reset on demand
- **CI (Ephemeral):** Testcontainers + Supabase CLI for local instance
- **Dev (Shared):** Supabase dev project (wiped weekly), seeded with factories
- **Staging:** Deferred until free slot/upgrade available
- **Production:** Real user data, backups + PITR enabled

**Secrets & Configuration Management:**
- **SUPABASE_SERVICE_KEY:** Local CLI / Supabase Dev / Supabase Staging / Supabase Prod
- **Test Strategy:** RLS bypass validation (service key should bypass); rotation tests

**Test Environment Requirements:**
- Supabase Test Project with anonymized wardrobe assets, guardian consent fixtures, and RLS parity (no bypass)

### Security Considerations

**RLS Scaffolding (Deferred to CC-0.11):**
- Full RLS policies will be implemented in CC-0.11 (Guardian consent flow)
- This story establishes RLS-enabled tables and placeholder policies
- Service key bypass for initial development (non-prod environments only)

**Storage Security:**
- All buckets default to private (public: false)
- Signed URLs with time-based expiration (1 hour upload, 24 hour view)
- File size limits enforced at bucket level

### Project Structure Notes

**Expected Structure After This Story:**
```
supabase/
├── config.toml              # Supabase CLI configuration
├── seed.sql                 # Optional SQL seeds (Prisma seeds preferred)
└── migrations/              # Synced from Prisma schema
    └── (auto-generated)

.env.local                    # Local Supabase credentials
.env.example                  # Template for environment variables
```

**Supabase Projects:**
- Dev: https://ckmpgfjwsthgtkfqez.supabase.co (ref: ckmpgfjwsthgtkfqez, tier: Free, region: Americas, auto-pause after 1 week)
- Prod: https://kxypzmbqwpuhfnbrdpmc.supabase.co (ref: kxypzmbqwpuhfnbrdpmc, tier: Free now; upgrade to Pro recommended, region: Americas)
- Staging: Deferred until free slot/upgrade available (plan for anonymized data)

### References

- [Architecture: ADR-001 Data Persistence](docs/bmm-architecture-20251110.md#adr-001)
- [Architecture: ADR-002 Media Pipeline](docs/bmm-architecture-20251110.md#adr-002)
- [Architecture: ADR-004 Auth & Roles](docs/bmm-architecture-20251110.md#adr-004)
- [Architecture: Deployment Architecture](docs/bmm-architecture-20251110.md#deployment-architecture)
- [Test Design: Deployment & Environment Strategy](docs/test-design-system.md#deployment--environment-strategy)
- [Test Design: Secrets & Configuration Management](docs/test-design-system.md#secrets--configuration-management)
- [Epics: Epic 0 Story CC-0.3](docs/epics.md#story-cc-03-set-up-supabase-projects-devsta gingprod)

### Learnings from Previous Story

**From Story 0-2-configure-prisma-schema-migrations-and-seed-data (Status: drafted)**

**Expected Outputs:**
- Prisma schema created in `packages/db/prisma/schema.prisma`
- Initial migration generated
- Seed scripts ready to populate database

**Dependencies for This Story:**
- Need Prisma schema from CC-0.2 to sync with Supabase
- Migration files will be applied to Supabase projects
- Seed data will populate Supabase local instance

**Integration Point:**
- After Supabase setup, run `npx supabase db push` to sync Prisma schema to Supabase
- Seed data from CC-0.2 will populate local Supabase instance

## Dev Agent Record

### Context Reference

<!-- Path(s) to story context XML will be added here by context workflow -->

### Agent Model Used

<!-- Will be filled by dev agent -->

### Debug Log References

<!-- Will be filled by dev agent during implementation -->

### Completion Notes List

- Documented Supabase dev/prod projects and environment files for AC #1 (dev/prod only, staging deferred)

### File List

- NEW: .env.dev
- NEW: .env.prod
- MODIFIED: .env.local
- MODIFIED: .env.example
- MODIFIED: docs/sprint-artifacts/0-3-set-up-supabase-projects-dev-staging-prod.md
- MODIFIED: package.json
- MODIFIED: README.md

## Change Log

| Date | Author | Change |
| ---- | ------ | ------ |
| 2025-11-13 | Bob (Scrum Master) | Story drafted from Epic 0, CC-0.3 acceptance criteria |
| 2025-11-25 | Amelia (Dev Agent) | Updated scope to dev/prod only due to Supabase free plan limits; staging deferred |
