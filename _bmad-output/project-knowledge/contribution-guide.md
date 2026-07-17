# Contribution guide

Updated: 2026-07-17 - document the brownfield contribution and validation workflow

This guide summarizes the repository rules that contributors must apply. The authoritative
sources remain [AGENTS.md](../../AGENTS.md), the
[project context](../project-context.md), workspace manifests, and repository automation.

## Branches and commits

- Branch from the remote default branch, `main`, and open a pull request back to `main`.
- Use a short, scoped branch name. Existing branches commonly use `feat/`, `fix/`, `chore/`,
  and `test/`; this naming pattern is conventional rather than CI-enforced.
- Use Conventional Commits, for example `feat(api): add alert preferences` or
  `docs: refresh roadmap targets`.
- Keep each commit focused. When practical, scope documentation commits to one document.
- Do not commit generated clutter, local environment overrides, secrets, production data,
  personal wardrobe data, or identifiable fixtures.

### Current `main`/`master` inconsistency

The remote default branch and the normal integration target are `main`. Most push workflows
also target `main`, and schema comparison explicitly fetches `main`. However,
[PR Gate](../../.github/workflows/pr-gate.yml) listens for pushes to `master`. Pull-request
events still run the gate, but its post-merge push trigger does not match the current default
branch. Treat `main` as canonical and fix this workflow mismatch rather than creating or
targeting a `master` branch.

## Workspace boundaries

The repository is an npm/Turborepo monorepo requiring Node.js 24 or newer. Use the root
[package scripts](../../package.json) and respect the task order in
[turbo.json](../../turbo.json): lint precedes tests, and tests precede builds.

- `apps/api` owns NestJS transport and application behavior. Keep features under
  `src/modules/<feature>` with controllers, services, and repositories separated.
- `apps/web` owns the Next.js application; preserve App Router server/client boundaries.
- `apps/mobile` owns Expo Router screens and mobile integration. Use app-local client
  factories for base URL and authentication resolution.
- `packages/api-client` owns shared public API contracts, generated clients, and stable API
  wrappers consumed by apps.
- `packages/db` owns the Prisma schema, migrations, seeds, and database-focused tests.
- `packages/testing` owns deterministic factories and cleanup helpers shared by tests.
- Other `packages/*` workspaces own reusable configuration and utilities. Import through
  package exports or stable wrappers; never reach into another workspace's private source.
- `_bmad-output` is the BMAD collaboration and project-knowledge surface. Do not modify
  installer-managed BMAD scaffolding except during an intentional framework update.

Prefer repository and workspace scripts because their `pre*` hooks build shared dependencies.
During development run the narrow workspace check, then `npm run verify:changed`. Run
`npm run validate` for the full typecheck, lint, test, and build sequence.

## Contract-first API changes

Every public REST operation starts in
[`packages/api-client/src/contracts/http`](../../packages/api-client/src/contracts/http).
Canonical Zod schemas are the source of truth; controller-local DTOs, handwritten app contract
types, checked-in OpenAPI JSON, and generated SDK files are not.

1. Change the shared Zod contract and its contract tests.
2. Update the NestJS controller/service/repository behavior and validate input and output at
   the boundary.
3. Generate OpenAPI and SDK artifacts with `npm run generate:api-client`.
4. Review generated diffs; never hand-edit `packages/api-client/src/generated/**`.
5. Run `npm run optic:lint`, the applicable tests, and `npm run test:pact`.
6. Confirm web and mobile use `@couture/api-client` wrappers rather than new local clients.

Public endpoints stay under `/api/v1` and use the shared `{ data }` response envelope. A
breaking change requires `/api/v2`; keep and document `/api/v1` deprecations for at least
90 days.

## Database changes

Make schema, migration, seed, and policy changes only in
[`packages/db`](../../packages/db). Edit `prisma/schema.prisma`, create a migration with
`npm run db:migrate`, and commit the migration SQL. Run `npm run db:generate` after changes;
never edit generated Prisma Client output.

Database work must preserve snake_case identifiers, UTC timestamps, RLS, authorization and
guardian-consent controls, audit-log immutability, and idempotent jobs/webhooks. Add focused
tests for schema constraints, migrations, repositories, RLS policies, and security behavior.
Use `npm run db:reset` only against an explicitly local test database; preview and tests must
never target production resources.

## Test expectations by boundary

Add or update tests in the same change as behavior. Use synthetic, deterministic,
namespaced/idempotent fixtures from `@couture/testing`, register created entities for cleanup,
and never leave `.only` in committed tests.

| Changed boundary                  | Expected validation                                                      |
| --------------------------------- | ------------------------------------------------------------------------ |
| Shared package or pure logic      | Colocated `*.spec.ts` unit tests and the workspace test                  |
| API controller/service/repository | Contract parsing, business logic, persistence, and failure-path tests    |
| Database/schema/RLS               | `@couture/db` tests plus migration, constraint, RLS, and security checks |
| Web or mobile component           | Colocated `*.test.tsx`; mock HTTP with MSW at the external boundary      |
| Public HTTP contract              | Regenerated OpenAPI/SDK, Optic lint/diff, Pact consumer/provider tests   |
| Cross-app browser flow            | Playwright under `playwright/`, locally or against an approved preview   |
| Mobile user flow                  | Relevant Maestro flow; CI execution is manual and advisory               |
| API performance-sensitive path    | Relevant k6 smoke/load scenario; PR smoke is path-filtered               |

