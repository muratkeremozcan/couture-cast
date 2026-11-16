# CC-6.17 Google sign-in: test design

Updated: 2026-11-15 (draft 2, reconciled to the frozen Intent and Decisions D1 to D11)

Owner: tea617. The story spec `_bmad-output/implementation-artifacts/spec-6-17-google-sign-in.md`
wins on any disagreement. TEA findings against the frozen spec are listed under "TEA rulings" and
go to the spec's Plan Change Log.

## Code facts the plan relies on

- App identity is an email lookup.
  `AccessTokenIdentityService.resolveVerifiedIdentity`
  (`apps/api/src/modules/auth/access-token-identity.service.ts`) calls Supabase `/auth/v1/user`,
  requires verified-email evidence (`email_verified === true`, `email_confirmed_at` or
  `confirmed_at`), then finds exactly one `User` row by case-insensitive email.
  Zero or two rows give 401.
  The role comes from `UserProfile.birthdate` only: under 13 or no birthdate gives 401, 13 to 17
  gives `teen`, 18 and up gives `guardian`.
  `app_metadata.app_user_id` plus `app_role` is a trusted shortcut; `user_metadata` is never read.
- Signup is unauthenticated: `POST /api/v1/auth/signup` (`auth.service.ts`) takes email and
  birthdate in the body, runs `evaluateAgeGate`, creates `User`, `UserProfile` (birthdate,
  `compliance.accountStatus` `active` or `pending_guardian_consent`) and an empty comfort profile
  under `pg_advisory_xact_lock(hashtext('user_email:' || lower(email)))`, and fires
  `profile_completed` with `userId`, `age` and `guardianConsentRequired`.
- Guardian accept (`guardian.service.ts` `acceptInvitation`) creates a guardian `User` with email
  only, no profile, so a guardian-only row cannot resolve a role today.
  `POST /api/v1/guardian/revoke` requires role `guardian` or `admin`, which needs a birthdate of 18
  or more once a profile exists.
- Web client (`apps/web/src/lib/web-session.ts`): no `flowType` today (implicit),
  `detectSessionInUrl: true`, storage key `couturecast.auth-session`; sign-out removes the key and
  `-code-verifier`; `verifySession` treats 401, 403 and 404 from `GET /api/v1/user/profile` as
  denied.
- Mobile client (`apps/mobile/src/lib/native-session.ts`): `detectSessionInUrl: false`, chunked
  SecureStore adapter, `processLock`; `expo-web-browser` and `expo-linking` installed.
  `app.json` scheme `mobile`; isolated builds `couturecast-story65` and `couturecast-story68`
  (`app.config.ts`, `STORY65_NATIVE_TEST_BUILD`, `STORY68_NATIVE_TEST_BUILD`).
  `app/+native-intent.tsx` passes every unknown link to the router, which lands on `+not-found`.
- Analytics (`packages/api-client/src/analytics-privacy.ts`): URL properties reduce to a known
  route template; query and fragment are dropped; unknown paths become `/:unknown`; app links keep
  scheme and template; `$set` and `$set_once` never leave.
- API log redaction (`apps/api/src/logger/pino.config.ts` `SENSITIVE_LOG_PATHS`) covers
  `authorization` and `token` keys; it has no `email`, `birthdate` or `code` entry.
