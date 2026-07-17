# API contracts: API

Updated: 2026-07-17 - Consolidated legacy API event generation and consumption guidance.

<!-- markdownlint-disable MD013 -->

## Purpose and authority

This document inventories the API that is implemented now. It is a navigation aid for
brownfield work, not a new specification. NestJS controllers determine which HTTP routes
exist. The shared Zod modules under
[`packages/api-client/src/contracts/http`](../../packages/api-client/src/contracts/http)
are canonical only for routes that they register and that controllers actually use.

For canonical public HTTP routes, authority flows in this order:

1. Zod request and response schemas in the shared HTTP contract module.
2. OpenAPI 3.1 assembled by
   [`openapi.ts`](../../packages/api-client/src/contracts/http/openapi.ts).
3. The checked-in
   [`http.openapi.json`](../../packages/api-client/docs/http.openapi.json).
4. Generated TypeScript fetch code under
   [`src/generated`](../../packages/api-client/src/generated).
5. NestJS controllers, which parse inputs and/or responses with the shared schemas.

The controller remains decisive when implementation and generated documentation disagree.
Admin, the root greeting, the empty weather route, and OpenAPI publication routes have no
canonical shared endpoint contract. Health routes use shared schemas and are registered,
but are intentionally outside the usual `{ data }` envelope.

## Authentication conventions

Protected HTTP routes use `RequestAuthGuard`, which requires
`Authorization: Bearer <access-token>`. It resolves identity through Supabase Auth, obtains
the allowed application role (`guardian`, `teen`, `moderator`, or `admin`) from trusted app
metadata, and attaches `{ token, userId, role }` to the request. See
[`security.guards.ts`](../../apps/api/src/modules/auth/security.guards.ts) and
[`access-token-identity.service.ts`](../../apps/api/src/modules/auth/access-token-identity.service.ts).

For a teen, the same guard also checks guardian-consent state and returns 403 when access is
not allowed. `RolesGuard` then enforces route-specific roles. Guardian consent and revoke
routes additionally bind the authenticated guardian ID to the request body; moderation does
the equivalent for `moderatorId`. Admin may act across IDs on those guarded routes.

Test-token bypass formats exist only when `TEST_ENV` is local/preview or `VERCEL_ENV` is
preview. Some test variants trust `x-user-id` and `x-user-role`; production resolution does
not. These headers are not a production authentication mechanism.

Socket.io accepts the token as `handshake.auth.token` or an HTTP Bearer header. It resolves
only the user ID, stores it in `socket.data`, and rejects missing or invalid tokens. Unlike
the HTTP guard, this path does not perform the guardian-consent check or role authorization.

Auth labels below are:

- `Public`: no HTTP guard.
- `Bearer`: any resolved role, with teen consent enforcement.
- `Bearer + roles`: `RolesGuard` and any route-level identity-binding check.
- `Token body`: no session guard; possession of the signed invitation token is the check.

## Implemented HTTP endpoints

Contract names link to canonical modules. `None` means the route is implemented but omitted
from the canonical HTTP registry.

### Auth and user

| Method | Path                            | Auth                    | Request                | Response                      | Canonical contract                                                |
| ------ | ------------------------------- | ----------------------- | ---------------------- | ----------------------------- | ----------------------------------------------------------------- |
| POST   | `/api/v1/auth/signup`           | Public                  | JSON: email, birthdate | 201 signup object             | [`auth.ts`](../../packages/api-client/src/contracts/http/auth.ts) |
| POST   | `/api/v1/auth/guardian-consent` | Bearer + guardian/admin | JSON consent fields    | 200 `{ tracked: true }`       | [`auth.ts`](../../packages/api-client/src/contracts/http/auth.ts) |
| GET    | `/api/v1/user/profile`          | Bearer                  | None                   | 200 profile and consent links | [`user.ts`](../../packages/api-client/src/contracts/http/user.ts) |

The profile response is a bare `{ user, linkedGuardians, linkedTeens }` object, not
`{ data: ... }`.

### Guardian and moderation