Mock external boundaries, not internal implementation. Tests must not call weather providers
or production services. Run the narrow test while developing, `npm run verify:changed` before
review, and boundary-specific integration or E2E commands when the table requires them.

## Formatting and style

- Run `npm run lint` to apply workspace ESLint rules and the repository-wide Prettier check.
  Use `npm run lint:fix` or `npm run format` for intentional automated fixes.
- Follow [`.prettierrc`](../../.prettierrc): 90-column code width, two spaces, single quotes,
  no semicolons, and ES5 trailing commas. Documentation should remain near 100 characters.
- Use strict TypeScript without broad casts that bypass safety. Use `import type` and
  `export type`, narrow caught `unknown` values, and handle every promise.
- Use lowercase kebab-case filenames, PascalCase for components/classes, camelCase for
  functions/variables, and snake_case for database identifiers.
- Include `.js` on relative imports in the NestJS NodeNext workspace. Follow the resolver
  conventions of each other app.
- Keep functions focused; extract complex domain decisions rather than suppressing lint rules.

For Markdown, use ATX sentence-case headings, tight paragraphs, and tables only for summaries.
Preserve established emoji and table schemas. Preview rendered Markdown when changing tables,
callouts, or emoji-heavy content.

## Documentation ownership

- `_bmad-output/project-knowledge` owns enduring project knowledge; implementation, planning,
  and QA artifacts belong in their corresponding `_bmad-output` directories.
- When vision, personas, or success metrics change, update the product brief first and the
  roadmap immediately afterward. Keep `Updated: YYYY-MM-DD - reason` below each title.
- Keep root helpers lightweight and link to project knowledge instead of duplicating it.
- Preserve searchable owner-anchor comments. If JSON, generated, or environment content cannot
  safely carry one, record the exception in
  [`owner-anchor-exceptions.md`](owner-anchor-exceptions.md).
- Verify external references and relative links. Put reviewer feedback in PR comments or linked
  issues rather than leaving inline TODOs.

## Security and privacy

- Never commit or log JWTs, service keys, contact details, wardrobe media, sensitive payloads,
  production records, or identifiable test fixtures. Use neutral placeholders.
- Never bypass JWT validation, NestJS guards, PostgreSQL RLS, or guardian consent. Under-16
  upload and community features must remain consent-gated.
- Preserve immutable audit events for authentication, consent, moderation, and data export.
- Keep local, preview, and production Supabase, Redis, storage, analytics, notifications, and
  other integrations separated. Fail closed when resource identity is ambiguous.
- Validate all external input and output at runtime. Keep queues, webhooks, analytics, and test
  setup idempotent so retries cannot duplicate user-visible or audit effects.
- Run the repository secret scan and investigate findings; do not weaken detection to make a
  check pass.

## Pull request checklist

Use the [pull request template](../../.github/PULL_REQUEST_TEMPLATE.md) and complete this list:

- [ ] Explain what changed, why it is needed, and how it was implemented.
- [ ] Link the relevant issue, story, or BMAD artifact.
- [ ] Identify risk, migration/rollout impact, and any explicitly deferred follow-up.
- [ ] List exact automated and manual checks run, including boundary-specific tests.
- [ ] Use factories for fixtures; avoid hardcoded assertion data; register cleanup; keep tests
      deterministic.
- [ ] Regenerate and review API or Prisma artifacts when their source changed.
- [ ] Update owned documentation and verify relative links and rendered Markdown.
- [ ] Confirm no secrets, personal data, production resources, or sensitive logs are present.
- [ ] Attach rendered screenshots/snippets for visual, table, or emoji-heavy documentation
      changes and mention consulted product, design, or engineering stakeholders when relevant.
- [ ] Ensure all applicable CI jobs pass and explain any intentionally skipped advisory check.

## CI checks

The branch ruleset declares one required status: `PR Gate / gate`. The gate waits for all other
jobs on the pull request, so failures in applicable PR workflows can block the required gate
even when those individual statuses are not separately marked required.

Blocking through PR Gate:

- **PR checks:** runtime dependency check, Prisma generation, typecheck, lint, build, unit tests,
  coverage reporting, and a 50% diff-coverage threshold.
- **Contract testing:** OpenAPI generation/lint plus deterministic Pact consumer and provider
  tests.
- **Run schema validation:** Optic lint and compatibility diff against `main`.
- **Gitleaks:** full-history secrets scan.
- **Playwright e2e:** blocking when applicable; burn-in selects changed tests before local,
  sharded Playwright runs.
- **k6 smoke:** blocking when path filters match API, contract, database, k6, or package-manifest
  changes.

Conditional or advisory:

- **Vercel Preview e2e:** runs on synchronization or a `PREVIEW` label and validates matching
  web/API preview SHAs.
- **CodeRabbit:** advisory-first and explicitly excluded from PR Gate waiting.
- **Mobile Maestro:** advisory manual workflow whose job permits failure.
- **k6 load, production Playwright, and mobile deploy:** manual or post-merge operational
  workflows, not PR merge checks.

Do not treat a skipped path-filtered or conditional workflow as evidence that its boundary was
tested. Run and report the relevant local command when the change warrants it.
