---
title: 'CC-6.17 Google sign-in'
type: 'feature'
ticket: '6-17-google-sign-in'
created: '2026-11-15'
status: 'in-progress'
baseline_revision: '2f59e42e'
route: 'full'
route_source: 'owner'
risk: 'high'
review: 'antigravity-plus-coderabbit'
review_source: 'pinned'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/project-context.md'
  - '{project-root}/_bmad-output/project-knowledge/couturecast_brief.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-6-14-complimentary-full-access.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-6-16-guest-wardrobe-outfit-preview.md'
  - '{project-root}/_bmad-output/test-artifacts/test-design/cc617-google-sign-in-test-design.md'
---

# CC-6.17 Google sign-in

There is no owner draft. Owner input (2026-11-12, roadmap after 6.15): add Google OAuth sign-in on
web, iOS and Android; sign-up must be painless for teens aged 13 to 15 while the existing age gate
and guardian consent rules still apply; the owner tests it with the two remaining family accounts,
which then get complimentary grants through the Story 6.14 CLI.
The builder froze this spec from that input and from code checked against `main` at `2f59e42e`.
This is acquisition work and adds no Community Beta gate.

<frozen-after-approval reason="human-owned intent; change only when the owner renegotiates">

## Intent

**Problem:** Creating a CoutureCast account takes two separate steps on every platform.
Signup (`POST /api/v1/auth/signup`) records an email and birthdate and authenticates nobody; the
person then opens Sign in, asks for a six-digit code, leaves the app for their mailbox and types
the code back.
For a teen on a phone that is the point where most attempts stop, and there is no other way in.

**Approach:** Add "Continue with Google" to sign-in and signup on web, iOS and Android, backed by
the Supabase Google provider.
A person whose Google address already belongs to a CoutureCast account is signed in after the
Google account chooser.
A new address goes to one short "Finish creating your account" step that asks only for a
birthdate, runs the same server-side age gate as email signup, and leaves the person signed in.
Teens aged 13 to 15 land in the existing guardian consent state and see the existing guardian
invitation step.
Anyone under 13 is refused, and the Google identity Supabase created for them is deleted.
Email codes keep working unchanged, and a guest preview conversion (Story 6.16) still reaches its
review step when the visitor picks Google.

**User story:** As a teen or adult who wants to try CoutureCast, I want to sign up and sign in with
my Google account, so that I can start without waiting for an email code.

**Successful first experience (new teen, phone):**

1. Tap "Continue with Google" on Sign in or Create account.
2. Pick a Google account in the system sheet.
3. Enter a birthdate on "Finish creating your account" and confirm.
4. See the account created with guardian consent pending, the guardian invitation step, and stay
   signed in.

An adult does steps 1 to 3 and lands signed in. A returning member does steps 1 and 2.

## Decisions

### D1. Supabase Google provider through the system browser with PKCE, on all three platforms

- Web, iOS and Android call `supabase.auth.signInWithOAuth({ provider: 'google' })` with
  `flowType: 'pkce'`; the client exchanges the returned `code` with `exchangeCodeForSession`.
  The code verifier stays in the existing auth storage (`couturecast.auth-session-code-verifier`),
  which both clients' sign-out already removes.
- Every Google start passes `queryParams: { prompt: 'select_account' }`, so a shared family
  device always shows the account chooser and never silently reuses the last Google account.
- Native opens the authorize URL with `expo-web-browser` `openAuthSessionAsync`
  (ASWebAuthenticationSession on iOS, Custom Tabs on Android), non-ephemeral so an existing
  Google browser session makes the chooser one tap.
- Google Cloud holds one OAuth client of type Web application. Its redirect URIs are the Supabase
  callbacks of local Auth, `couturecast-dev` and `couturecast-prod`.
- Decision record: a native ID-token SDK (`@react-native-google-signin/google-signin` with
  `signInWithIdToken`) was turned down. It needs `skip_nonce_check` on iOS, which removes replay
  protection from every Google sign-in; it needs Android OAuth clients bound to signing-key SHA-1
  fingerprints, and the release keys do not exist until store enrollment (roadmap item after this
  story); its free Android path sits on Google's deprecated legacy sign-in SDK.
  iOS and Android OAuth clients are therefore not created.
- No Google SDK, client id or secret ships in a client bundle; the provider secret lives in
  Supabase only.

### D2. One button, two doors, one outcome rule

- "Continue with Google" appears on web `/signin` and `/signup`, and on mobile `signin` and
  `signup`, above the existing email form and separated from it by an "or" divider.
  It follows Google's sign-in branding guidelines (official "G" mark, label "Continue with
  Google", neutral button) and has a localized accessible name.
