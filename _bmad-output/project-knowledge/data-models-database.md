# Data models and database

Updated: 2026-07-17 - Brownfield deep scan of the implemented Prisma and PostgreSQL layer.

## Scope and sources of truth

CoutureCast uses PostgreSQL through Prisma 6.19.0. The database URL is supplied through
`DATABASE_URL`; this document intentionally contains no environment values or credentials.

The current logical model is defined in
[the Prisma schema](../../packages/db/prisma/schema.prisma). Committed SQL under
[Prisma migrations](../../packages/db/prisma/migrations/) is authoritative for physical
constraints, grants, RLS policies, security-definer functions, and triggers that Prisma cannot
represent. In particular, a schema comment that says `RLS` is descriptive, not enforcement by
itself.

The scan covered the schema, all committed migrations, the seed entry point and modules, database
package scripts, the migration-deploy wrapper, and the five database test suites.

## Enumerations

| Enum                 | Values                          | Use                                 |
| -------------------- | ------------------------------- | ----------------------------------- |
| `ConsentStatus`      | `pending`, `granted`, `revoked` | Guardian-consent lifecycle          |
| `ConsentLevel`       | `read_only`, `full_access`      | Guardian access to linked teen data |
| `ComfortRun`         | `cold`, `neutral`, `warm`       | Personal temperature tendency       |
| `WindTolerance`      | `low`, `medium`, `high`         | Personal wind tolerance             |
| `PrecipPreparedness` | `low`, `medium`, `high`         | Personal precipitation readiness    |

`ConsentLevel` was added after the initial schema by the
[consent-level migration](../../packages/db/prisma/migrations/20260417020000_extend_guardian_consent_for_levels_and_revocation/migration.sql).
The remaining enum definitions originate in the initial migration or current schema.

## Model catalog

Unless noted otherwise, string IDs use Prisma `cuid()` defaults, timestamps use PostgreSQL
timestamps, and `created_at` defaults to the current database time. Most `updated_at` fields are
maintained by Prisma's `@updatedAt`, so raw SQL writers must set them explicitly.

### Identity, profile, and consent

| Model                | Key fields and relationships                                                               | Important constraints                                                |
| -------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| `User`               | `id`, unique `email`; root for profile, wardrobe, social, alerts, events, and audit data   | Application identity is text/cuid, not a foreign key to `auth.users` |
| `UserProfile`        | One-to-one `user_id`; optional display name, birthdate, and JSON preferences               | Unique `user_id`; user deletion is restricted                        |
| `ComfortPreferences` | One-to-one `user_id`; three comfort enums                                                  | Unique `user_id`; user deletion is restricted                        |
| `GuardianConsent`    | Required guardian and teen `User` links; level, status, grant/revoke times and IP metadata | Unique guardian/teen pair; both foreign-key deletions restricted     |
| `GuardianInvitation` | Teen, guardian email, requested level, expiry, optional accepted guardian                  | Partial unique index permits only one open invite per teen/email     |

The open-invitation uniqueness rule is SQL-only in the
[guardian invitation migration](../../packages/db/prisma/migrations/20260417030000_add_guardian_invitations/migration.sql):
historical accepted invitations remain possible while duplicate outstanding invitations do not.

### Weather and location

| Model                   | Key fields and relationships                                                                  | Important constraints                                                                   |
| ----------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `WeatherSnapshot`       | Canonical location/provider observation with coordinates, timezone, alerts JSON, and segments | Unique location/provider/provider-update tuple; location/fetch index                    |
| `ForecastSegment`       | Required snapshot; forecast time, offset, temperature, precipitation, wind, and condition     | Unique snapshot/forecast time; forecast-time index                                      |
| `WeatherIngestionState` | `location_key` primary key and last provider success/failure times                            | One state row per canonical location key                                                |
| `SavedLocation`         | User-owned label, canonical key, coordinates, timezone, optional place names, ordering        | Unique user/key; one partial-index primary location per user; coordinate and key checks |

