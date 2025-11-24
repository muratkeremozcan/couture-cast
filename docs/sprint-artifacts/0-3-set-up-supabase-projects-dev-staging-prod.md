# Story 0.3: Set up Supabase projects (dev/staging/prod)

Status: drafted

## Story

As a platform team,
I want Supabase infrastructure across environments,
so that developers can test locally and deploy to production with proper isolation.

## Acceptance Criteria

1. Create three Supabase projects: dev (wiped weekly), staging (anonymized snapshots), prod (live user data).
2. Configure Storage buckets: `wardrobe-images`, `derived-assets`, `community-uploads` with RLS policies per ADR-004.
3. Set up Supabase local development via Supabase CLI (`npx supabase start`); document access in README.
4. Configure database connection pooling (max 100 connections per environment) and backups (PITR enabled for prod).
5. Document environment URLs, service keys, and access credentials in Doppler (or Supabase Vault).

## Tasks / Subtasks

- [ ] Task 1: Create Supabase cloud projects (AC: #1)
  - [ ] Sign up for Supabase account at https://supabase.com
  - [ ] Create three organizations/projects: `couturecast-dev`, `couturecast-staging`, `couturecast-prod`
  - [ ] Configure project settings: region (closest to target users), pricing tier (Free for dev, Pro for staging/prod)
  - [ ] Document project URLs and ref IDs in project documentation
  - [ ] Set dev project to auto-pause after 1 week inactivity (wiped weekly per architecture)

- [ ] Task 2: Configure Storage buckets (AC: #2)
  - [ ] Create `wardrobe-images` bucket in all 3 projects (public: false, file size limit: 10MB, allowed MIME: image/jpeg, image/png)
  - [ ] Create `derived-assets` bucket (public: false, for color extraction outputs)
  - [ ] Create `community-uploads` bucket (public: false, file size limit: 5MB)
  - [ ] Enable RLS on all buckets (users can only access own files)
  - [ ] Configure bucket policies per ADR-004:
    - Teen users: can upload to wardrobe-images only if guardian consent granted
    - Guardians: can view linked teen's wardrobe-images
    - Admins: can access all buckets for moderation
  - [ ] Set up signed URL expiration (1 hour for uploads, 24 hours for views)

- [ ] Task 3: Install and configure Supabase CLI (AC: #3)
  - [ ] Install Supabase CLI: `npm install supabase --save-dev --workspace-root`
  - [ ] Run `npx supabase init` to create `supabase/` directory with config
  - [ ] Configure `supabase/config.toml` with local development settings
  - [ ] Run `npx supabase start` to start local Supabase stack (Postgres, Auth, Storage, Studio)
  - [ ] Verify local services accessible: Studio at http://localhost:54323, Postgres at localhost:54322
  - [ ] Link local to dev project: `npx supabase link --project-ref {dev-project-ref}`
  - [ ] Test migration sync: `npx supabase db push` applies Prisma schema to local instance

- [ ] Task 4: Configure database connection pooling and backups (AC: #4)
  - [ ] Set connection pooling in Supabase dashboard: max 100 connections per project (dev: 50, staging: 75, prod: 100)
  - [ ] Configure connection pool mode: transaction pooling for serverless functions, session pooling for long-lived connections
  - [ ] Enable PITR (Point-In-Time Recovery) for production project (7-day retention)
  - [ ] Configure automated backups: daily snapshots for staging/prod, weekly for dev
  - [ ] Test connection pool: verify 100 concurrent connections can be established without errors

- [ ] Task 5: Document environment configuration (AC: #5)
  - [ ] Create `.env.example` template with Supabase environment variables:
    ```
    # Supabase Configuration
    SUPABASE_URL=https://{project-ref}.supabase.co
    SUPABASE_ANON_KEY={anon-key}
    SUPABASE_SERVICE_KEY={service-key}
    DATABASE_URL=postgresql://postgres:{password}@db.{project-ref}.supabase.co:5432/postgres
    ```
  - [ ] Create Doppler projects (or Supabase Vault secrets): local, ci, dev, staging, production
  - [ ] Store credentials securely in Doppler for each environment
  - [ ] Document in README.md: how to access Supabase projects, how to sync env vars, how to run local development
  - [ ] Add to root README.md: "Prerequisites: Supabase CLI, Docker (for local Postgres)"

- [ ] Task 6: Configure Supabase Auth settings
  - [ ] Enable email/password authentication in Supabase Auth settings
  - [ ] Configure magic link email templates (branded CoutureCast styling)
  - [ ] Set JWT expiration: 7 days (refresh token), 1 hour (access token)
  - [ ] Configure redirect URLs for dev/staging/prod environments
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
  - [ ] Verify dev/staging/prod project dashboards are accessible

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
- Supabase projects: dev (auto-pause after 1 week), staging (anonymized data), prod (live users)

### Testing Context

**Source: docs/test-design-system.md**

**Deployment & Environment Strategy (Section: Deployment & Environment Strategy):**
- **Local:** Docker Compose (Postgres, Redis, Supabase local); Prisma seed scripts reset on demand
- **CI (Ephemeral):** Testcontainers + Supabase CLI for local instance
- **Dev (Shared):** Supabase dev project (wiped weekly), seeded with factories
- **Staging:** Anonymized prod-like data (refreshed weekly), full RLS enforcement
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
- Dev: https://couturecast-dev.supabase.co (weekly wipe)
- Staging: https://couturecast-staging.supabase.co (anonymized data)
- Prod: https://couturecast-prod.supabase.co (live users)

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

<!-- Will be filled by dev agent upon completion -->

### File List

<!-- Will be filled by dev agent with NEW/MODIFIED/DELETED files -->

## Change Log

| Date | Author | Change |
| ---- | ------ | ------ |
| 2025-11-13 | Bob (Scrum Master) | Story drafted from Epic 0, CC-0.3 acceptance criteria |
