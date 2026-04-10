# @couture/api-client

Updated: 2026-04-10 - Story 0.9 Task 9 closeout for SDK usage and regeneration workflow.

Status: active

Shared REST contracts, generated SDK surface, and realtime/event contract helpers for Couture Cast.

## What lives here

| Path                              | Purpose                                                                 | Editing rule           |
| --------------------------------- | ----------------------------------------------------------------------- | ---------------------- |
| `src/contracts/http/*`            | Canonical shared Zod contracts for public REST endpoints                | Human-authored         |
| `src/client.ts`                   | Stable client factory wrapper over the generated SDK                    | Human-authored         |
| `src/index.ts`                    | Package export surface                                                  | Human-authored         |
| `src/generated/*`                 | Generated TypeScript Fetch SDK from the canonical HTTP OpenAPI contract | Generated, do not edit |
| `docs/http.openapi.json`          | Checked-in canonical HTTP OpenAPI contract                              | Generated, do not edit |
| `docs/socket-events.openapi.json` | Generated event contract artifact                                       | Generated, do not edit |
| `testing/*`                       | Contract validation and regression checks                               | Human-authored         |

If you need to change the public REST contract, start in `src/contracts/http/*`. Do not patch the
generated SDK or the checked-in OpenAPI JSON directly.

## Create a client

Use the stable `createApiClient` wrapper from the package root:

```ts
import { createApiClient } from '@couture/api-client'

const client = createApiClient('https://api.couturecast.app')

const health = await client.apiHealthGet()
```

The wrapper keeps app code off generator internals and accepts either a raw access token or a full
options object.

## Auth patterns

### Web: cookie-backed same-origin requests

For web, prefer an app-local wrapper that forces `credentials: 'include'`:

```ts
import { createApiClient } from '@couture/api-client'

export function createWebApiClient() {
  return createApiClient(process.env.NEXT_PUBLIC_API_BASE_URL ?? '', {
    credentials: 'include',
  })
}
```

That matches the current pattern in `apps/web/src/lib/api-client.ts`.

### Mobile: bearer token injection

For mobile, pass an access token directly or via the options object:

```ts
import { createApiClient } from '@couture/api-client'

const client = createApiClient(process.env.EXPO_PUBLIC_API_BASE_URL!, {
  accessToken: async () => getSupabaseAccessToken(),
})

await client.apiV1UserProfileGet()
```

That matches the current pattern in `apps/mobile/src/lib/api-client.ts`.

## Error handling

The generated SDK returns typed success payloads for happy-path calls, but non-2xx responses throw
`ResponseError`.

```ts
import { ResponseError, createApiClient } from '@couture/api-client'

const client = createApiClient(process.env.API_BASE_URL!)

try {
  await client.apiV1AuthGuardianConsentPost({
    guardianConsentInput: {
      guardianId: 'guardian_123',
      teenId: 'teen_456',
      consentLevel: 'full',
    },
  })
} catch (error) {
  if (error instanceof ResponseError) {
    const status = error.response.status
    const body = await error.response.clone().json()

    if (status === 401) {
      // { statusCode: 401, message: string, error: 'Unauthorized' }
    }

    console.error({ status, body })
  }
}
```

Shared error envelope shapes are defined in `src/contracts/http/common.ts`. Current canonical HTTP
errors include:

- `BadRequestHttpError`
- `UnauthorizedHttpError`
- `ForbiddenHttpError`
- `NotFoundHttpError`

For endpoints with multiple meaningful response statuses, prefer the `*Raw` methods so you can
branch on `response.raw.status` yourself:

```ts
const response = await client.apiV1EventsPollGetRaw({ since })

if (response.raw.status === 200) {
  return (await response.raw.json()) as EventsPollResponse
}

return (await response.raw.json()) as EventsPollInvalidSinceResponse
```

## Contract ownership

- Public REST contracts are owned in `src/contracts/http/*`.
- `src/generated/*` and `docs/http.openapi.json` are outputs, not authoring surfaces.
- New public REST endpoints must start in the shared Zod contracts before controller or consumer
  implementation merges.
- Breaking changes belong on `/api/v2` and must follow the policy in
  `_bmad-output/project-knowledge/api-versioning.md`.

## Regeneration workflow

Run the exact workflow below when you change REST contracts:

```bash
npm run generate:http-openapi
npm test --workspace @couture/api-client
npm run optic:lint
npm run optic:diff
npm run generate:api-client
```

Notes:

- `generate:http-openapi` rewrites `docs/http.openapi.json` from the shared Zod contract modules.
- `npm test --workspace @couture/api-client` includes the package-level OpenAPI sync/validity
  checks.
- `optic:lint` validates the checked-in spec.
- `optic:diff` compares the checked-in spec to `main` and blocks breaking changes unless the
  OpenAPI major version records an explicit versioning decision.
- `generate:api-client` regenerates the HTTP spec again before rebuilding `src/generated/*`. That
  duplication is intentional.

Commit the contract module changes, the updated `docs/http.openapi.json`, and any regenerated
`src/generated/*` files in the same change.