Weather persistence was normalized by the
[weather migration](../../packages/db/prisma/migrations/20260707104000_normalize_weather_persistence/migration.sql).
`SavedLocation.location_key` must match the lowercase slug pattern
`^[a-z0-9]+(-[a-z0-9]+)*$`; latitude and longitude are bounded by SQL checks. The one-primary-row
rule and key-format check are not visible in the Prisma model. See the
[saved-location creation](../../packages/db/prisma/migrations/20260709120000_add_saved_locations/migration.sql)
and
[key-hardening migration](../../packages/db/prisma/migrations/20260709123000_harden_saved_location_key_format/migration.sql).

### Wardrobe, recommendation, and social data

| Model                  | Key fields and relationships                                                    | Important constraints                                      |
| ---------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `GarmentItem`          | User-owned image/category/material/comfort data and palette JSON                | Indexed by owner                                           |
| `PaletteInsights`      | One-to-one garment analysis plus owning user, colors, undertone, and confidence | Unique garment; owner index                                |
| `OutfitRecommendation` | User, optional forecast segment, scenario, garment IDs JSON, and reasoning JSON | Unique user/segment/scenario; owner index                  |
| `LookbookPost`         | User, optional palette insight, image URLs, caption, locale, and climate band   | Owner index; palette deletion sets link null               |
| `EngagementEvent`      | User and required post with event type                                          | Owner index; post/user deletion restricted                 |
| `ModerationEvent`      | Optional post, garment, flagger, and reviewer links plus action/reason          | All optional references become null on referenced deletion |

The recommendation uniqueness rule was added by the
[outfit uniqueness migration](../../packages/db/prisma/migrations/20260716120800_add_outfit_recommendation_unique_constraint/migration.sql).
Because PostgreSQL treats `NULL` values as distinct in a normal unique index, multiple rows with the
same user and scenario remain possible when `forecast_segment_id` is null.

### Alerting, messaging, and telemetry

| Model                      | Key fields and relationships                                                                  | Important constraints                                                      |
| -------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `AlertRule`                | User-owned rule type, non-null threshold, enabled flag                                        | Unique user/type; allowed types and type-specific threshold checks         |
| `NotificationPreference`   | One-to-one user setting for push and quiet hours                                              | Unique user; string times default to `22:00`/`07:00`, timezone to `UTC`    |
| `PushToken`                | User-owned globally unique token, optional platform, last-used time                           | Unique token; owner index                                                  |
| `EventEnvelope`            | Channel, JSON payload, optional user, optional outbox row                                     | User deletion cascades; channel, creation, and owner indexes               |
| `AlertDeliveryOutbox`      | One-to-one event handoff, deduplication key, reservation time, attempts, error, dispatch time | Unique event; event deletion cascades; worker-only access                  |
| `AlertCooldownReservation` | Deduplication key primary key and next eligible time                                          | One rolling cooldown reservation per alert fingerprint; worker-only access |
| `TelemetryEvent`           | Optional user, event type, required JSON properties, creation time                            | Mapped to `telemetry_events`; user deletion cascades                       |

`AlertRule.rule_type` is limited to `temperature`, `precipitation`, or `severe`. Thresholds are
database-checked as follows: temperature `(0, 100]`, precipitation `[0, 1]`, and severe one of
`1`, `2`, or `3`. A follow-up migration backfills null values and makes the column non-null:

- [Alert/outbox migration](../../packages/db/prisma/migrations/20260713151000_add_alert_delivery_outbox/migration.sql)
- [Threshold enforcement](../../packages/db/prisma/migrations/20260713160000_enforce_alert_rule_thresholds/migration.sql)
- [Rolling cooldown migration](../../packages/db/prisma/migrations/20260713170000_add_rolling_alert_cooldowns/migration.sql)

