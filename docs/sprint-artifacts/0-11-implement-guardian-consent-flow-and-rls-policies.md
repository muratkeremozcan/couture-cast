# Story 0.11: Implement guardian consent flow and RLS policies

Status: drafted

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

- [ ] Task 1: Implement age verification on signup (AC: #1)
  - [ ] Add birthdate field to signup form (Expo and Next.js)
  - [ ] Create age calculation utility: `packages/utils/age.ts`:
    ```typescript
    export function calculateAge(birthdate: Date): number {
      const today = new Date();
      let age = today.getFullYear() - birthdate.getFullYear();
      const monthDiff = today.getMonth() - birthdate.getMonth();
      if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthdate.getDate())) {
        age--;
      }
      return age;
    }
    ```
  - [ ] Implement age gate in signup endpoint:
    ```typescript
    const age = calculateAge(birthdate);
    if (age < 13) throw new ForbiddenException('Must be 13 or older');
    if (age < 16) {
      // Create account in pending state, require guardian
      user.status = 'pending_guardian_consent';
    }
    ```
  - [ ] Add UI messaging: "You must be 13 or older" for <13, "Guardian consent required" for 13-15

- [ ] Task 2: Create guardian_consent table migration (AC: #2)
  - [ ] Add to Prisma schema:
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
  - [ ] Create migration: `npx prisma migrate dev --name add_guardian_consent`
  - [ ] Add indexes for performance: `@@index([teenId])`, `@@index([guardianId])`

- [ ] Task 3: Implement guardian invitation flow (AC: #2)
  - [ ] Create `apps/api/src/modules/guardian/guardian.service.ts`
  - [ ] Implement `inviteGuardian(teenId: string, guardianEmail: string)`:
    - Generate invitation token (JWT with 7-day expiration)
    - Send email with invitation link: `/guardian/accept?token=...`
    - Store invitation in `guardian_invitations` table
  - [ ] Implement `acceptInvitation(token: string)`:
    - Validate token
    - Create or link guardian account
    - Record consent in `guardian_consent` table with IP address
    - Send confirmation email to teen and guardian
  - [ ] Add invitation UI in mobile and web apps

- [ ] Task 4: Implement RLS policies in Supabase (AC: #3)
  - [ ] Create RLS policy for `wardrobe_items` table:
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
  - [ ] Apply RLS policies to all user-scoped tables (rituals, preferences, etc.)
  - [ ] Test RLS policies with different user roles

- [ ] Task 5: Create audit log for consent events (AC: #4)
  - [ ] Add `consent_event` type to `audit_log` table:
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
  - [ ] Log consent grant: `auditLog.create({ eventType: 'consent_granted', ... })`
  - [ ] Log consent revoke: `auditLog.create({ eventType: 'consent_revoked', ... })`
  - [ ] Make audit log immutable: no DELETE or UPDATE policies

- [ ] Task 6: Implement consent revocation (AC: #5)
  - [ ] Create `revokeConsent(guardianId: string, teenId: string)` endpoint
  - [ ] Update `guardian_consent` table: set `revokedAt = NOW()`
  - [ ] Invalidate teen's active sessions (JWT blacklist or short expiration)
  - [ ] Send notification to teen: "Guardian consent revoked"
  - [ ] Log revocation event to audit log
  - [ ] Test: teen cannot access wardrobe after revocation

- [ ] Task 7: Handle teen turning 18 (AC: #6)
  - [ ] Create cron job to check birthdays daily
  - [ ] When teen turns 18:
    - Update user status: `pending_guardian_consent` → `active`
    - Send notification: "You no longer require guardian consent"
    - Optionally revoke guardian consent (configurable)
    - Log event to audit log
  - [ ] Test: teen gains full access on 18th birthday

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

- [ ] Task 9: Create guardian consent UI (AC: #2)
  - [ ] Teen signup flow: add birthdate picker, show guardian invitation screen if 13-15
  - [ ] Guardian invitation email template with accept link
  - [ ] Guardian accept page: create account or login, confirm consent
  - [ ] Teen dashboard: show guardian consent status, list guardians
  - [ ] Guardian dashboard: show linked teens, manage consent
  - [ ] Add UI to revoke consent

- [ ] Task 10: Document COPPA compliance (AC: #1-#6)
  - [ ] Create `docs/coppa-compliance.md`:
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

**Source: docs/bmm-architecture-20251110.md**

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
  const age = calculateAge(birthdate);
  if (age < 13) return { allowed: false, requiresGuardian: false };
  if (age < 16) return { allowed: true, requiresGuardian: true };
  return { allowed: true, requiresGuardian: false };
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
  });
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
docs/
└── coppa-compliance.md
```

### References

- [Architecture: ADR-004 Auth & Roles](docs/bmm-architecture-20251110.md#architecture-decision-records-adrs)
- [Architecture: Security Architecture](docs/bmm-architecture-20251110.md#security-architecture)
- [Epics: Epic 0 Story CC-0.11](docs/epics.md#epic-0--platform-foundation--infrastructure-sprint-0)
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
| 2025-11-13 | Bob (Scrum Master) | Story drafted from Epic 0, CC-0.11 acceptance criteria |
