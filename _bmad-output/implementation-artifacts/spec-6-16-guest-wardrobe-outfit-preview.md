---
title: 'CC-6.16 Guest wardrobe and outfit preview'
type: 'feature'
ticket: '6-16-guest-wardrobe-outfit-preview'
created: '2026-11-08'
status: 'in-progress'
baseline_revision: '6086faa8'
route: 'full'
route_source: 'owner'
risk: 'high'
review: 'antigravity-plus-coderabbit'
review_source: 'pinned'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/project-context.md'
  - '{project-root}/_bmad-output/project-knowledge/couturecast_brief.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-design-specification.md'
  - '{project-root}/_bmad-output/implementation-artifacts/2-2-comfort-calibration-settings.md'
  - '{project-root}/_bmad-output/implementation-artifacts/4-4-wardrobe-onboarding-silhouette-setup.md'
  - '{project-root}/_bmad-output/test-artifacts/test-design/cc616-guest-wardrobe-outfit-preview-test-design.md'
---

# CC-6.16 Guest wardrobe and outfit preview

Owner draft 2026-11-08 (`spec-6-16-guest-wardrobe-outfit-preview.md`, status draft).
The owner delegated planning to the builder on 2026-11-15; this spec freezes the draft's intent and
turns its decisions into implementation requirements checked against `main` at `6086faa8`.
CC-6.15 stays the Expo SDK 58 work; its remaining steps live in CC-6.15b.
This is acquisition and onboarding work and adds no Community Beta gate.

<frozen-after-approval reason="human-owned intent; change only when the owner renegotiates">

## Intent

**Problem:** A new visitor cannot experience CoutureCast's core value before creating an account
and setting up a wardrobe.
"Use starter wardrobe" (Story 4.4) only records a flag and skips capture; it gives no explorable
closet.
The landing hero is hardcoded text that does not react to any choice.
A signed-out mobile launch lands on Home, calls the guarded ritual API with an empty token, and
shows "Unable to load daily recommendations".

**Approach:** Add an optional, clearly labeled guest preview on web, iOS and Android.
An eligible visitor explores a bundled sample wardrobe, inspects complete sample outfits, makes
reversible choices, and sees how sample weather and the real comfort settings change a sample
recommendation, at once and with a matching explanation.
Account creation stays optional until the visitor wants their own wardrobe or wants to save their
comfort settings, and the only data that can cross into an account is the three comfort values,
after verified sign-in and an explicit review.

**User story:** As a new visitor, I want to try a sample wardrobe and see outfit suggestions
respond to my choices before signing up, so that I can decide whether CoutureCast is useful to me.

**Successful first experience:**

1. Choose "Try a sample wardrobe".
2. Pass the age eligibility gate without creating an account.
3. See a complete outfit, its sample weather and a short explanation.
4. Change a preference or swap a sample garment and see an understandable result immediately.
5. Keep exploring, leave, or create an account without losing the current preview.

### Evidence and interpretation

Wardify's public flow offers sample wardrobe exploration, nine like/dislike cards, optional profile
questions, and a Comfort/Balanced/Style control that changes the sample presentation.
That shows a useful interaction pattern and proves nothing about its backend.
CoutureCast adopts the low-friction trial and the immediate, explainable response.
It copies no Wardify asset, visual identity, gender assumption or claimed technology.

## Decisions

### D1. A separate guest experience with a direct route into the real product

- Web route `/preview` (client page, `apps/web/src/app/preview/`).
  Surfaces are selected by the `view` query parameter (`outfit`, `wardrobe`, `preferences`) so
  browser Back and Forward move between them.
- Mobile route `app/preview.tsx`, a stack screen outside `(tabs)`, rendering
  `src/features/preview/`; the three surfaces are a segmented control inside the screen, and
  Android Back closes an open sheet first, then leaves the preview.
- Web landing (`apps/web/src/app/page.tsx`) gains "Try a sample wardrobe" beside "Start signup",
  and a "Sign in" link.
- Mobile Home decides on the resolved session before fetching.
  Signed out: it renders a signed-out welcome card with "Try a sample wardrobe", "Create account"
  and "Sign in", and sends no ritual request.
  Restoring: the existing loading state.
  Unknown (the profile check threw): a retry state that keeps the stored session.
  Signed in: today's behavior.