- Supabase local (`supabase/config.toml`): no `[auth.external.google]`; `site_url`
  `http://127.0.0.1:3000`; GoTrue `v2.183.0`.
  Checked in the binary: GoTrue ignores the URL override for Google ("Google OAuth provider has URL
  config set which is ignored"); the Keycloak provider honours one.
- `apps/api/src/modules/commerce/operator-actor.ts` already reads `auth.users` through Prisma, so
  the API database role can see the auth schema.
- Playwright: `playwright/config/real-session.config.ts` (isolated database, Auth proxy, API 4077,
  real-auth web 3077, lifecycle in `scripts/e2e-real-session/`) runs with trace, video, screenshot
  and HTML report off. `base.config.ts` keeps trace and video on failure.
- Playwright runs only with an isolated `DATABASE_URL` and `PLAYWRIGHT_SKIP_DB_RESET=true`.
  macOS jobs never run on PRs; iOS Maestro runs nightly and on dispatch.

## Risk register

Probability (P) and impact (I) are 1 to 3; score is P x I. High is 6 or more.

| ID  | Risk                                                                                    | P   | I   | Score | Mitigating scenarios               |
| --- | --------------------------------------------------------------------------------------- | --- | --- | ----- | ---------------------------------- |
| R1  | Existing address gets a second account, a birthdate prompt, or a changed profile        | 3   | 3   | 9     | A-FED-409, L-E-THEN-GOOGLE, E-LINK |
| R2  | Under-13 Google data survives a refusal, or a child reaches a member surface            | 3   | 3   | 9     | A-FED-UNDER13, L-C-\*, E-UNDER13   |
| R3  | 13 to 15 skip `pending_guardian_consent` or its restrictions; role from Google claims   | 2   | 3   | 6     | A-FED-TEEN, A-ROLE-CLAIMS, E-TEEN  |
| R4  | Completion trusts the body, double-creates, or races cancel into an orphan              | 2   | 3   | 6     | A-FED-BODY, L-FINISH-\*, L-CANCEL  |
| R5  | Session without an account dead-ends, loops, or shows a member surface                  | 3   | 2   | 6     | W-RESUME, M-RESUME, L-NO-LOOP      |
| R6  | Shared device reuses the last Google account; a switch leaks the prior member's state   | 3   | 3   | 9     | U-START-PARAMS, L-SWITCH-\*        |
| R7  | Guest conversion through Google loses `from=preview` or crosses identities              | 2   | 3   | 6     | L-G-\*, E-CONV-GOOGLE              |
| R8  | Code, token, email or birthdate in a URL, log, artifact, referrer or analytics event    | 2   | 3   | 6     | T-\*, U-CALLBACK-CLEAN             |
| R9  | Redirect allowlist too wide, wrong origin, `mobile://` allowed, Keycloak live on a host | 2   | 3   | 6     | H-\*                               |
| R10 | Native callback double-handled, lost on cold start, or routed to `+not-found`           | 3   | 2   | 6     | U-INTENT-\*, M-CALLBACK-\*         |
| R11 | Pre-registered row owner inherits a typed birthdate (out of scope, D4)                  | 2   | 2   | 4     | A-PREREG-PINNED                    |
| R12 | Unverified or ambiguous address resolves to a row                                       | 1   | 3   | 3     | A-FED-UNVERIFIED, A-FED-AMBIGUOUS  |
| R13 | Guardian-only row: locked out, second row, or turned into a teen guardian               | 2   | 3   | 6     | A-FED-GUARDIAN-\*                  |
| R14 | Cancel, consent denied, provider error, outage, replay: wrong outcome or raw error text | 3   | 2   | 6     | W-FAIL-\*, M-FAIL-\*, A-FED-REPLAY |
| R15 | Hosted provider, client or callback misconfigured on dev or prod                        | 2   | 3   | 6     | H-\*, X-OWNER-RUN                  |
| R16 | Email OTP, email signup, guardian accept, E2E bypass tokens or open sessions regress    | 2   | 3   | 6     | G-\*                               |
| R17 | Telemetry drift: new properties, a second `profile_completed`, identity merge           | 2   | 2   | 4     | T-PROFILE-COMPLETED, T-NO-NEW      |
| R18 | Button off-brand, unlabeled, clipped in long locales, under 44 points                   | 2   | 1   | 2     | W-A11Y-\*, M-A11Y-\*               |
| R19 | The E2E provider seam (D10) works in a release or hosted build                          | 2   | 3   | 6     | U-SEAM-\*, H-SETTINGS              |
| R20 | Abandoned finish steps keep Google name, photo and email in Supabase with no end date   | 3   | 2   | 6     | TEA-4                              |

R1, R2 and R6 score 9. Each stays open until its ordered pairs are built and their seeded defects
are proved red.

## Stand-in for Google (D10)

- Mock OIDC server owned by the harness at `scripts/e2e-real-session/mock-oidc.mjs`: Keycloak
  endpoint shape (`/protocol/openid-connect/auth`, `/token`, `/userinfo`, `/certs`), identities
  chosen per test through a one-time login ticket so parallel workers never share one, claims
  `sub`, `email`, `email_verified`, `name`, `picture`.
  It records every request so tests can assert the authorize query.
- Local Supabase enables `[auth.external.keycloak]` with its `url` pointed at the mock; hosted
  projects never enable it (H-SETTINGS).
- Web: a Playwright route rewrites `provider=google` to `provider=keycloak` on the authorize
  request and records the original query first, so `prompt=select_account`, `redirect_to` and
  `code_challenge_method=s256` are asserted as the app sent them.
- Mobile: `EXPO_PUBLIC_E2E_OAUTH_PROVIDER=keycloak` only under `__DEV__` and an isolated story
  build (U-SEAM-\*).
- Spike S0 (done 2026-11-15, `_bmad-output/test-artifacts/story-6-17/spike-s0-oidc-stand-in.md`): the mock serves GoTrue's Keycloak calls from
  inside Docker on macOS and Linux CI, `email_verified: true` produces a confirmed auth user, and a
  Keycloak identity auto-links to an existing email-OTP auth user with the same address.
  If auto-linking differs from Google's (Google is a trusted provider in GoTrue), E-LINK is
  carried by the owner run and the gap is written here.

## Scenario catalog

Levels: A API (Vitest unit plus Nest integration against the isolated database with an Auth
double), U pure unit (`packages/*`, web lib, mobile lib), W web (Vitest component plus
Playwright), M mobile (Jest plus Maestro), E real local stack with the stand-in, H hosted
configuration probe, T telemetry and logs, L ordered lifecycle pairs, G member regression, X
manual evidence. Assertions are exact: status and body, locale catalog text, serialized keys, row
counts.

Subjects: email member E (active adult), Google-new adult N, Google-new teen T (born 14 years
ago), Google-new child C (12 years 364 days), guardian-only row Gd, guest G with a 6.16 proposal,
second family member F.

### P0: federated endpoints (R1 to R4, R12, R13)

- A-FED-GET-STATUS: `GET /api/v1/auth/signup/federated` answers `{ status: 'needs_birthdate' }`
  for no row and for a row without a profile, `{ status: 'complete' }` for one row with a profile,
  401 for unverified, ambiguous, missing and expired bearers. No other key in any body.
- A-FED-CREATE-ADULT: N with a birthdate 18 years ago today: 201, body equals
  `signupResponseSchema` with `accountStatus: 'active'`, `guardianConsentRequired: false`; one
  `User` row with the verified address as Supabase returns it, one `UserProfile` with that
  birthdate and `compliance` equal to email signup's, one empty comfort profile.
- A-FED-TEEN: T: `pending_guardian_consent`, `guardianConsentRequired: true`; the next
  `GET /api/v1/user/profile` with the same bearer answers 200 with role `teen`; the guardian
  invitation endpoint accepts the returned `userId`.
- A-FED-BOUNDARY: 13 on the birthday passes, 12 years 364 days refused, 15 and 16 split guardian
  consent exactly as `evaluateAgeGate`, 29 February in a non-leap year, invalid `2010-02-30`,
  future date and empty body answer 400 with the `parseBirthdateInput` message and create nothing.
- A-FED-UNDER13: C: 403 with `AGE_GATE_MESSAGES.underage`; the Auth Admin double received exactly
  one `DELETE /auth/v1/admin/users/<id>` where `<id>` is the bearer identity's `id`; zero app rows
  for the address; the birthdate is in no row and no log line.
- A-FED-UNDER13-DELETE-FAILS: Admin deletion answers 500: the response is still 403, the failure
  is logged without the address, and the abandoned-user sweep (TEA-4) deletes it later.
- A-FED-BODY: a body carrying `email`, `userId`, `role` or `accountStatus` is rejected by the
  strict schema (400) and creates nothing; the address used is always the bearer's.
- A-FED-UNVERIFIED: an identity with `email_verified: false` and no confirmed timestamps answers
  401 on `GET`, `POST` and `DELETE`, and nothing is created or deleted.
- A-FED-AMBIGUOUS: two rows matching case-insensitively: 401 on all three verbs; no row changes.
- A-FED-409: a row with a profile exists: `POST` answers 409, the profile and its `updated_at` are
  byte-identical afterwards, no comfort row is added, no `profile_completed` fires.
- A-FED-CASE: Google `A@X.com`, row `a@x.com`: same row (`GET` complete, `POST` 409).
- A-FED-GUARDIAN-ATTACH: Gd with an adult birthdate: 201, the existing `User.id` gains a profile,
  compliance and comfort defaults; still one row; the `GuardianConsent` rows are unchanged; the
  next profile check answers role `guardian`.
- A-FED-GUARDIAN-MINOR: Gd holding a granted consent with a birthdate under 18: outcome per TEA-2.
- A-SWEEP-ELIGIBLE: auth users at 23 h 59 m and at 24 h 1 m with no app account: only the second
  is deleted; one with an app account at any age is kept; a case-variant match is kept; one whose
  `app_metadata` has `app_user_id` or `app_role` or `role` is kept; one with no address is kept.
- A-SWEEP-PAGES: every page is read in order; candidates are collected across all pages before
  any deletion (deleting while paging shifts pages); a failed deletion is counted and logged
  without the address and the sweep continues; a `listUsers` failure on any page rejects with no
  deletion.
- A-SWEEP-LOCK: the sweep takes the address lock and re-checks for an account inside it; a finish
  holding the lock wins (TEA-10).
- A-SWEEP-SCHEDULE: `maintenance.scheduler.ts` registers `orphan-auth-user-sweep` with pattern
  `0 4 * * *` in UTC, once (idempotent upsert), only in the worker runtime.
- A-FED-DELETE: `DELETE` with no row for the address deletes the auth user (one Admin call, id
  from the bearer); with a row present it makes no Admin call and changes no row; 204 both times.
- A-FED-REPLAY: the same `POST` repeated after success answers 409 and creates nothing.
- A-FED-CONTRACT: OpenAPI publishes the three operations with bearer security; the strict input
  schema is `{ birthdate: string }`; the generated client and Pact match; `POST /signup` is
  byte-identical to main.
- A-SHARED-CREATION: email signup and federated signup produce identical `UserProfile.preferences`,
  comfort defaults and `profile_completed` properties for the same birthdate (one fixture, both
  paths).
- A-ROLE-CLAIMS: an identity whose `user_metadata` says `role: 'guardian'`, `birthdate`, `age` or
  `app_role`: role still comes from the stored birthdate.
- A-PREREG-PINNED: a row made by unauthenticated email signup, then Google with that address:
  signed in to that row with its stored birthdate (pins the D4 out-of-scope behavior so a change
  is visible).
- A-NO-GOOGLE-FIELDS: after A-FED-CREATE-ADULT, no app table holds the identity's `name`,
  `picture`, `sub` or any token (column scan of every table touched).

### P0: ordered lifecycle pairs (R1, R2, R4 to R7, R13)

Each pair runs in both orders where both are reachable; races are forced with a held promise in
the Auth or route double, no sleeps.

- L-E-THEN-GOOGLE: E signs in with Google: same `User.id`, profile byte-identical, no finish step,
  no `POST`; then E signs in by email code: same row.
- L-N-THEN-OTP: N finishes, signs out, signs in by email code: same row.
- L-FINISH-PARALLEL: two `POST` for N held at the lock: one 201, one 409; one row, one profile,
  one `profile_completed`.
- L-FINISH-VS-EMAIL-SIGNUP: federated `POST` and unauthenticated email signup for the same address,
  both orders: one row; the loser gets 409 or "Email already registered".
- L-CANCEL-VS-FINISH: `DELETE` and `POST` for N, both orders (TEA-1): either the account exists and
  the auth user survives, or neither exists. Never an app row whose only auth user was deleted.
- L-C-REFUSED-THEN-RETRY: C refused; the same Google account starts again: a new auth user id, the
  finish step, no trace of the first attempt; a second refusal deletes again.
- L-C-REFUSED-THEN-ADULT: C refused, then claims an adult birthdate on the next start: accepted as
  email signup would (self-reported age; pins parity, no new block).
- L-NO-LOOP: `GET` says `complete` but the profile check keeps answering 401 (TEA-3): one
  re-verify, then the refusal message and a local sign-out; at most two profile checks.
- L-SWITCH-MEMBER-TO-GOOGLE: E signed in taps Google and picks F: E is signed out before the
  authorize request; F's screens hold none of E's ritual cache, widget payload, share-card source
  or wardrobe rows.
- L-SWITCH-HELD-CHECK: E's profile check held, F's exchange completes, E's check resolves: E is
  never shown and F is verified.
- L-SIGNOUT-THEN-GOOGLE: E signs out; the next Google start carries `prompt=select_account`; the
  code verifier from the earlier attempt is gone.
- L-G-EXISTING: G with an intent signs in with Google as E: the review, with E's values.
- L-G-NEW: G with an intent continues as N: finish step, then the review; no comfort request
  before the 201.
- L-G-PICKER-MISMATCH: G expects E, picks F: F's review only, never E's values.
- L-G-UNDER13: G continues as C: refused; guest state and the intent are deleted.
- L-G-PLAIN-SIGNIN: G has state and signs in with Google without `from=preview`: guest state
  deleted, no review.
- L-G-FOCUS: the preview screen stays mounted under the Google flow; a session change while it is
  unfocused does not navigate (6.16 stacked-screen rule).

### P0: callbacks and redirects (R8, R10, R14)

- U-START-PARAMS (web and mobile): `signInWithOAuth` is called with `provider: 'google'`,
  `queryParams.prompt: 'select_account'`, `redirectTo` exactly `${origin}/auth/callback` or the
  app-scheme callback, plus `?from=preview` only when the door had the literal; nothing else.
- U-PKCE-CONFIG: both clients construct Supabase with `flowType: 'pkce'`; web with
  `detectSessionInUrl: false`.
- U-CALLBACK-CLEAN: the web callback calls `history.replaceState` removing `code`, `error`,
  `error_description` and `state` before analytics initializes (call-order spy); `from=preview`
  survives.
- U-CALLBACK-ROUTES: member to the D6 destination; `needs_birthdate` to `/signup/finish` carrying
  `from`; `error` to the door with the one fixed localized message; a missing `code` to the door.
- W-FAIL-NO-RAW-ERROR: `error_description=<img src=x onerror=alert(1)>` and a long free-text value
  render the fixed message only; the DOM contains neither value.
- W-FAIL-CANCEL, W-FAIL-OUTAGE, W-FAIL-REPLAY: chooser cancel shows "Sign-in cancelled"; an
  authorize 5xx and a disabled provider show the unavailable message; a used `code` shows the
  unavailable message and no session change. Email sign-in is usable after each.
- W-FAIL-UNVERIFIED and M-FAIL-UNVERIFIED: a callback with `error=access_denied` and
  `error_code=provider_email_needs_verification` shows the refusal copy, never "Sign-in
  cancelled" (TEA-11); plain `access_denied` stays cancelled.
- U-CALLBACK-HASH: the cleaned URL carries no fragment; GoTrue repeats the error fields there
  (TEA-12).
- W-FAIL-SLOW-API: the profile check times out after the exchange: the session is kept, the retry
  state shows, the finish step does not.
- U-INTENT-CALLBACK: `redirectSystemPath` returns `''` for `couturecast://auth/callback?code=x`
  while an in-process start is waiting and `/auth/callback?...` otherwise; other links unchanged;
  the `mobile://` alias routes as today.
- M-CALLBACK-ONCE: in-process result then Linking delivery, and Linking then in-process, for the
  same code: one `exchangeCodeForSession` call.
- M-CALLBACK-COLD: cold start through the callback link with the verifier in SecureStore: one
  exchange, routed as U-CALLBACK-ROUTES.
- M-FAIL-\*: the native counterparts of W-FAIL-CANCEL (`dismiss` and `cancel` results), OUTAGE,
  REPLAY and SLOW-API.
- W-RESUME and M-RESUME: a session with no account on reload or relaunch opens the finish step;
  every member route redirects to it; sign-out works from it.

### P0: telemetry, logs and artifacts (R8, R17)

- T-CALLBACK-URL: the serialized `$pageview` and `$exception` bodies captured on `/auth/callback`
  contain no `code=`, `error_description`, `access_token` or address (web route intercept).
- T-REFERRER: requests leaving the callback page carry no `code` in `Referer`.
- T-PROFILE-COMPLETED: one `profile_completed` per federated creation with exactly the email
  signup keys; none on 409, 403, cancel or guardian attach beyond the one creation.
- T-NO-NEW: no new event name and no property naming the sign-in method on either client.
- T-API-LOGS: pino output captured during every A-FED scenario contains no bearer, service role
  key, address or birthdate (TEA-8).
- T-ARTIFACTS: the E lane runs with trace, video, screenshot and HTML report off; the uploaded
  artifact set contains no file with `code=`, `access_token` or a synthetic address.

### P0: stand-in seam and hosted configuration (R9, R15, R19)

- U-SEAM-WEB: the web bundle contains no provider name other than `google`.
- U-SEAM-NATIVE: `EXPO_PUBLIC_E2E_OAUTH_PROVIDER=keycloak` is honored only with `__DEV__` and an
  isolated story build; with either false, Google start refuses and the provider stays `google`.
- U-SEAM-BUNDLE: the release bundle scan fails a bundle containing `EXPO_PUBLIC_E2E_OAUTH_PROVIDER`
  (seeded bundle proves it red).
- H-SETTINGS: `GET /auth/v1/settings` on `couturecast-dev` and `couturecast-prod`: `external.google`
  true, `external.keycloak` false, email still true, and `mailer_autoconfirm` false (with it on, an unverified Google address would sign in to an existing account; spike S0).
- H-AUTHORIZE: `GET /auth/v1/authorize?provider=google&redirect_to=<prod callback>` answers 302
  to `accounts.google.com` with the expected `client_id` and `redirect_uri` equal to the project's
  `/auth/v1/callback`; no login is attempted.
- H-ALLOWLIST: the Management API redirect allowlist equals the D5 list exactly on both projects
  (TEA-6); `mobile://` and `*.vercel.app` wildcards absent.
- H-SECRETS: no Google client secret in git history of the branch, in a web build or in a native
  bundle (gitleaks plus a string scan for the secret's prefix).
- X-OWNER-RUN: real Google on the preview deployment and a dev build, recorded under
  `_bmad-output/test-artifacts/story-6-17/`.

### P0: real local stack (E)

- E-NEW-ADULT, E-TEEN, E-UNDER13: the full web journey through the stand-in, GoTrue, the callback,
  the finish step and the API; DB reads confirm rows; for C the `auth.users` and
  `auth.identities` rows for the address are gone.
- E-LINK: an email-OTP member (code from local Mailpit) then the stand-in with the same address:
  one `auth.users` row with two identities, one app row.
- E-CANCEL and E-RESUME: cancel deletes the auth user; a closed tab resumes at the finish step.
- E-CONV-GOOGLE: a 6.16 guest proposal through the stand-in for a new address: finish step,
  review, accepted carryover read back from the comfort row.

### P1: accessibility and copy (R18)

- W-A11Y-AXE: axe clean on both doors, the callback states and the finish step in all ten locales.
- W-A11Y-KEYBOARD, W-A11Y-FOCUS: Google button reachable in order; focus on the birthdate field on
  the finish step; errors announced.
- W-A11Y-LAYOUT: 44 px targets, no clipping at 320 px and 200 percent zoom in de-DE, fr-FR, pt-PT.
- M-A11Y-MAESTRO: TalkBack (PR lane) and VoiceOver (nightly) labels and order on both doors and
  the finish step.
- W-BRAND and M-BRAND: the official "G" mark asset, label "Continue with Google" from each locale
  catalog, neutral button colors.
- U-STRINGS: every new key exists in all ten catalogs on both clients with identical key sets.

### Member regression (R16)

- G-OTP: email signup, email OTP sign-in, guardian acceptance and the 6.16 email conversion suites
  run unfiltered on the story head.
- G-BYPASS: the E2E bypass tokens (`test-token*`, k6, mobile fixtures) still resolve as today.
- G-OPEN-SESSION: a session stored before the PKCE switch restores after it (implicit-flow session
  in storage, then the new client).
- G-SCHEME: `mobile://` links and `couturecast://guardian-accept` open the same screens as today.

## TEA rulings on the frozen spec

- TEA-1: `DELETE` and `POST /auth/signup/federated` take the same advisory lock on the lowercased
  verified address, and `DELETE` re-checks for a row inside it. Without this, cancel in one tab and
  finish in another can delete the only auth user of a new account (L-CANCEL-VS-FINISH).
- TEA-2 (accepted by the builder): a guardian-only row holding a granted consent as guardian
  requires a birthdate of 18 or more; under 18 answers 403 and attaches nothing. Otherwise the
  guardian would become role `teen` and lose `POST /guardian/revoke` (A-FED-GUARDIAN-MINOR).
- TEA-3: after `GET` answers `complete`, the client re-verifies once. A second 401 shows the
  refusal and signs out locally; no loop (L-NO-LOOP).
- TEA-4 (accepted with amendments): a daily BullMQ Job Scheduler job `orphan-auth-user-sweep`
  (04:00 UTC, `apps/api/src/workers/maintenance.scheduler.ts`, logic in
  `orphan-auth-user-sweep.ts` `sweepOrphanAuthUsers(deps, now)`) deletes auth users created more
  than 24 hours ago whose verified address matches no app account case-insensitively, and skips
  any auth user whose `app_metadata` carries `app_user_id` or a role. It runs only where the worker
  runs. It also retries failed refusal deletions (A-FED-UNDER13-DELETE-FAILS, A-SWEEP-\*).
- TEA-5 (decided): the `exp://**` form is allowlisted on local `config.toml` and
  `couturecast-dev` only, never on prod; the button stays visible in Expo Go. H-ALLOWLIST pins
  `exp://` absent on prod.
- TEA-6: the `couturecast-dev` preview wildcard is scoped to this team's preview host pattern; a
  bare `https://*.vercel.app/**` would let any Vercel app receive codes. H-ALLOWLIST asserts the
  exact list.
- TEA-7: the app never branches on `app_metadata.provider` or the identity's provider name; the E
  lane proves it by passing with Keycloak identities, and a source grep pins it.
- TEA-8: `SENSITIVE_LOG_PATHS` gains `email`, `birthdate`, `code` and `serviceRoleKey` shapes, or
  the federated code never logs them; T-API-LOGS asserts the captured output either way.
- TEA-10: the orphan sweep takes the same address lock per auth user and re-checks for an account
  before `deleteUser`, so a person finishing at 04:00 UTC keeps the auth user of the account they
  just made (A-SWEEP-LOCK).
- TEA-11: GoTrue refuses an unverified provider address with `error=access_denied` plus
  `error_code=provider_email_needs_verification`; both clients map it to the refusal outcome.
- TEA-12: URL cleaning removes the fragment too.
- TEA-13: local `config.toml` enables the Keycloak provider against the lane's mock container
  `couturecast-mock-oidc` and allowlists the real-session web callback on port 3077; hosted
  projects keep it off (H-SETTINGS).
- TEA-14: the orphan sweep runs only with `ORPHAN_AUTH_USER_SWEEP_ENABLED=true` (hosted prod worker
  only, refused under `TEST_ENV` local or preview) and deletes a candidate only when its id is in
  `auth.users` of the database the app reads; a missing `auth.users` table deletes nothing. Without
  it, an E2E worker booted with the local service role key and an isolated database would delete
  every local Auth user (`A-SWEEP-PAIRING`).
- TEA-15: the `couturecast-dev` allowlist drops four pre-6.17 hosts (`dev.couturecast.app`,
  `dev-api.couturecast.app`, `app.couturecast.com`, `api.couturecast.com`): `couturecast.app` has
  no name servers and the `.com` holder is unproven, so either could receive dev sign-in
  redirects. H-SETTINGS and H-AUTHORIZE run through `scripts/ci/supabase-auth-config-probe.mjs`;
  H-ALLOWLIST evidence is `_bmad-output/test-artifacts/story-6-17/hosted-auth-config.md`.
- TEA-9: H-\* probes need only the anon key, except H-ALLOWLIST, which needs a Management API
  token; without one in CI it runs locally and its output is evidence.
- No disagreement with D1 to D11 beyond these.

## Seeded-defect proofs

Each runs in a throwaway worktree, is recorded under `_bmad-output/test-artifacts/story-6-17/`, and
must turn the named scenario red.

| ID   | Seeded defect                                                      | Must fail                        |
| ---- | ------------------------------------------------------------------ | -------------------------------- |
| S-1  | Federated `POST` creates a second row for an existing address      | A-FED-409, L-E-THEN-GOOGLE       |
| S-2  | Under-13 refusal skips the Auth Admin deletion                     | A-FED-UNDER13, E-UNDER13         |
| S-3  | Address taken from the request body                                | A-FED-BODY                       |
| S-4  | Role read from `user_metadata`                                     | A-ROLE-CLAIMS                    |
| S-5  | `prompt=select_account` dropped                                    | U-START-PARAMS                   |
| S-6  | Callback leaves `code` in the URL when analytics initializes       | U-CALLBACK-CLEAN, T-CALLBACK-URL |
| S-7  | `error_description` rendered                                       | W-FAIL-NO-RAW-ERROR              |
| S-8  | `from=preview` dropped from `redirectTo`                           | U-START-PARAMS, L-G-EXISTING     |
| S-9  | `DELETE` outside the advisory lock                                 | L-CANCEL-VS-FINISH               |
| S-10 | Unverified address accepted                                        | A-FED-UNVERIFIED                 |
| S-11 | Guardian-only row gets a second row instead of an attached profile | A-FED-GUARDIAN-ATTACH            |
| S-12 | Native callback exchanged twice                                    | M-CALLBACK-ONCE                  |
| S-13 | `+native-intent` passes the callback through while a start waits   | U-INTENT-CALLBACK                |
| S-14 | Keycloak seam honored outside `__DEV__`                            | U-SEAM-NATIVE                    |
| S-15 | `flowType` left implicit on web                                    | U-PKCE-CONFIG                    |
| S-16 | Switch to Google without signing out the previous member           | L-SWITCH-MEMBER-TO-GOOGLE        |
| S-17 | `GET` complete loops on 401                                        | L-NO-LOOP                        |
| S-18 | Second `profile_completed` on guardian attach or 409               | T-PROFILE-COMPLETED              |
| S-19 | Birthdate logged on refusal                                        | T-API-LOGS                       |
| S-20 | Guest state kept after a plain Google sign-in                      | L-G-PLAIN-SIGNIN                 |

## Red-first order for the build

1. Spike S0 and the mock OIDC server (TEA).
2. Contract and API: A-FED-CONTRACT, A-SHARED-CREATION, then A-FED-\*, A-ROLE-CLAIMS,
   A-PREREG-PINNED, A-NO-GOOGLE-FIELDS, L-FINISH-\*, L-CANCEL-VS-FINISH, T-API-LOGS red.
3. Web session: U-PKCE-CONFIG, U-START-PARAMS, U-CALLBACK-CLEAN, U-CALLBACK-ROUTES, G-OPEN-SESSION
   red; then the callback page, finish step and doors with W-FAIL-\*, W-RESUME, L-NO-LOOP,
   L-SWITCH-\*.
4. Mobile: U-INTENT-CALLBACK, U-SEAM-\*, M-CALLBACK-\*, M-FAIL-\*, M-RESUME red; then the screens.
5. Conversion: L-G-\* on both clients.
6. Telemetry: T-\* against serialized payloads.
7. Accessibility, brand and strings.
8. E lane, then G-\* unfiltered, then H-\* after external setup.
9. Seeded defects S-1 to S-20, learning path Step 57, evidence, X-OWNER-RUN.

## What the tests can and cannot prove

- Age is self-reported; the tests prove the gate, the deletion and the storage rules, never age.
- The stand-in proves GoTrue's OAuth machinery, PKCE, our callback, the finish step, linking by
  verified address and the conversion. Google's consent screen, Google's account chooser and the
  real client registration are proved only by H-AUTHORIZE and X-OWNER-RUN.
- iOS Maestro, VoiceOver and the ASWebAuthenticationSession consent alert run nightly and on
  dispatch; PRs carry unit, component, web, E lane and Android proofs.
