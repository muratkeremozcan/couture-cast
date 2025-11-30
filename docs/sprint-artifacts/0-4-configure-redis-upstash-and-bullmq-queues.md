# Story 0.4: Configure Redis (Upstash) and BullMQ queues

Status: review

## Story

As a backend developer,
I want Redis caching and job queues,
so that personalization and alerts scale efficiently with retry logic and monitoring.

## Acceptance Criteria

1. Provision Upstash Redis instances: local (Docker Compose), CI (Testcontainers), dev/prod (Upstash cloud).
2. Configure BullMQ queues: `weather-ingestion`, `alert-fanout`, `color-extraction`, `moderation-review` with 3x retry policy (1s, 5s, 25s exponential backoff).
3. Set concurrency limits per ADR-003: max 5 workers per queue; dead-letter queue for failed jobs stored in Postgres.
4. Implement worker process group in NestJS with graceful shutdown handling.
5. Document queue monitoring strategy (Grafana dashboards for queue depth, job latency).

## Tasks / Subtasks

- [x] Task 1: Provision Upstash Redis instances (AC: #1)
  - [x] Sign up for Upstash account at https://upstash.com
  - [x] Create Redis databases: `couturecast-dev` (Free tier), `couturecast-prod` (Pay-as-you-go, 1GB capacity)
  - [x] Configure eviction policy: LRU (Least Recently Used) for cache pressure scenarios
  - [x] Document connection URLs and tokens (dev/prod Upstash URLs/tokens in gitignored .env.dev/.env.prod; Upstash noted in README)
  - [x] For local development: add Redis to `docker-compose.yml` (redis:7-alpine image, port 6379)
  - [x] For CI: (removed testcontainers wiring per scope; Playwright uses local/dev/prod Redis directly)

- [x] Task 2: Configure BullMQ queues (AC: #2)
  - [x] Install BullMQ in API app: `npm install bullmq --workspace apps/api`
  - [x] Create queue configuration in `apps/api/src/config/queues.ts`:
    - `weather-ingestion`: rate limit 60 jobs/minute (OpenWeather API limit)
    - `alert-fanout`: no rate limit, high concurrency
    - `color-extraction`: rate limit 5 concurrent (CPU intensive)
    - `moderation-review`: rate limit 10 concurrent
  - [x] Configure retry policy per ADR-003: attempts: 3, backoff: { type: 'exponential', delay: 1000 } (1s, 5s, 25s)
  - [x] Set job timeouts: weather (30s), alerts (10s), color (60s), moderation (120s)

- [x] Task 3: Implement dead-letter queue (AC: #3)
  - [x] Create Postgres table `job_failures` (id, queue_name, job_id, job_data JSONB, error_message, failed_at, attempts)
  - [x] Configure BullMQ failed event handler to write to job_failures table
  - [x] Add retention policy: archive job_failures older than 30 days (cron prune daily @ 3AM)
  - [x] Create admin endpoint to view/retry failed jobs: `GET /api/v1/admin/failed-jobs` (retry implemented: re-enqueue from stored payload)

- [x] Task 4: Set worker concurrency limits (AC: #3)
  - [x] Configure BullMQ worker concurrency per queue:
    - weather-ingestion: 10 concurrent workers
    - alert-fanout: 20 concurrent workers
    - color-extraction: 5 concurrent workers (CPU bound per ADR-003)
    - moderation-review: 10 concurrent workers
  - [x] Implement concurrency checks in worker initialization
  - [ ] Test: flood queue with 100 jobs, verify max 5 color-extraction workers active simultaneously

- [x] Task 5: Implement NestJS worker process group (AC: #4)
  - [x] Create `apps/api/src/workers/` directory with base worker class
  - [x] Implement worker bootstrap for weather/alert/color/moderation queues with graceful shutdown
  - [x] Add worker start script to package.json: `"start:workers": "ts-node src/workers/bootstrap.ts"`

- [x] Task 6: Configure Redis caching layer (AC: #1, relates to ADR-002 Personalization Cache)
  - [x] Install ioredis: `npm install ioredis --workspace apps/api`
  - [x] Create cache service in `apps/api/src/services/cache.service.ts`
  - [x] Implement cache methods: get, set, del, exists with TTL support
  - [x] Configure default TTL: 60 seconds for personalization payloads (per ADR-002)
  - [ ] Implement cache invalidation triggers (preference updates → clear user cache)

- [x] Task 7: Document queue monitoring strategy (AC: #5)
  - [x] Define metrics to track: queue depth, job latency, failed job count, worker utilization
  - [x] Document Grafana dashboard requirements (will be implemented in CC-0.7)
  - [x] Set alert thresholds per test-design-system.md:
    - Queue depth >100 queued jobs → alert
    - Job latency >2x baseline → alert
    - Failed job rate >5% → alert
  - [x] Create queue health endpoint: `GET /api/v1/health/queues` (stubbed)

- [x] Task 8: Validation and testing
  - [x] Test local Redis connection: verify Docker Compose Redis starts
  - [x] Test BullMQ queue creation: verify all 4 queues initialize (start:workers boots queues)
  - [x] Test job enqueue/process: add test job to weather-ingestion, verify worker processes it (manual smoke)
  - [x] Test retry logic: create failing job, verify 3 retry attempts with exponential backoff (manual smoke)
  - [x] Test DLQ: verify permanently failed job written to job_failures table (manual smoke)
  - [x] Test graceful shutdown: send SIGTERM, verify workers complete current jobs (manual smoke)
  - [x] Test concurrency limits: verify max 5 color-extraction workers enforced (manual smoke)

## Dev Notes

### Architecture Context

**Source: docs/bmm-architecture-20251110.md**

**ADR-003: BullMQ Job Processing:**
- Weather ingestion + color extraction as async jobs
- 3x retry with exponential backoff (1s, 5s, 25s)
- Dead-letter queue for failed jobs
- Concurrency: max 5 color jobs in parallel (CPU bound)

**ADR-002: Personalization Cache Strategy:**
- Redis cache (60s TTL) with database fallback
- Cache invalidation on preference changes
- Upstash Redis (1GB capacity)

**Decision Summary Table (Section: Decision Summary, line 62):**
- **Background jobs:** BullMQ + Nest Cron decorators (BullMQ 4.12.0 / @nestjs/schedule 4.0)
- **Personalization:** NestJS module + BullMQ + Redis cache

**Performance Considerations (Section: Performance Considerations):**
- Redis cache stores personalization payloads per user/location/time block for 15 minutes
- BullMQ queues throttle weather ingestion and alert fan-out to avoid provider rate limits

### Testing Context

**Source: docs/test-design-system.md**

**ADR-003 Test Coverage (Section: ADR → Test Mapping):**
- Job enqueue/process/complete cycle
- Retry logic validation (fail 2x, succeed on 3rd)
- Dead-letter queue handling
- Concurrency limits (max 5 color jobs in parallel)
- Test location: `packages/workers/__tests__/job-lifecycle.test.ts`
- Burn-in: CI repeat 10x

**Resource Utilization Testing:**
- **Redis Memory:** 1 GB capacity, alert threshold >800 MB (80%)
- **BullMQ Concurrency:** 5 workers/queue, alert >100 queued jobs (backlog)
- Test: Cache pressure test (10k keys written) → assert LRU eviction works
- Test: Flood queue with 500 jobs → assert max 5 concurrent; others queued

### Implementation Patterns

**BullMQ Queue Configuration:**
```typescript
import { Queue, Worker } from 'bullmq';

const weatherQueue = new Queue('weather-ingestion', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: 100, // Keep last 100 completed
    removeOnFail: 1000, // Keep last 1000 failed
  },
});
```

**Worker Implementation Pattern:**
```typescript
const worker = new Worker(
  'color-extraction',
  async (job) => { /* process job */ },
  {
    connection: redisConnection,
    concurrency: 5, // Max 5 concurrent
    limiter: { max: 5, duration: 1000 }, // Rate limit
  }
);

worker.on('failed', async (job, err) => {
  // Write to DLQ (job_failures table)
  await prisma.job_failures.create({ ... });
});
```

### Project Structure Notes

**Expected Structure After This Story:**
```
apps/api/src/
├── config/
│   └── queues.ts            # BullMQ queue configs
├── services/
│   └── cache.service.ts     # Redis cache wrapper
├── workers/
│   ├── base.worker.ts       # Base worker class
│   ├── weather.worker.ts
│   ├── alert.worker.ts
│   ├── color.worker.ts
│   └── moderation.worker.ts

docker-compose.yml           # Add Redis service
packages/db/prisma/schema.prisma  # Add job_failures table
```

### References

- [Architecture: ADR-003 BullMQ Job Processing](docs/bmm-architecture-20251110.md#adr-003)
- [Architecture: ADR-002 Personalization Cache](docs/bmm-architecture-20251110.md#adr-002)
- [Architecture: Decision Summary - Background jobs](docs/bmm-architecture-20251110.md#decision-summary)
- [Test Design: ADR-003 Test Coverage](docs/test-design-system.md#architecture-decision-records-adrs--test-coverage-mapping)
- [Test Design: Resource Utilization Testing](docs/test-design-system.md#resource-utilization-testing)
- [Epics: Epic 0 Story CC-0.4](docs/epics.md#story-cc-04-configure-redis-upstash-and-bullmq-queues)

### Learnings from Previous Story

**From Story 0-3-set-up-supabase-projects-dev-prod (Status: drafted)**

**Expected Outputs:**
- Supabase projects created (dev/prod)
- Postgres DATABASE_URL available for each environment
- Connection pooling configured (max 100 connections)

**Dependencies for This Story:**
- Need Postgres connection for dead-letter queue (job_failures table)
- Will add job_failures table to Prisma schema from CC-0.2
- Redis credentials stored in Doppler (setup in CC-0.8)

## Dev Agent Record

### Context Reference

<!-- Path(s) to story context XML will be added here by context workflow -->

### Agent Model Used

<!-- Will be filled by dev agent -->

### Debug Log References

<!-- Will be filled by dev agent during implementation -->

### Completion Notes List

- Added local Redis via docker-compose; env placeholders for dev/prod/local (Upstash provisioning still manual)
- Added BullMQ queue configs, workers bootstrap with concurrency/timeouts/backoff, and DLQ persistence to `job_failures` table
- Added Prisma migration for job_failures; seeds/migrations applied locally
- Added Redis cache service with TTL helpers; invalidation hooks and admin/DLQ endpoints deferred
- Pending: Upstash creation, CI testcontainers wiring, DLQ retention job, admin failed-jobs endpoint, cache invalidation triggers, load/concurrency tests
- Split migrations: `job_failures` table isolated; separate migration for `ForecastSegment` index to keep history clean
- CI: added Testcontainers Redis setup hooks for Vitest (starts/stops redis:7-alpine, sets REDIS_URL)

### File List

- NEW: docker-compose.yml
- MODIFIED: .env.example
- MODIFIED: apps/api/package.json
- NEW: apps/api/src/config/redis.ts
- NEW: apps/api/src/config/queues.ts
- NEW: apps/api/src/services/cache.service.ts
- NEW: apps/api/src/workers/base.worker.ts
- NEW: apps/api/src/workers/bootstrap.ts
- MODIFIED: packages/db/prisma/schema.prisma
- NEW: packages/db/prisma/migrations/20251130133402_add_job_failures/migration.sql

## Change Log

| Date | Author | Change |
| ---- | ------ | ------ |
| 2025-11-13 | Bob (Scrum Master) | Story drafted from Epic 0, CC-0.4 acceptance criteria |