- Session restoration completes before either app picks the signed-in or guest state.
  On web, `/preview` shows a bounded "Checking your session" state while a stored session is
  unverified, and a retry state if verification fails for a reason other than 401/403/404.
  A stored session is never erased or treated as a guest because verification was slow or failed
  transiently.
- A verified member who opens `/preview` (web) or the preview route (mobile) is sent to `/` or
  Home. Members keep their Home, navigation and wardrobe; samples never replace them.
- Guest navigation holds only Outfit, Sample wardrobe and Preferences, plus Create account, Sign in,
  Reset preview and Exit preview. No copies of Community, Planner, purchases or settings.

### D2. Age and guardian boundaries stay intact

- The gate runs before any interactive preview content and reuses `evaluateBirthdateInput` from
  `@couture/utils` (`packages/utils/src/age.ts`).
  The birthdate stays in component state, is never sent over the network, never written to storage,
  and is cleared once evaluated.
- `blocked_underage` and invalid input show the existing `AGE_GATE_MESSAGES` copy and an exit path,
  and store nothing.
  A direct link, deep link or resumed state without a valid unexpired eligibility result shows the
  gate first.
- `active` and `pending_guardian_consent` both pass.
  Stored result: `{ eligible: true, expiresAt }`. No age, band or date.
- Ages 13 to 15 see only synthetic, read-only examples, which is all the preview contains.
  The preview grants no real wardrobe, upload, silhouette, community or other guardian-gated access.
- Signup still runs its authoritative server-side age check, and a server age or consent rejection
  clears the conversion proposal and wins over guest state.
- The preview collects no body photo, measurements, gender identity, city, email or device
  location.
- The gate is self-reported eligibility. Copy and docs call it that and never call it verification.

### D3. Samples are a bundled first-party catalog

- Catalog home: `packages/utils/src/sample-wardrobe/` in `@couture/utils`, which web, mobile and API
  already depend on. It is pure TypeScript plus zod.
- Art: first-party vector illustrations authored for this story as SVG path data in
  `sample-wardrobe/art.ts` (shape key plus palette), drawn by a thin renderer on each platform
  (React SVG on web, `react-native-svg` on mobile).
  Provenance in the manifest: `authored: 'couture-cast'`, license `project-owned`, story `6.16`.
  No binary garment assets and no third-party images.
- Manifest `SAMPLE_CATALOG` with `catalogVersion` (starts at `2026-11-15.1`): at least 30 garments
  and 12 looks, 9 of them flagged as feedback cards.
- Garment fields: `id` (`sample:g:<slug>`), `category` (the `garmentCategoryEnum` values),
  `material` (a `garmentMaterialEnum` value, optional), `comfortRanges` (subset of
  `garmentComfortRangeEnum`), `windResistant`, `waterResistant`, `collections`
  (`womenswear`, `menswear`, or both), `art`.
- Look fields: `id` (`sample:l:<slug>`), `collections`, `core` (top plus bottom, or dress, plus
  shoes; optional accessory), `feedbackCard`.
  Looks carry no outerwear; the selector adds a layer when the context calls for one (D5).
- Collection filter: `all` (default), `womenswear`, `menswear`. It describes the examples and asks
  nothing about the visitor.
- Localized names and accessible descriptions for every garment and look live in one shared
  string catalog in the same package, one module per supported locale.
- Sample types are their own (`SampleGarment`, `SampleLook`, `SampleOutfitResult`).
  Nothing is typed or shaped as `RitualResponse`, `GarmentItem`, capsule or community post.
- No sample row is seeded for a guest or a new member: no `GarmentItem`, `OutfitRecommendation`,
  capsule, upload or wardrobe-onboarding row.
- Story 4.4 "Use starter wardrobe" is unchanged.

### D4. Useful before any optional question

The first eligible screen shows a complete sample outfit with garment tiles, labeled sample
weather, a "Why this works" explanation, a working "Try another look", a link to the sample
wardrobe, the preference controls and a Create account action.
No quiz, body question, permission prompt, photo upload, payment or email precedes it.

Optional feedback, nine look cards:

- Each card is Like, Not for me, or unselected. Pressing the active choice clears it.
- Visitors can skip, stop partway, revisit any card, or "Reset choices".
- Progress reads "3 of 9 reviewed". No style-confidence score.
- Likes move a look ahead in ordering. Disliked looks leave "Try another look" until cleared.
- When every eligible look is disliked, an empty state offers "Review choices" and "Reset choices"
  and shows no outfit as a match.