The outbox stores a recoverable database-to-BullMQ handoff. Its event is deleted with the envelope.
Cooldown state is separate so concurrent workers can reserve a rolling 60-minute window rather than
relying on the original fixed time bucket.

### Operations, audit, and configuration

| Model         | Key fields and relationships                                    | Important constraints                                   |
| ------------- | --------------------------------------------------------------- | ------------------------------------------------------- |
| `JobFailure`  | Queue/job identity, payload JSON, error, failure time, attempts | Queue, failure-time, and compound job/queue indexes     |
| `AuditLog`    | Required user, event type/data, timestamp, optional IP          | Owner and event/time indexes; immutable by SQL triggers |
| `FeatureFlag` | String key primary key, typed JSON value, update time           | Mapped to `feature_flags`; one persisted value per key  |

`AuditLog` is append-only at the database boundary. `UPDATE`, `DELETE`, and `TRUNCATE` triggers
raise SQLSTATE `42501`, and RLS is both enabled and forced. Authenticated callers have only an
admin/moderator-gated read policy. See the
[audit hardening migration](../../packages/db/prisma/migrations/20260420160000_harden_audit_log_immutability/migration.sql).

## Major relational and data-flow groupings

1. **Identity and consent:** `User` anchors application-owned data. `GuardianConsent` links two
   users and drives guardian-aware RLS. `GuardianInvitation` records the pre-consent workflow.
2. **Weather ingestion:** provider observations enter `WeatherSnapshot`, fan out into
   `ForecastSegment`, and update `WeatherIngestionState`. `SavedLocation` is separate user intent,
   keyed by the same canonical location concept.
3. **Daily ritual:** comfort settings, garments, palette analysis, and forecast segments feed
   `OutfitRecommendation`. Garment membership is stored as JSON IDs rather than a relational join
   table, so referential integrity for those IDs is application-owned.
4. **Lookbook and moderation:** recommendations can lead to user posts, engagement, and moderation.
   Palette linkage is optional; moderation can target either a post or garment, but the schema does
   not require at least one target.
5. **Alert delivery:** `AlertRule`, `NotificationPreference`, and `PushToken` hold private user
   settings. A persisted `EventEnvelope` gets a one-to-one `AlertDeliveryOutbox` record before
   worker fanout. `AlertCooldownReservation` coordinates rolling deduplication.
6. **Operational evidence:** `TelemetryEvent`, `JobFailure`, and immutable `AuditLog` serve distinct
   analytics, worker-failure, and compliance needs. `FeatureFlag` is a local typed-value fallback.

## Row-level security and database security

The core policy helpers are SQL `SECURITY DEFINER` functions in a locked-down `private` schema.
They set an explicit search path, revoke public execution, and centralize identity, role, guardian
consent, and self-access checks. The definitive implementation is the
[guardian RLS migration](../../packages/db/prisma/migrations/20260420113000_add_guardian_shared_rls_policies/migration.sql),
as amended by the
[revoked-teen migration](../../packages/db/prisma/migrations/20260421090000_block_revoked_teens_from_self_access/migration.sql).

| Policy group       | Tables                                                                                                 | Authenticated behavior                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| Guardian-shared    | `UserProfile`, `ComfortPreferences`, `GarmentItem`, `PaletteInsights`, `OutfitRecommendation`          | Owner/admin CRUD; active read-only guardian reads; active full-access guardian CRUD              |
| Self/admin only    | `LookbookPost`, `EngagementEvent`, `SavedLocation`, `AlertRule`, `NotificationPreference`, `PushToken` | Owner/admin CRUD; guardian link alone grants nothing                                             |
| Consent visibility | `GuardianConsent`                                                                                      | Read only for guardian, teen, admin, or moderator; no client mutation policy                     |
| Event visibility   | `EventEnvelope`                                                                                        | Read only when global (`user_id` null), owned, or admin-visible; no client mutation policy       |
| Telemetry          | `telemetry_events`                                                                                     | Authenticated users read/insert only non-null owned rows; service role may insert anonymous rows |
| Audit              | `AuditLog`                                                                                             | Forced RLS; admin/moderator read only; mutation triggers block all row changes and truncate      |
| Worker only        | `AlertDeliveryOutbox`, `AlertCooldownReservation`                                                      | RLS enabled, no policies, and client grants revoked                                              |

