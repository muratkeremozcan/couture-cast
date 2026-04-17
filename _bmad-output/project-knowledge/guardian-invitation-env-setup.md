# Guardian invitation environment setup

Updated: 2026-04-17 - documented the env and secret placement for Story 0.11 Task 3.

## Purpose

The guardian invitation flow needs two runtime variables:

- `GUARDIAN_INVITE_WEB_BASE_URL`
  - Not a secret.
  - The public web origin used to build links like `/guardian/accept?token=...`.
- `GUARDIAN_INVITE_JWT_SECRET`
  - Secret.
  - Used only by the API to sign and verify 7-day guardian invitation tokens.

The API reads them in this order:

1. `GUARDIAN_INVITE_WEB_BASE_URL`
2. `NEXT_PUBLIC_APP_URL`
3. `APP_URL`
4. fallback `http://localhost:3000`

and:

1. `GUARDIAN_INVITE_JWT_SECRET`
2. `JWT_SECRET`
3. a development-only fallback secret outside production

## Local files on this machine

These local gitignored files were updated:

- `.env.local`
- `.env.dev`
- `.env.prod`

What was added:

- `GUARDIAN_INVITE_WEB_BASE_URL=http://localhost:3000`
- a unique `GUARDIAN_INVITE_JWT_SECRET` in each file

Why they all use `http://localhost:3000`:

- these files are local machine env files, not the deployed runtime itself
- when you run the API from your machine, the safest default is for invite links to land on the local
  Next.js app
- deployed environments must override the base URL to a real hosted web origin

What was intentionally not changed:

- `packages/db/.env`

Reason:

- Prisma only needs `DATABASE_URL` there
- the guardian invitation variables are API runtime settings, not database settings

## Exact hosted placement

### Vercel API project

Add both variables to the Vercel project that runs the Nest API:

- project: `couture-cast-api`
- environments: `Preview` and `Production`

Add:

- `GUARDIAN_INVITE_JWT_SECRET`
  - secret
  - required in both Preview and Production
- `GUARDIAN_INVITE_WEB_BASE_URL`
  - plain environment variable
  - required in both Preview and Production

Production value:

- set `GUARDIAN_INVITE_WEB_BASE_URL` to your real production web origin
- if you are using the default Vercel production domain for the web project, that is likely
  `https://couture-cast-web.vercel.app`
- if you have a custom domain, use the custom domain instead

Preview value:

- if your preview API should send guardians to a stable preview web hostname, set
  `GUARDIAN_INVITE_WEB_BASE_URL` to that stable preview alias or custom preview domain
- if you do not have a stable preview web hostname, do not rely on one static Preview value for
  invite links because Vercel preview URLs are deployment-specific
- in that case, either:
  - use the production web origin for preview invitations, or
  - add preview-domain handling later in code or deployment automation

### Vercel web project

You do not need to add a new secret to the Vercel web project for this feature today.

- project: `couture-cast-web`
- required additions: none

Reason:

- the API builds and signs the invitation link
- the web app only receives the token from the URL and posts it back to the API

Optional only if you want shared origin metadata across projects:

- `NEXT_PUBLIC_APP_URL`
- `APP_URL`

These are fallback inputs in the API code, but they are not required if
`GUARDIAN_INVITE_WEB_BASE_URL` is set correctly on the API project.

### GitHub Actions

You do not need to add a new GitHub Actions secret for the current workflows.

Required additions right now:

- none

Reason:

- current workflows in `.github/workflows` reference `DATABASE_URL_*`, `VERCEL_TOKEN`,
  `VERCEL_AUTOMATION_BYPASS_SECRET`, and related deployment/test variables
- none of the current CI jobs boot the deployed API in a way that requires
  `GUARDIAN_INVITE_JWT_SECRET`
- the guardian tests added in Story 0.11 Task 3 set test env values inline inside the test process

If you later add a workflow that deploys or smoke-tests the guardian invitation flow against a
runtime that reads env vars, add the secret to the runner or environment that actually starts the
API process, not to GitHub by default.

### Supabase

Required additions:

- none

Reason:

- guardian invitation signing is not a Supabase secret
- Supabase still only needs its existing auth/database credentials for this feature

### Upstash Redis

Required additions:

- none

Reason:

- the guardian invitation flow does not use Redis for token storage or verification

### Expo EAS / mobile delivery

Required additions:

- none

Reason:

- the mobile app only calls the API accept endpoint
- it does not sign invitation tokens and does not need the API secret

## Recommended values summary

Local machine:

```env
GUARDIAN_INVITE_WEB_BASE_URL=http://localhost:3000
GUARDIAN_INVITE_JWT_SECRET=<local-random-secret>
```

Vercel API Preview:

```env
GUARDIAN_INVITE_WEB_BASE_URL=https://<stable-preview-web-origin>
GUARDIAN_INVITE_JWT_SECRET=<preview-random-secret>
```

Vercel API Production:

```env
GUARDIAN_INVITE_WEB_BASE_URL=https://<production-web-origin>
GUARDIAN_INVITE_JWT_SECRET=<production-random-secret>
```

## Rotation guidance

Rotate `GUARDIAN_INVITE_JWT_SECRET` when:

- a secret leaks
- team access changes
- you intentionally invalidate outstanding invitation links

Rotation effect:

- all still-pending invitation links signed with the old secret will stop validating
- send replacement invitations after rotation if there are outstanding pending invites