- Copy calls these preview choices; nothing claims they train a model or build a profile.
- Buttons work by tap, click and keyboard; nothing needs a swipe or drag.

### D5. One deterministic, versioned sample policy shared by both clients

Controls:

1. Sample weather: `cool-windy`, `mild-dry`, `warm-rainy`.
2. Thermal comfort: "I tend to feel cold", "About average", "I tend to feel warm"
   (`cold | neutral | warm`).
3. Wind tolerance and rain preparedness (`low | medium | high`), the existing comfort values.
4. Likes and dislikes (D4).

Shared rules: the pure comfort rules move from
`apps/api/src/modules/personalization/ritual-generation.engine.ts` into
`packages/utils/src/comfort-rules.ts`: the wind, rain-probability and rain-amount thresholds and
their getters, the thermal offset (cold minus 3, warm plus 3), `resolveComfortRangeFromTemperature`,
the outerwear cutoff (adjusted feels-like below 15) and `CLOSE_COMFORT_MATCHES`.
The engine imports them, and a golden fixture of engine outputs (TEA `U-ENGINE-GOLDEN`) is green
before and after the move.
Comparisons keep the engine's semantics: strictly greater than the threshold, rain on rounded
probability or rounded amount.

Weather fixtures (metric, labeled as examples, never shown as a live forecast):

| Fixture      | Feels like | Wind m/s | Rain probability | Rain mm |
| ------------ | ---------- | -------- | ---------------- | ------- |
| `cool-windy` | 9          | 6.5      | 0.1              | 0       |
| `mild-dry`   | 16         | 2        | 0                | 0       |
| `warm-rainy` | 22         | 3        | 0.6              | 1.2     |

Those values sit on the thresholds so each control changes something real:
`mild-dry` with cold adds a layer (13, below 15);
`cool-windy` with warm moves cold to cool and changes the layer;
`cool-windy` with wind high drops the wind requirement (6.5 is not above 8);
`warm-rainy` with rain low drops the rain requirement (0.6 is not above 0.7, 1.2 not above 2.0);
`warm-rainy` with warm moves to hot and changes eligible looks.

Policy `selectSampleOutfit(state, catalog)`, version `SAMPLE_POLICY_VERSION = 1`:

1. Context: adjusted feels-like, comfort range, `needsLayer` (below 15), `windLayer`,
   `rainReady`.
2. Eligible looks: in the collection, every core garment suits the range exactly or by the close
   match table, and not disliked.
3. Order: liked first, then catalog order.
4. Selected look: the stored selection if still eligible, else the first in order.
   An ineligible stored selection is reported in the explanation.
5. Layer: needed when `needsLayer`, `windLayer` or `rainReady`. Candidates are outerwear in the
   collection that is wind resistant when `windLayer` and water resistant when `rainReady`; pick the
   exact range, then the close matches in table order, then catalog order.
6. Swaps: a stored swap for the selected look applies when the garment is in the same category,
   the collection, suits the range and meets the protection needs; otherwise it is ignored and the
   explanation says why. Weather and protection beat preference every time.
7. Result: `{ look, garments, context, explanation, alternatives, reason }`, where `explanation` is
   a list of keys with parameters and `reason` is `ok`, `all-disliked` or `no-eligible`.
   The UI renders outfit and explanation from that one object.

"Try another look" moves to the next eligible look in order, cycling, and never returns the current
one; with no alternative it returns `reason: 'no-alternative'` and the UI says so and suggests
a change.
When a preference leaves the outfit unchanged, the explanation says why it still suits.
No LLM, live weather, geocoder or authenticated API is called, and no NestJS or Prisma module enters
a client bundle.

### D6. Inspect and swap sample garments

- Sample wardrobe: category filter (all six categories), collection filter, item detail, and a way
  back to the current outfit that keeps every choice.
- Item detail: name, category, material when defined, comfort ranges, wind and water resistance,
  and the sample label.
- Swap: from an outfit tile, a dialog lists valid alternatives for that category and context as a
  radio group with the current item selected.
  It updates the composition and explanation through the policy and touches only guest state.
- No valid alternative: "No suitable alternative in this sample wardrobe."
- "Undo swaps" restores the look's starting composition.
- No capture, upload, background removal, real-record edit or body-photo processing in guest mode.

### D7. Local, bounded guest state