- The outcome depends only on the verified Google address, never on which door was used:
  - one CoutureCast account matches: signed in (D4);
  - no account matches: the finish step (D3);
  - the identity cannot be used (unverified address, ambiguous match): a refusal message and a
    local sign-out.
- Email OTP sign-in and email signup are unchanged.

### D3. "Finish creating your account" asks only for a birthdate

- Shown on web at `/signup/finish` and on mobile at `app/signup-finish.tsx`, only while a Google
  session exists with no app account.
- It shows the Google address read-only, a birthdate field with the existing
  `evaluateBirthdateInput` inline messages, "Create account" and "Cancel".
  It asks for nothing else: no name, photo, gender, city or second email.
- `GET /api/v1/auth/signup/federated`, bearer required, decides the route after a profile check
  answers 401: `{ status: 'needs_birthdate' }` when the verified address matches no row or one
  row without a profile, `{ status: 'complete' }` when one row with a profile matches (the client
  re-verifies), and 401 for an unverified address or an ambiguous match. The finish step renders
  only on `needs_birthdate`.
- New endpoint `POST /api/v1/auth/signup/federated`, bearer required, body `{ birthdate }`:
  - The address comes from the verified Supabase identity (`GET /auth/v1/user` with the bearer),
    never from the body. An unverified address is refused (401).
  - It runs the same `parseBirthdateInput` and `evaluateAgeGate` as `signUp`, and the same
    case-insensitive one-account-per-address transaction and advisory lock.
  - An address that already has an account answers 409 and creates nothing; the client then
    re-verifies and signs the person in.
  - It returns the existing `signupResponseSchema`.
- `signUp` and the new path share one account-creation function, so profile, compliance
  preferences, comfort defaults and `profile_completed` telemetry stay identical.
- Ages 13 to 15: the account is created `pending_guardian_consent`, the person stays signed in,
  and the screen shows the existing guardian invitation step (the same unauthenticated
  `POST /api/v1/guardian/invitations` the email flow uses). Server guardian restrictions apply
  unchanged from the first request.
- Under 13, by the client check or the server: the client still submits so the server can act,
  the server answers 403 with `AGE_GATE_MESSAGES.underage` and deletes the Supabase auth user
  through the Auth Admin API (`SUPABASE_SERVICE_ROLE_KEY`), the client signs out locally, and
  guest preview state is cleared. The birthdate is never stored on a refusal.
- Cancel: `DELETE /api/v1/auth/signup/federated` (bearer) deletes the Supabase auth user when no
  app account exists for its address and does nothing otherwise; the client signs out locally and
  returns to where the person came from.
- Existing rows without a `UserProfile` (guardian-only rows created by guardian acceptance):
  the identity service refuses them today for lack of a birthdate, so Google sign-in reaches the
  finish step. The federated endpoint attaches the profile, compliance preferences and comfort
  defaults to that row under the same lock and gate, and creates no second row. Rows that already
  have a profile answer 409.
- Leaving the step any other way (closing the tab, killing the app) keeps the Google session; the
  next launch or page load that finds a session without an account routes back to the finish
  step and never shows a member surface.

### D4. Identity mapping stays the existing verified-email rule

- `AccessTokenIdentityService` keeps mapping a verified address to exactly one app user. Supabase
  Google identities carry a confirmed address, so an existing email-signup account signs in with
  Google with no migration, and Supabase links a same-address Google identity to an existing email
  identity automatically.
- The app never reads or copies Google profile fields (`user_metadata` name, picture). No app
  table gains a column, and no Google token is stored by the app.
- Rows pre-registered by unauthenticated email signup carry a profile, so the verified owner of
  that address signs in to them with Google, exactly as with an email code today. The birthdate
  on such a row was typed by whoever pre-registered it; that is an existing property of email
  signup and stays out of scope here, recorded in the change log.
- Account-picker mismatch during a guest conversion: the review belongs to whichever identity
  Supabase verified. The stored intent is device-local and is applied only after that member's
  explicit review (6.16 D8), so picking a different Google account changes whose review it is and
  nothing else.
- Complimentary grants (Story 6.14) keep keying on the app account, so a family account created
  through Google is granted with the same CLI after signup.

### D5. Callback handling owns the redirect, and only `from=preview` survives it

- Web: `redirectTo` is `${origin}/auth/callback`, plus `?from=preview` when the door had it.
  `/auth/callback` exchanges the code, verifies the account through the existing
  `accept(session)` path, and routes: member to the D6 destination, no account to
  `/signup/finish` (carrying `from`), OAuth error or a cancelled chooser back to the door with a
  localized message. `detectSessionInUrl` becomes `false`, so no other page consumes a `code`.
