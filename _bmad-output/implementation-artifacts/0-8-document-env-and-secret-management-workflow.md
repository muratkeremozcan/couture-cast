# Story 0.8: Document env and secret management workflow

Status: done

## Story

As a security-conscious team,
I want a simple, documented secret-management workflow,
so that local development, CI, and deployments stay secure without adding paid tooling.

## Resolution

This story is resolved by the existing repository workflow:

- Local development uses gitignored `.env` files.
- CI uses GitHub Actions secrets.
- Hosted environments use provider-native secret stores.
- `gitleaks` remains the leak-prevention control for staged changes and CI.

No standalone secret manager is required for this project.

## Acceptance Criteria

1. Document `.env`-based local development and `.env.example` as the source of required variable names.
2. Document GitHub Actions secrets for CI and provider-native secret stores for hosted environments.
3. Keep `gitleaks` as the required secret-scanning control in local workflows and CI.
4. Document a manual secret-rotation schedule and incident-response procedure.
5. Keep least-privilege service keys for Supabase and other hosted services.

## Tasks / Subtasks

- [x] Task 1: Remove the third-party secret-manager requirement from the active plan (AC: #1, #2)
  - [x] Replace the vendor-specific story with the approved `.env` + GitHub/provider-secrets workflow
  - [x] Update active planning and architecture docs to reference the approved workflow

- [x] Task 2: Preserve existing secret-hygiene requirements (AC: #3, #4, #5)
  - [x] Keep `gitleaks` as the required secret-scanning control
  - [x] Document rotation guidance in project knowledge
  - [x] Keep least-privilege service-key guidance in the planning artifacts

## Dev Notes

### Decision Summary

- No third-party secret manager is adopted.
- Local secrets remain in gitignored `.env` files.
- CI secrets remain in GitHub Actions secrets.
- Hosted/runtime secrets remain in provider-native secret stores.

### References

- [Architecture: Security Architecture](../planning-artifacts/architecture.md#security-architecture)
- [Epics: Epic 0 Story CC-0.8](../planning-artifacts/epics.md#epic-0--platform-foundation--infrastructure-sprint-0)
- [Secrets Management](../project-knowledge/secrets-management.md)

## Dev Agent Record

### Context Reference

<!-- Path(s) to story context XML will be added here by context workflow -->

### Agent Model Used

GPT-5 Codex

### Debug Log References

None. Documentation-only change.

### Completion Notes List

- Replaced the vendor-specific draft with the accepted `.env` + GitHub/provider-secrets workflow.
- Normalized active docs to stop treating any third-party secret manager as required work.
- No code changes or runtime integrations were made.

### File List

- \_bmad-output/implementation-artifacts/0-8-document-env-and-secret-management-workflow.md
- \_bmad-output/project-knowledge/secrets-management.md
- \_bmad-output/planning-artifacts/architecture.md
- \_bmad-output/planning-artifacts/epics.md
- \_bmad-output/implementation-artifacts/sprint-status.yaml
- \_bmad-output/implementation-artifacts/0-3-set-up-supabase-projects-dev-staging-prod.md
- \_bmad-output/implementation-artifacts/0-4-configure-redis-upstash-and-bullmq-queues.md
- \_bmad-output/implementation-artifacts/0-5-initialize-socketio-gateway-and-expo-push-api.md
- \_bmad-output/implementation-artifacts/0-6-scaffold-cicd-pipelines-github-actions.md
- \_bmad-output/implementation-artifacts/0-7-configure-posthog-opentelemetry-and-grafana-cloud.md
- \_bmad-output/implementation-artifacts/0-12-provision-test-environments-and-harness-services.md
- \_bmad-output/test-artifacts/test-design-system.md
- \_bmad-output/planning-artifacts/refs/implementation-readiness-report-2025-11-13.md
- README.md

## Change Log

| Date       | Author | Change                                                      |
| ---------- | ------ | ----------------------------------------------------------- |
| 2026-03-27 | Amelia | Replaced vendor-specific draft with env/GitHub secret docs. |