Schema `guestPreviewStateSchema` (zod, strict) in `@couture/utils`:
`schemaVersion` (1), `catalogVersion`, `startedAt`, `eligibility` (`{ eligible: true, expiresAt }`),
`view`, `weather`, `collection`, `selectedLookId`, `comfort`
(`{ runsColdWarm, windTolerance, precipPreparedness }`, defaults `neutral`, `medium`, `medium`),
`votes` (look id to `like | dislike`), `swaps` (look id to category to garment id),
`conversion` (`{ intent: 'guest-preview-carryover' }` or absent).

- Storage: web `localStorage` key `couturecast.guest-preview`; mobile a JSON file
  `couture-cast-guest-preview.json` through `expo-file-system`.
  Both are separate from auth tokens, settings, ritual caches, widget data and wardrobe onboarding.
- Lifetime: 24 hours from `startedAt`, fixed; activity never extends it. `expiresAt` equals
  `startedAt` plus 24 hours.
- Reload and restart inside that window resume the state on the same browser or device.
  No cross-device promise.
- Expired, malformed, oversized (over 16 KB serialized), schema-mismatched or catalog-mismatched
  state is discarded and the preview starts clean.
- Every id is parsed against the current catalog. Unknown ids are dropped and never reach a path,
  URL or API.
- Storage denied, full or unavailable: the preview runs in memory and shows "This preview may reset
  when you close it."
- "Reset preview" restores defaults and keeps eligibility. "Exit preview" deletes the stored state.
- Writes go through one store per platform with a monotonic epoch.
  Reset, exit, expiry and identity change bump the epoch, and a write from an older epoch is
  dropped, so a late write cannot bring cleared state back.
- A verified sign-in that did not come from the preview deletes guest state.
  Guest state is never read for a member except the conversion proposal in D8.

### D8. Signup keeps context and promises only what exists

Conversion copy separates:

- Can be saved after sign-in: the three comfort settings.
- Preview only: sample items, outfits, likes, collection filter and swaps.
- Still required: account setup, verified sign-in, and guardian approval where it applies.

Flow:

- "Create account" stores `conversion.intent` and opens the existing signup with `?from=preview`.
  `from` accepts only the literal `preview`; anything else is ignored.
- Signup success shows a "Sign in to continue" action that keeps `?from=preview`.
  Cancel, Back, validation failure, duplicate email, OTP failure and network failure all keep the
  preview, and a "Back to preview" link is shown on signup and sign-in when `from=preview`.
- The signup response never authenticates: its `userId` is not stored, not used as identity, and no
  member call is made before verified sign-in.
- Sign-in success with a stored `conversion.intent` routes to the review screen
  (web `/preview/continue`, mobile `app/preview-continue.tsx`) in place of today's `'/'` or
  `router.back()`. Without it, sign-in behaves as today.
- Review: "Use these comfort preferences?" shows the account values from
  `GET /api/v1/personalization/comfort` beside the proposed values.
  "Use preview settings" sends `PUT` with the three values through `@couture/api-client`, then reads
  back with `GET`, and shows success only when the read-back equals the proposal.
  "Keep account preferences" is equally prominent and sends nothing.
- A failed save keeps the proposal with Retry.
  A timeout reads the account values first and resubmits only if they still differ.
  One in-flight application at a time; the button is disabled while pending.
- The review binds to the verified member id and identity epoch at open.
  A response for an older epoch is dropped, and a member change discards the proposal.
- A server 403 for age or consent shows the server message and discards the proposal.
- Declining or completing clears all guest state. Preview choices other than comfort never reach
  the account.
- The review then continues to the real next step: wardrobe onboarding (web
  `/wardrobe/onboarding`, mobile `/wardrobe-onboarding`) for an active account, and the existing
  guardian-pending path for one awaiting consent. No onboarding step is marked complete.

### D9. Honest presentation

Persistent label on every preview surface, garment detail, outfit detail and preference result:

> Sample wardrobe. Example weather and outfits, not your closet or live forecast.

Supporting copy:

> Change a preference to see how this example responds.

Conversion copy:

> Create an account to add your clothes. You can choose to save your comfort preferences after
> signing in. Sample items and preview likes stay in this preview.

- No match percentages, popularity, endorsements, sponsorship, live temperatures or location
  promises.
- The landing's existing hero demo keeps its content and gains an "Example" label so it reads as a
  demonstration; the new entry routes to the labeled preview.
