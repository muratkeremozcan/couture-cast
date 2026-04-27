# COPPA compliance

Updated: 2026-04-27 - Documented Story 0.11 guardian consent controls for
legal review.

Status: legal review required

This document is an engineering and product compliance draft. It is not legal
advice and must be approved by counsel before the COPPA, privacy, or Terms of
Service language is published.

## Regulatory baseline

- Current rule text: 16 CFR Part 312, Children's Online Privacy Protection Rule
  (COPPA Rule), current eCFR text verified on 2026-04-27:
  <https://www.ecfr.gov/current/title-16/chapter-I/subchapter-C/part-312>
- FTC business guidance: Complying with COPPA: Frequently Asked Questions:
  <https://www.ftc.gov/business-guidance/resources/complying-coppa-frequently-asked-questions>
- FTC final rule amendments: Federal Register publication dated 2025-04-22,
  with the general compliance date now reached on 2026-04-22:
  <https://www.federalregister.gov/documents/2025/04/22/2025-05904/childrens-online-privacy-protection-rule>
- FTC age-verification policy statement dated 2026-02-25:
  <https://www.ftc.gov/legal-library/browse/enforcement-policy-statement-promoting-adoption-age-verification-technology>

## Scope decision

CoutureCast's main product is designed as a 13+ general-audience service. The
product brief separately reserves CoutureCast Jr. for ages 12 and under, and the
main app blocks under-13 account creation until that product has its own
child-directed compliance review.

Legal must confirm whether the main product remains general audience. If counsel
determines that any surface is child-directed or mixed-audience under COPPA, the
age-screening and under-13 handling rules must be re-reviewed before release.

## Age verification strategy

Signup collects a neutral birthdate before enabling access to wardrobe,
recommendation, community, or profile features. The age calculation is shared
across clients and API code through `packages/utils/src/age.ts`.

| Age band | Product handling                                                                                                                                           | Current implementation evidence                                                                                 |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Under 13 | Block main CoutureCast signup and login access. Do not create an active account. Route future interest to the Jr. path only after separate legal approval. | `evaluateAgeGate` returns `blocked_underage`; web and mobile signup messaging says users must be 13 or older.   |
| 13-15    | Allow account creation only in `pending_guardian_consent` state. Block wardrobe access until a guardian grants consent.                                    | API signup stores pending compliance state; `RequestAuthGuard` and RLS coverage block pending or revoked teens. |
| 16+      | Create an active account without guardian consent.                                                                                                         | `evaluateAgeGate` returns `active`; API and client tests cover this path.                                       |

Operational requirements:

- Do not collect wardrobe images, outfit preferences, location-backed wardrobe
  data, profile content, or community content before age eligibility is known.
- Do not encourage a user to change their birthdate to bypass the gate.
- Preserve only the minimum age-gate evidence needed for compliance,
  fraud-prevention, and audit defense.
- Re-run legal review before adding document scanning, facial analysis, or other
  age-verification vendors. If a vendor is used only to determine age, collected
  data must not be reused, must be deleted promptly after verification, and must
  be protected by written confidentiality and security assurances.

## Guardian consent requirements

CoutureCast's guardian flow applies a stricter product policy than COPPA's
under-13 minimum: users aged 13-15 need guardian consent before wardrobe access.
The current flow is also intended to be reusable for CoutureCast Jr., but Jr. must
not launch without separate child-directed notices and legal approval.

Current consent model:

- A teen in `pending_guardian_consent` enters a guardian email address from the
  web or mobile signup flow.
- `POST /api/v1/guardian/invitations` creates a `GuardianInvitation` record,
  signs a token with a seven-day expiration, and queues an invitation email.
- The invitation identifies the teen account, requested consent level
  (`read_only` or `full_access`), expiration, and accept link.
- `POST /api/v1/guardian/accept` validates the token, links or creates the
  guardian account, records `GuardianConsent`, captures `consent_granted_at` and
  request IP address, and queues confirmation emails.
- Guardian consent levels drive RLS behavior: read-only guardians can view linked
  teen wardrobe data, while full-access guardians can update supported wardrobe
  rows.

Legal review requirements:

- Confirm that email-based consent is sufficient for the 13-15 product policy.
- For any future under-13 CoutureCast Jr. flow, confirm whether email-plus,
  text-plus, payment-card, knowledge-based, photo-ID, platform consent, or another
  FTC-approved method is required for each data-use category.
- Confirm whether any third-party disclosure is integral to the service. If not,
  the parent or guardian must be offered a separate consent choice for disclosure.
- Approve the direct notice copy before under-13 collection is enabled anywhere.

## Consent revocation process

Guardians can revoke a teen consent link from the guardian dashboard through
`POST /api/v1/guardian/revoke`.

Current revocation behavior:

- The API requires an authenticated guardian or admin.
- A guardian can revoke only their own link unless the caller is an admin.
- The consent row is updated with `revoked_at`, `revoked_ip_address`, and
  `status = revoked`.
- The teen receives a queued notification.
- A `consent_revoked` audit event is written.
- If no active guardian remains, teen access is invalidated and the account
  returns to a guardian-required state.
- RLS policies block revoked guardians and block teen self-access after the last
  active guardian consent is revoked.

Required user-facing policy language:

- Guardians must be told how to revoke consent before granting it.
- Guardians must be able to request review or deletion of covered child data.
- Revocation should stop future collection and use except where retention is
  legally required, necessary for security, or needed for compliance evidence.

## Audit logging