- The callback page removes `code`, `error` and `error_description` from the URL with
  `history.replaceState` before analytics initializes on it, and page-view capture drops the
  callback route's query, so no `code` or token reaches `$current_url`, a log line or a referrer.
  With PKCE no token is ever in a URL.
- Provider `error` and `error_description` values are never rendered; any error maps to one fixed
  localized message.
- Mobile: the redirect is `Linking.createURL('auth/callback')` on the app scheme, plus
  `from=preview`. `openAuthSessionAsync` returns the URL in process on both platforms.
  `+native-intent.tsx` recognizes the callback link (today it falls through to `+not-found`):
  while an in-process start is waiting it returns an empty path so the router stays put, and
  otherwise (an app cold-started by the link) it routes to `app/auth/callback.tsx`, which completes
  the same exchange. A code is exchanged once; a second delivery is a no-op.
- `from` is read through `parsePreviewFrom`. No open return URL exists, so no redirect allowlist
  beyond Supabase's is needed.
- Supabase redirect allowlists: local adds `http://127.0.0.1:3000/auth/callback**`,
  `couturecast://**` and the isolated story schemes; `couturecast-dev` adds the Vercel preview web
  origins and `couturecast://**`; `couturecast-prod` adds
  `https://couture-cast-web.vercel.app/auth/callback**` and `couturecast://**`.

### D6. The 6.16 guest conversion works through Google

- A Google sign-in or signup started from `?from=preview` with a stored conversion intent ends at
  `/preview/continue` (web) or `preview-continue` (mobile), through the same
  `destinationAfterSignIn` / `continuesToPreviewReview` rule; any other Google sign-in clears guest
  state.
- A new address from the preview passes through the finish step first, then the review.
- An under-13 refusal from the preview clears guest state, as email signup does.
- Screens left mounted under the Google flow react to session changes only on focus
  (`useFocusEffect`), so the preview cannot hijack the conversion.

### D7. The native scheme becomes `couturecast`

- `app.json` `scheme` becomes `["couturecast", "mobile"]`: `couturecast` is primary and used for
  OAuth; `mobile` stays so existing links keep opening. The tests and guardian links already
  assume `couturecast://`.
- Isolated story builds keep their `couturecast-story65` and `couturecast-story68` schemes.
- Decision record: Android App Links and iOS universal links were turned down for the callback.
  They need the release signing certificate and an Apple team id, which arrive with store
  enrollment. A custom scheme is safe here because PKCE binds the code to the verifier held in the
  app's secure storage, so an app that intercepts the link cannot exchange it.

### D8. External setup is part of the story

- Google Cloud: project `couturecast`, OAuth consent screen External, app name CoutureCast,
  scopes `openid`, `email`, `profile` only (non-sensitive), one Web application client (D1).
  Publishing status stays Testing with the owner and the three family accounts as test users.
  Decision record: In production was turned down for now. Google requires a public home page
  and privacy policy link before publishing, and the repo's legal copy
  (`_bmad-output/project-knowledge/terms-of-service.md`) is a draft awaiting counsel; publishing
  draft legal text is the owner's call. Testing covers the owner's family acceptance; switching to
  In production needs only those two links and one click, with no code change.
- Local Supabase: `[auth.external.google]` enabled with
  `client_id = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID)"` and
  `secret = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET)"`; local and CI start with or without
  those values set.
- Hosted Supabase `couturecast-dev` and `couturecast-prod`: Google provider enabled with the same
  client, and redirect allowlists from D5, set through the Management API.
- The client secret is stored only in Supabase and in the gitignored `.env.local`, `.env.preview`
  and `.env.prod` mirrors. No Vercel or EAS variable is added, because no app process reads it;
  `SUPABASE_SERVICE_ROLE_KEY` on the API's Vercel production and preview environments is verified
  present for D3 deletions.
- A Google outage or a disabled provider shows the localized unavailable message on the door and
  leaves email sign-in working; disabling the provider in Supabase is the kill switch.

### D9. Telemetry stays as it is

- Completion fires `profile_completed` through the shared account-creation function with exactly
  the properties email signup sends. No sign-in method property and no new event are added, so
  the analytics allowlist does not change.

### D10. Automatable stand-in for Google

- Local GoTrue (v2.183.0) ignores a URL override for the Google provider, so the real-stack lane
  enables the Keycloak provider against a mock OIDC server owned by the test harness.
- Web: Playwright rewrites `provider=google` to `provider=keycloak` on the authorize request;
  app code always asks for `google`.
- Mobile: `EXPO_PUBLIC_E2E_OAUTH_PROVIDER=keycloak` swaps the provider name only when `__DEV__`
  and the isolated story build are both true. Anything else refuses it at runtime, and a bundle
  scan fails a release bundle that contains the variable, as the RevenueCat test key guard does.
