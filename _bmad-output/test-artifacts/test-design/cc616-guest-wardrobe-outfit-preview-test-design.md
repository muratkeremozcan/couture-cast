# CC-6.16 guest wardrobe and outfit preview: test design

Updated: 2026-11-15 (draft 2, reconciled to the frozen Intent and Decisions D1 to D10)

Owner: tea616. The story spec
`_bmad-output/implementation-artifacts/spec-6-16-guest-wardrobe-outfit-preview.md` wins on any
disagreement. TEA findings against the frozen spec are listed under "TEA rulings" and go to the
spec's Plan Change Log.

## Code facts the plan relies on

- Age rules: `evaluateBirthdateInput`, `evaluateAgeGate`, `AGE_GATE_MESSAGES`,
  `INVALID_BIRTHDATE_MESSAGE` in `packages/utils/src/age.ts`. `active` and
  `pending_guardian_consent` pass the guest gate; `blocked_underage` and invalid input do not.
- Comfort contract: `packages/api-client/src/contracts/http/comfort.ts`. `runsColdWarm`
  `cold | neutral | warm`; `windTolerance` and `precipPreparedness` `low | medium | high`.
- Engine thresholds (`ritual-generation.engine.ts`, moving to `packages/utils/src/comfort-rules.ts`):
  thermal offset 3; ranges change at `< 10`, `< 15`, `< 20`, `< 25`; outerwear below 15; wind
  `> 3 | 5 | 8` m/s; rain probability `> 0.2 | 0.4 | 0.7`; rain amount `> 0.1 | 0.5 | 2.0` mm.
  The engine has two rain paths: the comfort-note path compares the raw probability, and the badge
  path compares rounded percent and rounded tenths of a millimetre. They disagree at values such as
  probability 0.704 and amount 0.54, so the golden grid includes those values.
- Analytics: web `webAnalyticsPrivacyFilter` then `shareCardSharedBeforeSend`
  (`capture_pageview: 'history_change'`, `person_profiles: 'identified_only'`, recording off);
  mobile `mobileAnalyticsPrivacyFilter` then `mobilePostHogBeforeSend`. Both drop events outside
  their allowlists.
- Sessions: web `apps/web/src/lib/web-session.ts`; mobile `native-session.ts`,
  `secure-session-storage.ts`, `mobile-auth.ts`.
- Guest state: web `localStorage` key `couturecast.guest-preview`; mobile file
  `couture-cast-guest-preview.json` through `expo-file-system`; 24 h fixed from `startedAt`;
  16 KB cap; one store per platform with a monotonic epoch.
- Playwright runs only with an isolated `DATABASE_URL` and `PLAYWRIGHT_SKIP_DB_RESET=true`.
  macOS jobs never run on PRs; iOS Maestro runs nightly and on dispatch.

## Risk register

Probability (P) and impact (I) are 1 to 3; score is P x I. High is 6 or more.

