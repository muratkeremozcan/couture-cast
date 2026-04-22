# Story 0.11: Implement guardian consent flow and RLS policies

Status: in-progress

## Story

As Compliance,
I need guardian consent enforcement for under-16 users,
so that CoutureCast satisfies COPPA requirements and age-gating obligations.

## Acceptance Criteria

1. Implement age verification on signup: users enter birthdate → calculate age → block if <13, flag if 13-15 (requires guardian), allow if 16+.
2. Create guardian invitation flow: teen account created in "pending consent" state → guardian receives email invite → guardian accepts → consent timestamp recorded in `guardian_consent` table with `guardian_id`, `teen_id`, `timestamp`, `ip_address`.
3. Implement RLS policies per ADR-004 and test-design-system.md Guardian Consent Flow Edge Cases:
   - Teen can only access own wardrobe unless guardian linked
   - Guardian can access linked teen's wardrobe (read-only or full access based on consent level)
   - Cross-account access denial enforced
4. Create immutable audit log entries for all consent events (grant, revoke, guardian deleted) per test-design-system.md Audit Log Verification.
5. Implement consent revocation: guardian revokes → teen session invalidated → wardrobe inaccessible → audit log records revocation.
6. Add test coverage per test-design-system.md: single guardian happy path, revocation mid-session, multiple guardians, teen turns 18, consent audit trail, age verification failure (7 test cases).

## Tasks / Subtasks