- Real Google is exercised by hand on a Vercel preview deployment and a dev build, recorded as
  evidence; no CI job signs in to Google.

### D11. Copy, accessibility and localization

- New strings (Google button, divider, finish step, refusal and cancel messages) ship in all ten
  locales on both clients. The finish step calls the age check self-reported eligibility only
  where 6.16 already does; elsewhere it uses the existing signup copy.
- 44-point targets, keyboard and screen-reader order, focus on the first field of the finish
  step, and announced errors, as the existing signup screens do.

### D12. Public Privacy Policy and Terms of Service

- Google's consent screen cannot leave Testing without a home page, a privacy policy and terms
  links on an authorized domain, so the web app gains `/privacy` and `/terms`.
- Server-rendered, signed out, indexable: no session check and no redirect. The session bridge
  exempts both paths from the finish-step resume, because the finish step and Google's consent
  screen link to them mid-signup.
- Every statement is backed by code: Google's address, name and photo stay in Supabase Auth and
  the app reads only the verified address (D4); birthdate for the age gate; under-13 and
  cancelled identities deleted at once, a failed deletion and abandoned identities by the daily
  sweep after a day (D3, TEA-4); guardian consent for ages 13 to 15; pseudonymous analytics with
  no address or code, website events through `/ingest`, mobile events direct to PostHog, and
  `profile_completed` carrying age and whether guardian consent is required (D5); account
  erasure on request through the 6.13 erasure route; contact `muratkerem@gmail.com`, approved
  by the owner. No certification or retention figure the code does not enforce.
- Processors as production runs them: Supabase, Vercel, Northflank, Upstash, PostHog, Grafana
  Cloud (OTLP export is configured in production), OpenWeather (the only production weather
  mode), Expo push with Apple and Google delivery, Stripe, and Google. RevenueCat is left out:
  store enrollment has not happened, so the mobile apps sell nothing.
- No Google token is stored. Both clients wrap their auth storage with `withoutProviderTokens`
  (`@couture/utils`), which drops `provider_token` and `provider_refresh_token` before the
  session reaches localStorage or SecureStore and on every read; the real-session lane pins
  that Auth returned the token and the stored session lacks it.
- English only. The legal text is the reference wording reviewers check against the code, and
  a translation would need its own review; the pages are not in the ten-locale catalogs.
- Linked from the home page, signup, sign-in and the finish step; both routes are in
  `WEB_ANALYTICS_ROUTES` and the Story 3.8 axe and landmark matrix.

## Boundaries & Constraints

**Always:**

- Keep the server authoritative for age, guardian consent and account identity.
- Keep email OTP sign-in and email signup working unchanged.
- Delete the Supabase identity of anyone refused for age.
- Keep guardian restrictions, entitlement gates, community rollout controls and RLS as they are.
- Validate every new request and response with the shared contracts, and publish the endpoints in
  the OpenAPI spine.
- Keep every PR job under 20 minutes and add no macOS job to PRs.

**Never:**

- Ship a Google client secret or SDK key in a client bundle or in git.
- Trust a client-supplied email, role or Google profile field for identity or age.
- Create an account without a birthdate passing the server gate.
- Use `skip_nonce_check`, an embedded web view, or the native Google SDK.
- Store Google names, photos or tokens in app tables.
- Change production flags or entitlements, or grant complimentary access, inside the PR.

</frozen-after-approval>

## I/O & Edge-Case Matrix