| ID  | Risk                                                                                                      | P   | I   | Score | Mitigating scenarios                                                |
| --- | --------------------------------------------------------------------------------------------------------- | --- | --- | ----- | ------------------------------------------------------------------- |
| R1  | Under-13 or invalid input reaches the preview (UI, direct route, deep link, resumed or tampered state)    | 2   | 3   | 6     | U-AGE-_, U-STATE-ELIGIBILITY, W-GATE-_, M-GATE-\*                   |
| R2  | Birthdate or age band stored or transmitted                                                               | 2   | 3   | 6     | U-STATE-STRICT, W-GATE-NO-NETWORK, T-NO-PII                         |
| R3  | Signup response treated as authentication; comfort call before verified sign-in                           | 2   | 3   | 6     | W-CONV-NO-AUTH, M-CONV-NO-AUTH, E-CONV-REAL-STACK                   |
| R4  | Guest state or a pending carryover crosses identities                                                     | 3   | 3   | 9     | L-\* ordered pairs                                                  |
| R5  | Carryover overwrites silently, double-applies, or reports success before read-back                        | 2   | 3   | 6     | W-CONV-_, M-CONV-_, W-CONV-UNCERTAIN                                |
| R6  | Guest journey writes product rows                                                                         | 2   | 3   | 6     | E-NO-DB-WRITES, A-NO-NEW-ROUTE                                      |
| R7  | Sample ids reach requests, ritual cache, widgets or share-card sources                                    | 2   | 3   | 6     | U-STATE-ID-ALLOWLIST, W-NO-SAMPLE-IN-REQUESTS, M-NO-SAMPLE-IN-CACHE |
| R8  | Session restore races: guest entry or erase during a slow or failed check; mobile signed-out ritual fetch | 3   | 2   | 6     | L-RESTORE-_, M-HOME-_                                               |
| R9  | Late write resurrects state after reset, exit, expiry or identity change                                  | 3   | 2   | 6     | U-STORE-EPOCH, L-\*-THEN-WRITE                                      |
| R10 | Rule extraction changes authenticated ritual output                                                       | 2   | 3   | 6     | U-ENGINE-GOLDEN                                                     |
| R11 | Outfit and explanation disagree, or a control has no material effect                                      | 2   | 2   | 4     | U-SEL-\*                                                            |
| R12 | Web and mobile reach different results for one state                                                      | 2   | 2   | 4     | X-PARITY                                                            |
| R13 | Activation events, prohibited properties, automatic pageviews or identity merge from the preview          | 2   | 3   | 6     | T-\*                                                                |
| R14 | Catalog defects: incomplete look, dangling id, missing art key, missing locale string, no provenance      | 2   | 2   | 4     | U-CATALOG-\*                                                        |
| R15 | Accessibility regressions: focus, selection semantics, swipe-only, clipping in long locales               | 2   | 2   | 4     | W-A11Y-_, M-A11Y-_                                                  |
| R16 | Member regressions from new entry, sign-in routing and mobile Home branching                              | 2   | 3   | 6     | G-\*                                                                |
| R17 | Dishonest copy: scores, live-weather claims, popularity, sponsorship, unlabeled hero demo                 | 1   | 2   | 2     | _-HONEST-_                                                          |

R4 is the one score-9 risk. It stays open until every L-\* pair is built and its seeded defect is
proved red.

## Scenario catalog

Levels: U unit (`packages/utils`, `packages/api-client`), C component (web Vitest, mobile Jest),
W web Playwright, M mobile (component plus Maestro), E owned-stack end to end, T telemetry, X
cross-platform fixture, A API, G member regression. Assertions are exact: status and body, text
from the locale catalog, serialized payload keys. No `>= 400`, no truthy checks on payloads.

### P0: eligibility (R1, R2)

- U-AGE-BOUNDARY: 12 years 364 days blocked with `AGE_GATE_MESSAGES.underage`; 13 on the birthday
  passes; 15 (`pending_guardian_consent`) passes; 16 passes; 29 February birthdate in a non-leap year.
- U-AGE-INVALID: empty, `2010-02-30`, `2010-2-3`, a future date, padded whitespace.
- U-STATE-STRICT: the strict schema rejects any extra key (`birthdate`, `age`, `band`); a stored
  eligible state serializes exactly `{ eligible: true, expiresAt }` under `eligibility`.
- U-STATE-ELIGIBILITY: `expiresAt` equals `startedAt` plus 24 h; a state past `expiresAt`, or with
  `eligible` other than literal `true`, parses as no eligibility.
- C-GATE-CLEARS (web and mobile): the birthdate field value is cleared after evaluation, pass or
  fail.
- W-GATE-UNDERAGE and M-GATE-UNDERAGE: existing underage copy and an exit; no preview surface; no
  `couturecast.guest-preview` key or guest file afterwards; no guest event.
- W-GATE-DIRECT: `/preview`, `/preview?view=wardrobe`, `/preview?view=preferences` and
  `/preview/continue` with no eligibility show the gate first.
- M-GATE-DEEPLINK: the preview and preview-continue routes opened by deep link show the gate first.
- W-GATE-TAMPER: stored state with a forged eligibility, wrong `schemaVersion` or wrong
  `catalogVersion` is discarded; the gate shows.
- W-GATE-NO-NETWORK: the gate submission sends zero requests (route recorder).
- E-GATE-SERVER-WINS: an eligible guest signs up with an under-13 birthdate; the server refusal
  shows and the conversion proposal is discarded.

### P0: isolation and no writes (R6, R7)

- E-NO-DB-WRITES: row counts and max ids of user, profile, comfort, garment, recommendation,
  capsule, upload, onboarding, subscription, entitlement, complimentary grant, community and
  telemetry tables are equal before and after a full guest journey on the isolated database.
- A-NO-NEW-ROUTE: the OpenAPI document is byte-identical to main; no Pact change.
- W-NO-PROTECTED-CALLS: the request recorder during the guest journey sees zero `/api/v1/*` calls.
- M-HOME-SIGNED-OUT-NO-FETCH: signed-out Home renders the welcome card ("Try a sample wardrobe",
  "Create account", "Sign in") and the API double records zero ritual requests.
