# Story 0.8: Set up environment management (Doppler) and secret rotation

Status: drafted

## Story

As a security-conscious team,
I want centralized secret management with rotation policies,
so that credentials stay secure across environments and comply with security best practices.

## Acceptance Criteria

1. Configure Doppler projects: local, ci, dev, staging, production with secrets per test-design-system.md Secrets & Configuration Management table (DATABASE_URL, WEATHER_API_KEY, REDIS_URL, LAUNCHDARKLY_SDK_KEY, SUPABASE_SERVICE_KEY).
2. Implement healthcheck endpoint (`/api/health?check=secrets`) to validate Doppler sync on deploy.
3. Set up pre-commit hooks using `gitleaks` or `detect-secrets` to scan for hardcoded secrets; CI fails if patterns detected.
4. Document quarterly secret rotation schedule and test secret rotation via staging environment.
5. Enforce least-privilege service keys for Supabase Storage (read-only for web, write for API workers).

## Tasks / Subtasks

- [ ] Task 1: Set up Doppler account and projects (AC: #1)
  - [ ] Sign up for Doppler (free tier supports 5 projects)
  - [ ] Create Doppler projects: `couturecast-local`, `couturecast-ci`, `couturecast-dev`, `couturecast-staging`, `couturecast-production`
  - [ ] Install Doppler CLI: `brew install dopplerhq/cli/doppler` (macOS) or download binary
  - [ ] Authenticate CLI: `doppler login`
  - [ ] Configure default project: `doppler setup` in repo root

- [ ] Task 2: Define secret schema and populate secrets (AC: #1)
  - [ ] Create secret list per environment in `docs/secrets-management.md`:
    - `DATABASE_URL`: Postgres connection string
    - `REDIS_URL`: Upstash Redis connection string
    - `SUPABASE_URL`: Supabase project URL
    - `SUPABASE_ANON_KEY`: Supabase anon key (public-safe)
    - `SUPABASE_SERVICE_KEY`: Supabase service role key (server-only)
    - `WEATHER_API_KEY`: OpenWeather API key
    - `POSTHOG_API_KEY`: PostHog project key
    - `GRAFANA_API_KEY`: Grafana Cloud API key
    - `GRAFANA_OTLP_ENDPOINT`: Grafana OTLP endpoint URL
    - `EXPO_ACCESS_TOKEN`: Expo Push API token
    - `VERCEL_TOKEN`: Vercel deployment token
    - `FLY_API_TOKEN`: Fly.io API token
    - `SLACK_WEBHOOK_URL`: Slack incoming webhook
    - `PAGERDUTY_INTEGRATION_KEY`: PagerDuty service key
    - `JWT_SECRET`: JWT signing secret (32 bytes, generated via OpenSSL)
  - [ ] Generate secrets: `openssl rand -base64 32` for JWT_SECRET
  - [ ] Populate secrets in Doppler UI for each environment
  - [ ] Set environment-specific values (e.g., dev database vs prod database)

- [ ] Task 3: Integrate Doppler with applications (AC: #1)
  - [ ] Install Doppler SDK: `npm install @dopplerhq/node-sdk --workspace apps/api`
  - [ ] Create ` for Doppler client initialization
  - [ ] Update app startup to fetch secrets from Doppler:
    ```typescript
    import { Doppler } from '@dopplerhq/node-sdk';
    const doppler = new Doppler({
      accessToken: process.env.DOPPLER_TOKEN,
    });
    const secrets = await doppler.secrets.list({ project, config });
    ```
  - [ ] Set `DOPPLER_TOKEN` in CI/CD environments (GitHub Secrets)
  - [ ] Test local development: `doppler run -- npm run dev:api`
  - [ ] Update README with Doppler setup instructions

- [ ] Task 4: Implement health check endpoint (AC: #2)
  - [ ] Create `apps/api/src/modules/health/health.controller.ts`
  - [ ] Implement `GET /api/health` endpoint (basic health check)
  - [ ] Implement `GET /api/health?check=secrets` endpoint:
    - Verify critical secrets are present (not null/undefined)
    - Test database connection using DATABASE_URL
    - Test Redis connection using REDIS_URL
    - Return 200 OK if all checks pass, 503 Service Unavailable if any fail
  - [ ] Add health check to deployment workflows:
    ```yaml
    - name: Health check after deploy
      run: curl -f https://api.couturecast.app/api/health?check=secrets || exit 1
    ```
  - [ ] Document health check in `docs/api-reference.md`

- [ ] Task 5: Set up gitleaks for secret scanning (AC: #3)
  - [ ] Install gitleaks: `brew install gitleaks` (macOS) or download binary
  - [ ] Create `.gitleaks.toml` configuration in repo root:
    ```toml
    title = "CoutureCast Gitleaks Config"
    [allowlist]
    description = "Allowlist test fixtures and example secrets"
    paths = [
      '''      '''docs/examples/'''
    ]
    ```
  - [ ] Add pre-commit hook in `.husky/pre-commit`:
    ```bash
    gitleaks protect --staged --verbose --redact --no-banner
    ```
  - [ ] Test pre-commit hook: add fake secret, commit should fail
  - [ ] Add gitleaks to CI (already in CC-0.6 workflow)
  - [ ] Document gitleaks setup in `docs/secrets-management.md`

- [ ] Task 6: Implement detect-secrets as backup scanner (AC: #3)
  - [ ] Install detect-secrets: `pip install detect-secrets`
  - [ ] Initialize baseline: `detect-secrets scan > .secrets.baseline`
  - [ ] Add pre-commit hook in `.pre-commit-config.yaml`:
    ```yaml
    - repo: https://github.com/Yelp/detect-secrets
      rev: v1.4.0
      hooks:
        - id: detect-secrets
          args: ['--baseline', '.secrets.baseline']
    ```
  - [ ] Audit baseline for false positives: `detect-secrets audit .secrets.baseline`
  - [ ] Update baseline after audit: commit `.secrets.baseline`
  - [ ] Test on sample hardcoded secret

- [ ] Task 7: Document secret rotation schedule (AC: #4)
  - [ ] Create `docs/secrets-management.md` with rotation policy:
    - **Quarterly rotation** (every 90 days): DATABASE_URL, JWT_SECRET, SUPABASE_SERVICE_KEY
    - **Annual rotation** (every 365 days): API keys (WEATHER_API_KEY, POSTHOG_API_KEY, etc.)
    - **On-demand rotation** (immediately): any suspected compromise
  - [ ] Document rotation procedure:
    1. Generate new secret
    2. Update Doppler (staging first)
    3. Deploy staging, verify health check
    4. Update Doppler (production)
    5. Deploy production, verify health check
    6. Revoke old secret after 24-hour grace period
  - [ ] Add calendar reminders for rotation deadlines
  - [ ] Test rotation in staging: rotate JWT_SECRET, verify app still works

- [ ] Task 8: Test secret rotation in staging (AC: #4)
  - [ ] Select non-critical secret for testing: WEATHER_API_KEY
  - [ ] Generate new OpenWeather API key
  - [ ] Update Doppler staging config with new key
  - [ ] Trigger staging deployment
  - [ ] Verify health check passes: `curl https://staging-api.couturecast.app/api/health?check=secrets`
  - [ ] Verify weather data still loads in staging app
  - [ ] Revoke old API key, confirm new key is in use
  - [ ] Document test results in `docs/secrets-management.md`

- [ ] Task 9: Enforce least-privilege service keys (AC: #5)
  - [ ] Review Supabase RLS policies (from CC-0.3)
  - [ ] Create service accounts in Supabase:
    - `web-app-service`: read-only access to public data
    - `api-worker-service`: write access to all tables (for background jobs)
  - [ ] Generate service role keys per account
  - [ ] Update Doppler secrets:
    - `SUPABASE_SERVICE_KEY_WEB`: web app service key (read-only)
    - `SUPABASE_SERVICE_KEY_API`: API worker service key (read-write)
  - [ ] Update apps to use appropriate service key:
    - `apps/web`: use `SUPABASE_SERVICE_KEY_WEB`
    - `apps/api`: use `SUPABASE_SERVICE_KEY_API`
  - [ ] Test permissions: web app cannot write, API can write
  - [ ] Document service account strategy in `docs/secrets-management.md`

- [ ] Task 10: Create Doppler sync automation (AC: #1)
  - [ ] Set up Doppler webhooks for secret changes
  - [ ] Create GitHub Action workflow `.github/workflows/doppler-sync.yml`:
    - Trigger on Doppler webhook
    - Validate webhook signature
    - Trigger deployment workflow to apply new secrets
  - [ ] Test webhook: update secret in Doppler, verify deployment triggered
  - [ ] Document webhook setup in `docs/secrets-management.md`

- [ ] Task 11: Implement secret access audit logging (AC: #4)
  - [ ] Log secret access in application:
    ```typescript
    logger.info({
      event: 'secret_accessed',
      secretKey: 'DATABASE_URL',
      service: 'api',
      timestamp: new Date().toISOString(),
    });
    ```
  - [ ] Send audit logs to Grafana Loki
  - [ ] Create Grafana dashboard: "Secret Access Audit"
    - Panel: Secret access frequency by key
    - Panel: Access by service
    - Alert: Unusual secret access pattern
  - [ ] Document audit logging in `docs/secrets-management.md`

- [ ] Task 12: Document secrets management for team
  - [ ] Create `docs/secrets-management.md` with sections:
    - Secret categories and rotation schedules
    - How to add new secret to Doppler
    - How to rotate secrets safely
    - Least-privilege principles
    - Incident response for leaked secrets
    - Health check validation
  - [ ] Add Doppler CLI cheat sheet
  - [ ] Document emergency procedures for secret compromise
  - [ ] Add FAQ section for common issues

## Dev Notes

### Architecture Context

**Source: docs/bmm-architecture-20251110.md**

**Security Architecture (lines 175-181):**
- Supabase Auth + RLS enforce tenant isolation
- Guardian consent stored and checked
- Postgres `pgcrypto` encrypts sensitive fields
- NestJS guards enforce role-based access
- Audit logging for auth changes, moderation, data exports
- All secrets managed via Doppler (or Supabase Vault)
- Least-privilege service keys for Supabase Storage

**Consistency Rules (line 156):**
- Feature flags: PostHog helpers in ` fallback to Postgres toggle

**Implementation Patterns (line 148):**
- Background jobs retry 5 times with exponential backoff before DLQ

### Testing Context

**Secret Management Testing:**
- Verify health check detects missing secrets
- Test secret rotation: old secret invalid, new secret valid
- Verify least-privilege: web app cannot write to restricted tables
- Test gitleaks pre-commit hook prevents secret commits
- Validate Doppler sync updates app configuration

**Security Testing:**
- Scan codebase for hardcoded secrets (gitleaks + detect-secrets)
- Verify encrypted fields in Postgres (pgcrypto)
- Test service account permissions (read-only vs read-write)
- Validate audit logging captures secret access

**Integration Testing:**
- E2E test: app starts with Doppler secrets
- E2E test: health check passes after secret rotation
- E2E test: webhook triggers deployment on secret change

### Implementation Patterns

**Doppler Client Pattern:**
```typescript
// import { Doppler } from '@dopplerhq/node-sdk';

const doppler = new Doppler({
  accessToken: process.env.DOPPLER_TOKEN,
});

export async function getSecrets(project: string, config: string) {
  const response = await doppler.secrets.list({ project, config });
  return response.secrets;
}

// Usage in app
const secrets = await getSecrets('couturecast', 'production');
process.env.DATABASE_URL = secrets.DATABASE_URL.computed;
```

**Health Check Pattern:**
```typescript
// apps/api/src/modules/health/health.controller.ts
import { Controller, Get, Query } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  async healthCheck(@Query('check') check?: string) {
    if (check === 'secrets') {
      return this.validateSecrets();
    }
    return { status: 'ok' };
  }

  private async validateSecrets() {
    const requiredSecrets = [
      'DATABASE_URL',
      'REDIS_URL',
      'SUPABASE_URL',
      'JWT_SECRET',
    ];

    for (const key of requiredSecrets) {
      if (!process.env[key]) {
        throw new ServiceUnavailableException(`Missing secret: ${key}`);
      }
    }

    // Test connections
    await this.testDatabaseConnection();
    await this.testRedisConnection();

    return { status: 'ok', secrets: 'valid' };
  }
}
```

**Pre-commit Hook Pattern:**
```bash
#!/bin/sh
# .husky/pre-commit

echo "Running gitleaks..."
gitleaks protect --staged --verbose --redact --no-banner

if [ $? -ne 0 ]; then
  echo "❌ Gitleaks detected secrets in staged files"
  echo "Run 'gitleaks protect --staged --verbose' for details"
  exit 1
fi

echo "✅ No secrets detected"
```

### Project Structure Notes

**New Directories:**
```
└── doppler.ts                    # Doppler client
apps/api/src/modules/health/
├── health.module.ts
├── health.controller.ts
└── health.service.ts
.husky/
└── pre-commit                    # Git hooks
.gitleaks.toml                    # Gitleaks config
.secrets.baseline                 # detect-secrets baseline
docs/
└── secrets-management.md         # Secrets documentation
.github/workflows/
└── doppler-sync.yml              # Doppler webhook handler
```

**Environment Variables (Doppler):**
- `DOPPLER_TOKEN`: Doppler service token (set in CI/CD)
- All application secrets stored in Doppler, not in `.env` files

**Git Ignored:**
```
.env*
!.env.example
doppler.yaml
```

### References

- [Architecture: Security Architecture](docs/bmm-architecture-20251110.md#security-architecture)
- [Epics: Epic 0 Story CC-0.8](docs/epics.md#epic-0--platform-foundation--infrastructure-sprint-0)
- [Doppler Documentation](https://docs.doppler.com/)
- [Gitleaks](https://github.com/gitleaks/gitleaks)
- [detect-secrets](https://github.com/Yelp/detect-secrets)
- [Supabase Service Roles](https://supabase.com/docs/guides/api/api-keys)

### Learnings from Previous Stories

**From CC-0.3 (Supabase):**
- Store service keys securely
- Use least-privilege access patterns
- Separate test and production credentials

**From CC-0.4 (Redis/BullMQ):**
- Connection strings must be secured
- Test connection validity in health checks

**From CC-0.5 (Socket.io):**
- Auth tokens must be rotated regularly
- Monitor authentication failures

**From CC-0.6 (CI/CD):**
- Secrets required in GitHub Actions
- Health checks validate deployments
- Pre-commit hooks prevent bad commits

**From CC-0.7 (Observability):**
- Audit log secret access
- Monitor secret rotation events
- Alert on unusual access patterns

**For this story:**
- Doppler centralizes secret management across environments
- Health checks catch configuration errors early
- Pre-commit hooks prevent secret leaks before push
- Secret rotation tested in staging first
- Least-privilege reduces blast radius of compromise
- Audit logging provides accountability

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
| 2025-11-13 | Bob (Scrum Master) | Story drafted from Epic 0, CC-0.8 acceptance criteria |