- The preview reuses CoutureCast's typography, theme tokens, hero and garment patterns, focus
  styles and responsive layout.

### D10. Preview analytics stay apart from activation

- Sample actions never emit `profile_completed`, `first_outfit_generated` or
  `wardrobe_onboarding_completed`.
- New client events in `packages/api-client/src/types/analytics-events.ts` and the privacy allowlist
  in `analytics-privacy.ts`: `guest_preview_started`, `guest_preview_interacted`,
  `guest_preview_signup_clicked`.
  Properties: `platform`, `locale`, `catalog_version`, plus `action` and `control` from closed enums.
  Nothing else: no birthdate, age band, location, ids, votes, preference values, images, email,
  tokens or URLs.
- Events start only after eligibility, follow the existing analytics posture (the apps have no
  consent banner; the SDK is off without a key), and send `$process_person_profile: false`.
- Automatic capture: the web `before_send` filter drops `$pageview` and `$pageleave` for `/preview`
  paths, and mobile skips manual screen tracking for preview routes. The gate is never recorded.
- Before handing off to signup or sign-in from the preview, the client calls the SDK `reset()`, so
  the later `identify` cannot merge preview history into the member.
- An analytics failure never blocks the preview or the conversion.
- A signup click is reported as a click, never as a signup or conversion.

## Boundaries & Constraints

**Always:**

- Work without an account, personal wardrobe, permission prompt or external personalization call
  once the app has loaded.
- Keep server authorization, RLS, guardian checks, entitlement gates and community rollout controls
  as they are.
- Validate stored state and catalog input with strict schemas.
- Use only first-party sample content with recorded provenance.
- Keep samples out of wardrobe counts, free-tier limits, billing, recommendations, share-card
  sources, widgets, exports, community and activation metrics.
- Localize every new string and accessible name in en-US, en-CA, es-419, fr-CA, fr-FR, tr-TR,
  de-DE, it-IT, pt-BR and pt-PT.
- Support reduced motion, 44-point targets, keyboard, VoiceOver, TalkBack, Android Back, browser
  Back and Forward, and dismissible overlays that restore focus.
- Keep member journeys and the CC-6.15b scope untouched.

**Never:**

- Create an anonymous Supabase account, shared demo user, impersonation token or fake wardrobe row.
- Remove an auth guard to make the guest flow work.
- Request location, camera, photo library, notifications, contacts or tracking permission.
- Save likes or dislikes to any account field, or import sample clothes into an account.
- Add virtual try-on, body analysis, a style taxonomy, social browsing, shopping, premium trials or
  seven-day planning.
- Change production settings or flags, or treat this as Community Beta sign-off.

</frozen-after-approval>

## I/O & Edge-Case Matrix

| Scenario                              | Input / state                         | Expected behavior                                         |
| ------------------------------------- | ------------------------------------- | --------------------------------------------------------- |
| First eligible visit                  | No account, no guest state            | Gate, then a complete labeled outfit; controls optional   |
| Underage or invalid date              | Gate fails                            | No preview, nothing stored, no guest event                |
| Direct preview link                   | No eligibility                        | Gate first                                                |
| Session restoring                     | Stored session unverified             | Bounded checking state; no guest entry, no erase          |
| Session check fails transiently       | Profile call errors (not 401/403/404) | Retry state; session kept                                 |
| Member opens preview                  | Verified member                       | Sent to `/` or Home; wardrobe untouched                   |
| Preference change                     | Valid value                           | Deterministic result and matching explanation; no network |
| Rapid changes                         | Several inputs before render          | Latest state wins; no stale explanation                   |
| Partial or skipped feedback           | Any votes                             | Preview usable; votes editable                            |
| All looks disliked                    | Every eligible look disliked          | Empty state with Review and Reset                         |
| One eligible look                     | Try another look                      | `no-alternative` message and a suggested change           |
| Invalid swap                          | Unknown or unsuitable id              | Ignored; last valid outfit kept; explanation says why     |
| Art failure                           | Unknown art key                       | Category glyph fallback with accessible name              |
| Offline after load                    | Bundle loaded                         | Preview works; signup says a connection is needed         |
| First web load offline                | Bundle missing                        | Browser error page; no offline promise                    |
| Storage unavailable                   | Write throws                          | In-memory with the reset disclosure                       |
| Expired or changed catalog            | Old state                             | Discarded; clean start                                    |
| Reset during pending write            | Older write in flight                 | Reset wins                                                |
| Signup cancelled                      | Conversion intent stored              | Same preview restored                                     |
| Signup succeeded                      | No session                            | Sign in to continue; no comfort call                      |
| Existing member signs in from preview | Account has values                    | Review shows both; nothing overwritten without consent    |
| Save times out                        | Outcome unknown                       | Read first, resubmit only if different                    |
| Identity changes during save          | Different member                      | Old result dropped; proposal discarded                    |
| Guardian pending                      | Server restrictions                   | Restrictions hold; existing next step                     |
| Analytics down                        | SDK throws                            | Preview and conversion unaffected                         |
| Back, Close, repeat                   | Overlay or auth step                  | Predictable history, state kept, focus restored           |

