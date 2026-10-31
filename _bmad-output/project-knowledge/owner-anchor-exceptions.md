# Owner Anchor Exceptions

Updated: 2026-10-31 - register owner IDs whose targets are applied Prisma migrations, JSON files or directories

Use this file only when the primary target cannot safely carry a stable in-file owner comment.

- Step 2 step 1 owner: source lives in `package.json` and `turbo.json` (JSON config files; no stable in-file comment anchor).
- Step 2 step 5 owner: source lives in `packages/api-client/package.json`, `packages/db/package.json`, and `packages/testing/package.json` (JSON config files; no stable in-file comment anchor).
- Step 10 step 5 owner: source lives in `.env.local`, `.env.preview`, and `.env.prod` (environment files; do not rely on shared in-file owner comments there).
- Story 0.9 Task 3 step 1 owner: source lives in `package.json` and `package-lock.json` (`package-lock.json` is generated and should not carry a stable owner comment).
- Story 0.9 Task 3 step 2 owner: source lives in `openapitools.json` (JSON config file; no stable in-file comment anchor).
- Story 0.11 Task 4 owner: source lives in `packages/db/prisma/migrations/20260420113000_add_guardian_shared_rls_policies/migration.sql` (applied Prisma migration; editing it changes its checksum).
- Story 1.1 Task 2 step 2 owner: source lives in `packages/db/prisma/migrations/20260707104000_normalize_weather_persistence/migration.sql` (applied Prisma migration; editing it changes its checksum).
- Story 1.3 Task 1 step 2 owner: source lives in `packages/db/prisma/migrations/20260713180000_cascade_delete_user_event_envelopes/migration.sql` (applied Prisma migration; editing it changes its checksum).
- Story 1.4 Task 1 step 2 owner: source lives in `packages/db/prisma/migrations/20260714100000_add_telemetry_event/migration.sql` (applied Prisma migration; editing it changes its checksum).
- Story 5.1 Task 8 step 1 owner: source lives in `pact/http/consumer/` and `pact/http/provider/` (directories; no single file carries the anchor).
- Story 5.3 Task 1 step 2 owner: source lives in `packages/db/prisma/migrations/20260818090000_add_premium_theme/migration.sql` (applied Prisma migration; editing it changes its checksum).
- Story 5.3 Task 5 step 4 owner: source lives in `apps/web/src/i18n/locales/` (JSON locale catalog directories; no stable in-file comment anchor).
- Story 5.4 Task 1 step 2 owner: source lives in `packages/db/prisma/migrations/20260825090000_add_palette_advisor/migration.sql` (applied Prisma migration; editing it changes its checksum).
- Story 5.4 Task 7/8 step 4 owner: source lives in `apps/web/src/i18n/locales/` and `apps/mobile/assets/locales/` (JSON locale catalog directories; no stable in-file comment anchor).
- Story 5.5 Task 3 step 2 owner: source lives in `packages/db/prisma/migrations/20260904091500_add_planner_day_plan/migration.sql` (applied Prisma migration; editing it changes its checksum).
- Story 5.5 Task 7/8 step 4 owner: source lives in `apps/web/src/i18n/locales/` and `apps/mobile/assets/locales/` (JSON locale catalog directories; no stable in-file comment anchor).
- Story 6.1 localization owner: source lives in `apps/web/src/i18n/locales/` and `apps/mobile/assets/locales/` (JSON locale catalog directories; no stable in-file comment anchor).
- Story 6.2b allow-list owner: source lives in `apps/api/policies/community-screening/allow-list-v1.json` (JSON config file; no stable in-file comment anchor).
- Story 6.6 index owner: source lives in `packages/db/prisma/migrations/20261022140000_community_spotlight_window_indexes/migration.sql` (applied Prisma migration; editing it changes its checksum).
- Story 1.2b schema owner: source lives in `packages/db/prisma/migrations/20261023090000_location_search_window/migration.sql` (applied Prisma migration; editing it changes its checksum).
- Story 6.8 Task 3 step 1 owner: source lives in `apps/api/src/modules/share-cards/assets/` and `apps/api/nest-cli.json` (an asset directory and a JSON config file; no stable in-file comment anchor).