| Method | Path                           | Auth                     | Request                    | Response                 | Canonical contract                                                            |
| ------ | ------------------------------ | ------------------------ | -------------------------- | ------------------------ | ----------------------------------------------------------------------------- |
| POST   | `/api/v1/guardian/invitations` | Public                   | JSON: teenId, email, level | 201 invitation and link  | [`guardian.ts`](../../packages/api-client/src/contracts/http/guardian.ts)     |
| POST   | `/api/v1/guardian/accept`      | Token body               | JSON: invitation token     | 200 linked guardian/teen | [`guardian.ts`](../../packages/api-client/src/contracts/http/guardian.ts)     |
| POST   | `/api/v1/guardian/revoke`      | Bearer + guardian/admin  | JSON: guardianId, teenId   | 200 revoke result        | [`guardian.ts`](../../packages/api-client/src/contracts/http/guardian.ts)     |
| POST   | `/api/v1/moderation/actions`   | Bearer + moderator/admin | JSON action fields         | 200 `{ tracked: true }`  | [`moderation.ts`](../../packages/api-client/src/contracts/http/moderation.ts) |

The invitation creation route is currently unauthenticated even though it accepts an
arbitrary `teenId`. Its response includes the signed invitation URL. Acceptance is
deliberately unauthenticated and uses the one-time signed token supplied in the body.

### Locations

| Method | Path                                     | Auth   | Request                | Response                          | Canonical contract                                                          |
| ------ | ---------------------------------------- | ------ | ---------------------- | --------------------------------- | --------------------------------------------------------------------------- |
| GET    | `/api/v1/locations`                      | Bearer | None                   | 200 `{ data: SavedLocation[] }`   | [`locations.ts`](../../packages/api-client/src/contracts/http/locations.ts) |
| POST   | `/api/v1/locations`                      | Bearer | JSON saved location    | 201 `{ data: SavedLocation }`     | [`locations.ts`](../../packages/api-client/src/contracts/http/locations.ts) |
| PATCH  | `/api/v1/locations/{locationId}`         | Bearer | Path ID and JSON patch | 200 `{ data: SavedLocation }`     | [`locations.ts`](../../packages/api-client/src/contracts/http/locations.ts) |
| POST   | `/api/v1/locations/{locationId}/primary` | Bearer | Path ID                | 200 `{ data: SavedLocation }`     | [`locations.ts`](../../packages/api-client/src/contracts/http/locations.ts) |
| DELETE | `/api/v1/locations/{locationId}`         | Bearer | Path ID                | 200 `{ data: { deleted: true } }` | [`locations.ts`](../../packages/api-client/src/contracts/http/locations.ts) |

Create is strict. Update must contain at least one field; changing location identity requires
`locationKey`, latitude, longitude, and timezone together.

### Weather and ritual

| Method | Path                            | Auth   | Request                     | Response                         | Canonical contract                                                      |
| ------ | ------------------------------- | ------ | --------------------------- | -------------------------------- | ----------------------------------------------------------------------- |
| GET    | `/api/v1/weather`               | Bearer | Missing location key        | Always 400 Nest error            | None                                                                    |
| GET    | `/api/v1/weather/{locationKey}` | Bearer | Path location key           | 200 `{ data: freshness result }` | [`weather.ts`](../../packages/api-client/src/contracts/http/weather.ts) |
| GET    | `/api/v1/ritual`                | Bearer | Optional `locationId` query | 200 weather plus 3 outfits       | [`ritual.ts`](../../packages/api-client/src/contracts/http/ritual.ts)   |

Weather returns one of `fresh`, `cached`, `stale`, or `unavailable`. A snapshot requires
exactly 48 hourly entries. Cached, stale, and unavailable variants use fixed user messages.
The missing-key route exists only to turn `/api/v1/weather` into a specific 400 response.

### Alerts and event polling

| Method | Path                         | Auth   | Request                    | Response                        | Canonical contract                                                    |
| ------ | ---------------------------- | ------ | -------------------------- | ------------------------------- | --------------------------------------------------------------------- |
| GET    | `/api/v1/alerts/preferences` | Bearer | None                       | 200 preferences and rules       | [`alerts.ts`](../../packages/api-client/src/contracts/http/alerts.ts) |
| PUT    | `/api/v1/alerts/rules`       | Bearer | JSON: 1-3 unique rules     | 200 `{ data: { rules } }`       | [`alerts.ts`](../../packages/api-client/src/contracts/http/alerts.ts) |
| PUT    | `/api/v1/alerts/preferences` | Bearer | JSON notification settings | 200 `{ data: { preferences } }` | [`alerts.ts`](../../packages/api-client/src/contracts/http/alerts.ts) |
| GET    | `/api/v1/events/poll`        | Bearer | Optional ISO `since` query | 200 events and nextSince        | [`events.ts`](../../packages/api-client/src/contracts/http/events.ts) |