## Code Map

**Shared**

- `packages/utils/src/age.ts`: `evaluateBirthdateInput`, `AGE_GATE_MESSAGES`.
- `packages/utils/src/comfort-rules.ts` (new): thresholds, offsets, range, close matches.
- `packages/utils/src/sample-wardrobe/` (new): `catalog.ts`, `art.ts`, `selector.ts`, `state.ts`,
  `strings/<locale>.ts`, `index.ts`.
- `packages/api-client/src/contracts/http/comfort.ts`, `wardrobe.ts`: enums reused.
- `packages/api-client/src/types/analytics-events.ts`, `src/analytics-privacy.ts`: guest events and
  allowlist; `$pageview` route filter.
- `apps/api/src/modules/personalization/ritual-generation.engine.ts`: imports the shared rules.

**Web**

- `apps/web/src/app/page.tsx`: entry links. `components/lookbook-prism-layout.tsx`: Example label.
- `apps/web/src/app/preview/` (new): page, `continue/` review, components, store.
- `apps/web/src/app/signup/signup-form.tsx`, `apps/web/src/app/signin/page.tsx`: `from=preview`.
- `apps/web/src/lib/web-session.ts`: session state read (no behavior change).
- `apps/web/src/analytics/browser-analytics.ts`: reset helper, route filter.
- `apps/web/src/i18n/`: shared preview strings merged; chrome strings in all 10 catalogs.

**Mobile**

- `apps/mobile/app/(tabs)/index.tsx`: signed-out welcome card, no signed-out ritual fetch.
- `apps/mobile/app/preview.tsx`, `app/preview-continue.tsx` (new); `src/features/preview/` (new).
- `apps/mobile/app/signup.tsx`, `app/signin.tsx` and `src/features/signup/`: `from=preview`.
- `apps/mobile/src/lib/native-session.ts`, `mobile-auth.ts`: identity epoch for the review.
- `apps/mobile/app/_layout.tsx`: skip screen tracking for preview routes.
- `apps/mobile/assets/locales/`: chrome strings in all 10 catalogs.

**Tests**

- `packages/utils/src/**/*.spec.ts`, `apps/web/src/**/*.test.tsx`, `apps/mobile/src/**/*.test.tsx`.
- `playwright/tests/guest-preview*.spec.ts`; `maestro/guest-preview*.yaml`.

No new table, endpoint or contract change.

## Tasks & Acceptance

### Execution

- [ ] Register 6-16 in `sprint-status.yaml`.
- [ ] Golden-fixture the engine, then extract `comfort-rules.ts`.
- [ ] Catalog, art, strings, selector and state schema with unit tests.
- [ ] Web gate, preview, wardrobe, preferences, feedback, swaps, reset, exit and store.
- [ ] Mobile signed-out Home, gate, preview and store.
- [ ] Signup and sign-in `from=preview`; review screens on both platforms.
- [ ] Guest analytics events, route filter and SDK reset.
- [ ] Localization, accessibility, labels and art fallback.
- [ ] Playwright and Maestro journeys plus member regressions.
- [ ] Learning path Step 56 and evidence under `_bmad-output/test-artifacts/story-6-16/`.

### AC1. Value before signup

Given a signed-out eligible visitor on web, iOS or Android, when they open the preview, then they
see a complete sample outfit and can browse the sample wardrobe without an account, upload,
permission or optional question.

### AC2. Genuine immediate feedback

Given a loaded sample, when the visitor changes each control, then the result follows the shared
policy and its explanation matches the outfit, and each control has a fixture that materially
changes the result.
Input to updated result is at most 200 ms at p95 over 30 changes on the documented reference
setup, and the first useful preview renders within 2 seconds; measured values are recorded.

