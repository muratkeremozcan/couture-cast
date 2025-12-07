# API events

Updated: 2025-12-06 — initial shared payload schemas for Socket.io + Expo events.

## Payload shape

- Base event: `{ version: string; timestamp: ISO8601; userId: string; data: T }`
- Timestamp must be ISO-8601 (validated via `z.string().datetime()`).
- Channel namespaces match ADR-007: `lookbook:new`, `ritual:update`, `alert:weather`.

## Event types

- **lookbook:new** — `LookbookNewEvent`
  - Data: `{ postId: string; locale?: string; climateBand?: string; mediaUrls?: string[] }`
- **ritual:update** — `RitualUpdateEvent`
  - Data: `{ ritualId: string; status: scheduled|in-progress|completed; nextRunAt?: ISO; message?: string }`
- **alert:weather** — `AlertWeatherEvent`
  - Data: `{ alertType: temperature|precipitation|severe; location: string; message: string; severity: info|warning|critical }`

## Runtime validation

- Zod schemas exported from `packages/api-client/src/types/socket-events.ts`.
- `socketEventSchemas` maps namespace → schema for validation on server and clients.
- OpenAPI doc generated via `npm run gen:openapi:events --workspace packages/api-client` → `packages/api-client/docs/socket-events.openapi.json`.

## Consumption

- Import types and schemas from `@couture/api-client`:

```ts
import { alertWeatherEventSchema, type AlertWeatherEvent } from '@couture/api-client'
```

Use schemas on ingress/egress to validate event payloads for web, mobile, and widgets.