Consent evidence is stored in two layers:

- `GuardianConsent`: current and historical guardian-to-teen consent state.
- `AuditLog`: immutable lifecycle events with event type, user id, timestamp,
  IP address where applicable, and metadata.

Current event types:

- `consent_granted`
- `consent_revoked`
- `guardian_deleted`
- `guardian_consent_aged_out`

Database migration
`packages/db/prisma/migrations/20260420160000_harden_audit_log_immutability/migration.sql`
blocks direct audit-log `UPDATE`, `DELETE`, and `TRUNCATE`, adds an
`event_type/timestamp` index, and restricts RLS read access to admin claims.

Audit records must remain internally accessible for compliance investigation,
security review, and legal hold. They must not be exposed to guardians or teens
without a verified access/export workflow approved by legal.

## Data retention policies

COPPA requires child personal information to be retained only as long as
reasonably necessary for the purpose collected, and the amended rule requires a
written data-retention policy for children's personal information.

Draft CoutureCast retention rules:

| Data category                              | Retention rule                                                                                                            | Deletion or minimization trigger                                                                                           |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Under-13 signup attempts                   | Do not create active accounts. Keep only security or aggregate telemetry needed to prevent abuse.                         | Delete or anonymize raw attempt data on the shortest operational schedule legal approves.                                  |
| Pending guardian invitations               | Keep while the seven-day token is valid, then retain minimal delivery and abuse-prevention evidence.                      | Purge expired, unaccepted invitation content after the legal-approved grace period.                                        |
| Active guardian consent                    | Keep while the teen account needs guardian authorization and while needed for compliance evidence.                        | On teen deletion, guardian deletion, valid privacy request, or age-out, revoke or minimize according to approved workflow. |
| Revoked consent                            | Keep minimal evidence of who revoked, when, and from which account/IP for dispute and compliance defense.                 | Redact nonessential contact fields after the legal-approved retention period.                                              |
| Audit logs                                 | Keep immutable event evidence subject to legal hold and compliance needs.                                                 | Archive or minimize after the legal-approved retention period; never mutate rows in place.                                 |
| Wardrobe/profile/community data for minors | Keep only while the account is active, consent is valid where required, and the data is necessary for requested features. | Delete through account deletion, privacy request, consent revocation where legally required, or moderation/legal process.  |

Legal must supply exact retention periods before production publication. Until
then, product copy must avoid promising a fixed deletion interval except where
the system already guarantees it.

## Privacy policy updates

The published Privacy Policy needs a COPPA and teen privacy section covering:

- The main CoutureCast service is for users 13 and older.
- Under-13 users cannot create accounts in the main app.
- Birthdate is collected to determine eligibility and guardian-consent status.
- Users aged 13-15 need guardian consent before wardrobe access.
- Categories of personal information collected after consent, including account
  contact details, profile data, wardrobe images, outfit preferences, location or
  weather context where applicable, persistent identifiers, device data, and
  support/security logs.
- Whether any personal information is disclosed to service providers,
  analytics/observability vendors, affiliates, advertising partners, or public
  community surfaces.
- How guardians grant consent, revoke consent, request review, request deletion,
  or stop future collection.
- How consent and audit data are retained and protected.
- A dedicated privacy contact for guardian requests.
- A clear statement that no personalized advertising is served to minors unless
  legal later approves a compliant model.

## Terms of Service updates

The Terms of Service must include a COPPA/guardian consent section that states:

- Main CoutureCast is a 13+ service.
- Users under 13 may not use the main service.
- Users aged 13-15 need guardian consent before accessing wardrobe features.
- Guardians are responsible for consent accuracy and can revoke consent.
- CoutureCast may suspend or restrict accounts when age or guardian-consent
  information is missing, false, expired, or revoked.
- Future CoutureCast Jr. terms and privacy notices will be separate.

Draft ToS language is maintained in
`_bmad-output/project-knowledge/terms-of-service.md`.

## Legal review checklist

- Confirm main product classification: general audience, mixed audience, or
  child-directed.
- Approve under-13 block language and Jr. waitlist handling.
- Approve 13-15 guardian consent as product policy, including whether the
  consent method is sufficient.
- Approve future under-13 verifiable parental consent methods before Jr. work.
- Confirm direct notice requirements for each data category and third-party
  disclosure.
- Provide exact retention periods for invitations, revoked consent, audit logs,
  and minor wardrobe/profile data.
- Approve Privacy Policy copy, ToS copy, in-app consent copy, invitation email
  copy, and revocation copy.
- Confirm state privacy law overlays for teens, targeted advertising, profiling,
  location data, and deletion/export rights.

## Story 0.11 evidence map

| Acceptance criterion    | Compliance evidence                                                                                            |
| ----------------------- | -------------------------------------------------------------------------------------------------------------- |
| AC1 age verification    | Shared age utilities, API signup checks, web/mobile signup messaging, and age-gate tests.                      |
| AC2 guardian invitation | `GuardianInvitation`, seven-day signed token, invitation email payload, accept endpoint, and dashboards.       |
| AC3 RLS policies        | Guardian-aware RLS migrations and database tests for teen, guardian, admin, revoked, and cross-account access. |
| AC4 audit logging       | Immutable `AuditLog` migration and grant/revoke/age-out audit event tests.                                     |
| AC5 revocation          | Revoke endpoint, teen notification, session/access invalidation, and RLS revoked-access coverage.              |
| AC6 test coverage       | Unit, integration, database, and Playwright API coverage mapped in the story file.                             |