### AC3. Explorable samples and reversible choices

Given any sample outfit, when the visitor inspects, filters, swaps, votes or tries another look,
then every action has a real result, can be undone, and changes only guest state.

### AC4. Honest content

Given any preview surface, the sample label is visible, weather is called an example, and nothing
claims personalization, live conditions, popularity, sponsorship or ownership.

### AC5. Bounded continuity

Given valid unexpired guest state, reload, restart, auth cancellation and Back resume the preview.
Reset, exit, expiry, corrupt storage and version changes recover cleanly, and late writes cannot
restore cleared data.

### AC6. Safe conversion

Only a verified session applies comfort values, after an explicit review, through the existing
comfort API, with success shown only after read-back.
Samples and votes are never imported, account values are never silently overwritten, and wardrobe
onboarding is never marked complete.

### AC7. Age, identity and authorization isolation

Under-13 visitors cannot enter by UI or direct route. Guest activity never authenticates or weakens
a server guard. Guardian restrictions hold. Member A's data or pending work never shows for member
B or a signed-out visitor.

### AC8. Accessibility and localization

New controls, feedback and disclosures work in all ten locales and meet WCAG 2.2 AA, with keyboard,
VoiceOver, TalkBack, focus restoration, reduced motion, narrow screens and large text covered.
Initial large text is tested on the current SDK; the known live font-scale defect belongs to
CC-6.15b and excuses no new clipping.

### AC9. No product-data or analytics contamination

A full guest journey writes no member, garment, recommendation, capsule, upload, onboarding,
billing or community row, touches no widget cache, and emits no activation event.
Captured payloads match the allowlist.

### AC10. Member journeys intact

Verified sign-in, Home ritual, wardrobe onboarding, guardian flow, premium gates, community
controls and share-card journeys keep working, with regression proof on the changed entry,
navigation and identity boundaries.

## Implementation Notes

Pending build.

## Plan Change Log

- 2026-11-15: Owner draft frozen into this spec by the builder under delegated planning.
  Changes from the draft, each from code checked at `6086faa8`:
  - No comfort settings screen exists on web or mobile, so the review screen is the first client
    consumer of `ComfortApi`.
  - Web sign-in hardcodes `'/'` and mobile sign-in calls `router.back()`; `from=preview` and the
    stored intent replace an open return URL, so no redirect allowlist is needed.
  - The landing renders the same for members and guests and had no sign-in link; one is added.
  - Mobile signed-out Home showed a failed ritual request; it now renders a welcome card.
  - The repo has no garment images; art is first-party vector data in `@couture/utils`.
  - Engine wind and rain affect badges only; the sample policy turns them into a protective-layer
    requirement, which the draft's "protection requirement" allows, and labels it as sample policy.
  - Analytics: added the `reset()` handoff, because `identify` would otherwise merge the anonymous
    preview history into the member.

## Review Triage Log

Pending.

## Test Design (TEA)

Full plan, reconciled to the frozen Intent and Decisions (this spec wins on any disagreement):
`_bmad-output/test-artifacts/test-design/cc616-guest-wardrobe-outfit-preview-test-design.md`.
17 risks, 11 high; R4 (guest state or a pending carryover crossing identities) scores 9 until
every `L-*` ordered pair is built and its seeded defect is proved red.
97 scenario entries: P0 47 (eligibility 11, isolation 8, lifecycle pairs 16, conversion 12),
P1 46 (functional 26, accessibility and honesty 10, telemetry 10), member regression 4.
Entries marked W and M run on both platforms.
20 seeded-defect proofs (S-1 to S-20) run in a throwaway worktree and are recorded under
`_bmad-output/test-artifacts/story-6-16/`.

TEA rulings on the frozen spec (clarifications, no decision reversed):

- TEA-1: "Reset preview" keeps `startedAt` and `expiresAt`, so resets cannot extend retention past
  24 hours (`L-RESET-KEEPS-START`, S-16).
- TEA-2: the engine has two rain paths that disagree at probability 0.704 and amount 0.54 (comfort
  notes compare raw values, badges compare rounded ones). `U-ENGINE-GOLDEN` pins both, and the
  sample policy uses the rounded badge semantics named in D5.
- TEA-3: the Android Maestro guest flow joins the PR lane only while that lane stays under 20
  minutes; otherwise it runs nightly with iOS.
