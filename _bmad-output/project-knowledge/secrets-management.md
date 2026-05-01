# Secrets management

Updated: 2026-03-27 - replaced third-party secret-manager plan with the existing `.env` and GitHub/provider secret workflow.

## Decision

- No standalone secret manager is required for CoutureCast.
- Local development uses gitignored `.env` files such as `.env`, `.env.local`, `.env.preview`, and `.env.prod`.
- CI uses GitHub Actions secrets.
- Hosted environments use provider-native secret stores such as Vercel, Expo EAS, Supabase, Upstash, and other service dashboards.
- `.env.example` remains the canonical list of required variable names without real values.

## Environment workflow

### Local

- Keep populated `.env*` files out of version control.
- Use `.env.example` to bootstrap required keys.
- Prefer `.env.local` for machine-specific overrides.

### CI

- Store CI-only values in GitHub Actions repository or environment secrets.
- Scope production secrets to protected environments.
- Rotate tokens when access changes or a leak is suspected.

### Hosted

- Store runtime secrets in the platform that consumes them.
- Avoid duplicating secrets across systems unless a deployment target requires it.
- Keep least-privilege keys for each runtime surface.
- For the guardian invitation flow, use `_bmad-output/project-knowledge/guardian-invitation-env-setup.md`
  as the system-specific runbook for local, Vercel, and CI placement.

## Rotation policy

- Quarterly: `DATABASE_URL`, `JWT_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, Redis tokens, deployment tokens.
- Annual: low-risk third-party API keys if they have not already been rotated.
- Immediate: any suspected compromise, offboarding event, or accidental exposure.

## Rotation procedure

1. Generate the replacement secret.
2. Update the relevant GitHub or provider-native secret store.
3. Redeploy or restart the affected environment.
4. Validate the application with the new value.
5. Revoke the old secret after verification.

## Leak prevention

- `gitleaks` is required in local workflows and CI.
- Never commit populated `.env*` files.
- Never store production credentials in screenshots, markdown examples, or tickets.
- Use neutral placeholders in project docs.

## Least-privilege guidance

- Use read-only keys where a client or read path does not need write access.
- Keep server-side elevated keys scoped to the narrowest runtime that needs them.
- Separate local, non-production, and production credentials.