Alert rule thresholds depend on type. Preferences require an IANA timezone and `HH:MM`
quiet-hours values. Equal start/end values are rejected when quiet hours are enabled.

### Health, operator, and publication surfaces

| Method | Path                              | Auth                | Request                | Response                       | Canonical contract                                                    |
| ------ | --------------------------------- | ------------------- | ---------------------- | ------------------------------ | --------------------------------------------------------------------- |
| GET    | `/`                               | Public              | None                   | 200 plain `Hello World!`       | None                                                                  |
| GET    | `/api/health`                     | Public              | None                   | 200 deployment metadata        | [`health.ts`](../../packages/api-client/src/contracts/http/health.ts) |
| GET    | `/api/v1/health/queues`           | Public              | None                   | 200 queue names, empty metrics | [`health.ts`](../../packages/api-client/src/contracts/http/health.ts) |
| GET    | `/api/v1/admin/failed-jobs`       | Public              | Optional `queue` query | Up to 100 raw failure rows     | None                                                                  |
| GET    | `/api/v1/admin/failed-jobs/retry` | Public              | Required `id` query    | Replay result                  | None                                                                  |
| GET    | `/api/v1/openapi.json`            | Public when enabled | None                   | Canonical OpenAPI JSON         | Generated registry                                                    |
| GET    | `/api/docs`                       | Public when enabled | Swagger UI assets      | Interactive API docs           | Generated registry                                                    |

OpenAPI publication defaults on outside production and off in production. `OPENAPI_ENABLED`
can override that behavior. See
[`apps/api/src/openapi.ts`](../../apps/api/src/openapi.ts) and
[`main.ts`](../../apps/api/src/main.ts).

Queue health is a placeholder: it reports configured names and `{ metrics: {} }`, not live
queue depth or failure counts. The two admin routes are neither guarded nor represented in
OpenAPI. Retry mutates state through GET, requeues stored job data, and deletes the failure
record after a successful enqueue.

## OpenAPI and SDK generation

The implemented generation flow is:

1. Domain `register*Contracts` functions register Zod components and paths.
2. [`contracts/http/openapi.ts`](../../packages/api-client/src/contracts/http/openapi.ts)
   composes those functions and generates OpenAPI 3.1.
3. `npm run generate:http-openapi` executes
   [`generate-http-openapi.ts`](../../packages/api-client/scripts/generate-http-openapi.ts)
   and writes
   [`docs/http.openapi.json`](../../packages/api-client/docs/http.openapi.json).
4. `npm run generate:api-client` regenerates that JSON, invokes OpenAPI Generator's
   `typescript-fetch` target, and runs
   [`postprocess-generated-sdk.ts`](../../packages/api-client/scripts/postprocess-generated-sdk.ts).
5. Generator settings in [`openapitools.json`](../../openapitools.json) write to
   `packages/api-client/src/generated` with runtime checks disabled.
6. [`client.ts`](../../packages/api-client/src/client.ts) exposes `createApiClient`; the
   package root also exports generated APIs and models.

The running API publishes the same generated document through Swagger UI rather than deriving
it from Nest decorators. Generation does not inspect controllers, so unregistered routes are
absent and registered security metadata can still drift from guards.

Validation currently includes Swagger Parser validation and exact comparison between the
builder output and checked-in JSON in
[`http-openapi.spec.ts`](../../packages/api-client/testing/http-openapi.spec.ts). Optic lint
and diff scripts operate on the checked-in JSON. Pact generation first regenerates OpenAPI
and runs Optic lint.

## Realtime and polling contracts

[`gateway.gateway.ts`](../../apps/api/src/modules/gateway/gateway.gateway.ts) exposes
authenticated Socket.io namespaces matching `/lookbook` and `/ritual`, plus the fixed
`/alert:weather` namespace. On weather-alert connection, the socket joins the private
`alert:user:{userId}` room.

Shared event envelopes in
[`socket-events.ts`](../../packages/api-client/src/types/socket-events.ts) are
`{ version, timestamp, userId, data }` and define:

| Namespace        | Event           | Implemented server emission        | Payload data                              |
| ---------------- | --------------- | ---------------------------------- | ----------------------------------------- |
| `/lookbook`      | `lookbook:new`  | No emission in current gateway     | postId and optional display fields        |
| `/ritual`        | `ritual:update` | No emission in current gateway     | ritualId, status, optional timing/message |
| `/alert:weather` | `alert:weather` | Yes, schema-validated to user room | type, location, message, severity         |