- TEA-4: `reset()` before the signup handoff gives a visitor who cancels a new anonymous id for the
  rest of the preview. Accepted; `T-RESET-BEFORE-HANDOFF` asserts it and that nothing merges.
- TEA-5: padded whitespace in the gate passes because D2 reuses the signup rule, which trims.
- TEA-6: web guest state lives in shared `localStorage`, so the web store listens to the `storage`
  event; an external change bumps the epoch, drops queued writes and re-reads
  (`L-CROSS-TAB-*`, S-20).
- TEA-7: the review shows the localized rejected copy on a 403 where D8 says server message;
  accepted, because it states the same refusal in every locale.
- TEA-8: Maestro guest flows run in a signed-out mode of `scripts/run-maestro.mjs`: Metro without
  either E2E token and with `EXPO_PUBLIC_E2E_AUTH_MODE=real`, `clearState` on launch, in their own
  shard. A sign-out step cannot work because the fixture token wins over the native session.
- TEA-9: the mobile preview always shows that creating an account needs a connection. Accepted:
  it states a requirement and claims no network status, so no NetInfo dependency is added.

Red-first order for the build:

1. `U-ENGINE-GOLDEN` green on the current engine (grid includes 9, 10, 12, 13, 15, 16, 19, 20, 22,
   25 feels-like; wind 3, 3.01, 5, 6.5, 8, 8.01; probability 0.2 to 0.705; amount 0.1 to 2.05; two
   locales), then `U-RULES-UNITS` red, then the extraction.
2. Catalog, strings and art: `U-CATALOG-*` red.
3. Selector and swaps: `U-SEL-*`, `U-SWAP`, `U-VOTES` red, with the five D5 material pairs; the
   shared `X-PARITY` fixture file.
4. State and store: `U-STATE-*`, `U-STORE-EPOCH`, `U-FROM-LITERAL` red.
5. Analytics: `U-EVENTS-SCHEMA`, `U-PRIVACY-ALLOWLIST` red.
6. Web gate, session check and routes: `W-GATE-*`, `L-RESTORE-*`, `L-MEMBER-OPENS-PREVIEW` red,
   then the surfaces.
7. Mobile Home, gate and routes: `M-HOME-SIGNED-OUT-NO-FETCH`, `M-GATE-*`, `L-RESTORE-*` red, then
   the surfaces.
8. Conversion: `W-CONV-*`, `M-CONV-*`, `L-G-*`, `L-APPLY-THEN-SWITCH`, `L-READBACK-THEN-SWITCH` red.
9. Telemetry: `T-*` red against the real serialized SDK payloads.
10. Accessibility and honesty: `W-A11Y-*`, `M-A11Y-*`, `*-HONEST-*`.
11. `E-NO-DB-WRITES`, `E-GATE-SERVER-WINS`, `E-CONV-REAL-STACK`, then the `G-*` suites unfiltered.
12. Seeded defects S-1 to S-20, learning path Step 56, evidence.

Build rules the tests rely on:

- The storage adapter and the comfort API double each expose a deferred hold, so every race is
  forced in both orders without sleeps.
- One recorder per platform captures every outgoing request and every serialized analytics body;
  isolation and telemetry scenarios assert on it with exact keys.
- `X-PARITY` reads one JSON fixture from `packages/utils`; web and mobile render through their real
  store and renderer.
- E2E proofs use an isolated `DATABASE_URL`, `PLAYWRIGHT_SKIP_DB_RESET=true`, synthetic accounts and
  local Mailpit for the OTP.

What the tests can and cannot prove: eligibility is self-reported, so the tests prove the gate and
its storage rules, never age. AC2 timing is measured on the documented reference setup and recorded;
CI timing supports web only. iOS Maestro and VoiceOver run nightly and on dispatch; PRs carry unit,
component, web, owned-stack and Android proofs. A first web load while offline shows the browser's
own error page and is not tested beyond copy making no offline promise.

## Verification

- Focused package, web and mobile unit tests; `npm run verify:changed`; `npm run validate`.
- Playwright guest, signup, verified-session and onboarding suites with an isolated
  `DATABASE_URL` and `PLAYWRIGHT_SKIP_DB_RESET=true`.
- Android Maestro guest flow on the PR lane; iOS flows run in the nightly native lane.
- Database state before and after a guest journey; captured network and analytics payloads.
- Results under `_bmad-output/test-artifacts/story-6-16/`.