- W-NO-PERMISSIONS and M-NO-PERMISSIONS: no geolocation, camera, photo, notification or tracking
  prompt (Playwright permission log; Maestro asserts no system dialog on Android, and on iOS in the
  nightly lane).
- U-STATE-ID-ALLOWLIST: unknown, path-like (`../x`), URL-like, over-length and wrong-prefix ids
  (anything outside `sample:g:` and `sample:l:` in the current catalog) are dropped at parse.
- W-NO-SAMPLE-IN-REQUESTS: through conversion, no request URL, body or header contains `sample:`.
- M-NO-SAMPLE-IN-CACHE: ritual cache, widget payload and share-card source stores hold no `sample:`
  string after a guest journey and after conversion.

### P0: identity and lifecycle, ordered pairs (R4, R8, R9)

Subjects: guest G, verified member A, verified member B, guardian-pending member P.
Each pair runs in both orders where both are reachable. Races are forced with a deferred promise
held in the storage adapter or the API route double; no sleeps.

- L-G-THEN-A-FROM-PREVIEW: G with a conversion intent signs in as A; A reaches the review only;
  votes, swaps and filters reach no request.
- L-G-THEN-A-ELSEWHERE: G has state, then A signs in from the plain sign-in entry; guest state is
  deleted and no review shows.
- L-A-THEN-G: A signs out, a preview starts on the same device; no A data and no pending A proposal.
- L-G-A-B: G proposes, A signs in and leaves the review open, A signs out, B signs in; B never sees
  A's proposal or A's account values.
- L-APPLY-THEN-SWITCH: A accepts, the `PUT` is held, the identity changes to B, the `PUT` resolves;
  B's screen does not change, A's read-back is dropped, the proposal is discarded.
- L-READBACK-THEN-SWITCH: same with the read-back `GET` held.
- L-RESET-THEN-WRITE and L-WRITE-THEN-RESET: a write is held, reset happens, the write settles;
  reset wins in both orders. Same shape: L-EXIT-THEN-WRITE, L-EXPIRY-THEN-WRITE,
  L-SIGNIN-THEN-WRITE.
- L-RESET-KEEPS-START: reset keeps `startedAt` and `expiresAt` (ruling TEA-1).
- L-RESTORE-SLOW (W and M): restore held; web `/preview` shows "Checking your session", mobile Home
  shows the existing loading state; no gate, no welcome card, no ritual request until it settles.
- L-RESTORE-TRANSIENT (W and M): the profile check fails with 500 or a network error; the retry
  state shows and the stored session survives a reload; 401, 403 and 404 take the signed-out path.
- L-MEMBER-OPENS-PREVIEW (W and M): verified A opens the preview route and lands on `/` or Home;
  wardrobe rows unchanged.
- L-P-CONVERTS: guardian-pending P after the review gets the existing guardian-pending next step and
  every restriction holds; onboarding is not entered.

### P0: conversion (R3, R5)

- U-FROM-LITERAL: `from=preview` is honored; `from=Preview`, `from=preview2`, `from=https://x`,
  repeated `from` and an encoded value are ignored.
- W-CONV-NO-AUTH and M-CONV-NO-AUTH: after a 201 signup response, the `userId` is not stored and no
  comfort or member request is sent; "Sign in to continue" keeps `from=preview`.
- W-CONV-REVIEW: account values from `GET /api/v1/personalization/comfort` and proposed values both
  render; "Keep account preferences" sends nothing, clears guest state and continues.
- W-CONV-ACCEPT: one `PUT` whose body equals the three proposed values; success renders only after
  the read-back `GET` equals them. A read-back that differs shows no success and keeps Retry.
- W-CONV-DOUBLE-TAP: two activations, one `PUT`; the button is disabled while pending.
- W-CONV-FAIL: a 500 keeps the proposal and Retry; no success copy.
- W-CONV-UNCERTAIN: the `PUT` times out after the server committed; the client reads first and shows
  success with no second `PUT`. Variant: the server did not commit; exactly one resubmission.
- W-CONV-403: a 403 for age or consent shows the server message and discards the proposal.
- W-CONV-CANCEL: cancel, Back, validation failure, duplicate email (sign-in offered), OTP failure and
  network failure each return to the same preview state through "Back to preview".
- W-CONV-NEXT: an active account continues to `/wardrobe/onboarding` with every onboarding step
  still incomplete (DB read).