The alert-delivery policies are defined in the
[delivery security migration](../../packages/db/prisma/migrations/20260713142500_secure_alert_delivery_records/migration.sql);
telemetry policy details are in the
[telemetry migration](../../packages/db/prisma/migrations/20260714100000_add_telemetry_event/migration.sql).

Tables not listed above have no RLS policy installed by the scanned migrations. This includes
`User`, weather snapshots/segments/ingestion state, `GuardianInvitation`, `JobFailure`,
`ModerationEvent`, and `feature_flags`. They therefore require trusted backend/database-role access
and must not be assumed tenant-safe merely because the API usually mediates them.

### Supabase identity mapping

The application `User.id` is text and normally a cuid, while Supabase Auth's JWT `sub` is a UUID.
`private.current_app_user_id()` therefore resolves identity in this order:

1. top-level signed `app_user_id`;
2. signed `app_metadata.app_user_id`;
3. a case-insensitive `User.email` lookup, but only for a signed, verified email claim;
4. JWT `sub` as a final fallback.

Roles similarly come only from signed top-level or `app_metadata` claims. Client-writable
`user_metadata` is deliberately ignored and is covered by an integration test. The verified-email
bridge is explicitly temporary: email reassignment can invalidate ownership assumptions until an
auth hook establishes a durable `app_user_id`. Seeded `User` rows also do not create Supabase
`auth.users`; a test login maps only if its trusted claims or verified email correspond to the
application row.

When a profile's compliance JSON marks both `accountStatus = pending_guardian_consent` and
`guardianConsentRequired = true`, the revised helpers block that user's self-access after the last
active consent is lost. Admin access and a still-active guardian link follow their normal policy
paths.

## Migration, client generation, and seed workflow

Commands are exposed at both repository root and
[the database workspace](../../packages/db/package.json):

| Goal                                 | Repository-root command                  | Behavior                                                                 |
| ------------------------------------ | ---------------------------------------- | ------------------------------------------------------------------------ |
| Generate Prisma client               | `npm run db:generate`                    | Runs `prisma generate`; generated client output must not be edited       |
| Create/apply a development migration | `npm run db:migrate`                     | Runs `prisma migrate dev` in `packages/db`                               |
| Seed current database                | `npm run db:seed`                        | Runs `prisma db seed`, configured to execute `tsx prisma/seeds/index.ts` |
| Reset local database                 | `npm run db:reset`                       | Forced migrate reset without auto-seed, followed by one explicit seed    |
| Open Prisma Studio                   | `npm run db:studio -w packages/db`       | Opens an interactive browser against the configured database             |
| Apply committed migrations           | `node scripts/prisma-migrate-deploy.mjs` | Loads root environment precedence and runs `prisma migrate deploy`       |
| Run DB tests                         | `npm test -w packages/db`                | Runs the package's five sequential/nonparallel Vitest suites             |

The deploy wrapper is
[scripts/prisma-migrate-deploy.mjs](../../scripts/prisma-migrate-deploy.mjs). It is used by API
startup paths, applies committed migrations without creating new ones, and propagates the Prisma
process exit status. Use the repository's Node 24+ requirement even though the database workspace
manifest alone currently states Node 22+.

### Seed behavior

The deterministic seed entry point is
[prisma/seeds/index.ts](../../packages/db/prisma/seeds/index.ts). It fixes Faker's seed, then runs:

1. synthetic users, profiles, comfort settings, and guardian links;
2. wardrobe items and palette insights;
3. weather snapshots and 48 forecast segments per location;
4. outfit recommendations, lookbook posts, engagement, and audit rows;
5. canonical and supplemental feature flags.

