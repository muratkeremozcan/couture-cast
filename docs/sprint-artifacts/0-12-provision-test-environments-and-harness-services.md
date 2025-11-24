# Story 0.12: Provision test environments and harness services

Status: drafted

## Story

As a test engineer,
I need isolated test environments,
so that tests run deterministically without affecting production and all test infrastructure is ready for feature development.

## Acceptance Criteria

1. Provision 6 test environments per test-design-system.md Test Environment Requirements:
   - Supabase test project with anonymized fixtures and RLS parity
   - Weather provider harness (stub service replaying OpenWeather payloads, emitting 429/500 on demand)
   - BullMQ/Redis sandbox (synthetic jobs, no prod queue access)
   - Media pipeline lab (Sharp/ONNX with GPU fallback for CI)
   - Cross-surface device matrix (Playwright browsers, Expo simulators, watch emulator)
   - Localization snapshot suite (locale bundles, disclosure templates)
2. Document access/runbooks for each environment in `docs/test-environments.md`.
3. Implement weather harness as ` with fixture loading from `4. Configure CI to use stub provider (no real API calls); dev/staging use real OpenWeather test API key.
5. Validate environment readiness: run smoke tests in each environment and confirm pass.

## Tasks / Subtasks

- [ ] Task 1: Provision Supabase test project (AC: #1)
  - [ ] Create new Supabase project: `couturecast-test`
  - [ ] Apply Prisma schema migrations
  - [ ] Seed with anonymized test data (from CC-0.10 factories)
  - [ ] Configure RLS policies (identical to prod)
  - [ ] Set up Storage buckets with test data
  - [ ] Document connection details in Doppler (test environment)
  - [ ] Configure weekly reset job to wipe/reseed test database

- [ ] Task 2: Create weather provider harness (AC: #1, #3)
  - [ ] Create ` directory
  - [ ] Implement stub HTTP server using Express:
    ```typescript
    import express from 'express';
    import { loadFixtures } from './fixtures';

    const app = express();
    const fixtures = loadFixtures();

    app.get('/weather/current', (req, res) => {
      const locationId = req.query.locationId;
      res.json(fixtures.current[locationId] || fixtures.current.default);
    });

    app.get('/weather/forecast', (req, res) => {
      // Simulate rate limit if requested
      if (req.query.simulateError === '429') {
        return res.status(429).json({ error: 'Rate limit exceeded' });
      }
      // Simulate server error
      if (req.query.simulateError === '500') {
        return res.status(500).json({ error: 'Internal server error' });
      }
      const locationId = req.query.locationId;
      res.json(fixtures.forecast[locationId] || fixtures.forecast.default);
    });

    export default app;
    ```
  - [ ] Create ` with sample responses
  - [ ] Add harness startup to test setup: `beforeAll(() => harness.start())`

- [ ] Task 3: Set up BullMQ/Redis sandbox (AC: #1)
  - [ ] Create isolated Redis instance for tests (Testcontainers or local Docker)
  - [ ] Configure BullMQ queues in test mode (separate namespace)
  - [ ] Create synthetic jobs for testing:
    ```typescript
    export function createSyntheticJob(queueName: string, data: any) {
      return testQueue.add(queueName, data);
    }
    ```
  - [ ] Document job lifecycle testing patterns
  - [ ] Ensure tests clean up queues after each run

- [ ] Task 4: Set up media pipeline lab (AC: #1)
  - [ ] Create ` directory
  - [ ] Configure Sharp for image processing in tests
  - [ ] Install ONNX runtime for color analysis tests
  - [ ] Create GPU fallback for CI (CPU-only mode):
    ```typescript
    const useCPU = process.env.CI === 'true';
    const session = await ort.InferenceSession.create(modelPath, {
      executionProviders: useCPU ? ['cpu'] : ['cuda', 'cpu'],
    });
    ```
  - [ ] Add test fixtures: sample garment images, expected color palettes
  - [ ] Document media processing test patterns

- [ ] Task 5: Configure cross-surface device matrix (AC: #1)
  - [ ] Configure Playwright browsers in CI:
    ```typescript
    // playwright.config.ts
    projects: [
      { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
      { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
      { name: 'webkit', use: { ...devices['Desktop Safari'] } },
      { name: 'mobile-chrome', use: { ...devices['Pixel 5'] } },
      { name: 'mobile-safari', use: { ...devices['iPhone 12'] } },
    ]
    ```
  - [ ] Set up Expo simulator matrix (iOS 16+, Android 12+)
  - [ ] Configure watch emulator (Apple Watch simulator)
  - [ ] Document device matrix in `docs/test-environments.md`
  - [ ] Add device matrix to CI workflow (AC: #4)

- [ ] Task 6: Create localization snapshot suite (AC: #1)
  - [ ] Create ` directory
  - [ ] Generate snapshot bundles for each locale:
    - EN (US/CA)
    - ES (LatAm)
    - FR (CA/EU)
  - [ ] Create disclosure templates for each locale (COPPA, privacy policy)
  - [ ] Implement snapshot tests:
    ```typescript
    it('should render EN locale correctly', () => {
      const rendered = renderComponent({ locale: 'en-US' });
      expect(rendered).toMatchSnapshot();
    });
    ```
  - [ ] Document localization testing in `docs/test-environments.md`

- [ ] Task 7: Document environment access (AC: #2)
  - [ ] Create `docs/test-environments.md` with sections:
    - **Supabase Test Project**: connection URL, credentials, reset schedule
    - **Weather Harness**: how to start, simulate errors, add fixtures
    - **BullMQ/Redis Sandbox**: queue names, job lifecycle, cleanup
    - **Media Pipeline Lab**: Sharp config, ONNX models, GPU fallback
    - **Device Matrix**: browsers, simulators, emulators
    - **Localization Suite**: locale bundles, snapshot testing
  - [ ] Add runbooks for common tasks:
    - Reset test database
    - Add new weather fixture
    - Simulate rate limit error
    - Test on specific device
  - [ ] Document troubleshooting for each environment

- [ ] Task 8: Configure CI to use harness (AC: #4)
  - [ ] Update `.github/workflows/test.yml` to start weather harness:
    ```yaml
    - name: Start weather harness
      run: npm run test:weather-harness:start &
    - name: Wait for harness
      run: npx wait-on http://localhost:3002/health
    - name: Run tests
      run: npm test
      env:
        WEATHER_API_URL: http://localhost:3002
        USE_WEATHER_HARNESS: true
    ```
  - [ ] Add environment variable: `USE_WEATHER_HARNESS=true` for CI, `false` for dev/staging
  - [ ] Verify no real API calls in CI (check network logs)

- [ ] Task 9: Create smoke tests for environment validation (AC: #5)
  - [ ] Create ` directory
  - [ ] Write smoke tests for each environment:
    ```typescript
    describe('Test Environment Smoke Tests', () => {
      it('should connect to Supabase test project', async () => {
        const { data, error } = await supabase.from('users').select('count');
        expect(error).toBeNull();
      });

      it('should fetch weather from harness', async () => {
        const response = await weatherClient.getCurrent('test-location');
        expect(response.status).toBe(200);
      });

      it('should process jobs in BullMQ sandbox', async () => {
        const job = await testQueue.add('test-job', { data: 'test' });
        await job.waitUntilFinished(queueEvents);
        expect(job.isCompleted()).toBe(true);
      });

      it('should process images in media lab', async () => {
        const result = await processImage('test-image.jpg');
        expect(result).toBeDefined();
      });

      it('should run on all device matrix browsers', async () => {
        // Playwright auto-runs on all configured projects
        expect(true).toBe(true);
      });

      it('should render all locales', async () => {
        const locales = ['en-US', 'es-419', 'fr-CA'];
        for (const locale of locales) {
          const rendered = renderComponent({ locale });
          expect(rendered).toBeDefined();
        }
      });
    });
    ```
  - [ ] Run smoke tests in CI before main test suite
  - [ ] Fail fast if smoke tests fail

- [ ] Task 10: Create environment teardown scripts (AC: #5)
  - [ ] Create `    - Stop weather harness
    - Clean up Redis queues
    - Close Supabase connections
    - Stop Playwright servers
  - [ ] Add to `afterAll` hooks in test setup
  - [ ] Document teardown procedures in `docs/test-environments.md`

- [ ] Task 11: Set up test data anonymization (AC: #1)
  - [ ] Create `    - Export prod data
    - Anonymize PII (emails, names, IP addresses)
    - Import to test project
  - [ ] Document data anonymization procedures
  - [ ] Schedule monthly anonymization job (GitHub Actions cron)

- [ ] Task 12: Create environment health dashboard (AC: #5)
  - [ ] Create Grafana dashboard: "Test Environment Health"
    - Panel: Test database size
    - Panel: Weather harness uptime
    - Panel: Redis queue depth (test queues)
    - Panel: Smoke test pass rate
  - [ ] Set up alerts for environment issues
  - [ ] Document dashboard access in `docs/test-environments.md`

## Dev Notes

### Architecture Context

**Source: docs/bmm-architecture-20251110.md**

**Testing (lines 114-116):**
- Turborepo + npm workspaces
- Vitest for unit/integration
- Playwright for web E2E, Maestro for mobile E2E

**Integration Points (lines 119-120):**
- Weather provider (OpenWeather or chosen API) ingested hourly via NestJS Cron + BullMQ jobs

**Development Environment (lines 199-214):**
- Prerequisites: Node 20 LTS, npm 10+, Docker, Supabase CLI, Fly CLI, Vercel CLI, Expo CLI
- Setup commands: npm install, npm run db:migrate, npm run dev:web/mobile/api

### Testing Context

**6 Test Environments (AC: #1):**
1. Supabase test project - Database and auth testing
2. Weather harness - API simulation and error injection
3. BullMQ/Redis sandbox - Job queue testing
4. Media pipeline lab - Image processing testing
5. Device matrix - Cross-platform E2E testing
6. Localization suite - i18n testing

**Environment Isolation:**
- Each environment isolated from production
- Tests do not call real external APIs
- Data anonymized for privacy
- Environments reset regularly to prevent pollution

### Implementation Patterns

**Weather Harness Pattern:**
```typescript
// import express from 'express';
import { weatherFixtures } from '../weather/__fixtures__';

export function createWeatherHarness(port: number = 3002) {
  const app = express();

  app.get('/current', (req, res) => {
    const locationId = req.query.locationId as string;
    res.json(weatherFixtures.current[locationId] || weatherFixtures.default);
  });

  return app.listen(port);
}
```

**Smoke Test Pattern:**
```typescript
// import { test, expect } from '@playwright/test';

test.describe('Environment Smoke Tests', () => {
  test('Supabase connection', async () => {
    // Verify database connection
  });

  test('Weather harness responds', async () => {
    // Verify harness is running
  });
});
```

**CI Environment Config:**
```yaml
# .github/workflows/test.yml
env:
  USE_WEATHER_HARNESS: true
  WEATHER_API_URL: http://localhost:3002
  SUPABASE_URL: ${{ secrets.SUPABASE_TEST_URL }}
  REDIS_URL: redis://localhost:6379/1
```

### Project Structure Notes

**New Directories:**
```
├── weather-harness/
│   ├── server.ts
│   ├── fixtures.ts
│   └── health.ts
├── media-lab/
│   ├── sharp.config.ts
│   ├── onnx.config.ts
│   └── fixtures/
│       ├── test-garment.jpg
│       └── expected-palettes.json
├── localization/
│   ├── snapshots/
│   │   ├── en-US/
│   │   ├── es-419/
│   │   └── fr-CA/
│   └── templates/
│       ├── coppa-disclosure.md
│       └── privacy-policy.md
├── smoke/
│   └── environment.smoke.spec.ts
└── scripts/
    ├── teardown.ts
    └── anonymize-prod-data.ts
└── openweather-responses.json
docs/
└── test-environments.md
```

**Environment Variables (Test):**
- `USE_WEATHER_HARNESS`: true (CI), false (dev/staging)
- `WEATHER_API_URL`: harness URL or real API URL
- `SUPABASE_URL`: test project URL
- `REDIS_URL`: test Redis instance
- `GPU_ENABLED`: false (CI), true (local)

### References

- [Architecture: Testing](docs/bmm-architecture-20251110.md#technology-stack-details)
- [Architecture: Integration Points](docs/bmm-architecture-20251110.md#integration-points)
- [Architecture: Development Environment](docs/bmm-architecture-20251110.md#development-environment)
- [Epics: Epic 0 Story CC-0.12](docs/epics.md#epic-0--platform-foundation--infrastructure-sprint-0)
- [Testcontainers](https://testcontainers.com/)
- [Playwright Device Emulation](https://playwright.dev/docs/emulation)

### Learnings from Previous Stories

**From CC-0.3 (Supabase):**
- Test project requires same schema as production
- RLS policies must match for realistic testing

**From CC-0.4 (Redis/BullMQ):**
- Test queues must be isolated
- Job cleanup critical to prevent pollution

**From CC-0.6 (CI/CD):**
- CI needs deterministic, fast environments
- No external API calls in CI

**From CC-0.10 (Test fixtures):**
- Anonymized data for test project
- Factory-based seed data

**For this story:**
- Test environments enable deterministic tests
- Weather harness eliminates external API dependency
- Device matrix ensures cross-platform compatibility
- Smoke tests validate environment readiness
- Documentation critical for team adoption

## Dev Agent Record

### Context Reference

<!-- Path(s) to story context XML will be added here by context workflow -->

### Agent Model Used

<!-- Will be filled by dev agent -->

### Debug Log References

<!-- Will be filled by dev agent during implementation -->

### Completion Notes List

<!-- Will be filled by dev agent upon completion -->

### File List

<!-- Will be filled by dev agent with NEW/MODIFIED/DELETED files -->

## Change Log

| Date | Author | Change |
| ---- | ------ | ------ |
| 2025-11-13 | Bob (Scrum Master) | Story drafted from Epic 0, CC-0.12 acceptance criteria |