- M-CONV-\*: REVIEW, ACCEPT, DOUBLE-TAP, FAIL and NEXT on `app/preview-continue.tsx` against the
  mobile API double.
- E-CONV-REAL-STACK: guest, signup, OTP through local Mailpit, verified session, accepted
  carryover on the real local authenticated stack with a synthetic account; DB read confirms the
  comfort row equals the proposal.

### P1: functional preview (R10, R11, R12, R14)

- U-ENGINE-GOLDEN: recorded on the current engine before extraction; grid of three comfort runs x
  three wind x three rain x weather set {9, 10, 12, 13, 15, 15.5, 16, 19, 20, 22, 25 feels-like; wind 3,
  3.01, 5, 6.5, 8, 8.01; probability 0.2, 0.204, 0.4, 0.404, 0.6, 0.7, 0.704; amount 0.1, 0.14, 0.46, 0.54, 1.2,
  2.0, 2.05} x two locales; after extraction the engine reproduces every output byte for byte.
- U-RULES-UNITS: each exported rule in `comfort-rules.ts` at both sides of every edge.
- U-SEL-DETERMINISTIC: same state and catalog give the same result over 1,000 runs and after a JSON
  round trip; `SAMPLE_POLICY_VERSION` equals 1.
- U-SEL-MATERIAL: the five D5 pairs, each changing only one control:
  `mild-dry` neutral against cold (layer added at 13);
  `cool-windy` neutral against warm (cold to cool, different layer);
  `cool-windy` wind medium against high (wind requirement drops at 6.5);
  `warm-rainy` rain medium against low (rain requirement drops at 0.6 and 1.2);
  `warm-rainy` neutral against warm (warm to hot at exactly 25, eligible looks change).
  Plus votes: a like moves that look first.
- U-SEL-UNCHANGED-EXPLAINED: a control change that leaves the outfit unchanged adds the
  still-suits explanation key.
- U-SEL-WEATHER-FIRST: a liked look that fails the range never wins; a swap that fails protection
  is ignored with its explanation key.
- U-SEL-EXPLANATION-MATCH: every explanation key's parameters reference a garment or context value
  in the same result object.
- U-SEL-ANOTHER: never returns the current look; cycles in order; with one eligible look returns
  `no-alternative`.
- U-SEL-ALL-DISLIKED and U-SEL-NO-ELIGIBLE: reasons `all-disliked` and `no-eligible` carry no look.
- U-SEL-STALE-SELECTION: an ineligible stored selection falls back to the first in order and the
  explanation reports it.
- U-SWAP: valid alternatives share the category, collection, range and protection needs; an unknown
  or unsuitable id is ignored; "Undo swaps" restores the starting composition.
- U-VOTES: like, not for me, pressing the active choice clears it, reset choices; progress text
  "3 of 9 reviewed" from every locale catalog.
- U-CATALOG-COMPLETE: at least 30 garments and 12 looks, exactly 9 feedback cards; every core is top
  plus bottom or dress, plus shoes; no look carries outerwear; every id resolves and is unique;
  every art key resolves; provenance `authored: 'couture-cast'`, `project-owned`, story `6.16` on
  every garment; womenswear and menswear both present; every category in the enum used.
- U-CATALOG-STRINGS: every garment and look has a name and accessible description in all ten
  locale modules; key sets are identical across locales.
- U-CATALOG-FIXTURE-REACH: under every fixture and comfort combination, the selector returns `ok`
  for the default `all` collection (no default dead end).
- U-STATE-LIMITS: expired, malformed, over 16 KB, wrong schema version and wrong catalog version are
  discarded; the store starts clean.
- U-STATE-RETENTION: activity at 23 h 59 m does not move `expiresAt`.
- U-STORE-EPOCH: a write captured at epoch n is dropped after reset, exit, expiry or identity change
  bumps the epoch.
- X-PARITY: one shared JSON fixture of states and expected results runs in the utils, web and
  mobile suites through each platform's store and renderer; all match.
- W-STORAGE-DENIED and M-STORAGE-DENIED: storage throws on write; the preview continues and shows
  "This preview may reset when you close it."
- W-OFFLINE-AFTER-LOAD: the preview keeps working offline; signup says a connection is needed.
- W-ART-FALLBACK and M-ART-FALLBACK: an unknown art key renders the category glyph with its
  accessible name; reset and navigation still work.
- W-NAV-HISTORY: Back and Forward move across `view=outfit|wardrobe|preferences` and close the swap
  dialog; state kept. M-NAV-BACK: Android Back closes an open sheet, then leaves the preview.