| Scenario                                | Input / state                            | Expected behavior                                                   |
| --------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------- |
| Returning member, Google                | Verified address with one account        | Signed in; lands where email sign-in lands                          |
| Email member first uses Google          | Account made by email signup             | Signed in to the same account; identities linked by Supabase        |
| New adult                               | No account                               | Finish step; birthdate passes; account `active`; signed in          |
| New teen 13 to 15                       | No account                               | Account `pending_guardian_consent`; guardian invite step; signed in |
| New under-13, client check              | Birthdate under 13                       | Server 403; auth user deleted; local sign-out; nothing stored       |
| Under-13 via direct API call            | Bearer plus young birthdate              | 403; auth user deleted; no app row                                  |
| Finish step cancelled                   | Session, no account                      | Auth user deleted; local sign-out; back to the door                 |
| Finish step abandoned                   | Tab closed or app killed                 | Next load routes to the finish step; no member surface              |
| Address registered meanwhile            | Federated signup races email signup      | One account; the loser gets 409 and signs in                        |
| Case-variant address                    | Google `A@x.com`, account `a@x.com`      | Same account                                                        |
| Ambiguous address                       | Two accounts match case-insensitively    | Refusal message; local sign-out; nothing created                    |
| Unverified Google address               | `email_verified` false                   | 401 from both endpoints; refusal message; nothing created           |
| Chooser cancelled                       | User closes Google or the auth sheet     | Back on the door, no message beyond "Sign-in cancelled", no session |
| OAuth error                             | `error` in the callback URL              | Localized unavailable message; email form still usable              |
| Provider disabled or Google down        | Authorize fails                          | Unavailable message; email sign-in works                            |
| Callback replayed                       | Used or foreign `code`                   | Exchange fails; unavailable message; no session change              |
| Android cold start                      | App killed while the Custom Tab was open | `app/auth/callback` completes the exchange and routes               |
| Preview conversion, existing member     | `from=preview`, intent stored            | Review step                                                         |
| Preview conversion, new address         | `from=preview`, intent stored            | Finish step, then review step                                       |
| Preview, under-13 refusal               | `from=preview`                           | Guest state cleared                                                 |
| Google sign-in without `from=preview`   | Guest state stored                       | Guest state cleared                                                 |
| Signed-in member taps Google            | Different Google account                 | Previous member signed out first; new identity verified             |
| API slow after exchange                 | Profile check times out                  | Session kept; retry state; not shown as "no account"                |
| Complimentary grant after Google signup | Owner runs the 6.14 CLI with the address | Grant applies to the Google-created account                         |

## Code Map

**API**

- `apps/api/src/modules/auth/auth.service.ts`: extract shared account creation; add
  `signUpFederated` and `abandonFederatedSignup`.
- `apps/api/src/modules/auth/auth.controller.ts`: `GET`, `POST` and
  `DELETE /api/v1/auth/signup/federated`.
- `apps/api/src/modules/auth/access-token-identity.service.ts`: export the verified Supabase
  identity read (address, verification, auth user id) for the new endpoints; mapping unchanged.
- `apps/api/src/modules/auth/supabase-auth-admin.ts` (new): Auth Admin user deletion and listing.
- `apps/api/src/modules/auth/orphan-auth-user-sweep.ts` (new): the gated daily sweep (TEA-4,
  TEA-10, TEA-14), scheduled by `apps/api/src/workers/maintenance.scheduler.ts` and run through the
  community runtime by `apps/api/src/workers/community.bootstrap.ts`.
- `packages/api-client/src/contracts/http/auth.ts`: `federatedSignupInputSchema`; OpenAPI,
  generated client and Pact.

**Web**

- `apps/web/src/lib/web-session.ts`: `flowType: 'pkce'`, `detectSessionInUrl: false`,
  `startWebGoogleSignIn`, `completeWebOAuth`, a `no_account` outcome.
- `apps/web/src/app/auth/callback/page.tsx` (new), `apps/web/src/app/signup/finish/` (new).
- `apps/web/src/lib/oauth-callback-url.ts` (new): takes the callback params out of the URL.
- `apps/web/src/lib/post-signin-destination.ts` (new): the 6.16 destination rule, shared by the
  email and Google paths. `apps/web/src/app/components/session-bridge.tsx`: finish-step resume.
- `apps/web/src/app/signin/page.tsx`, `apps/web/src/app/signup/signup-form.tsx`: Google button.
- `apps/web/src/app/components/google-sign-in-button.tsx` (new).
- `apps/web/src/lib/signup.ts`: federated submit and abandon.
- `apps/web/src/i18n/`: strings in all ten catalogs.

**Mobile**

- `apps/mobile/src/lib/native-session.ts`: `flowType: 'pkce'`, `startNativeGoogleSignIn`,
  `completeNativeOAuth`, a `no_account` outcome.
- `apps/mobile/app/+native-intent.tsx`: callback link handling; `src/lib/native-oauth-flight.ts`
  (new) holds the in-flight flag and the callback-link match.
- `apps/mobile/src/lib/post-signin-destination.ts` (new): the shared destination rule;
  `app/(tabs)/index.tsx` resumes a finish step on focus.
- `apps/mobile/app/auth/callback.tsx`, `apps/mobile/app/signup-finish.tsx` (new);
  `apps/mobile/src/features/signup/`: finish screen and Google button.
- `apps/mobile/app/signin.tsx`, `apps/mobile/app/signup.tsx`: Google button.
- `apps/mobile/src/lib/signup.ts`: federated submit and abandon.
- `apps/mobile/app.json`: scheme array. `apps/mobile/app.config.ts`: `isolatedNativeBuild`.

**Shared**

- `packages/utils/src/federated-signin/` (new): the ten-locale copy and Google's "G" mark and
  button colours, used by both clients (replaces per-client catalog strings).
