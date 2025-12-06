# Story 0.5: Initialize Socket.io gateway and Expo Push API

Status: in-progress

## Story

As a developer,
I want real-time communication infrastructure,
so that users receive weather alerts and community updates instantly via Socket.io and push notifications.

## Acceptance Criteria

1. Configure Socket.io server in NestJS with namespace strategy per ADR-007 (`lookbook:new`, `ritual:update`, `alert:weather`).
2. Implement connection lifecycle (connect, disconnect, reconnect with exponential backoff 1s, 3s, 9s; max 5 retries).
3. Set up Expo Push API credentials and notification sending service (push token registration, batch notification dispatch).
4. Create shared payload schema for events (version, timestamp, userId, data) and enforce in TypeScript types.
5. Test connection fallback: Socket.io disconnect → polling mode activated; reconnect → resume Socket.io stream.

## Tasks / Subtasks

- [x] Task 1: Configure Socket.io server in NestJS (AC: #1)
  - [x] Install Socket.io dependencies: `npm install @nestjs/platform-socket.io socket.io --workspace apps/api`
  - [x] Create `apps/api/src/modules/gateway/` directory structure
  - [x] Implement `GatewayModule` with Socket.io server configuration
  - [x] Configure namespace strategy per ADR-007: `lookbook:new`, `ritual:update`, `alert:weather`
  - [x] Set up CORS and authentication middleware for Socket.io connections
  - [x] Document namespace purposes in code comments

- [x] Task 2: Implement connection lifecycle (AC: #2)
  - [x] Create `ConnectionManager` service to handle client connections
  - [x] Implement `@OnConnect` and `@OnDisconnect` handlers
  - [x] Add reconnection logic with exponential backoff (1s, 3s, 9s intervals)
  - [x] Set max retry limit to 5 attempts
  - [x] Log connection events to Pino logger with structured format (requestId, userId, namespace)
  - [x] Create integration test for connection lifecycle in `apps/api/src/modules/gateway/gateway.test.ts`

- [ ] Task 2: Implement connection lifecycle (AC: #2)
  - [ ] Create `ConnectionManager` service to handle client connections
  - [ ] Implement `@OnConnect` and `@OnDisconnect` handlers
  - [ ] Add reconnection logic with exponential backoff (1s, 3s, 9s intervals)
  - [ ] Set max retry limit to 5 attempts
  - [ ] Log connection events to Pino logger with structured format (requestId, userId, namespace)
  - [ ] Create integration test for connection lifecycle in `apps/api/src/modules/gateway/gateway.test.ts`

- [ ] Task 3: Set up Expo Push API (AC: #3)
  - [ ] Install Expo SDK: `npm install expo-server-sdk --workspace apps/api`
  - [ ] Create `apps/api/src/modules/notifications/` directory
  - [ ] Implement `PushNotificationService` with Expo Push token registration
  - [ ] Add batch notification dispatch method (handle up to 100 notifications per batch per Expo limits)
  - [ ] Configure Expo Access Token in environment variables (EXPO_ACCESS_TOKEN)
  - [ ] Implement error handling for invalid push tokens and rate limits
  - [ ] Create `PushTokenRepository` to store user push tokens in Postgres

- [ ] Task 4: Create shared payload schema (AC: #4)
  - [ ] Create `packages/api-client/src/types/socket-events.ts` for event type definitions
  - [ ] Define base event interface: `{ version: string; timestamp: ISO8601; userId: string; data: T }`
  - [ ] Create specific event types for each namespace:
    - `LookbookNewEvent` (lookbook:new)
    - `RitualUpdateEvent` (ritual:update)
    - `AlertWeatherEvent` (alert:weather)
  - [ ] Add Zod schemas for runtime validation
  - [ ] Export types to be consumed by mobile and web apps
  - [ ] Document event schema in `docs/api-events.md`

- [ ] Task 5: Implement connection fallback mechanism (AC: #5)
  - [ ] Create `PollingService` in web and mobile apps for fallback mode
  - [ ] Implement Socket.io disconnect detection in client
  - [ ] Add automatic polling activation (30-second interval) on disconnect
  - [ ] Create REST endpoints for polling: `GET /api/v1/events/poll?since=<timestamp>`
  - [ ] Implement reconnection detection and automatic switch back to Socket.io stream
  - [ ] Add telemetry events for fallback activation/deactivation
  - [ ] Test disconnect/reconnect scenarios in E2E tests

- [ ] Task 6: Create unit and integration tests
  - [ ] Unit tests for `ConnectionManager`: connect, disconnect, retry logic
  - [ ] Unit tests for `PushNotificationService`: token registration, batch dispatch, error handling
  - [ ] Integration test for Socket.io gateway: namespace routing, authentication
  - [ ] Integration test for fallback mechanism: disconnect → polling → reconnect
  - [ ] Mock Expo Push API responses in tests

- [ ] Task 7: Document real-time architecture
  - [ ] Update architecture doc with Socket.io namespace diagram
  - [ ] Document connection lifecycle flow (connect → auth → subscribe → events)
  - [ ] Add Expo Push notification flow (register token → send notification → handle receipts)
  - [ ] Document fallback strategy and polling endpoint behavior
  - [ ] Add troubleshooting guide for common Socket.io issues

## Dev Notes

### Architecture Context

**Source: docs/bmm-architecture-20251110.md**

**ADR-007 Real-time + Notifications (lines 223):**
- Socket.io + Expo Push + shared payload schema
- Namespace strategy: `lookbook:new`, `ritual:update`, `alert:weather`
- Shared payload: version, timestamp, userId, data

**Technology Stack (lines 114-115):**
- Socket.io 4.7.2 for real-time communication
- Expo SDK 51.0.3 for push notifications
- NestJS 11.1.2 for backend gateway

**Integration Points (lines 119-124):**
- Expo Push API sends alerts
- Socket.io mirrors the same payload for web/widgets
- PostHog SDKs feed event data
- Server-side uses REST API for flag checks

**API Contracts (lines 169-173):**
- All public endpoints prefixed `/api/v1`
- Authentication via Supabase JWT
- Example: `POST /api/v1/lookbook` creates post with status response
- OpenAPI spec generated from NestJS decorators

**Implementation Patterns (lines 143-148):**
- Socket.io events namespaced (`lookbook:new`, `ritual:update`) with version and timestamp
- Background jobs retry 5 times with exponential backoff before DLQ
- Tests colocated `*.test.ts` (no dedicated E2E package; Playwright/Maestro live at repo root)

**Consistency Rules (lines 152-157):**
- Logging: Pino (API) + consola (clients) with JSON format including timestamp, requestId, userId, feature
- OTLP forwarding to Grafana Cloud
- Feature flags via PostHog helpers in `packages/config/flags.ts`

### Testing Context

**Connection Lifecycle Testing:**
- Test connect → authenticate → subscribe flow
- Test disconnect handling and cleanup
- Test exponential backoff: verify 1s, 3s, 9s intervals
- Test max retry limit (5 attempts) before giving up
- Test reconnection after successful retry

**Push Notification Testing:**
- Test token registration and storage
- Test batch dispatch (up to 100 notifications)
- Test invalid token handling
- Test rate limit errors
- Test receipt processing

**Fallback Mechanism Testing:**
- Test automatic polling activation on disconnect
- Test polling endpoint returns events since timestamp
- Test automatic switch back to Socket.io on reconnect
- Test no duplicate events during transition

**Integration Testing:**
- Test full flow: client connects → receives event via Socket.io
- Test full flow: client disconnects → polls via REST → receives event
- Test authentication on Socket.io connection
- Test namespace isolation (events don't leak between namespaces)

### Implementation Patterns

**Namespace Organization:**
```typescript
// apps/api/src/modules/gateway/gateway.module.ts
@WebSocketGateway({
  namespace: /^\/(lookbook|ritual|alert)$/,
  cors: { origin: true }
})
export class EventsGateway {
  @SubscribeMessage('subscribe')
  handleSubscribe(@MessageBody() data: any, @ConnectedSocket() client: Socket) {
    const namespace = client.nsp.name;
    // Route to appropriate handler based on namespace
  }
}
```

**Event Schema Pattern:**
```typescript
// packages/api-client/src/types/socket-events.ts
export interface BaseEvent<T = unknown> {
  version: string;
  timestamp: string; // ISO8601
  userId: string;
  data: T;
}

export interface AlertWeatherEvent extends BaseEvent<{
  alertType: 'temperature' | 'precipitation' | 'severe';
  location: string;
  message: string;
  severity: 'info' | 'warning' | 'critical';
}> {}
```

**Exponential Backoff Pattern:**
```typescript
// Client-side reconnection logic
const backoffDelays = [1000, 3000, 9000]; // 1s, 3s, 9s
let retryCount = 0;
const maxRetries = 5;

socket.on('disconnect', () => {
  if (retryCount < maxRetries) {
    const delay = backoffDelays[Math.min(retryCount, backoffDelays.length - 1)];
    setTimeout(() => socket.connect(), delay);
    retryCount++;
  } else {
    activatePollingMode();
  }
});
```

### Project Structure Notes

**New Directories:**
```
apps/api/src/modules/
├── gateway/
│   ├── gateway.module.ts
│   ├── gateway.gateway.ts
│   ├── gateway.service.ts
│   ├── connection-manager.service.ts
│   └── gateway.test.ts
├── notifications/
│   ├── notifications.module.ts
│   ├── push-notification.service.ts
│   ├── push-token.repository.ts
│   └── notifications.test.ts
packages/api-client/src/types/
└── socket-events.ts
```

**Environment Variables:**
- `EXPO_ACCESS_TOKEN`: Expo Push API access token
- `SOCKET_IO_CORS_ORIGIN`: Allowed origins for Socket.io CORS
- `SOCKET_IO_PORT`: Port for Socket.io server (default: same as API)

### References

- [Architecture: ADR-007 Real-time + Notifications](docs/bmm-architecture-20251110.md#architecture-decision-records-adrs)
- [Architecture: Technology Stack](docs/bmm-architecture-20251110.md#technology-stack-details)
- [Architecture: Integration Points](docs/bmm-architecture-20251110.md#integration-points)
- [Epics: Epic 0 Story CC-0.5](docs/epics.md#epic-0--platform-foundation--infrastructure-sprint-0)
- [Socket.io Documentation](https://socket.io/docs/v4/)
- [Expo Push Notifications](https://docs.expo.dev/push-notifications/overview/)
- [NestJS WebSockets](https://docs.nestjs.com/websockets/gateways)

### Learnings from Previous Stories

**From CC-0.1 (Turborepo setup):**
- Version verification is critical - run npm info commands before installing
- Lock all dependency versions to avoid drift
- Document all environment variables

**From CC-0.2 (Prisma):**
- Create migration scripts alongside implementation
- Add seed data for testing (push tokens for test users)
- Include rollback strategy

**From CC-0.3 (Supabase):**
- Document all service keys and credentials
- Set up local development environment first
- Test connection before deploying

**From CC-0.4 (Redis/BullMQ):**
- Implement retry logic with exponential backoff
- Set up monitoring/observability from the start
- Document queue patterns and concurrency limits

**For this story:**
- Test Socket.io in local environment before cloud deployment
- Create comprehensive connection lifecycle tests
- Document namespace strategy clearly for future feature teams
- Set up Grafana dashboards for Socket.io metrics (connections, disconnects, events/sec)

## Dev Agent Record

### Context Reference

<!-- Path(s) to story context XML will be added here by context workflow -->

### Agent Model Used

<!-- Will be filled by dev agent -->

### Debug Log References

- 2025-12-06: `npm test --workspaces --if-present` (vitest) — added gateway TDD coverage for Socket.io options/auth middleware
- 2025-12-06: `npm run lint:fix` → lint clean; `npm run typecheck` → tsc clean (gateway spec/types)
- 2025-12-06: `npm test --workspaces --if-present` (vitest) — connection lifecycle retries/fallback integration
- 2025-12-06: `npm run lint -- --max-warnings=0`; `npm run typecheck` — clean after connection manager + gateway lifecycle

### Completion Notes List

- Task 1: Scaffolded gateway module with ADR-007 namespaces, CORS + auth middleware, and coverage for options/auth wiring
- Task 2: Added ConnectionManager with backoff (1s/3s/9s, max 5), Pino-structured logging, connect/disconnect handlers, retry/fallback emits, and integration coverage

### File List

- apps/api/package.json
- apps/api/src/app.module.ts
- apps/api/src/modules/gateway/connection-manager.service.ts
- apps/api/src/modules/gateway/gateway.test.ts
- apps/api/src/modules/gateway/gateway.gateway.spec.ts
- apps/api/src/modules/gateway/gateway.gateway.ts
- apps/api/src/modules/gateway/gateway.module.ts
- docs/sprint-artifacts/0-5-initialize-socketio-gateway-and-expo-push-api.md
- docs/sprint-artifacts/sprint-status.yaml
- package-lock.json

## Change Log

| Date | Author | Change |
| ---- | ------ | ------ |
| 2025-12-06 | Amelia (Dev Agent) | Task 2: connection lifecycle (ConnectionManager, backoff, retry/fallback emits, Pino logging, integration tests) |
| 2025-12-06 | Amelia (Dev Agent) | Task 1: gateway module scaffolding with ADR-007 namespaces, CORS/auth middleware, and vitest coverage |
| 2025-11-13 | Bob (Scrum Master) | Story drafted from Epic 0, CC-0.5 acceptance criteria |