- W-RELOAD-RESUME and M-RESTART-RESUME: valid state resumes the same look, votes, swaps and comfort.
- W-RAPID-CHANGES: several control changes before render settles; the screen equals the selector
  output for the final state, art and copy together.
- W-RESET-EXIT: Reset keeps eligibility and restores defaults; Exit deletes the stored key and the
  next visit shows the gate.

### P1: accessibility and honesty (R15, R17)

- W-A11Y-AXE: axe clean on every surface, the swap dialog, the gate and the review, in all ten
  locales.
- W-A11Y-KEYBOARD: every control operable by keyboard, votes and swaps included.
- W-A11Y-FOCUS: gate, swap dialog and item detail return focus to the opener.
- W-A11Y-SEMANTICS: weather, comfort, wind and rain are radio groups; the current swap item is the
  checked radio; vote buttons expose pressed state.
- W-A11Y-ANNOUNCE and M-A11Y-ANNOUNCE: a result change is announced once.
- W-A11Y-LAYOUT: 44 px targets; no clipping at 320 px and at 200 percent zoom in de-DE, fr-FR and
  pt-PT; reduced motion removes transitions.
- M-A11Y-MAESTRO: TalkBack (PR lane) and VoiceOver (nightly) labels and order on the outfit,
  wardrobe, preferences and review screens; large text on the current SDK, with any live font-scale
  issue recorded under CC-6.15b and new clipping failing.
- W-HONEST-LABEL and M-HONEST-LABEL: the exact D9 label from each locale catalog on every surface,
  garment detail, outfit detail and preference result.
- W-HONEST-NO-CLAIMS: preview DOM has no percent score, live-temperature wording, popularity,
  endorsement or sponsorship text; weather is labeled as an example.
- W-HONEST-HERO: the landing hero demo shows the "Example" label.

### P1: telemetry (R13)

- U-EVENTS-SCHEMA: the three `guest_preview_*` schemas are strict; `action` and `control` are
  closed enums; an extra property fails.
- U-PRIVACY-ALLOWLIST: `analytics-privacy.ts` passes the three events with exactly `platform`,
  `locale`, `catalog_version`, `action`, `control` and `$process_person_profile: false`, and strips
  everything else.
- T-SERIALIZED-WEB and T-SERIALIZED-MOBILE: capture the real SDK request bodies (web route
  intercept, mobile transport double) for a full journey; every event and property key is on the
  allowlist.
- T-NO-PAGEVIEW: no `$pageview` or `$pageleave` for any `/preview` path, `/preview/continue`
  included; mobile sends no screen event for the preview routes.
- T-NO-PII: no date, age band, location, email, vote, `sample:` id, comfort value, token, image or
  URL in any serialized event, inherited super properties included.
- T-BEFORE-ELIGIBILITY: zero events from the gate, before or after a failed attempt.
- T-NO-ACTIVATION: `profile_completed`, `first_outfit_generated` and
  `wardrobe_onboarding_completed` never fire during the guest journey or the review.
- T-RESET-BEFORE-HANDOFF: `reset()` runs before navigation to signup or sign-in; the post-sign-in
  `identify` carries a different anonymous id than the preview events; no `$create_alias`.
- T-SIGNUP-CLICK: `guest_preview_signup_clicked` is the only conversion-side preview event.
- T-FAILURE-SAFE: SDK init failure and a throwing sanitizer leave the preview and the review working.

### Member regression (R16)

- G-SIGNIN-PLAIN (W and M): sign-in without `from=preview` and without intent goes to `/` on web and
  `router.back()` on mobile, as today.
- G-HOME-SIGNED-IN: signed-in mobile Home fetches the ritual as today; the welcome card never shows.
- G-STARTER-WARDROBE: Story 4.4 "Use starter wardrobe" unchanged.
- G-SUITES: the existing Playwright suites for auth session, home, wardrobe onboarding, guardian
  consent, premium, community and share-card run unfiltered on the story head.

## TEA rulings on the frozen spec

- TEA-1: Reset must keep `startedAt` and `expiresAt`. D7 says Reset keeps eligibility; without this,
  repeated resets extend retention past 24 h. Proved by L-RESET-KEEPS-START.
- TEA-2: The sample policy names which engine rain semantics it uses (D5 says rounded, matching the
  badge path). The golden grid pins both engine paths at the disagreeing values so the extraction
  cannot merge them.
- TEA-3: The Android Maestro guest flow joins the PR lane only while that lane stays under 20
  minutes; otherwise it runs nightly with iOS.