There are no inbound `@SubscribeMessage` handlers. Generic lookbook and ritual gateways
currently manage authenticated connection lifecycle only.

Disconnect handling emits one of two control events:

- `connection:retry`: `{ delayMs, attempt }`.
- `connection:fallback`: `{ activatePolling, attempt }`.

Those control payloads are implemented in the gateway but are not part of
`socketEventSchemas`. The API-client
[`PollingService`](../../packages/api-client/src/realtime/polling-service.ts) defaults to a
30-second interval, advances its cursor only when `nextSince` is truthy, and delegates
fetching and event handling to the caller.

`GET /api/v1/events/poll` returns user-owned and global event-envelope records created after
the optional cursor. Success is `{ events, nextSince }`, without `{ data }`. Each event has
`id`, `channel`, unknown `payload`, nullable `userId`, and `createdAt`. Invalid `since` is
also HTTP 200 with `{ events: [], nextSince: null, error }`. Repository failures are hidden
as HTTP 200 with an empty success result, so clients cannot distinguish no events from
degraded storage.

### Event generation and consumption

The shared socket schemas are exported through `@couture/api-client`. Consumers should import
the schema and inferred type from that package and validate payloads at ingress and egress:

```ts
import { alertWeatherEventSchema, type AlertWeatherEvent } from '@couture/api-client'
```

Regenerate the Socket.io and Expo event OpenAPI artifact after changing a shared event schema:

```bash
npm run gen:openapi:events --workspace packages/api-client
```

The command writes
[`socket-events.openapi.json`](../../packages/api-client/docs/socket-events.openapi.json).

## Error and envelope caveats

- Canonical Nest HTTP errors use `{ statusCode, message, error }` for 400, 401, 403, 404,
  and 500. The shared schemas are in
  [`common.ts`](../../packages/api-client/src/contracts/http/common.ts).
- The global
  [`ApiExceptionFilter`](../../apps/api/src/filters/api-exception.filter.ts) delegates body
  rendering to Nest and adds telemetry; it does not normalize successful bodies or custom
  service errors.
- Success envelopes are inconsistent. Alerts, locations, weather, and ritual use `{ data }`.
  Auth, user, guardian, moderation, events, and health return bare objects.
- Events' invalid-query payload uses a string `error` field and HTTP 200, unlike standard
  Nest errors. Storage failure is also a successful empty poll.
- Admin returns raw Prisma rows. A missing retry ID is a Nest 400, but an unknown ID throws
  a generic error and normally becomes 500.
- Controllers runtime-validate responses for most canonical routes. User, guardian, auth,
  and moderation validation occurs in their services. Admin and root do not use shared
  response validation.
- OpenAPI declares Bearer security for alerts, events, locations, weather, and ritual.
  It omits the security declaration on guarded guardian-consent, guardian-revoke,
  moderation-action, and user-profile operations.

## Current risks

1. **Unauthenticated admin operations.** Both `/api/v1/admin` routes are public. They expose
   failed-job records and permit replay/deletion. The retry operation is a state-changing GET
   and has no role, CSRF, or canonical request/response contract.
2. **Unauthenticated guardian invitation creation.** Any caller can submit a `teenId` and
   guardian email and receive an invitation URL. Eligibility checks exist, but caller
   identity and relationship to the teen are not established.
3. **Noncanonical routes.** Root, admin, the empty weather route, and publication routes are
   outside domain registration. Generated clients and OpenAPI-based tests cannot discover
   or detect drift in them.
4. **OpenAPI auth drift.** Four guarded domain operations lack `security` metadata, making
   generated documentation and clients understate authentication requirements.
5. **Envelope fragmentation.** Multiple successful response styles increase client branching
   and make a global response invariant impossible.
6. **Realtime authorization gap.** Socket authentication verifies identity but does not apply
   HTTP's teen consent or role checks. Lookbook and ritual contracts are shared, but current
   gateway code does not emit those domain events.
7. **Polling ambiguity and cursor ties.** Empty results can mean no events or repository
   failure. The cursor is only a timestamp, so records sharing the boundary timestamp depend
   on repository ordering/filter semantics and may duplicate or be skipped.
8. **Sensitive raw operator output.** Failed-job records and stored job payloads are returned
   directly by the admin list route. Their shape and redaction are not constrained by a
   public schema.
9. **Generated SDK runtime validation is disabled.** The SDK trusts generated TypeScript
   shapes; callers need explicit Zod parsing where runtime trust boundaries matter.