- [x] Task 1: Implement age verification on signup (AC: #1)
  - [x] Add birthdate field to signup form (Expo and Next.js)
  - [x] Create age calculation utility: `packages/utils/age.ts`:
    ```typescript
    export function calculateAge(birthdate: Date): number {
      const today = new Date()
      let age = today.getFullYear() - birthdate.getFullYear()
      const monthDiff = today.getMonth() - birthdate.getMonth()
      if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthdate.getDate())) {
        age--
      }
      return age
    }
    ```
  - [x] Implement age gate in signup endpoint:
    ```typescript
    const age = calculateAge(birthdate)
    if (age < 13) throw new ForbiddenException('Must be 13 or older')
    if (age < 16) {
      // Create account in pending state, require guardian
      user.status = 'pending_guardian_consent'
    }
    ```
  - [x] Add UI messaging: "You must be 13 or older" for <13, "Guardian consent required" for 13-15

- [x] Task 2: Create guardian_consent table migration (AC: #2)
  - [x] Add to Prisma schema:
    ```prisma
    model GuardianConsent {
      id          String   @id @default(uuid())
      guardianId  String
      teenId      String
      consentLevel String  // 'read_only' or 'full_access'
      grantedAt   DateTime @default(now())
      revokedAt   DateTime?
      ipAddress   String
      guardian    User     @relation("Guardian", fields: [guardianId], references: [id])
      teen        User     @relation("Teen", fields: [teenId], references: [id])
      @@unique([guardianId, teenId])
    }
    ```
  - [x] Create migration: `npx prisma migrate dev --name add_guardian_consent`
  - [x] Add indexes for performance: `@@index([teenId])`, `@@index([guardianId])`

- [x] Task 3: Implement guardian invitation flow (AC: #2)
  - [x] Create `apps/api/src/modules/guardian/guardian.service.ts`
  - [x] Implement `inviteGuardian(teenId: string, guardianEmail: string)`:
    - Generate invitation token (JWT with 7-day expiration)
    - Send email with invitation link: `/guardian/accept?token=...`
    - Store invitation in `guardian_invitations` table
  - [x] Implement `acceptInvitation(token: string)`:
    - Validate token
    - Create or link guardian account
    - Record consent in `guardian_consent` table with IP address
    - Send confirmation email to teen and guardian
  - [x] Add invitation UI in mobile and web apps

- [ ] Task 3.5: Propagate guardian invitation env vars to hosted runtimes
  - [x] Copy the variable `GUARDIAN_INVITE_JWT_SECRET` from local `.env.dev` into Vercel
        project `couture-cast-api` Preview environment variables
  - [x] Copy the variable `GUARDIAN_INVITE_JWT_SECRET` from local `.env.prod` into Vercel
        project `couture-cast-api` Production environment variables
  - [ ] Copy the variable name `GUARDIAN_INVITE_WEB_BASE_URL` into Vercel project
        `couture-cast-api` Preview environment variables and set it to the intended web origin
        for preview invitation links
  - [x] Copy the variable name `GUARDIAN_INVITE_WEB_BASE_URL` into Vercel project
        `couture-cast-api` Production environment variables and set it to the production web
        origin used in guardian invitation links
  - [x] Do not copy guardian invitation secrets into `couture-cast-web`, GitHub Actions,
        Supabase, Upstash Redis, Expo EAS, or markdown docs unless a later deployment path
        explicitly requires them
  - [x] Keep real values only in gitignored local `.env*` files and provider secret stores; never
        paste secret values into the repository

- [x] Task 4: Implement RLS policies in Supabase (AC: #3)
  - [x] Prerequisite: deploy Prisma schema to Supabase dev/prod (once available from Story 0.2) so tables exist for RLS
  - [x] Create RLS policy for `wardrobe_items` table:

    ```sql
    -- Teen can access own wardrobe
    CREATE POLICY "Teen can access own wardrobe"
    ON wardrobe_items FOR ALL
    USING (auth.uid() = user_id);

    -- Guardian can access linked teen's wardrobe
    CREATE POLICY "Guardian can access linked teen wardrobe"
    ON wardrobe_items FOR SELECT
    USING (
      EXISTS (
        SELECT 1 FROM guardian_consent
        WHERE guardian_id = auth.uid()
        AND teen_id = wardrobe_items.user_id
        AND revoked_at IS NULL
      )
    );

    -- Guardian with full access can modify
    CREATE POLICY "Guardian full access can modify"
    ON wardrobe_items FOR ALL
    USING (
      EXISTS (
        SELECT 1 FROM guardian_consent
        WHERE guardian_id = auth.uid()
        AND teen_id = wardrobe_items.user_id
        AND consent_level = 'full_access'
        AND revoked_at IS NULL
      )
    );
    ```

  - Note: the shipped migration applies this same guardian-aware pattern to
    `GarmentItem`, `OutfitRecommendation`, `UserProfile`, `ComfortPreferences`,
    and `PaletteInsights`. Use
    `packages/db/prisma/migrations/20260420113000_add_guardian_shared_rls_policies/migration.sql`
    and `packages/db/test/rls-policies.spec.ts` as the authoritative source for
    the real table and policy names.
  - [x] Apply RLS policies to all user-scoped tables (rituals, preferences, etc.)
  - [x] Test RLS policies with different user roles

- [ ] Task 5: Create audit log for consent events (AC: #4)
  - [x] Add `consent_event` type to `audit_log` table:
    ```prisma
    model AuditLog {
      id        String   @id @default(uuid())
      eventType String   // 'consent_granted', 'consent_revoked', 'guardian_deleted'
      userId    String
      metadata  Json     // { guardianId, teenId, consentLevel, ipAddress }
      timestamp DateTime @default(now())
      @@index([eventType, timestamp])
    }
    ```
  - [x] Log consent grant: `auditLog.create({ eventType: 'consent_granted', ... })`
  - [x] Log consent revoke: `auditLog.create({ eventType: 'consent_revoked', ... })`
  - [x] Make audit log immutable: no DELETE or UPDATE policies

- [x] Task 6: Implement consent revocation (AC: #5)
  - [x] Create `revokeConsent(guardianId: string, teenId: string)` endpoint
  - [x] Update `guardian_consent` table: set `revokedAt = NOW()`
  - [x] Invalidate teen's active sessions (JWT blacklist or short expiration)
  - [x] Send notification to teen: "Guardian consent revoked"
  - [x] Log revocation event to audit log
  - [x] Test: teen cannot access wardrobe after revocation

- [x] Task 7: Handle teen turning 18 (AC: #6)
  - [x] Create cron job to check birthdays daily
  - [x] When teen turns 18:
    - Update user status: `pending_guardian_consent` → `active`
    - Send notification: "You no longer require guardian consent"
    - Optionally revoke guardian consent (configurable)
    - Log event to audit log
  - [x] Test: teen gains full access on 18th birthday

- [ ] Task 8: Write test cases (AC: #6)
  - [ ] Test: Single guardian happy path
    - Teen signs up (age 14)
    - Guardian receives invitation
    - Guardian accepts
    - Teen can access wardrobe
  - [ ] Test: Revocation mid-session
    - Teen logged in
    - Guardian revokes consent
    - Teen session invalidated
    - Teen cannot access wardrobe
  - [ ] Test: Multiple guardians
    - Teen has 2 guardians
    - Both can access wardrobe
    - One revokes, other still has access
  - [ ] Test: Teen turns 18
    - Teen turns 18
    - Status updated to active
    - Guardian consent optional
  - [ ] Test: Consent audit trail
    - Grant, revoke, multiple guardians
    - All events logged
    - Audit log immutable
  - [ ] Test: Age verification failure
    - User <13 blocked
    - User 13-15 requires guardian
    - User 16+ no guardian needed
  - [ ] Test: Cross-account access denial
    - Teen A cannot access Teen B's wardrobe
    - Guardian A cannot access unlinked teen
  - [ ] Follow-up boundary: auth-session rollout is implemented in Story 0.14 Task 2 only
        after login/session-backed journeys are stable; keep 401/403 negative contract tests
        unauthenticated.

- [ ] Task 9: Create guardian consent UI (AC: #2)
  - [ ] Teen signup flow: add birthdate picker, show guardian invitation screen if 13-15
  - [ ] Guardian invitation email template with accept link
  - [ ] Guardian accept page: create account or login, confirm consent
  - [ ] Teen dashboard: show guardian consent status, list guardians
  - [ ] Guardian dashboard: show linked teens, manage consent
  - [ ] Add UI to revoke consent

- [ ] Task 10: Document COPPA compliance (AC: #1-#6)
  - [ ] Create `_bmad-output/project-knowledge/coppa-compliance.md`:
    - Age verification strategy
    - Guardian consent requirements
    - Consent revocation process
    - Audit logging
    - Data retention policies
    - Privacy policy updates
  - [ ] Add COPPA section to Terms of Service
  - [ ] Document for legal review

## Dev Notes

### Architecture Context

**Source: \_bmad-output/planning-artifacts/architecture.md**

**ADR-004 Auth & Roles (line 221):**

- Supabase Auth + NextAuth + Postgres RBAC + guardian consent

**Security Architecture (lines 175-181):**

- Supabase Auth + RLS enforce tenant isolation
- Guardian consent stored and checked before enabling uploads for under-16 accounts
- Postgres `pgcrypto` encrypts sensitive guardian/contact fields
- Audit logging writes immutable entries for authentication changes, moderation decisions, data exports

**Data Architecture (line 161):**

- Core tables include `guardian_consent`

### Testing Context

**7 Test Cases from Epics (AC: #6):**

1. Single guardian happy path
2. Revocation mid-session
3. Multiple guardians
4. Teen turns 18
5. Consent audit trail
6. Age verification failure
7. Cross-account access denial

**Edge Cases:**

- Guardian deletes account: revoke all consents, notify teens
- Teen deletes account: revoke all guardian links, notify guardians
- Guardian invitation expires: teen remains in pending state, can resend
- Multiple invitations: last accepted guardian has consent
- Consent level change: read-only → full access or vice versa

### Implementation Patterns

**Age Verification Pattern:**

```typescript
function validateAge(birthdate: Date): { allowed: boolean; requiresGuardian: boolean } {
  const age = calculateAge(birthdate)
  if (age < 13) return { allowed: false, requiresGuardian: false }
  if (age < 16) return { allowed: true, requiresGuardian: true }
  return { allowed: true, requiresGuardian: false }
}
```

**RLS Policy Pattern:**

```sql
-- Teen can only access own data
CREATE POLICY "teen_own_data"
ON user_data FOR ALL
USING (auth.uid() = user_id);

-- Guardian can access linked teen data
CREATE POLICY "guardian_linked_teen"
ON user_data FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM guardian_consent
    WHERE guardian_id = auth.uid()
    AND teen_id = user_data.user_id
    AND revoked_at IS NULL
  )
);
```

**Audit Log Pattern:**

```typescript
async function logConsentEvent(event: ConsentEvent) {
  await prisma.auditLog.create({
    data: {
      eventType: event.type,
      userId: event.userId,
      metadata: {
        guardianId: event.guardianId,
        teenId: event.teenId,
        ipAddress: event.ipAddress,
      },
      timestamp: new Date(),
    },
  })
}
```

### Project Structure Notes

**New Directories:**

```
apps/api/src/modules/guardian/
├── guardian.module.ts
├── guardian.service.ts
├── guardian.controller.ts
└── guardian.test.ts
apps/api/src/modules/consent/
├── consent.module.ts
├── consent.service.ts
└── consent.test.ts
packages/db/prisma/migrations/
└── XXX_add_guardian_consent/
    └── migration.sql
_bmad-output/
└── project-knowledge/
    └── coppa-compliance.md
```

### References

- [Architecture: ADR-004 Auth & Roles](../planning-artifacts/architecture.md#architecture-decision-records-adrs)
- [Architecture: Security Architecture](../planning-artifacts/architecture.md#security-architecture)
- [Epics: Epic 0 Story CC-0.11](../planning-artifacts/epics.md#epic-0--platform-foundation--infrastructure-sprint-0)
- [COPPA Requirements](https://www.ftc.gov/legal-library/browse/rules/childrens-online-privacy-protection-rule-coppa)
- [Supabase RLS](https://supabase.com/docs/guides/auth/row-level-security)

### Learnings from Previous Stories

**From CC-0.2 (Prisma):**

- Foreign key relationships critical
- Migrations must be reversible

**From CC-0.3 (Supabase):**

- RLS policies enforce security
- Service roles bypass RLS

**For this story:**

- Age verification protects minors
- Guardian consent enables compliance
- RLS policies enforce access control
- Audit logging provides accountability
- Test all edge cases thoroughly

## Dev Agent Record

### Context Reference

<!-- Path(s) to story context XML will be added here by context workflow -->

### Agent Model Used

GPT-5 Codex

### Debug Log References

- `npm install --ignore-scripts --no-progress`
- `npm run generate:http-openapi`
- `npm run typecheck --workspace @couture/utils && npm run test --workspace @couture/utils`
- `npm run typecheck --workspace api && npm run test --workspace api -- src/modules/auth/auth.controller.spec.ts src/modules/auth/auth.service.spec.ts`
- `npm run typecheck --workspace web && npm run test --workspace web -- src/app/signup/signup-form.test.tsx`
- `npm run typecheck --workspace mobile && npm run test --workspace mobile -- src/features/signup/signup-screen.test.tsx`
- `npm run typecheck --workspace @couture/api-client && npm run test --workspace @couture/api-client -- testing/http-openapi.spec.ts`
- `npx tsc --noEmit -p playwright/tsconfig.json`
- `npx eslint --max-warnings=0 playwright/tests/api/auth-signup-age-gate.spec.ts`
- `TEST_ENV=local npx playwright test playwright/tests/api/auth-signup-age-gate.spec.ts --list`
- `npm run db:generate --workspace packages/db`
- `npm run typecheck --workspace packages/db`
- `npm run test --workspace api -- src/modules/auth/auth.service.spec.ts src/modules/user/user.service.spec.ts`
- `npm run test --workspace @couture/testing -- test/cleanup.spec.ts`
- `npm run test --workspace api -- src/modules/guardian/guardian.controller.spec.ts src/modules/guardian/guardian.service.spec.ts`
- `npm run test --workspace web -- src/app/signup/signup-form.test.tsx src/app/guardian/accept/guardian-accept-view.test.tsx`
- `npm run test --workspace mobile -- src/features/signup/signup-screen.test.tsx src/features/guardian/guardian-accept-screen.test.tsx`
- `npm run typecheck --workspace api`
- `npm run typecheck --workspace web`
- `npm run typecheck --workspace mobile`
- `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx prisma migrate deploy --schema packages/db/prisma/schema.prisma`
- `npm run test --workspace packages/db`
- `npx eslint --max-warnings=0 packages/db/test/rls-policies.spec.ts packages/db/vitest.config.ts`
- `set -a; source .env.dev; set +a; npx prisma migrate deploy --schema packages/db/prisma/schema.prisma`
- `set -a; source .env.prod; set +a; npx prisma migrate deploy --schema packages/db/prisma/schema.prisma`
- `npm run test --workspace api -- src/modules/guardian/guardian.service.spec.ts`
- `npm run typecheck --workspace packages/db`
- `npm run test --workspace packages/db -- test/audit-log-immutability.spec.ts`
- `npm run test --workspace api -- src/modules/guardian/guardian.controller.spec.ts src/modules/guardian/guardian.service.spec.ts src/modules/auth/security.guards.spec.ts`
- `npm run generate:http-openapi`
- `npm run test --workspace @couture/api-client -- testing/http-openapi.spec.ts`
- `npm run test --workspace packages/db -- test/rls-policies.spec.ts test/audit-log-immutability.spec.ts`
- `npm run test --workspace api -- src/modules/guardian/guardian.service.spec.ts src/modules/guardian/guardian.cron.spec.ts`
- `npm run typecheck --workspace api`

### Completion Notes List

- Added a new shared `@couture/utils` workspace package with `calculateAge`, `parseBirthdateInput`, and reusable age-gate evaluation logic.
- Added `POST /api/v1/auth/signup` plus shared contract definitions, OpenAPI registration, and API tests for under-13 blocking, 13-15 pending guardian consent, and 16+ eligibility.
- Added minimal Next.js and Expo signup flows with birthdate inputs and inline messaging for the COPPA age-gate states.
- Added a focused Playwright API contract spec for signup age-gating and duplicate-email handling without expanding this PR into browser/mobile E2E churn.
- Extended the existing `GuardianConsent` Prisma model with `consent_level` and `revoked_at`, preserving the repo's existing snake_case naming and current callers.
- Added a forward SQL migration that backfills revoked rows, keeps existing guardian/teen lookup indexes in place, and prepares the table for later invitation/RLS work.
- Added a `GuardianInvitation` Prisma model and migration, wired cleanup helpers for invitation records, and exposed shared guardian invitation/accept contracts in the API client.
- Implemented an API guardian module with invitation token signing/verification, teen compliance-state checks, consent persistence, guardian account linking, and analytics capture on successful consent.
- Queued guardian invitation and confirmation emails through `event_envelope` records so the flow integrates with the repo's existing outbound-event pattern without introducing a parallel mailer stack.
- Added web and mobile guardian invitation UX for pending teen accounts plus guardian acceptance screens backed by the shared guardian contracts.
- Added a guardian-aware RLS migration that bridges Supabase JWT claims to the repo's current text user IDs, centralizes guardian/admin access helpers in the private schema, and protects wardrobe-domain tables plus self-only community tables.
- Added database-level Vitest coverage for teen, guardian read-only, guardian full-access, admin, anonymous, and cross-account denial scenarios, then deployed the RLS migration set to local, dev, and prod Supabase databases.
- Added immutable audit-log hardening with an event-type/timestamp index, consent-grant writes in the guardian acceptance transaction, and a database-level spec that proves direct `UPDATE`/`DELETE` attempts fail.
- Extended the guardian consent audit helper to accept revoke/delete event types so Task 6 can reuse the same payload shape when the revocation endpoint lands.
- Added `POST /api/v1/guardian/revoke` plus shared revoke contracts so guardians/admins can revoke one teen consent link with the caller IP recorded at the API boundary.
- Revocation now updates `GuardianConsent`, queues a teen notification email, records a `consent_revoked` audit log row, and only flips the teen back to `pending_guardian_consent` when no active guardian remains.
- Added teen compliance enforcement in `RequestAuthGuard` and a follow-on RLS migration so revoked teens lose authenticated self-access today instead of waiting for the future session-store rollout in Story 0.14.
- Added focused coverage for revoke controller/service behavior, blocked teen auth requests, refreshed OpenAPI output, and database-level proof that revoked teens can no longer read or mutate wardrobe rows.
- Added a daily UTC guardian cron sweep that emancipates 18+ teens, flips pending accounts to active, queues adulthood notifications, records `guardian_consent_aged_out` audit entries, and can revoke guardian links by default via config.
- Hardened guardian invitations so adult accounts cannot still gain or regain guardian-linked access through delayed acceptance, and added focused unit coverage for the 18th-birthday transition path.

### File List

- NEW `packages/utils/package.json`
- NEW `packages/utils/tsconfig.json`
- NEW `packages/utils/tsconfig.build.json`
- NEW `packages/utils/vitest.config.ts`
- NEW `packages/utils/src/index.ts`
- NEW `packages/utils/src/age.ts`
- NEW `packages/utils/src/age.spec.ts`
- MODIFIED `package-lock.json`
- MODIFIED `packages/api-client/src/contracts/http/auth.ts`
- MODIFIED `packages/api-client/testing/http-openapi.spec.ts`
- MODIFIED `packages/api-client/docs/http.openapi.json`
- MODIFIED `apps/api/package.json`
- MODIFIED `apps/api/src/contracts/http.ts`
- MODIFIED `apps/api/src/modules/auth/auth.controller.ts`
- MODIFIED `apps/api/src/modules/auth/auth.service.ts`
- MODIFIED `apps/api/src/modules/auth/auth.module.ts`
- MODIFIED `apps/api/src/modules/auth/auth.controller.spec.ts`
- MODIFIED `apps/api/src/modules/auth/auth.service.spec.ts`
- MODIFIED `apps/api/src/modules/auth/security.guards.ts`
- NEW `apps/api/src/modules/auth/security.guards.spec.ts`
- MODIFIED `apps/web/package.json`
- MODIFIED `apps/web/tsconfig.json`
- MODIFIED `apps/web/vitest.config.ts`
- MODIFIED `apps/web/src/app/page.tsx`
- NEW `apps/web/src/lib/signup.ts`
- NEW `apps/web/src/app/signup/page.tsx`
- NEW `apps/web/src/app/signup/signup-form.tsx`
- NEW `apps/web/src/app/signup/signup-form.test.tsx`
- MODIFIED `apps/mobile/package.json`
- MODIFIED `apps/mobile/tsconfig.json`
- MODIFIED `apps/mobile/vitest.config.ts`
- MODIFIED `apps/mobile/app/(tabs)/index.tsx`
- NEW `apps/mobile/app/signup.tsx`
- NEW `apps/mobile/src/lib/signup.ts`
- NEW `apps/mobile/src/features/signup/signup-screen.tsx`
- NEW `apps/mobile/src/features/signup/signup-screen.test.tsx`
- NEW `playwright/tests/api/auth-signup-age-gate.spec.ts`
- MODIFIED `packages/db/prisma/schema.prisma`
- NEW `packages/db/prisma/migrations/20260417020000_extend_guardian_consent_for_levels_and_revocation/migration.sql`
- NEW `packages/db/prisma/migrations/20260420113000_add_guardian_shared_rls_policies/migration.sql`
- MODIFIED `packages/db/package.json`
- NEW `packages/db/vitest.config.ts`
- NEW `packages/db/test/rls-policies.spec.ts`
- MODIFIED `.env.example`
- MODIFIED `apps/api/src/app.module.ts`
- MODIFIED `apps/api/src/contracts/http.ts`
- NEW `apps/api/src/modules/guardian/guardian.module.ts`
- NEW `apps/api/src/modules/guardian/guardian.controller.ts`
- NEW `apps/api/src/modules/guardian/guardian.controller.spec.ts`
- NEW `apps/api/src/modules/guardian/guardian.service.ts`
- NEW `apps/api/src/modules/guardian/guardian.service.spec.ts`
- NEW `apps/web/src/lib/guardian.ts`
- NEW `apps/web/src/app/guardian/accept/page.tsx`
- NEW `apps/web/src/app/guardian/accept/guardian-accept-view.tsx`
- NEW `apps/web/src/app/guardian/accept/guardian-accept-view.test.tsx`
- NEW `apps/mobile/src/lib/guardian.ts`
- NEW `apps/mobile/app/guardian-accept.tsx`
- NEW `apps/mobile/src/features/guardian/guardian-accept-screen.tsx`
- NEW `apps/mobile/src/features/guardian/guardian-accept-screen.test.tsx`
- NEW `packages/api-client/src/contracts/http/guardian.ts`
- MODIFIED `packages/api-client/src/contracts/http/index.ts`
- MODIFIED `packages/api-client/src/contracts/http/openapi.ts`
- MODIFIED `packages/testing/src/cleanup.ts`
- MODIFIED `packages/testing/test/cleanup.spec.ts`
- NEW `packages/db/prisma/migrations/20260417030000_add_guardian_invitations/migration.sql`
- NEW `packages/db/prisma/migrations/20260420160000_harden_audit_log_immutability/migration.sql`
- NEW `packages/db/prisma/migrations/20260421090000_block_revoked_teens_from_self_access/migration.sql`
- NEW `packages/db/test/audit-log-immutability.spec.ts`
- NEW `apps/api/src/modules/guardian/guardian.cron.ts`
- NEW `apps/api/src/modules/guardian/guardian.cron.spec.ts`

## Change Log

| Date       | Author             | Change                                                                                                                                                   |
| ---------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2025-11-13 | Bob (Scrum Master) | Story drafted from Epic 0, CC-0.11 acceptance criteria                                                                                                   |
| 2026-04-16 | Codex              | Completed Task 1 age verification across API, web, mobile, shared utils, OpenAPI docs, and added targeted Playwright API coverage                        |
| 2026-04-17 | Codex              | Completed Task 2 by extending the existing GuardianConsent Prisma model and adding a migration for consent levels and revocation support                 |
| 2026-04-17 | Codex              | Completed Task 3 guardian invitation flow across Prisma, API contracts/module, email event queueing, and web/mobile invitation and acceptance UI         |
| 2026-04-20 | Codex              | Completed Task 4 with guardian-aware RLS policies, database persona tests, and migration deploys to local/dev/prod Supabase environments                 |
| 2026-04-20 | Codex              | Advanced Task 5 with immutable audit-log storage, consent-grant persistence, and database coverage for blocked audit row mutations                       |
| 2026-04-21 | Codex              | Completed Task 6 with guardian revoke contracts/API flow, teen compliance/session blocking, and RLS coverage for revoked self-access                     |
| 2026-04-22 | Codex              | Completed Task 7 with daily adulthood emancipation cron coverage, configurable guardian-link revocation, audit/notification writes, and invite hardening |