- TEA-4: `reset()` before handoff gives a visitor who cancels signup a new anonymous id for the rest
  of the preview. Accepted; T-RESET-BEFORE-HANDOFF asserts it and no merge.
- No disagreement with D1 to D10 beyond these clarifications.

## Seeded-defect proofs

Each runs in a throwaway worktree, is recorded under `_bmad-output/test-artifacts/story-6-16/`, and
must turn the named scenario red.

| ID   | Seeded defect                                             | Must fail                         |
| ---- | --------------------------------------------------------- | --------------------------------- |
| S-1  | Gate passes age 12                                        | U-AGE-BOUNDARY, W-GATE-UNDERAGE   |
| S-2  | Birthdate written into guest state                        | U-STATE-STRICT                    |
| S-3  | Preview route renders without eligibility                 | W-GATE-DIRECT                     |
| S-4  | Comfort `PUT` sent after the signup response              | W-CONV-NO-AUTH                    |
| S-5  | Held `PUT` result applied after an identity switch        | L-APPLY-THEN-SWITCH               |
| S-6  | Store write not checked against the epoch                 | U-STORE-EPOCH, L-RESET-THEN-WRITE |
| S-7  | Transient restore failure clears the stored session       | L-RESTORE-TRANSIENT               |
| S-8  | Wind comparison `>` changed to `>=` in `comfort-rules.ts` | U-ENGINE-GOLDEN, U-SEL-MATERIAL   |
| S-9  | Try another look returns the current look                 | U-SEL-ANOTHER                     |
| S-10 | A disliked look returned when all are disliked            | U-SEL-ALL-DISLIKED                |
| S-11 | `$pageview` for `/preview` let through                    | T-NO-PAGEVIEW                     |
| S-12 | `first_outfit_generated` emitted on a sample result       | T-NO-ACTIVATION                   |
| S-13 | Sample id included in a request body                      | W-NO-SAMPLE-IN-REQUESTS           |
| S-14 | Success shown before read-back                            | W-CONV-ACCEPT                     |
| S-15 | Second tap issues a second `PUT`                          | W-CONV-DOUBLE-TAP                 |
| S-16 | Reset refreshes `startedAt`                               | L-RESET-KEEPS-START               |
| S-17 | Mobile signed-out Home fetches the ritual                 | M-HOME-SIGNED-OUT-NO-FETCH        |
| S-18 | `from` accepts any value                                  | U-FROM-LITERAL                    |
| S-19 | `reset()` skipped before signup handoff                   | T-RESET-BEFORE-HANDOFF            |

## Red-first order for the build

1. U-ENGINE-GOLDEN green on the current engine; then U-RULES-UNITS red; then the extraction.
2. Catalog, strings, art: U-CATALOG-\* red.
3. Selector and swaps: U-SEL-\*, U-SWAP, U-VOTES red; the X-PARITY fixture file.
4. State and store: U-STATE-\*, U-STORE-EPOCH, U-FROM-LITERAL red.
5. Analytics: U-EVENTS-SCHEMA, U-PRIVACY-ALLOWLIST red.
6. Web gate, session and routes: W-GATE-_, L-RESTORE-_ (W), L-MEMBER-OPENS-PREVIEW (W) red; then
   the surfaces and W-\* functional.
7. Mobile Home, gate and routes: M-HOME-_, M-GATE-_, L-RESTORE-\* (M) red; then the surfaces.
8. Conversion: U-FROM-LITERAL wiring, W-CONV-_, M-CONV-_, L-G-\*, L-APPLY-THEN-SWITCH,
   L-READBACK-THEN-SWITCH red.
9. Telemetry: T-\* red against the serialized payload recorders.
10. Accessibility and honesty.
11. E-NO-DB-WRITES, E-GATE-SERVER-WINS, E-CONV-REAL-STACK, then G-\* unfiltered.
12. Seeded defects S-1 to S-19, learning path Step 56, evidence.

## What the tests can and cannot prove

- Eligibility is self-reported; the tests prove the gate and its storage rules, never age.
- AC2 timing (200 ms p95 over 30 changes, first useful preview within 2 s) is measured on the
  documented reference setup and recorded; CI timing is supporting evidence for web only.
- iOS Maestro and VoiceOver run on the nightly and dispatch lanes; PRs carry unit, component, web,
  owned-stack and Android proofs.
- A first web load while offline shows the browser's own error page; nothing is tested there beyond
  the absence of an offline promise in copy.