- `scripts/ci/revenuecat-bundle-scan.mjs`: the release scan also plants and searches for the
  `EXPO_PUBLIC_E2E_OAUTH_PROVIDER` sentinel (D10).

**Config**

- `supabase/config.toml`: `[auth.external.google]`, `[auth.external.keycloak]` (TEA-13),
  `additional_redirect_urls`.
- `.env.example`: the two local substitution names, no values.

**Tests**

- API unit and integration specs beside the changed modules; web and mobile unit tests.
- `playwright/tests/google-sign-in*.spec.ts`; `maestro/google-sign-in*.yaml`; the seam TEA picks
  for an automatable Google stand-in.

## Tasks & Acceptance

### Execution

- [ ] Register 6-17 in `sprint-status.yaml`.
- [ ] Google Cloud project, consent screen and Web client; Supabase local, dev and prod provider
      and redirect allowlists; env mirrors; verify the API service role key on Vercel.
- [ ] Contract, OpenAPI, Pact; shared account creation; federated signup and abandon endpoints;
      Auth Admin deletion.
- [ ] Web PKCE switch, callback route, finish step, Google button on both doors.
- [ ] Mobile PKCE switch, scheme, auth session, callback route, finish step, Google button.
- [ ] 6.16 conversion through Google on both clients.
- [ ] Localization and accessibility for every new string and control.
- [ ] TEA red specs green; Playwright and Maestro journeys plus email sign-in and guardian
      regressions.
- [ ] Real Google sign-in on a preview deployment and on a dev build, recorded as evidence.
- [ ] Learning path Step 57 and evidence under `_bmad-output/test-artifacts/story-6-17/`.

### AC1. Painless Google sign-up

Given a person with a Google account and no CoutureCast account on web, iOS or Android, when they
choose "Continue with Google", pick an account and enter an eligible birthdate, then they have an
account and are signed in, with no email code, password or other field.

### AC2. Returning members

Given an existing account, email-created or Google-created, when its owner continues with Google,
then they are signed in to that same account and nothing is created.

### AC3. Age and guardian rules hold

Under-13 birthdates are refused by the server whatever the client sends, and the Supabase
identity is deleted. Ages 13 to 15 get `pending_guardian_consent`, the guardian invitation step,
and the same server restrictions as an email-created teen.

### AC4. Identity integrity

The account address always comes from a verified Supabase identity. Unverified, ambiguous and
replayed identities create nothing and sign nobody in, and no Google profile field reaches an app
table.

### AC5. Guest conversion intact

A guest preview conversion with a stored intent reaches the review step through Google on all
three platforms, for existing and new addresses, and any other Google sign-in clears guest state.

### AC6. Failure and cancellation

Chooser cancel, finish cancel, OAuth error, provider outage, slow API and Android cold start each
end in the matrix outcome, keep email sign-in usable and leave no member surface for a person
without an account.

### AC7. Email paths unchanged

Email signup, email OTP sign-in, guardian acceptance and the 6.16 email conversion pass their
existing suites unchanged.

### AC8. Accessibility and localization

The button, divider and finish step work in all ten locales with keyboard, VoiceOver and TalkBack,
44-point targets and announced errors.

### AC9. Configured everywhere

Google sign-in works against local Supabase with the secret set, on a Vercel preview deployment
against `couturecast-dev`, and is enabled on `couturecast-prod`; no secret is in git or a client
bundle.

## Test Design (TEA)

