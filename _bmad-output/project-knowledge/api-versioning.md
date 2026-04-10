# API versioning

Updated: 2026-04-10 - Story 0.9 Task 9 closeout for REST contract versioning and governance.

Status: active

## Scope

This policy applies to public REST endpoints defined in
`packages/api-client/src/contracts/http/*`, the checked-in canonical contract file
`packages/api-client/docs/http.openapi.json`, the live API contract surfaces
`/api/v1/openapi.json` and `/api/docs`, and the generated SDK under
`packages/api-client/src/generated`.

Socket event schemas follow their own versioned event payload rules in
`packages/api-client/src/types/socket-events.ts`; this document is about public HTTP contracts.

## Source of truth and ownership

- Shared Zod contract modules in `packages/api-client/src/contracts/http/*` are the only source of
  truth for public REST contracts.
- New public REST endpoints must start in those contract modules before controller code, generated
  SDK code, or documentation changes land.
- `packages/api-client/src/contracts/http/openapi.ts` owns canonical OpenAPI assembly and the
  contract `info.version` value.
- Nest controllers, ad hoc DTOs, Swagger decorators, checked-in JSON artifacts, live API docs, and
  generated SDK files are downstream outputs. Do not edit them to change the public contract.
- API feature owners own the contract module for their slice. Web/mobile owners own app-local
  client wrappers and must be consulted before breaking consumer-visible changes merge.

## Versioning model

| Layer                  | Rule                                                                                                                                           |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| URL namespace          | `/api/v1` is stable. Breaking changes ship on `/api/v2`; they do not land silently in `/api/v1`.                                               |
| OpenAPI `info.version` | Semantic version in `packages/api-client/src/contracts/http/openapi.ts` records contract history.                                              |
| CI enforcement         | Optic diffs the canonical spec against `main` and blocks breaking changes unless a major version bump records an explicit versioning decision. |

### Semantic versioning rules

- Patch: descriptions, examples, tags, or other metadata-only changes with no wire-level behavior
  change.
- Minor: additive backward-compatible changes such as a new endpoint, a new optional request
  field, or a new optional response field.
- Major: removals, renames, stricter validation, auth requirement changes, enum narrowing, status
  code removals, required field additions, or any other incompatible contract change.

If there is doubt, classify the change as breaking. That costs less than surprising every consumer.

## Breaking vs non-breaking changes

| Change                                                                   | Classification |
| ------------------------------------------------------------------------ | -------------- |
| Add a new endpoint under the current version namespace                   | Non-breaking   |
| Add an optional request field                                            | Non-breaking   |
| Add an optional response field                                           | Non-breaking   |
| Change examples, descriptions, tags, or summaries                        | Non-breaking   |
| Remove or rename an endpoint, field, path param, query param, or header  | Breaking       |
| Add a required request field                                             | Breaking       |
| Remove a response field or supported response status code                | Breaking       |
| Narrow an enum or tighten validation so a previously valid payload fails | Breaking       |
| Require authentication or authorization where it was previously absent   | Breaking       |

Treat new response enum values as breaking unless the consumer contract already models them as
open-ended. Closed client branches fail in production, not just in type systems.

## Deprecation policy

- `/api/v1` remains the stable public surface until a replacement exists in `/api/v2`.
- Deprecated `/api/v1` operations must remain available for at least 90 days after the deprecation
  notice is published.
- The deprecation notice must include the replacement endpoint or field, the migration action, and
  a sunset date that is at least 90 days in the future.
- After the notice window ends, removal of the deprecated `/api/v1` surface must ship with a major
  OpenAPI version bump and pass Optic diff checks in CI.

## How deprecation metadata is expressed

Deprecation metadata is authored in the canonical contract modules, not in generated files.

For endpoint-level deprecation, mark the path as deprecated in `registry.registerPath(...)` and put
the migration details in the description:

```ts
registry.registerPath({
  method: 'get',
  path: '/api/v1/user/profile',
  tags: ['user'],
  summary: 'Get the authenticated user profile',
  deprecated: true,
  description: 'Deprecated: use /api/v2/user/profile. Sunset not before 2026-07-09.',
  responses: {
    // ...
  },
})
```

For schema or property deprecation, attach metadata where the Zod schema is declared:

```ts
const legacyDisplayNameSchema = z.string().openapi({
  deprecated: true,
  description: 'Deprecated: use preferredDisplayName. Sunset not before 2026-07-09.',
})
```

This metadata surfaces in the generated OpenAPI document as `deprecated: true` plus the associated
description text. That makes the warning visible in the checked-in spec, live docs, and any
downstream SDK/documentation generated from that spec.

## Expected rollout for a breaking change

1. Add the replacement contract under `/api/v2` in the shared Zod contract module.
2. Mark the old `/api/v1` contract as deprecated with replacement and sunset details.
3. Keep both versions live for at least 90 days.
4. Bump the major OpenAPI `info.version` before merge when the old contract is removed or otherwise
   broken.
5. Regenerate the canonical spec and SDK, run Optic diff, and communicate the migration in the PR
   description and release notes.

## Regeneration and validation workflow

The contract workflow for REST changes is:

```bash
npm run generate:http-openapi
npm test --workspace @couture/api-client
npm run optic:lint
npm run optic:diff
npm run generate:api-client
```

`generate:api-client` regenerates the canonical HTTP spec again before rebuilding the SDK. That
duplication is intentional: the script stays idempotent even when someone skips the earlier step.

See `packages/api-client/README.md` for consumer-facing SDK usage and the same regeneration flow.