Seed modules use stable synthetic IDs and mostly `upsert`, making ordinary records rerunnable.
They reuse shared factories from `@couture/testing`. No real user data or credentials belong in
these fixtures.

There is one material rerun conflict: the ritual seed
[upserts audit rows](../../packages/db/prisma/seeds/rituals.ts) with a non-empty `update` branch,
while the later audit migration blocks every update. The first seed into an empty migrated database
can insert those rows, but a second `npm run db:seed` attempts to update them and fails with
SQLSTATE `42501`. `npm run db:reset` succeeds because it recreates an empty database before seeding.
To make direct reruns safe, audit seeding must become insert-if-absent without issuing an update.

## Database test coverage

The package uses Node-environment Vitest with file parallelism disabled. Coverage is split between
static schema/migration assertions and live PostgreSQL integration tests:

| Suite                                                                                     | Coverage                                                                                                                        |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| [alert-schema.spec.ts](../../packages/db/test/alert-schema.spec.ts)                       | Prisma alert models, SQL type constraints, push preference, and self-only RLS text                                              |
| [alert-outbox-schema.spec.ts](../../packages/db/test/alert-outbox-schema.spec.ts)         | Outbox/event relation, rolling cooldown migration, worker-only RLS, and thresholds                                              |
| [alert-delivery-security.spec.ts](../../packages/db/test/alert-delivery-security.spec.ts) | Static checks for push-token, event-envelope, and cooldown access policies                                                      |
| [rls-policies.spec.ts](../../packages/db/test/rls-policies.spec.ts)                       | Live roles/claims, expected policies, guardian levels, revocation, isolation, admin paths, worker tables, events, and telemetry |
| [audit-log-immutability.spec.ts](../../packages/db/test/audit-log-immutability.spec.ts)   | Live forced-RLS state and blocked update/delete/truncate operations                                                             |

The live suites use `RLS_TEST_DATABASE_URL`, then `DATABASE_URL`, then a local Supabase default.
They require a migrated non-production target and fail with setup guidance when the schema is
absent. They create randomized synthetic rows and clean them up; audit tests use transaction
rollback because committed audit rows cannot be deleted.

Current gaps are visible from the suite boundaries: there is no database test for seed rerun
idempotence, the partial guardian-invitation index, saved-location check failures/one-primary
enforcement, weather uniqueness, outfit uniqueness with a null segment, or access posture for the
tables that have no RLS.

## Implementation caveats

- **Migrations outrank Prisma for database-only behavior.** Partial indexes, check constraints,
  RLS, grants, functions, and triggers can be lost from understanding if only `schema.prisma` is
  reviewed.
- **Audit seed reruns are not idempotent.** The audit upsert update branch conflicts with immutable
  audit triggers after the first successful seed.
- **Supabase identity is bridged, not natively keyed.** Prefer a durable signed `app_user_id`;
  verified-email fallback is transitional and seed rows do not provision Auth users.
- **Several JSON references are not relationally enforced.** Garment IDs in recommendations,
  profile compliance state, feature-flag shapes, payloads, and telemetry properties depend on
  application validation.
- **Some domain values remain free-form strings.** Categories, scenarios, event/action types,
  platforms, quiet-hour strings, and timezones have no database enum or format constraint.
- **Delete behavior is mixed.** New user-owned alert/location/event/telemetry rows often cascade,
  while older profile, wardrobe, consent, social, and audit foreign keys generally restrict or set
  null. Deletion workflows must account for this asymmetry.
- **RLS coverage is selective.** Absence from the policy table above means no migration-enforced
  tenant boundary was found; backend-only intent should be reinforced with explicit grants/RLS.
- **Nullable uniqueness has PostgreSQL semantics.** The outfit compound unique index does not
  deduplicate rows whose forecast segment is null.