Full plan, reconciled to the frozen Intent and Decisions (this spec wins on any disagreement):
`_bmad-output/test-artifacts/test-design/cc617-google-sign-in-test-design.md`.
20 risks, 16 high; R1 (an existing address gets a second account or a changed profile), R2
(under-13 Google data survives a refusal) and R6 (a shared device reuses the last Google account
or leaks the prior member's state) score 9 until their ordered pairs are built and their seeded
defects are proved red.
80 scenario entries: P0 70 (federated endpoints 23, lifecycle pairs 17, callbacks and redirects
12, telemetry and logs 6, stand-in seam and hosted configuration 8, real local stack 4), P1
accessibility and copy 6, member regression 4.
20 seeded-defect proofs (S-1 to S-20) run in a throwaway worktree and are recorded under
`_bmad-output/test-artifacts/story-6-17/`.

TEA rulings on the frozen spec:

- TEA-1: `DELETE` and `POST /auth/signup/federated` share the advisory lock on the lowercased
  verified address, and `DELETE` re-checks for a row inside it (`L-CANCEL-VS-FINISH`, S-9).
- TEA-2 (accepted): a guardian-only row holding a granted consent requires a birthdate of 18 or
  more; under 18 answers 403 and attaches nothing. Otherwise the guardian becomes role `teen` and
  loses `POST /guardian/revoke` (`A-FED-GUARDIAN-MINOR`).
- TEA-3: after `GET` answers `complete`, the client re-verifies once; a second 401 shows the
  refusal and signs out locally (`L-NO-LOOP`, S-17).
- TEA-4 (accepted with amendments): daily BullMQ job `orphan-auth-user-sweep` at 04:00 UTC in
  `apps/api/src/workers/maintenance.scheduler.ts` deletes auth users older than 24 hours with no
  app account by case-insensitive verified address, skips any whose `app_metadata` carries
  `app_user_id` or a role, and runs only where the worker runs (`A-SWEEP-*`).
- TEA-5 (decided): `exp://**` is allowlisted on local and `couturecast-dev` only, never prod; the
  button stays visible in Expo Go (`H-ALLOWLIST`).
- TEA-6: the `couturecast-dev` preview wildcard is scoped to this team's preview host pattern;
  `H-ALLOWLIST` asserts the exact list on both projects.
- TEA-7: the app never branches on the identity's provider name; the Keycloak lane proves it.
- TEA-8: the federated code logs no address, birthdate, bearer, code or service role key
  (`T-API-LOGS`, S-19).
- TEA-9: `H-SETTINGS` and `H-AUTHORIZE` need only the anon key; `H-ALLOWLIST` needs a Management
  API token and runs locally as evidence when CI has none.
- TEA-10: the orphan sweep takes the address lock and re-checks for an account before each
  deletion (`A-SWEEP-LOCK`).
- TEA-11: `error=access_denied` with `error_code=provider_email_needs_verification` (GoTrue's
  refusal of an unverified provider address) is the refusal outcome on both clients, never
  "Sign-in cancelled".
- TEA-12: callback URL cleaning also drops the fragment, where GoTrue repeats the error fields.
- TEA-13: local `config.toml` enables Keycloak against the lane's mock OIDC container and
  allowlists the real-session web callback; hosted projects keep Keycloak off and
  `mailer_autoconfirm` false (`H-SETTINGS`; spike S0 evidence in
  `_bmad-output/test-artifacts/story-6-17/spike-s0-oidc-stand-in.md`).
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

Red-first order for the build:

1. Spike S0 and the harness mock OIDC server (TEA): Keycloak endpoints reachable from GoTrue in
   Docker on macOS and Linux CI, verified address, auto-linking to an email-OTP user.
2. Contract and API: `A-FED-CONTRACT`, `A-SHARED-CREATION`, `A-FED-*`, `A-ROLE-CLAIMS`,
   `L-FINISH-*`, `L-CANCEL-VS-FINISH`, `T-API-LOGS`.
3. Web session, callback and finish step: `U-PKCE-CONFIG`, `U-START-PARAMS`, `U-CALLBACK-*`,
   `G-OPEN-SESSION`, `W-FAIL-*`, `W-RESUME`, `L-NO-LOOP`, `L-SWITCH-*`.
4. Mobile: `U-INTENT-CALLBACK`, `U-SEAM-*`, `M-CALLBACK-*`, `M-FAIL-*`, `M-RESUME`.
5. Conversion `L-G-*` on both clients; telemetry `T-*`; accessibility, brand and strings.
6. E lane, `G-*` unfiltered, `H-*` after external setup; seeded defects; learning path Step 57;
   `X-OWNER-RUN`.

What the tests can and cannot prove: age is self-reported, so the tests prove the gate, the
deletion and the storage rules, never age. The Keycloak stand-in proves GoTrue's OAuth flow,
PKCE, our callback, the finish step, linking by verified address and the conversion; Google's
consent screen, chooser and client registration are proved only by `H-AUTHORIZE` and the recorded
real-Google run. iOS Maestro and VoiceOver run nightly and on dispatch.

## Plan Change Log

- 2026-11-15: Spec frozen by the builder from the owner's roadmap input, checked at `2f59e42e`:
  - Signup authenticates nobody today and sign-in is email OTP only, so a new Google identity has
    no account; the finish step and the federated endpoint close that gap.
  - The API already maps any verified address to one account, so returning members need no API
    change.
  - Supabase OAuth creates its auth user before the age is known, so refusal and cancel delete it.
  - The app scheme was `mobile` while links and tests assume `couturecast`; D7 aligns them.
  - iOS and Android OAuth clients from the coordinator's setup list are not created (D1 decision
    record).
  - TEA's draft risk register shaped D1 (`prompt=select_account`), D3 (guardian-only rows), D4
    (pre-registered rows, picker mismatch), D5 (URL cleaning, fixed error copy,
    `+native-intent`), D7 (no App Links yet), D9 (telemetry) and D10 (Keycloak stand-in).
  - Setup on 2026-11-15: Google Cloud project `couturecast` and Web client created; hosted
    `couturecast-dev` and `couturecast-prod` Google provider enabled with D5 allowlists (dev also
    allows the local `exp://` form for Expo Go, TEA-5); API `SUPABASE_SERVICE_ROLE_KEY` confirmed
    on Vercel production and preview.
  - TEA rulings accepted: TEA-2 (a guardian-only row with granted consent needs 18 or more),
    TEA-4 (daily orphan auth-user sweep on the worker scheduler, skipping identities whose
    `app_metadata` carries `app_user_id` or a role), TEA-5 (local and dev allow `exp://**`,
    prod never).
  - Build changes, each with its reason: copy lives in `@couture/utils` like 6.16's, so both
    clients say the same thing; a `GET` status endpoint decides the finish step after a 401,
    because a 401 alone cannot tell no account from an ambiguous or unverified one; a
    `sessionStorage` (web) and SecureStore (mobile) marker resumes an abandoned finish step without
    branching on the provider (TEA-7); the sweep runs only with
    `ORPHAN_AUTH_USER_SWEEP_ENABLED=true` on the hosted worker and checks `auth.users` pairing
    (TEA-14); a guardian-only row is checked before any refusal deletes an identity (TEA-2).
  - TEA sign-off rounds (API two rounds, web and mobile one each), changes each with its reason:
    the sweep runs only with `ORPHAN_AUTH_USER_SWEEP_ENABLED=true`, refuses test environments,
    checks `auth.users` pairing and throws before deleting at the page cap (TEA-14); a 404 counts
    as deleted only with `user_not_found`; the finish-step 403 carries a machine code
    (`underage`, `federated_guardian_minor`); the door (`door=signup`) rides the round trip so
    failures and Cancel return to the page that started (D5); a stored identity without an
    account resumes the finish step from the server's status, so a new tab resumes too (D3);
    the callback drops the PKCE verifier on failure; Android Back on the finish form is Cancel;
    the guardian step is localized; the door helpers live in `@couture/utils` because a server
    page calls them (the E lane caught the client-only import).
  - TEA-15 done in the Supabase dashboard at the owner's request (the Management API call was
    refused by the session's permission classifier); the hosted probe still passes.
  - D12 added: publishing the Google consent screen needs public privacy and terms pages.
    TEA's text review corrected five claims against the code: the stored session held
    Google's access token (now stripped on both clients), analytics differs by client and
    `profile_completed` carries age, three processors were missing, a failed under-13 deletion
    falls to the sweep, and the mobile apps sell no subscription yet.
  - Antigravity round (2f59e42e..HEAD), all fixed in the PR: the door now rides the mobile round
    trip as on web (redirectTo and the marker, the browser session still watching the bare
    callback URL), so Cancel, refusals and the cold callback return to the page that started,
    and a sign-in on a root sign-in screen goes Home; the web resume reruns on every route
    change, and the mobile resume asks the server status like web, so an identity stored
    without the marker resumes and an email code clears the marker; an under-13 refusal clears
    the stored guest preview whichever door started, with the mobile write awaited before
    Continue; the privacy text now names the account id server events carry, a failed Cancel
    delete falling to the sweep, the whole 13 to 15 lock and the coordinates OpenWeather gets.
  - Out of scope, existing behavior: unauthenticated email signup lets anyone pre-register an
    address with a birthdate of their choosing; the address owner then signs in to that row.
  - Post-merge fix (`fix/pending-teen-sign-in`): a teen waiting on a guardian looped back to
    sign-in on every Google attempt in production, because the guardian lock 403s the profile
    check and the federated status answered `complete`. The status now answers
    `awaiting_guardian` with the account id when the lock refuses the teen (revoked consent
    included); web and mobile keep the session and show the guardian invitation on the finish
    step, Continue signs out, and an email code routes the same way. Reproduced red on `main`
    in the real-session lane first.
  - Guardian consent off (owner ruling 2026-11-16, same branch): the teen-path review found a teen
    could approve their own account, no invite mail was sent and no guardian could revoke.
    `GUARDIAN_CONSENT_POLICY` defaults to `off`: every 13+ account is active, the guardian
    endpoints answer 409, migration `20261116120000_guardian_consent_off` activates waiting teens,
    and the legal pages no longer promise a lock. `required_13_15` stays in the test lanes and
    fails boot elsewhere until finding B-1 is fixed; the re-enable checklist is in the test design.
    Also fixed: admin dead-letter routes now need an admin bearer (finding B-8).
