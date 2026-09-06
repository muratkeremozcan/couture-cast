---
baseline_commit: c0bc45d8f08d8b82a496029029f76d5cdc8719d4
status: done
---

<!-- markdownlint-disable MD013 MD024 MD036 -->

# Story 5.4: Color palette & beauty/accessory advisor

Status: done

**Story key:** `5-4-color-palette-beauty-accessory-advisor` · **Epic:** 5 — Commerce & Premium Enhancements (Phase 2)
**Baseline commit:** `c0bc45d8` (branch `feat/epic5-story4`, clean, tip of `main` after story 5.3's mobile surface PR #137 and the Maestro sharding PRs #138/#139)
**Prepared:** 2026-08-25 by the create-story workflow, from exhaustive analysis of `epics.md`, `prd.md`, `architecture.md` (ADR-014 in particular), the UX specification, story 5.3 (`done`), story 5.2's entitlement primitives, story 5.1's commerce machinery, story 4.4's photo-upload lifecycle, story 4.2's colour processor, and live-codebase research across the wardrobe, commerce, config, db, testing and i18n workspaces.

## Story

As a Premium user,
I want makeup and accessory suggestions tailored to my tones
so that I complete the look.

(Verbatim from `epics.md:448`.)

## Traceability: epic AC → story AC

| Epic AC (`epics.md:451-453`)                                                              | Story AC   | Kind                                                                                                                                       |
| ----------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Accept selfie or wardrobe feed to derive undertone palette with explicit consent flow  | AC 1, 2, 3 | Split three ways: consent (AC 1), the wardrobe source (AC 2), the selfie source (AC 3). One epic line, three real subsystems               |
| 2. Recommend foundation/blush shades and accessory pairings with optional sponsored links | AC 4, 5    | Split: first-party recommendations (AC 4), the optional sponsored overlay (AC 5)                                                           |
| 3. Provide clear disclosure for sponsored suggestions and allow user to dismiss/save      | AC 6       | Direct                                                                                                                                     |
| —                                                                                         | AC 7       | Derived from `epics.md:566` ("CC-5.2 gates CC-5.4") and FR "Premium experience shall include custom color palette analysis" (`prd.md:206`) |
| —                                                                                         | AC 8       | Derived from repo convention (ten locale catalogs × two surfaces) and `prd.md:266` accessibility                                           |
| —                                                                                         | AC 9       | Derived from `epics.md:576` ("Respect consent flows around images … and color analysis (CC-5.4); log opt-ins")                             |

## Acceptance Criteria

1. **Explicit, revocable, server-enforced consent.** No image is read and no analysis runs until the user has granted palette-analysis consent through a real control (not a hardcoded literal — see Decision 5 for why that distinction is called out). Consent is a persisted, revocable fact on `PaletteProfile` (`consent_granted_at` / `consent_revoked_at`), enforced **server-side on every analysis and read path**, and every grant and revoke writes an immutable `AuditLog` row (`epics.md:576` says "log opt-ins", which is an audit requirement, not a telemetry one). Revoking consent erases the derived palette and any retained selfie bytes in the same transaction-plus-purge as `DELETE` (Decision 9).

2. **Wardrobe source.** With consent granted, an entitled user can derive a palette from their existing wardrobe with no new image upload. The derivation aggregates the `PaletteInsights.hex_codes` rows story 4.2's `WardrobeColorProcessor` already writes (`wardrobe-color.processor.ts:172-184`) and classifies a **warm / cool / neutral / olive** undertone from them. It sets `depth` to `null` — clothing colour cannot evidence skin depth, and pretending otherwise is the single most likely thing to be silently faked here (Decision 3). Fewer than `MIN_WARDROBE_SAMPLES` (Decision 3) usable rows fails cleanly with `insufficient_wardrobe`, never with a guessed answer.

3. **Selfie source.** With consent granted, an entitled user can upload one selfie through the allocate → PUT bytes → commit → queue → analyse lifecycle that story 4.4 already established for the "My Form" photo, producing **undertone and depth**. **The selfie bytes are purged from storage as soon as the analysis terminates, success or failure** (Decision 8) — only the derived scalars persist. This is what ADR-014's "only derived metadata surfaces to clients" (`architecture.md`, ADR-014) means when the image is of a face rather than a garment, and it is asserted by tests, not merely intended.

4. **First-party recommendations.** A ready palette yields, from a versioned, deterministic rule table (Decision 6): foundation guidance, two blush shades, and accessory pairings across the three accessory slots the PRD names — jewelry, bags, eyewear (`prd.md:207`). The same `(undertone, depth)` input always yields the same output, and a `depth: null` (wardrobe-sourced) palette yields undertone-family foundation _guidance_ rather than a shade match, with copy that says so. No LLM, no model download, no external service.

5. **Optional sponsored overlay.** Zero or one affiliate offer may attach to each advisor slot, resolved server-side through story 5.1's existing catalog, click-token and deep-link machinery — extended, not duplicated (Decision 7). A slot with no matching offer renders its first-party recommendation alone. No URL ever reaches the client; the outbound link is minted at click time by `POST /api/v1/commerce/affiliate/clicks`, exactly as 5.1 requires.

6. **Disclosure, dismiss and save.** Every sponsored suggestion renders a disclosure in reading order **before** the control it describes, following `commerce-preferences-section.tsx:165-173`'s established shape. Each recommendation — sponsored or not — can be saved or dismissed, persisted per user in `AdvisorRecommendationState`, surviving reload and cross-device sign-in. A dismissed suggestion does not reappear on the next read. `CommercePreference.affiliate_ctas_enabled = false` suppresses the sponsored overlay here too, because it is the user's existing global commerce opt-out and a second, contradicting switch would be a dark pattern the PRD forbids (`prd.md:47`).

7. **Entitlement and kill-switch gating.** Every write path except `DELETE` mounts `PremiumEntitlementGuard` (a lapsed subscriber must always be able to erase their data — Decision 9); a non-entitled or signed-out reader sees the locked upsell panel, following the same shape 5.3 shipped (`premium-theme-section.tsx`, itself following `planner-rail.tsx:81-96`). The `color_analysis_enabled` flag becomes this feature's kill switch and **its registry default flips `true` → `false`** to match every other premium/commerce gate's fail-closed posture (Decision 10). Guardian consent still gates uploads for under-16 accounts through the existing `WardrobeUploadGuard`, unchanged.

8. **Localization and accessibility.** New keys under `commerce.premium.palette.*` ship in all ten locale catalogs on both surfaces (`de-DE`, `en-CA`, `en-US`, `es-419`, `fr-CA`, `fr-FR`, `it-IT`, `pt-BR`, `pt-PT`, `tr-TR`), with a new dedicated parity spec per surface plus the one-line subtree exclusion in the parent `premium-locales.spec.ts` (Decision 12 — 5.3 learned this the hard way). Both new surfaces pass axe WCAG2A/WCAG2AA at 1440×900 and 375×812, signed out and signed in.

9. **RLS, retention and analytics.** `PaletteProfile` and `AdvisorRecommendationState` register in `selfOnlyTables` (`packages/db/test/rls/harness.ts:33-50`) and pass the full actor matrix. Three server-side pseudonymous events register across all three analytics registries (Decision 13). Both new tables join the cleanup delete order and the account-erasure path.

## Decisions

### Decision 1 — Read this first: what already exists, and what this story must not rebuild

Four subsystems this story needs are already built, tested and shipped. Building any of them again is the primary failure mode available here.

| Need                          | Already exists                                                                                                                                                                      | What this story does                                                 |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Per-garment colour extraction | `WardrobeColorProcessor.extractDominantHex` (Sharp `.stats()` channel means) writing `PaletteInsights.hex_codes` + `confidence_score` (`wardrobe-color.processor.ts:47-61,172-184`) | Reads those rows. Does not re-extract, does not touch the processor  |
| User-photo upload lifecycle   | `SilhouetteProfile.my_form_*` — allocate/PUT/commit/BullMQ/moderate/ready-or-failed (`wardrobe-silhouette.service.ts`, `silhouette-photo.processor.ts`)                             | Mirrors the shape on a new model. Does not touch `SilhouetteProfile` |
| Entitlement check + locked UI | `PremiumEntitlementService.hasPremiumAccess`, `PremiumEntitlementGuard`, `premium-theme-section.tsx`'s locked panel                                                                 | Mounts the guard, copies the panel shape                             |
| Affiliate money machinery     | `CommercePartner`/`AffiliateOffer`/`AffiliateClick`/`AffiliateConversion`, HMAC click tokens, deep-link host validation, conversion webhook (story 5.1)                             | Extends the offer table by two nullable columns. Duplicates nothing  |

**The one genuinely new thing is undertone classification.** `PaletteInsights.undertone` is a free-text `String?` column that has existed since the initial migration (`schema.prisma:466`, `20251125180510_init/migration.sql:107`) and that **no application code has ever written**. Confirmed by reading every writer: the only runtime upsert (`wardrobe-color.processor.ts:172-184`) sets `hex_codes` and `confidence_score` and omits `undertone`.

Two non-runtime writers do exist and must not be broken: `packages/db/prisma/seeds/wardrobe.ts:99,108` writes the literal strings `'cool'`/`'warm'` into it for 25 seeded rows, and `packages/db/test/rls/harness.ts:263` inserts it in the RLS scenario. **Leave `PaletteInsights.undertone` exactly as it is** — do not convert it to the new `SkinUndertone` enum, do not backfill it, and do not read it. This story's undertone lives on `PaletteProfile`; the old column is a four-month-old placeholder whose only consumers are fixtures, and repurposing it would break both of them for no gain.

### Decision 2 — Processing location: server-side, Sharp-only. Three source documents disagree; the ADR and the shipped code win

`ux-design-specification.md:409` states the pipeline is "an in-house build using **on-device** palette detection so user imagery never leaves CoutureCast's boundary." `architecture.md` ADR-014 states the opposite in detail: "**Server-side processing (not on-device)** … NestJS worker … Sharp (image resize) → ONNX Runtime … On-device processing rejected due to: (1) model size (50+ MB) would bloat mobile bundle, (2) inconsistent device performance … (3) centralized processing enables palette quality monitoring."

ADR-014 is dated 2025-11-13, three days after the UX spec, was written specifically to close the PRD's open question (`prd.md:294`), and — decisively — **the shipped pipeline is already server-side**: `WardrobeColorProcessor` runs Sharp inside the API. Building an on-device path now would mean two colour pipelines with different answers. Server-side, in the API, is what this story does. The UX spec line is stale; do not cite it as a requirement and do not "restore" on-device processing.

A third document leans the same stale way: the PRD's open question (`prd.md:294`) asks to "confirm **on-device** processing constraints, privacy posture, and performance budgets before CC-5.4," and the readiness report escalated exactly that as a CC-5.4 blocker (`refs/implementation-readiness-report-2025-11-13.md:242-245`, "Architecture defines NestJS worker (server-side), but PRD implies potential on-device option"). ADR-014 is the answer to that question, not another voice in it. ADR-014 answers the posture for wardrobe images ("images stay in Supabase Storage with user-scoped access; only derived metadata surfaces to clients") and gives a budget ("~3-5s per image; GPU fallback to CPU in CI"). A **face** photo is more sensitive than a garment photo, so this story tightens the posture rather than merely inheriting it: see Decision 8's immediate-purge rule. Record in `deferred-work.md` how the blocker was discharged, so a later reader does not think the gate was skipped.

**One deliberate divergence from ADR-014, stated so review does not read it as an oversight.** ADR-014 prescribes "Sharp (image resize) → ONNX Runtime (color inference using pre-trained model)". This story takes ADR-014's _location_ decision (server-side), its _privacy posture_ (derived metadata only) and its _budget_, and declines the ONNX step: the output here is one four-way and one five-way classification that closed-form CIELAB colour science settles exactly, and the repo's only ONNX consumer already carries a 50 MB model directory plus a `GARMENT_TAGGING_MODEL_DIR` cache and a `verify:tagging-model` prestart gate for a genuinely learned task. Adding a second model to decide `warm | cool | neutral | olive` would buy nothing and cost a deploy-time artifact. Record the divergence in `deferred-work.md` against ADR-014 so the ADR can be amended rather than quietly contradicted.

### Decision 3 — Undertone classification: ITA° over CIELAB, with Sharp only. No model, no new dependency

`sharp@^0.34.5` is already a direct dependency of `apps/api` (`apps/api/package.json`). ONNX Runtime is present only inside story 4.2's FashionCLIP worker with its own 50 MB model directory and a `GARMENT_TAGGING_MODEL_DIR` cache; standing up a second model for a four-way classification would be a large cost for a small decision. **Do not add a model, and do not add a colour library** (`culori`, `chroma-js` and friends are not dependencies of this repo).

The classification is standard, published colour science, implemented as pure functions in `packages/utils` — the same home story 5.3 chose for `contrast.ts`, and the same reasoning: the maths is needed by the API and by tests, and it is not app-specific.

**Task 2 opens by making `contrast.ts`'s linearization reusable, because today it is not.** `contrast.ts` exports only `contrastRatio`, `meetsWcagAA` and the two ratio constants (`packages/utils/src/index.ts`). `parseHex` (`contrast.ts:60-83`) and `relativeLuminance` (`:86-94`) are module-private, and `relativeLuminance` collapses the three linearized channels into a single 709-weighted scalar inside one function — it never yields the per-channel linear values CIEXYZ needs. So the first step is to export two pure helpers from `contrast.ts` and refactor `relativeLuminance` to compose them, with no behaviour change:

```ts
/** 0-255 sRGB channels from #RGB, #RRGGBB, or either without the leading #. */
export function srgbChannels(value: string): [number, number, number]
/** WCAG/sRGB gamma-expansion of one 0-255 channel to linear [0, 1]. */
export function linearizeSrgbChannel(channel: number): number
```

`contrast.spec.ts` keeps its existing assertions unchanged as the proof the refactor was behaviour-preserving. Note the real input contract while you are in there: `contrast.ts` accepts `#RGB`, `#RRGGBB` and both without the `#`, and **throws** on anything else, including eight-digit `#RRGGBBAA`, because it cannot composite alpha against an unknown backdrop. `skin-tone.ts` inherits that contract exactly rather than inventing a second one.

`packages/utils/src/skin-tone.ts` (new, sibling to `contrast.ts` and `accessibility.ts`, same pure-function style, no classes), exported from `packages/utils/src/index.ts`:

```ts
export type SkinUndertone = 'warm' | 'cool' | 'neutral' | 'olive'
export type SkinDepth = 'fair' | 'light' | 'medium' | 'tan' | 'deep'

export type Lab = { L: number; a: number; b: number }

export function srgbToLab(hex: string): Lab
export function linearRgbToLab(rgb: readonly [number, number, number]): Lab
export function individualTypologyAngle(lab: Lab): number | null
export function classifyDepth(ita: number): SkinDepth
export function chroma(lab: Lab): number
export function hueAngleDegrees(lab: Lab): number
export function classifyUndertone(lab: Lab): SkinUndertone
```

- **`srgbToLab` / `linearRgbToLab`** — sRGB → linear RGB (via `linearizeSrgbChannel`, never a second copy) → CIEXYZ under the **D65** white point, sRGB's own illuminant → CIELAB. `linearRgbToLab` is the entry point the pixel pipeline uses, because **averaging must happen in linear space, never on gamma-encoded bytes**: the mean of two sRGB byte values is not the colour halfway between them, and `WardrobeColorProcessor.extractDominantHex` already takes that approximation (`.stats()` channel means over gamma-encoded data). Reproducing it here would bias every derived undertone toward the darker input.
- **`individualTypologyAngle`** — `ITA° = arctan((L* − 50) / b*) × 180 / π`, the Chardon Individual Typology Angle, the standard instrument for skin-tone classification, and what makes `depth` a defensible scalar rather than a guess. It **returns `null` when `b* ≤ 0`**: the formula is undefined there and a bluish mean is not skin. A `null` ITA terminates the analysis as `failed` / `low_quality`; it never falls through to a band.
- **`classifyDepth`** — the published ITA° bands, with the literature's brown and dark bands collapsed onto `deep` because the enum has five members: `ITA > 55` → `fair`, `41 < ITA ≤ 55` → `light`, `28 < ITA ≤ 41` → `medium`, `10 < ITA ≤ 28` → `tan`, `ITA ≤ 10` → `deep`. **Exclusive-lower, inclusive-upper**, which is the published convention and — unlike an inclusive-lower reading — is total: every real number lands in exactly one band, and the four boundary values 55, 41, 28 and 10 are not orphaned. Pin all four boundaries plus one value inside each band in a unit test so a later refactor cannot shift a band by one degree unnoticed.
- **`classifyUndertone`** — on the CIELAB **hue angle**, `h° = atan2(b*, a*)` in degrees wrapped to `[0, 360)`, not on a `b*/a*` ratio. A ratio divides by `a*`, which is near zero for neutral skin and genuinely negative for a wardrobe mean pulled green or cyan, so it both blows up and silently inverts the comparison at exactly the inputs this feature has to get right. `atan2` is defined everywhere except `a* = b* = 0`, which `chroma()` already screens. The rule: `neutral` when `chroma(lab) < NEUTRAL_CHROMA_MAX` (too little colour to call); otherwise `olive` when `h°` falls in `[OLIVE_HUE_MIN, OLIVE_HUE_MAX)` — the yellow-green wedge above the warm band, the quadrant a warm/cool axis alone mislabels and the omission most likely to be reported as a bug by real users; `warm` below `WARM_HUE_MAX`; `cool` above `COOL_HUE_MIN`. Export every threshold as a named constant with its reasoning in a docblock, so tuning one is a one-line reviewable change rather than an archaeological dig.

**Getting skin pixels out of a selfie without a face detector — the step that makes `no_face` reachable.** Sharp's `.stats()` returns whole-image channel means: on a selfie that is skin plus hair, clothing, wall and window, and its mean is not a skin tone. This story adds no model and no `expo-face-detector`, so the isolation is a published, deterministic chroma gate rather than detection:

1. `sharp(bytes).rotate().resize(256, 256, { fit: 'cover', position: 'attention' }).removeAlpha().raw().toBuffer()` — bounded work, EXIF-corrected, one comparable pixel grid per input.
2. Keep only the centre `CENTRE_CROP_FRACTION` (0.5) box, where a framed face sits. The UX copy asks for a centred, evenly lit, unfiltered face; this is what makes that instruction load-bearing rather than decorative.
3. Gate each pixel through the Chai–Ngan YCbCr skin-chroma bounds — `77 ≤ Cb ≤ 127` and `133 ≤ Cr ≤ 173`. **Compute Cb/Cr from the gamma-encoded sRGB bytes using the BT.601 matrix, not from linear RGB**: those bounds are published against BT.601 YCbCr over R'G'B', and feeding linearized values in shifts every threshold. Linearization comes after the gate, on the survivors only.
4. **If fewer than `MIN_SKIN_PIXEL_FRACTION` (0.15) of the cropped pixels survive, terminate `failed` / `no_face`.** This is what `no_face` means here and the only thing that emits it: there is no face detector, so "no face" is "not enough skin-chromatic pixels where a face should be".
5. Convert the survivors through `linearRgbToLab` and take the **median** (not the mean) `a*` and `b*`, so a bright earring or a strand of hair inside the gate cannot drag the answer.

**Confidence is reported, never faked.** Both sources return a `confidence` in `[0, 1]`. For the selfie it is the surviving-pixel fraction scaled by the inter-quartile tightness of the survivors' hue angle — broad agreement across many pixels scores high, a handful of scattered pixels scores low. For the wardrobe it is a function of sample count and hue spread. `confidence < MIN_CONFIDENCE` (0.4) terminates as `failed` with `low_quality` rather than shipping a low-confidence answer that a user will read as fact about their body.

**Wardrobe aggregation, precisely.** Read the acting user's `PaletteInsights` rows and take each row's `hex_codes[0]`. `hex_codes` is `Json?` (`schema.prisma:467`) and Prisma types it as `Prisma.JsonValue`, so parse it through a small Zod guard (`z.array(z.string())`) and skip rows that fail rather than indexing into an unknown — a fixture or an older row can hold anything. Convert each survivor through `srgbToLab`, then discard near-achromatic entries (`chroma(lab) < ACHROMATIC_CHROMA_MAX`, because a wardrobe of black and white garments says nothing about undertone). That filter does a second job for free: `extractDominantHex` returns the literal `#808080` when Sharp throws (`wardrobe-color.processor.ts:61`), so every failed extraction in the user's history is discarded here instead of being counted as a neutral vote. Require at least `MIN_WARDROBE_SAMPLES = 5` survivors — otherwise fail `insufficient_wardrobe`. Classify the undertone from the **median** `a*`/`b*` of the survivors, for the same outlier reason as the selfie path. **Set `depth: null`.** Garment colour is evidence about what the user chooses to wear, not about their skin; AC 4 makes the degraded foundation output visible in the UI rather than hiding the difference.

For the seeded environments the E2E tiers run against, the wardrobe path is deterministic by construction: `packages/db/prisma/seeds/wardrobe.ts:89-114` writes 25 `PaletteInsights` rows whose `hex_codes[0]` is always `#C9A14A`. Assert the resulting classification as a fixed value rather than a range.

### Decision 4 — What "derive undertone palette" means for each source, stated plainly

The epic's phrase collapses two different derivations into one clause. They are not the same measurement and the story does not pretend they are:

- **Selfie → skin undertone + depth.** A direct measurement of the user.
- **Wardrobe → wardrobe-palette bias, reported as undertone, `depth: null`.** An inference from the colours the user already owns.

Both write the same `PaletteProfile` row and both drive the same recommendation table, which is what makes "or" in the epic AC a real user choice rather than two features. The difference is carried in exactly two places: the `source` column, and the `depth: null` that gates foundation shade matching down to family guidance. Do not add a second model, a second endpoint family, or a second recommendation table for the two sources.

### Decision 5 — Consent is a persisted server-side fact, not a client-side literal

**Prior art, and the trap in it.** Story 4.4's My Form photo has a consent-shaped field: `commitSilhouettePhotoInputSchema` requires `confirmsBasewearGuidance: z.literal(true)` (`wardrobe.ts:925-930`), and the mobile editor gates its stepper behind a `guidanceConfirmed` switch (`silhouette-editor.tsx:150,589,606`). But both clients send the literal unconditionally (`silhouette-editor.tsx:365`, `silhouette-settings-panel.tsx:543`), and the server persists only a timestamp (`my_form_consent_checked_at`). The enforcement is entirely client-side; the server cannot distinguish a user who acknowledged from a caller who typed `true`.

That is adequate for basewear _guidance_. It is not adequate for image-derived body characteristics, and `epics.md:576` asks for more than a timestamp: "Respect consent flows around images (CC-4.1) and color analysis (CC-5.4); **log opt-ins**." So this story ships the stronger shape:

- **Persisted and revocable.** `PaletteProfile.consent_granted_at` / `consent_revoked_at`. Consent is current when `consent_granted_at` is set and `consent_revoked_at` is null or earlier than it.
- **Server-enforced on every path that touches an image or derived data.** Analysis, selfie allocate, selfie commit, and the read of derived results all assert current consent and answer `403 PALETTE_CONSENT_REQUIRED_MESSAGE` without it. A client flag is not the gate.
- **Audited both ways.** Grant and revoke each write an `AuditLog` row (`event_type: 'palette_analysis_consent_changed'`, `event_data: { from, to, source }`, `ip_address: null`), following `premium-entitlement.service.ts:385-398` exactly. Revocation is as auditable as the grant, which is the half that gets forgotten.
- **Revocation erases.** Revoking is not a flag flip: it runs the same erase path as `DELETE` (Decision 9). A user who withdraws consent and finds their skin tone still stored has not had consent respected.

Do **not** add a `confirmsPalettePolicy: z.literal(true)` field to the analyze/commit bodies as a second, weaker gate beside the persisted one. One gate, server-side.

### Decision 6 — Recommendations are a versioned, deterministic first-party rule table

`packages/api-client/src/contracts/http/palette-advisor.ts` owns an exported, frozen `ADVISOR_RULES` table keyed by `undertone`, with a `depth`-refined foundation branch:

- **foundation** — with `depth`, one shade family plus a named depth band ("warm, medium"); with `depth: null`, the undertone family alone plus the `foundationDepthUnknown` copy key that says why (AC 4).
- **blush** — exactly two shade names per undertone.
- **jewelry / bag / eyewear** — one pairing per slot per undertone.

Rules:

- **It is data, not prose.** Each entry is `{ itemKey, labelKey, swatchHex }`. `labelKey` is a locale key; **no English shade name is ever hardcoded in a component**. This is 5.3's most-cited i18n lesson (its review found baked-English error copy in two libs and had to fix 5.2's as well) applied before the fact.
- **`itemKey` is the stable identity** used by save/dismiss, by analytics, and by offer matching. Namespace it `advisor:{slot}:{undertone}[:{depth}]`. It must never be a translated string or an array index.
- **`ADVISOR_RULES_VERSION`** is a string constant persisted on `PaletteProfile.analysis_version` alongside the palette. When the table changes, the version changes; a stored `item_key` from a retired version resolves to nothing and is skipped rather than crashing the surface. Same discipline as `GarmentTagSuggestionSnapshot.analysisVersion` (`wardrobe-color.processor.ts:123`).
- **Every `swatchHex` passes `meetsWcagAA()`** against the surface it renders on, checked by a unit test, exactly as 5.3's Decision 2/3 requires for palette values. Two of 5.3's three theme accents already fail the small-text floor — this is a demonstrated hazard on this codebase, not hypothetical caution.

**Do not** generate recommendations with an LLM, fetch them from a service, or seed them as database rows. A rule table in code is deterministic, diffable, testable offline, and needs no operator console — the same reasoning story 5.1 used to keep its partner catalog seed-and-migration managed.

### Decision 7 — Sponsored links extend story 5.1's catalog by two nullable columns; they do not fork it

**The constraint.** `AffiliateOffer.garment_category` is a required `GarmentCategory` (`schema.prisma:832`), and that enum has no beauty member (`top`, `bottom`, `outerwear`, `dress`, `shoes`, `accessory` — `schema.prisma:48-55`). A foundation offer has no honest value for it.

**Rejected alternatives, with reasons.** Adding `beauty` to `GarmentCategory` pollutes a wardrobe enum that `GarmentItem`, tagging, capsules and 5.1's slot derivation all read. A separate `AdvisorOffer` table forces `AffiliateClick.offer_id` to become polymorphic and duplicates the partner/token/webhook/conversion machinery. Reusing `accessory` for foundation makes beauty offers eligible for 5.1's ritual accessory slot.

**Chosen.** `AffiliateOffer` gains two nullable columns and relaxes one:

```prisma
enum AdvisorSlot { foundation blush jewelry bag eyewear }

// on AffiliateOffer:
garment_category   GarmentCategory?   // was required
advisor_slot       AdvisorSlot?
advisor_undertone  SkinUndertone?     // NULL = wildcard, exactly like comfort_range
```

with a migration check constraint `num_nonnulls(garment_category, advisor_slot) = 1`, so every row is unambiguously a garment offer or an advisor offer and neither can be both nor neither.

- **`advisor_undertone` NULL is the wildcard**, and an exact undertone match outranks a wildcard regardless of `priority`, with `id ASC` as the total tie-break — the identical ordering rule 5.1 already documents for `comfort_range` (`schema.prisma:824-827`). Copy that `ORDER BY` shape verbatim; do not invent a second ranking idiom on the same table.
- **The two _selections_ can never cross, and that is checked.** `CommerceRepository.findBestOffer` matches `o."garment_category" = $n::"GarmentCategory"` (`commerce.repository.ts:252`), so an advisor row's NULL never matches it; this story's advisor query matches `advisor_slot` with equality, so a garment row's NULL never matches. That is a real guarantee of SQL NULL semantics, but it is exactly the kind of guarantee that survives until someone adds an `OR garment_category IS NULL` for a wildcard feature. **Ship a regression test in both directions**: a seeded advisor offer never appears on a ritual card, and a seeded garment offer never appears in the advisor.
- **The _click_ path is where they genuinely can cross, and NULL semantics do not save it.** `CommerceRepository.findActiveClickOffer` (`commerce.repository.ts:310-331`) looks a row up by `o."id"` plus status, partner status and window — nothing else. It deliberately does not re-derive the slot match, and that is correct for 5.1's rotation problem, but it means any active offer id is clickable with any `surface` the caller sends. So **the advisor branch must key on server data, never on `input.surface`**: add `o."advisor_slot" AS advisor_slot` to that SELECT and `readonly advisor_slot: AdvisorSlot | null` to `CommerceClickOffer` (`commerce.repository.ts:69-80`), then branch on `offer.advisor_slot !== null`. Keying on the client-supplied surface would let a caller mint `advisor_offer_clicked` for a garment offer, or route a real advisor click down the scenario-lookup path by sending `mobile_hero`. Assert both crossed combinations.
- **`garment_category` going nullable does not widen `CommerceOfferMatch`.** `commerce.repository.ts:64` types it as a non-null `GarmentCategory` under a `$queryRaw<CommerceOfferMatch[]>` assertion, which Prisma does not check. The type stays correct because `findBestOffer` filters on equality and therefore cannot return a NULL row, and `shopThisLookSchema.garmentCategory` (`commerce.ts:47`) stays a required `garmentCategoryEnum`. Leave both alone; widening either to `| null` would push a nullable through 5.1's whole CTA surface for a row it can never see.
- **The advisor overlay is gated by `commerce_affiliate_enabled` too, not only by `color_analysis_enabled`.** Offer resolution must run the same short-circuit chain `AffiliateOfferService.resolveShopThisLook` documents (`affiliate-offer.service.ts:194-232`): the flag, then `findAffiliateCtasEnabled` (a missing row means the `true` default), then selection, with any failure degrading to "no offer" rather than to an error — a catalog fault must never take down the advisor's first-party recommendations. `AffiliateClickService.recordClick` enforces the same two gates itself and answers `503 COMMERCE_DISABLED_MESSAGE` / `403 COMMERCE_OPTED_OUT_MESSAGE` (`affiliate-click.service.ts:105-127`), so an advisor click inherits them with no new code. Do **not** add `isAffiliateAudienceEligible` to the advisor selection: `resolveShopThisLook` deliberately omits it and the click path deliberately applies it, and a third posture on the same catalog is how that policy stops being reversible in one place.
- **New index** for the advisor lookup: `[status, locale_region, advisor_slot, priority(sort: Desc)]`. The existing garment index stays.
- **`affiliateSurfaceSchema` gains `palette_advisor`** (`commerce.ts:27`). Its own docblock says a new surface must be added deliberately, which is what this is. **And so does its hand-copied twin**: `affiliateCtaClickedPropertiesSchema` re-lists `surface: z.enum(['mobile_hero'])` at `analytics-events.ts:1405` instead of importing the contract enum, so adding the member in one place and not the other makes every advisor click fail a `.strict()` parse inside `TelemetryService` — an absence of events, which is the failure mode 5.3's review already paid for once. Add it to both, and while there change the properties schema to derive from `affiliateSurfaceSchema` by import so the pair cannot drift again.
- **The user's existing opt-out applies.** `CommercePreference.affiliate_ctas_enabled = false` suppresses the advisor's sponsored overlay too. Do not add a second, advisor-specific opt-out: two switches for one concept is the dark pattern `prd.md:47` forbids, and 5.1 already put this control in both surfaces' settings.

**One real defect this creates, and how to close it.** `AffiliateClickService.recordClick` resolves `scenario` via `repository.findRecommendationScenario(userId, recommendationId)` and, on a miss, `scenarioNameSchema.safeParse(null)` fails, so it stores the `UNRESOLVED_SCENARIO` sentinel, logs `affiliate_cta_clicked_scenario_unresolved` and **skips the analytics emission entirely** (`affiliate-click.service.ts:47-54,159,178,192-206`). An advisor click has no `ScenarioOutfit`, so without a change every advisor click would silently land in that path and emit nothing. Branch on `offer.advisor_slot !== null`: skip the scenario lookup, store a dedicated `ADVISOR_SCENARIO` sentinel, and emit the new `advisor_offer_clicked` event instead (Decision 13). `AffiliateClick.recommendation_id` carries the `PaletteProfile.id` for advisor clicks, which keeps the 60-second dedupe index (`user_id, offer_id, recommendation_id, minute`) meaningful, since an offer belongs to exactly one advisor slot and so cannot legitimately be clicked twice in a minute from two places. The column's comment says "The ScenarioOutfit.id the CTA was rendered on", which becomes half-true; **amend the comment to state both meanings rather than renaming the column**, which would be a migration on a shipped table for no behavioural gain.

### Decision 8 — The selfie is purged the moment analysis terminates

The selfie upload lifecycle mirrors `SilhouetteProfile.my_form_*` (Decision 11) with one deliberate divergence: **on every terminal status — `ready` or `failed` — the object is deleted from storage and `selfie_purged_at` is stamped.** What persists is `undertone`, `depth`, `confidence`, `analysis_version`, `analyzed_at`, `source`. No image, no signed URL, no `imageAccess` block in the contract.

**There are three doors to a terminal status, not two, and all three must purge.** 4.4 reaches `ready` in the processor, reaches `contrast`/`privacy_violation` in the processor, and reaches `timeout`/`storage_error` from the _worker's_ catch block on the last attempt — `silhouetteProcessor.markFailed(...)` in `apps/api/src/workers/wardrobe.bootstrap.ts:166-177`, which never runs the processor body at all (`silhouette-photo.processor.ts:177-189`). A purge written only inside `process()` therefore leaks every selfie whose analysis exhausts its retries, which is the same permanent-retention bug this decision exists to prevent, entered through a different door. **Put the purge in one private method and call it from both the processor's terminal branches and `PaletteAnalysisProcessor.markFailed`.**

Why this differs from 4.4, which retains the My Form photo: the My Form photo has an ongoing product purpose (it is ghosted beneath outfit renders, so it must be readable later). A palette selfie has no purpose after the four scalars are derived. Retaining it would be storing a face photograph for no product reason, which is exactly what ADR-014's "only derived metadata surfaces to clients" is trying to avoid once the image is of a person's face.

Consequences to implement deliberately, not discover:

- **No re-analysis without re-upload.** There are no bytes to re-read. If a future story wants "re-run with a better model", it owns re-prompting for a photo. Note it in `deferred-work.md`.
- **Order matters: commit the terminal status first, then purge.** Purging before the status write means a crash between them leaves the row in `processing` with no bytes to re-read, and the BullMQ retry then fails its download for the whole retention window. The status commit is the durable fact; the purge follows it.
- **The status commit is not best-effort; the purge is.** Storage removal failure must not strand the profile: log it, leave `selfie_purged_at` null, and let the retention sweep pattern catch it. Follow `wardrobe-silhouette.service.ts:328-330`'s `.catch(() => undefined)` on stale-object removal — and note that the same file removes objects _without_ a catch at `:479`, which is the wrong idiom to copy here.
- **A failed analysis purges too.** The most likely bug is purging only on the success branch, leaving every rejected photo in the bucket permanently. Assert all three branches.
- **`privacy_violation` does not fork into 4.4's moderation path.** 4.4 writes a `ModerationEvent` plus one guardian `EventEnvelope` per active consent inside the terminal transaction (`silhouette-photo.processor.ts:133-170`). This story does neither, for a reason that has to be stated rather than discovered: `ModerationEvent` has relations to `LookbookPost`, `GarmentItem` and `SilhouetteProfile` and none to `PaletteProfile` (`schema.prisma:667-674`), and a moderation row is a pointer to evidence a human can review — evidence Decision 8 has just deleted on purpose. A palette selfie that trips the privacy check terminates `failed` / `privacy_violation`, purges, and tells the user; it creates no reviewable record and notifies no guardian. Log this in `deferred-work.md` for product: if guardian notification on a flagged teen selfie turns out to be required, it needs either a retention carve-out or a notification that carries no image, and both are policy calls no planning document has made.
- **Test it at the integration tier, not only with a mock.** `5.4-INT-*` asserts the object is gone from the storage double after each terminal outcome and that `selfie_purged_at` is set.

### Decision 9 — Erasure and retention

- **`DELETE /api/v1/commerce/premium/palette`** clears the derived scalars, revokes consent, deletes `AdvisorRecommendationState` rows for the user, purges any retained selfie object, and writes the `AuditLog` row. Revoking consent (Decision 5) runs the same path.
- **`PaletteProfile` is one row per user and is not deleted on erase** — the row survives with nulled scalars and a set `consent_revoked_at`, so a revocation is a fact rather than an absence. Same reasoning 5.3's Decision 8 applied to `PremiumThemePreference`: reset is an upsert, never a delete. `AdvisorRecommendationState` rows, by contrast, **are** deleted — they are per-item, unbounded, and carry no fact worth keeping once consent is gone.
- **Cleanup registration.** Both tables join `packages/testing/src/cleanup.ts`'s delegate list and delete order. `PaletteProfile` references only `User`, so it needs only to precede the user delete — place it beside `premiumThemePreference` (`cleanup.ts:314-320`). `AdvisorRecommendationState` likewise.
- **Factories.** Extend `packages/testing/src/factories/premium.factory.ts` — the same file 5.3 chose for the same reason ("it is the same premium domain"). Follow `PremiumThemePreference`'s **three-part** shape, not two: `createX` (fixture) → `buildXCreateInput` (Prisma input) → `persistX` (`premium.factory.ts:275-333`). So `createPaletteProfile` / `buildPaletteProfileCreateInput` / `persistPaletteProfile` and the same trio for `AdvisorRecommendationState`, with both keys registered in `registry.ts` beside `'premiumThemePreferences'` (`:30`).

### Decision 10 — `color_analysis_enabled` becomes this feature's kill switch, and its default flips to `false`

Recon fact: `color_analysis_enabled` is registered in all six flag touchpoints (`packages/config/src/flags.ts:63-66`, `flags.spec.ts:19,101,137,175,228`, `packages/db/prisma/seeds/feature-flags.ts:23`, `feature-flags.service.spec.ts:58,60,70,72,90,99,128,161`) and has **zero production consumers** — every reference outside the registry, the seed and the two project-knowledge documents is a test fixture. This story is its first.

It also has `defaultValue: true`, which is out of step with every other premium/commerce gate. `premium_themes_enabled`, `commerce_affiliate_enabled` and `commerce_subscription_enabled` all default `false` with the same stated reasoning, quoted from `flags.ts:71-74`: "a degraded PostHog can never switch commerce ON by accident — the fallback order is remote answer, then the `FeatureFlag` cache row, then this default, and only the first two can ever say yes."

A consent-gated feature that reads photographs of faces is the last flag in this repo that should fail open. **Flip the registry default to `false` and put the `true` in the seed**, exactly as `premium_themes_enabled` does (`seeds/feature-flags.ts:21`), so the feature is on wherever the seed has run and off everywhere else, production included, until someone flips it. Add the explanatory comment beside it in the registry, matching the three neighbours' house style.

Five concrete edits this forces. Grep `color_analysis_enabled` across the repo before starting and again before finishing; the first three are all breakages, and each fails somewhere different:

- `packages/config/src/flags.spec.ts:137` currently asserts `getFeatureFlag('color_analysis_enabled', 'user-5')` **resolves to `true`** as the no-adapters code default. Update that assertion. It sits under a comment about the ritual still having to render, which was written when nothing consumed the flag; the flag's fallback semantics are unchanged, only its default. While there, move the key into `flags.spec.ts:38-41`'s "returns registry defaults for known keys" case so the new default is asserted positively rather than only as a side effect.
- `apps/api/src/modules/feature-flags/feature-flags.service.spec.ts:161` asserts `{ key: 'color_analysis_enabled', value: true }` inside "uses registry defaults only when both PostHog and fallback storage are empty". This is a **second, different spec in a different workspace** and it fails the moment the registry flips. Update it, and add the one-line reason comment its `commerce_affiliate_enabled` and `commerce_subscription_enabled` neighbours already carry.
- `packages/db/prisma/seeds/feature-flags.ts:23` currently reads `getDefaultFeatureFlagValue('color_analysis_enabled')`. Replace with a literal `true` plus a one-line comment saying why the seed overrides the code default — note that `premium_themes_enabled: true` at `:21` carries no such comment, so this is the pattern `commerce_affiliate_enabled` at `:25-30` sets, not the one directly above. Without this edit the seed turns the feature **off** in every test environment and every one of this story's positive-path tests fails for a reason that looks like a bug in the feature.
- `_bmad-output/project-knowledge/feature-flags.md:29-31` and `_bmad-output/project-knowledge/shared-packages.md:56` both document the default as `true`. They are hand-maintained and are the first thing a later reader consults; update both in the same commit.

**Scope of the gate:** it gates the write paths (consent grant, analyze, selfie allocate/commit) and the sponsored overlay. The `GET` always answers, carrying `analysisEnabled: boolean`, because a flag-off or non-entitled caller still needs to render the locked or unavailable state cleanly — the same scoping decision and the same reason 5.3 recorded for `premium_themes_enabled`.

**Precedence on writes, stated once so review does not "discover" it:** `PremiumEntitlementGuard` is a NestJS guard and runs pre-handler; the consent check and the flag check live in the service body, consent first. So a non-entitled caller always gets `403 PREMIUM_REQUIRED_MESSAGE`; an entitled caller without consent gets `403 PALETTE_CONSENT_REQUIRED_MESSAGE`; only an entitled, consented caller can observe `503 PALETTE_ANALYSIS_DISABLED_MESSAGE`. Intentional, not a bug to fix.

### Decision 11 — Data model

```prisma
enum PaletteSource { selfie wardrobe }

enum SkinUndertone { warm cool neutral olive }

enum SkinDepth { fair light medium tan deep }

/// Mirrors SilhouettePhotoStatus. The wardrobe source jumps straight to
/// `processing` (there is nothing to upload), which is why the upload statuses
/// are nullable rather than a required starting state.
enum PaletteAnalysisStatus { pending_upload bytes_uploaded processing ready failed }

enum PaletteAnalysisFailureReason {
  no_face
  low_quality
  privacy_violation
  insufficient_wardrobe
  timeout
  storage_error
}

enum AdvisorSlot { foundation blush jewelry bag eyewear }

enum AdvisorAction { saved dismissed }

/// RLS: owner-only (selfOnlyTables). One row per user. Holds the consent fact,
/// the derived palette scalars, and the transient selfie upload lifecycle.
/// The selfie BYTES never outlive the analysis (decision 8): selfie_purged_at
/// is stamped when the object is removed, and nothing here is a signed URL.
model PaletteProfile {
  id                            String                        @id @default(cuid())
  user                          User                          @relation(fields: [user_id], references: [id], onDelete: Cascade)
  user_id                       String                        @unique
  consent_granted_at            DateTime?
  consent_revoked_at            DateTime?
  source                        PaletteSource?
  undertone                     SkinUndertone?
  depth                         SkinDepth?
  confidence                    Float?
  analysis_version              String?
  analyzed_at                   DateTime?
  status                        PaletteAnalysisStatus?
  failure_reason                PaletteAnalysisFailureReason?
  selfie_object_path            String?                       @unique
  selfie_upload_session_id      String?                       @unique
  selfie_upload_idempotency_key String?
  selfie_commit_idempotency_key String?
  selfie_commit_payload_hash    String?
  selfie_file_size_bytes        Int?
  selfie_mime_type              String?
  selfie_content_sha256         String?
  selfie_width_px               Int?
  selfie_height_px              Int?
  selfie_upload_expires_at      DateTime?
  selfie_committed_at           DateTime?
  selfie_purged_at              DateTime?
  revision                      Int                           @default(0)
  created_at                    DateTime                      @default(now())
  updated_at                    DateTime                      @updatedAt

  @@index([user_id])
  @@index([user_id, status, selfie_upload_expires_at])
  @@map("PaletteProfile")
}

/// RLS: owner-only. One row per saved-or-dismissed suggestion. item_key is the
/// rule table's stable id (decision 6), never a translated label.
model AdvisorRecommendationState {
  id         String        @id @default(cuid())
  user       User          @relation(fields: [user_id], references: [id], onDelete: Cascade)
  user_id    String
  slot       AdvisorSlot
  item_key   String
  action     AdvisorAction
  created_at DateTime      @default(now())
  updated_at DateTime      @updatedAt

  @@unique([user_id, slot, item_key])
  @@index([user_id])
  @@map("AdvisorRecommendationState")
}
```

- `User` gains two back-relations, `palette_profile PaletteProfile?` and `advisor_recommendation_states AdvisorRecommendationState[]`, at the end of the 5.1/5.2/5.3 block that closes the model (`schema.prisma:228-233`, model ends `:234`). **Re-grep before editing** — line numbers in this document drift, and 5.3's own notes recorded a stale citation within three weeks.
- **`SilhouetteProfile` is not touched.** The columns are mirrored onto the new model, not shared. A second consumer of the My Form columns would couple two unrelated features to one lifecycle. The mirror is close but not literal: `mode`, `height_slider` and `build_slider` are silhouette-only and absent here; `my_form_retention_status` and `my_form_moderation_flagged_at` are absent because Decision 8 purges instead of retaining and this story writes no `ModerationEvent`; and `selfie_purged_at` is new.
- **RLS category: `selfOnlyTables`** (`packages/db/test/rls/harness.ts:33-50`), not `guardianSharedTables` — even though the adjacent `PaletteInsights` is guardian-shared. Reason, stated so it is a decision and not an oversight: guardian consent already gates **whether** an under-16 account may upload at all, through the unchanged `WardrobeUploadGuard` → `GuardianService.assertWardrobeUploadAllowed` (`wardrobe.guard.ts`, `guardian.service.ts:1139-1160`). Exposing the _derived body characteristic_ to a guardian is a different mandate, and no planning document grants it. Same posture 5.1 took for `CommercePreference`. Record it in `deferred-work.md` for product to revisit rather than deciding it silently either way.
- **Migration:** next timestamp directory after the 5.3 theme migration, hand-authored SQL that mirrors `CommercePreference`'s grant/policy block for both new tables (the template is in `20260811090000_add_commerce_affiliate/migration.sql:219-249`), adds the `AffiliateOffer` columns, relaxes `garment_category` to nullable, adds the `num_nonnulls` check constraint and the new advisor index. Then `npm run db:generate`.
- **Grants breadth matters, and `rls-policies` does not prove it.** Follow 5.3's review lesson: add a `packages/db/test/palette-advisor-schema.spec.ts` pinning `authenticated` to exactly the four owner verbs and `anon` to none, plus the four policy names per table. Correct policies with no `GRANT` deny even the owner; correct grants with no policies expose every row; the actor matrix alone catches neither.
- **Drive the INSERT policy's positive half through the `authenticated` role** in the new `packages/db/test/rls/palette-advisor.spec.ts`. Seed inserts go through the superuser admin pool and bypass RLS, so `WITH CHECK (false)` would pass a whole matrix while making the feature's first write impossible — exactly the hole 5.3's review found.

### Decision 12 — API surface

New files in `apps/api/src/modules/commerce/`: `palette-advisor.controller.ts`, `palette-advisor.service.ts`, `palette-analysis.processor.ts`, `palette-analysis-processing.queue.ts`, `palette-analysis.engine.ts` (interface + real + fixture, mirroring `silhouette-photo-moderation.engine.ts`'s three-part, eleven-line shape) and co-located specs. Register the controller in `commerce.module.ts`'s `controllers` array (`:63-79`) and the service in `providers` (`:80-111`); the export comment naming CC-5.4 is at `:112-114`.

**A queue and a worker are not optional wiring — without them the feature enqueues into nothing.** Three edits outside the commerce module, none of which any prior premium story needed:

1. `apps/api/src/config/queues.ts` — add `'palette-analysis'` to the closed `QueueName` union (`:19-25`) and a matching entry to `queueConfigs` (`:48-101`). A new name is required rather than reusing `moderation-review`: that worker does `silhouettePhotoProcessingJobSchema.parse(job.data)` unconditionally, so a palette job on it throws before it reaches any handler.
2. `apps/api/src/workers/wardrobe.bootstrap.ts` — register the worker beside the existing two, hand-wiring `PaletteAnalysisProcessor` the way `SilhouettePhotoProcessor` is at `:153-157`. It goes here rather than in `bootstrap.ts` because this is the process that already owns `SupabaseWardrobeStorageAdapter` and the image-processing concurrency policy. Nest DI does not work under `tsx` in this repository, so hand-wire; the `deferred-work.md` ledger records why.
3. `classifyPaletteProcessingFailure(error)` plus `PaletteAnalysisProcessor.markFailed(profileId, reason)`, mirroring `classifySilhouetteProcessingFailure` and `silhouette-photo.processor.ts:177-189`, called from the worker's catch block only on the final attempt (`wardrobe.bootstrap.ts:166-177`). **`markFailed` purges** (Decision 8).

**Route prefix: `/api/v1/commerce/premium/palette`.** Same reasoning 5.3 recorded and it still holds: every commerce-module controller lives under `/api/v1/commerce/...`, and `CommerceCacheHeadersMiddleware` is bound to `/api/v1/commerce{/*path}` for `RequestMethod.ALL` in `configure()` (`commerce.module.ts:117-122`, with the rationale in the module docblock at `:47-51`), so a route outside the prefix silently ships a per-user response without `private, no-store`. Assert the header on the `GET` so a later route move cannot drop it silently.

| Method | Path                                                  | Guards                                                               | Flag | Notes                                                                                                  |
| ------ | ----------------------------------------------------- | -------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------ |
| GET    | `/api/v1/commerce/premium/palette`                    | `RequestAuthGuard`                                                   | no   | Profile + consent + recommendations + offers; carries `isEntitled`, `analysisEnabled`, `hasConsent`    |
| POST   | `/api/v1/commerce/premium/palette/consent`            | `RequestAuthGuard`, `PremiumEntitlementGuard`                        | yes  | `{ granted: boolean }`; revoke runs the erase path                                                     |
| POST   | `/api/v1/commerce/premium/palette/analyze`            | `RequestAuthGuard`, `PremiumEntitlementGuard`                        | yes  | `{ source: 'wardrobe' }`; enqueues, answers `202` with status                                          |
| POST   | `/api/v1/commerce/premium/palette/selfie/upload-url`  | `RequestAuthGuard`, `PremiumEntitlementGuard`, `WardrobeUploadGuard` | yes  | Mirrors `createSilhouetteUploadUrl`, incl. `Idempotency-Key` handling                                  |
| PUT    | `/api/v1/commerce/premium/palette/selfie/uploads/:id` | upload token (not `RequestAuthGuard`)                                | yes  | Raw bytes; mirrors the silhouette bytes route and its token, size and MIME validation                  |
| POST   | `/api/v1/commerce/premium/palette/selfie/commit`      | `RequestAuthGuard`, `PremiumEntitlementGuard`, `WardrobeUploadGuard` | yes  | Enqueues analysis; `201` fresh / `200` replay, per the house convention                                |
| PUT    | `/api/v1/commerce/premium/palette/recommendations`    | `RequestAuthGuard`, `PremiumEntitlementGuard`                        | no   | `{ itemKey, slot, action: 'saved' \| 'dismissed' \| null }`; `null` clears the row                     |
| DELETE | `/api/v1/commerce/premium/palette`                    | `RequestAuthGuard`                                                   | no   | Erase; deliberately **not** entitlement-gated — a lapsed subscriber must always be able to delete data |

- All responses use the `{ data }` envelope and are parsed through their published schema **in the controller** before returning. 5.3's review caught both of its handlers skipping this; precedents are `alerts.controller.ts:59` and `comfort.controller.ts:44`.
- Contract module `packages/api-client/src/contracts/http/palette-advisor.ts` + barrel line + `registerPaletteAdvisorContracts` wired into `openapi.ts` (imports near `:21-23`, registry calls near `:111-113`), and bump `info.version` **1.3.0 → 1.4.0** at `openapi.ts:142` (additive). Extend the hand-maintained re-export block in `apps/api/src/contracts/http.ts` with a new "Story 5.4 palette advisor" section — that file does not `export *`.
- Message constants: `PALETTE_CONSENT_REQUIRED_MESSAGE`, `PALETTE_ANALYSIS_DISABLED_MESSAGE`, `PALETTE_ANALYSIS_IN_PROGRESS_MESSAGE`. **Reuse `PREMIUM_REQUIRED_MESSAGE`**; it is guard-owned and already exists.
- **Status is a discriminated union on the wire**, following `silhouetteMyFormSchema` (`wardrobe.ts:823-860`): `failureReason` present exactly on `failed`, palette scalars present exactly on `ready`, `depth` nullable within `ready`. This makes `{status: 'ready', failureReason: 'no_face'}` unrepresentable in the generated types rather than merely unlikely. Story 4.4 paid for this lesson in review; inherit it.
- Regenerate with `npm run generate:api-client`, then `npm run optic:lint`, and commit the generated diff. Never hand-edit `packages/api-client/src/generated/**`.

### Decision 13 — Analytics

Three new server-side events, all pseudonymous. `premium_theme_selected` is the worked example; follow every one of its **seven** registration points, because the ones that fail open fail silently. `telemetry.service.ts:560-567`'s own docblock says it: getting two of three lockstep edits right leaks a raw user id. **Verify each line number at implementation time** — this table has already moved twice.

| #   | File                                                                  | What to add                                                                                                                                                              |
| --- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `packages/api-client/src/types/analytics-events.ts:~72`               | the name, in `analyticsEventNameSchema`                                                                                                                                  |
| 2   | `packages/api-client/src/types/analytics-events.ts:~588`              | the event schema, carrying `analyticsSubjectId`                                                                                                                          |
| 3   | `packages/api-client/src/types/analytics-events.ts:~627`              | the entry in `analyticsEventSchemas`                                                                                                                                     |
| 4   | `packages/api-client/src/types/analytics-events.ts:~1550,~1631`       | the `.strict()` properties schema and the `track*`/`build*` payload builder                                                                                              |
| 5   | `packages/api-client/src/testing/analytics-event-assertions.ts:33,82` | import + entry in `analyticsPropertySchemas`                                                                                                                             |
| 6   | `apps/api/.../telemetry.service.ts:~157` and `~222`                   | the `CaptureEventPayloads` member (`Omit<…, 'analyticsSubjectId'>`) and the `captureEventInputSchemas` entry — **two separate maps in the same file, both easy to miss** |
| 7   | `apps/api/.../telemetry.service.ts:568-577` and `579-597`             | membership in `PSEUDONYMOUS_EVENT_TYPES` and the paired builder in `pseudonymousEventBuilders`                                                                           |

| Event                          | Properties (allowlist, `.strict()`)             | Emitted                                              |
| ------------------------------ | ----------------------------------------------- | ---------------------------------------------------- |
| `palette_analysis_completed`   | `{ source, undertone, depth, outcome }`         | Processor, on terminal status                        |
| `advisor_offer_clicked`        | `{ partnerId, offerId, advisorSlot, platform }` | `AffiliateClickService`, advisor branch (Decision 7) |
| `advisor_recommendation_acted` | `{ slot, action }`                              | Successful `PUT /recommendations`                    |

- **`platform` carries the `'web' | 'mobile'` split, because nothing else does.** One `palette_advisor` surface member covers both clients, and `affiliate_cta_clicked` has no platform property to lean on — its `.strict()` allowlist is exactly `partner_id, offer_id, scenario, surface, locale_region, recommendation_id` (`analytics-events.ts:1400-1409`). Without `platform` on the new event, web and mobile advisor clicks are indistinguishable in reporting. It is a two-member enum and carries nothing identifying.
- **No raw hex, no confidence score, no image metadata in any property.** `undertone` and `depth` are four- and five-member enums; a hex value is closer to a biometric fingerprint and has no analytics purpose.
- Ship a **negative fixture** per event proving the allowlist rejects anything beyond the named properties, and a set-equality assertion across the three registries — 5.3's review found a hand-copied palette list in `types/` that nothing kept in agreement with the contract enum, failing open inside `TelemetryService` so the symptom was an _absence_ of events. Pin `AdvisorSlot` and `SkinUndertone` in the analytics schemas against the contract enums by import, not by re-listing them.

### Decision 14 — Surfaces

Both surfaces ship, because the epic AC does not qualify one and this repo ships cross-surface controls for cross-surface features (5.1's Decision 2 reasoning, applied to a feature that is genuinely used on both).

**Mobile** — a dedicated route, not another settings section. The advisor has an upload flow, a result state and five recommendation slots; `apps/mobile/app/(tabs)/settings.tsx` is already **1474 lines** with three inline premium sections. Follow the wardrobe convention instead: thin route `apps/mobile/app/palette-advisor.tsx` (a `Stack.Screen` title plus the component, mirroring `app/wardrobe-silhouette.tsx`'s thirteen lines exactly) over `apps/mobile/src/features/premium/palette-advisor-screen.tsx`. The entry point is a row in the existing premium settings block linking to it via `router.push('/palette-advisor')`, matching `wardrobe-hub-screen.tsx:193-203`'s `Pressable` — note that `settings.tsx` imports no router today, so this adds the first `useRouter` there, and the row needs the same `accessibilityRole="link"` + `accessibilityLabel` + `testID` shape.

**Web** — `apps/web/src/app/palette/page.tsx` with the section body in `apps/web/src/app/components/palette-advisor-panel.tsx` (component under `app/components/`, not inline in the page — the convention `wardrobe-onboarding-flow.tsx:5-10` documents, and the reason is Next.js's generated route types, not taste). The page carries the four load-bearing attributes every destination route in this app carries: `id="main-content"`, `tabIndex={-1}`, `data-focus-surface="dark"`, and `<StickyBottomNav />`. Read `apps/web/src/app/settings/page.tsx` (43 lines) before writing the page; its docblock states all four and why.

Two consequences of adding the fifth destination route, both of which have to be done deliberately:

- **`playwright/tests/accessibility-hardening.spec.ts` does not discover routes.** Its scan runs over the literal `primaryRoutes` array at `:9` (`'/'`, `'/community'`, `'/wardrobe'`, `'/settings'`) and a secondary list at `:11-14`. Add `/palette` to `primaryRoutes`, or the page is never scanned and AC 8's axe evidence does not exist. The suite loads routes **signed out**, so the locked panel must render cleanly with no session.
- **`StickyBottomNav` will highlight the wrong tab.** `sticky-bottom-nav.tsx:31` resolves the active tab with `NAV_TABS.find((tab) => tab.href === pathname)?.id ?? 'home'`, an exact-equality match over four hrefs, so `/palette` renders with Home highlighted. This is already wrong today for `/wardrobe/capsules` and `/wardrobe/onboarding`, which are nested under an existing tab and still fall back to Home. Fix it here with a longest-prefix match (`'/'` matching only exactly), and add a nav test pinning `/wardrobe/capsules` → Wardrobe and `/palette` → no tab active rather than Home.

**Client libs** mirror the established shape exactly: `apps/web/src/lib/palette-advisor.ts` after `premium-theme.ts`, and `apps/mobile/src/lib/palette-advisor.ts` after the mobile `premium-theme.ts`. On **mobile**, reuse `withRequestTimeout` from `apps/mobile/src/lib/commerce.ts` — `premium-theme.ts:26` and `premium.ts:31` both already import it. On **web** there is no such shared helper: `apps/web/src/lib/commerce.ts` exports none and `apps/web/src/lib/premium-theme.ts` has no timeout at all; the only implementation is private inside `apps/web/src/lib/wardrobe.ts:259`. Follow `premium-theme.ts` and add no timeout, or promote the `wardrobe.ts` helper to a shared export and use that. **Do not copy it into a third file.** Web signed-out classification uses `hasWebSession()` from `apps/web/src/lib/commerce.ts:47`.

**Failure copy is localized at the lib boundary.** Classify failures into a `PaletteAdvisorFailureReason` union (`signed_out` / `not_entitled` / `no_consent` / `analysis_disabled` / `in_progress` / `unknown`) and let the component pick the catalog string. The thrown `message` stays developer-facing for logs and assertions. The template is already on both surfaces: `apps/web/src/lib/premium-theme.ts:71-88,143,182` and `apps/mobile/src/lib/premium-theme.ts:55-72,125,164` (union, error class carrying `reason`, `reasonForStatus`, and the `*FailureReason(error)` accessor). This is the exact defect 5.3's review found in its own lib **and** retroactively in 5.2's `premium.ts`; do not reintroduce it a third time.

**Selfie capture on mobile** uses `expo-image-picker@~17.0.11`, already a dependency and already used with the camera and library permission prompts at `wardrobe-onboarding-screen.tsx:195-196`. **Do not add `expo-camera`, `expo-face-detector`, or any new media dependency.**

**Watch and widgets: out of scope**, unchanged from 5.3's Decision 5. No file under `apps/mobile/targets/` or the Android widget sources is touched. Neither surface has room for a sponsorship disclosure, and an undisclosed affiliate tap target would breach the PRD guardrail — the same reason 5.1 gave for keeping widgets and watchOS out of commerce entirely.

### Decision 15 — Locale keys

New keys under `commerce.premium.palette.*`, in all ten catalogs on both surfaces (`apps/web/src/i18n/locales/*.json`, `apps/mobile/assets/locales/*.json`). Enumerate them in the contract module beside `ADVISOR_RULES` so the rule table and its copy cannot drift.

Groups: `sectionTitle`, `intro`, `consent.{title,body,grant,revoke,granted}`, `source.{selfie,wardrobe,selfieHint,wardrobeHint}`, `status.{idle,uploading,processing,ready,failed}`, `failure.{noFace,lowQuality,privacyViolation,insufficientWardrobe,timeout,storageError}`, `result.{undertone,depth,depthUnknown,confidence}`, `undertone.{warm,cool,neutral,olive}`, `depth.{fair,light,medium,tan,deep}`, `slot.{foundation,blush,jewelry,bag,eyewear}`, `foundationDepthUnknown`, `shades.*` (one key per `ADVISOR_RULES` entry — these are the `labelKey`s), `sponsored.{disclosure,partnerLabel,cta}`, `actions.{save,saved,dismiss,dismissed,undo}`, `locked.{title,body,signedOutBody}`, `unavailable`, `loadError`, `saveError`, `deleteConfirm`.

- **New dedicated parity specs** `apps/web/src/i18n/palette-advisor-locales.spec.ts` and `apps/mobile/src/i18n/palette-advisor-locales.spec.ts`, scoped to `catalog.commerce.premium.palette`, reusing the flatten/placeholder-parity/non-empty/no-untranslated assertions and an `APPROVED_COGNATES` allowlist (shade names are close to proper nouns and will legitimately stay near-English in several locales — budget the entries up front rather than forcing translations).
- **And** the one-line subtree exclusion in `apps/web/src/i18n/premium-locales.spec.ts` and its mobile twin, because they pin an exact key list for `commerce.premium.*` and a new nested subtree fails their own parity assertions otherwise. 5.3's Decision 13 was amended in review for getting exactly this wrong; the rule is: a new feature area gets its own spec **and** the parent gets an exclusion.
- **`en-CA` uses `-our` spellings.** Its only divergences from `en-US` are spelling; 5.3 shipped "colors" there and had to fix it in review. This story's copy is full of the word — get it right the first time.

## Prerequisites

Epic list (`epics.md:454`): CC-4.1 (**done**) for wardrobe data, CC-5.2 (**done**) for the entitlement check. `epics.md:553` adds the sequencing rationale ("Ensure CC-4.1 lands before CC-5.4 so the advisor has wardrobe context") and `:566` confirms CC-5.2 gates it. Also already satisfied and load-bearing here: CC-4.2 (**done**) — without its `WardrobeColorProcessor` there are no `PaletteInsights.hex_codes` rows for the wardrobe source to read; CC-4.4 (**done**) for the photo-upload lifecycle this story mirrors; CC-5.1 (**done**) for the affiliate machinery; CC-5.3 (**done**) for the premium-surface conventions and the `@couture/utils` colour-maths home. Foundational: CC-0.2, CC-0.3, CC-0.9, CC-0.11, CC-3.2.

No operator or vendor provisioning is required. Sponsored advisor offers need catalog rows, which are seed- and migration-managed exactly as story 5.1 established (there is deliberately no admin console); seed at least one advisor offer per slot so the positive path is demonstrable, behind the same `allowsCommerceSeeding()` guard that keeps commerce seeding out of production (`seeds/commerce.ts`).

## Tasks / Subtasks

- [x] **Task 1 — Schema, RLS, factories (AC 1, 2, 3, 6, 9)**
  - [x] Seven new enums (`PaletteSource`, `SkinUndertone`, `SkinDepth`, `PaletteAnalysisStatus`, `PaletteAnalysisFailureReason`, `AdvisorSlot`, `AdvisorAction`) + `PaletteProfile` + `AdvisorRecommendationState` per Decision 11; `AffiliateOffer` gains `advisor_slot`/`advisor_undertone` and relaxes `garment_category` to nullable
  - [x] Hand-authored migration: both `CommercePreference`-shaped grant/policy blocks, the `num_nonnulls(garment_category, advisor_slot) = 1` check constraint, the advisor index; `User` back-relations; `npm run db:generate`
  - [x] Register both tables in `selfOnlyTables` (`packages/db/test/rls/harness.ts`), extend `SeededScenario`, `seedScenario` and `cleanupScenario`; new `packages/db/test/rls/palette-advisor.spec.ts` carrying the actor matrix **including the owner-INSERT positive half driven through the `authenticated` role**
  - [x] `packages/db/test/palette-advisor-schema.spec.ts`: grant breadth (`authenticated` = exactly four owner verbs, `anon` = none), the four policy names per table, nullable/unique/cascade shape, and the check constraint rejecting both-null and both-set `AffiliateOffer` rows
  - [x] `premium.factory.ts`: `createPaletteProfile`/`persistPaletteProfile`, `createAdvisorRecommendationState`/`persistAdvisorRecommendationState`, registry keys, `cleanup.ts` delegates and delete order
  - [x] Seed at least one advisor offer per slot behind `allowsCommerceSeeding()`

- [x] **Task 2 — Colour science utility (AC 2, 3)**
  - [x] Export `srgbChannels` and `linearizeSrgbChannel` from `packages/utils/src/contrast.ts` and refactor `relativeLuminance` (`:86-94`) to compose them; `contrast.spec.ts` passes unchanged as proof of no behaviour change. Add both to `packages/utils/src/index.ts`. **Do this before writing `skin-tone.ts`** — reuse is impossible until it lands (Decision 3)
  - [x] `packages/utils/src/skin-tone.ts` per Decision 3, exported from `index.ts`: `srgbToLab`, `linearRgbToLab`, `individualTypologyAngle`, `classifyDepth`, `chroma`, `hueAngleDegrees`, `classifyUndertone`, and every threshold as a named constant
  - [x] Unit tests pinning all four ITA° band boundaries (55, 41, 28, 10) on **both** sides of each, the `b* ≤ 0` → `null` branch, every undertone threshold including the olive hue wedge, negative-`a*` inputs that a ratio implementation would misclassify, a known-hex round trip through `srgbToLab`, `#RGB` acceptance, and `#RRGGBBAA` rejection. `toBeCloseTo(value, 2)`, never `toBe`
  - [x] Unit test proving every `ADVISOR_RULES` `swatchHex` passes `meetsWcagAA()` against the surface background it renders on

- [x] **Task 3 — Contracts, rule table, analytics registries (AC 4, 5, 6, 8, 9)**
  - [x] `packages/api-client/src/contracts/http/palette-advisor.ts`: request/response schemas (status as a discriminated union per Decision 12), `ADVISOR_RULES` + `ADVISOR_RULES_VERSION`, message constants, locale-key enumeration; barrel + `registerPaletteAdvisorContracts` + `openapi.ts` → 1.4.0; `apps/api/src/contracts/http.ts` block
  - [x] `affiliateSurfaceSchema` gains `palette_advisor` **and so does `affiliateCtaClickedPropertiesSchema`'s hand-copied `surface` enum (`analytics-events.ts:1405`), which should be derived from it by import** (Decision 7)
  - [x] Three analytics events per Decision 13, all **seven** registration points each, with the negative property fixtures and the contract-enum-derived (not hand-copied) slot/undertone lists
  - [x] `npm run generate:api-client`, `npm run optic:lint`, commit the generated diff

- [x] **Task 4 — Feature flag (AC 7)**
  - [x] `color_analysis_enabled` registry default `true` → `false` in `packages/config/src/flags.ts:63-66`, with the explanatory comment matching its three fail-closed neighbours
  - [x] All four follow-on edits from Decision 10 — `flags.spec.ts:137` (+ `:38-41`), `feature-flags.service.spec.ts:161`, the literal `true` in `seeds/feature-flags.ts:23`, and the two `project-knowledge` documents. Miss the seed and every positive-path test in this story fails looking like a feature bug; miss either spec and the workspace goes red

- [x] **Task 5 — API: consent, wardrobe analysis, recommendations, erase (AC 1, 2, 4, 6, 7, 9)**
  - [x] `PaletteAdvisorService` + `PaletteAdvisorController` per Decision 12, registered in `commerce.module.ts`; `AuditLog` rows on consent grant and revoke
  - [x] Wardrobe derivation reading `PaletteInsights`, with the achromatic filter, the `MIN_WARDROBE_SAMPLES` floor and `depth: null`
  - [x] Save/dismiss upsert with `null` clearing the row; dismissed items suppressed on the next `GET`
  - [x] `DELETE` + revoke sharing one erase path
  - [x] Advisor offer resolution running 5.1's short-circuit chain (`commerce_affiliate_enabled`, then `findAffiliateCtasEnabled`, then selection) and degrading to "no offer" on any fault rather than failing the whole `GET` (Decision 7)
  - [x] `AffiliateClickService` advisor branch keyed on `offer.advisor_slot`, with `advisor_slot` added to `findActiveClickOffer`'s SELECT and to `CommerceClickOffer` (Decision 7)
  - [x] Supertest over HTTP: guard `401`/`403`/`200`; consent-before-flag precedence (Decision 10); flag-off `503` for an entitled consented caller; `insufficient_wardrobe`; cross-user authz; the inherited `Cache-Control: private, no-store` on `GET`; a garment offer id sent with `surface: 'palette_advisor'` and an advisor offer id sent with `surface: 'mobile_hero'` both taking the branch the _offer_ dictates

- [x] **Task 6 — API: selfie lifecycle and analysis worker (AC 3, 7)**
  - [x] `palette-analysis.engine.ts` (interface + Sharp-backed real engine implementing Decision 3's crop → skin-gate → median pipeline + fixture engine, mirroring `silhouette-photo-moderation.engine.ts`), `palette-analysis-processing.queue.ts` (job id keyed on **profile id + upload session id**, `__` separator — read `silhouette-photo-processing.queue.ts:25-45` for why a profile-id-only key silently drops every upload after the first), `palette-analysis.processor.ts`
  - [x] **Queue and worker registration**, without which nothing consumes the jobs: `'palette-analysis'` in `apps/api/src/config/queues.ts`'s `QueueName` union (`:19-25`) and `queueConfigs` (`:48-101`); the worker hand-wired in `apps/api/src/workers/wardrobe.bootstrap.ts` beside the existing two; `classifyPaletteProcessingFailure` + `markFailed(profileId, 'timeout' | 'storage_error')` called on the final attempt only (Decision 12)
  - [x] Allocate / PUT bytes / commit routes mirroring the silhouette ones, including upload-token validation, size and MIME limits, idempotency keys and stale-object cleanup; `WardrobeUploadGuard` mounted so under-16 guardian consent still applies
  - [x] **Purge on all three terminal branches** — `ready`, in-processor `failed`, and `markFailed` from the worker's retry-exhaustion catch — with `selfie_purged_at` stamped after the status commit, best-effort removal that cannot strand `processing` (Decision 8)
  - [x] Processor specs covering ready, each failure reason including `no_face` from the skin-pixel floor and `low_quality` from a `null` ITA, the purge on all three branches, and exactly-once telemetry

- [x] **Task 7 — Web (AC 1, 2, 3, 4, 5, 6, 7, 8)**
  - [x] `apps/web/src/lib/palette-advisor.ts` with the classified failure reasons; `/palette` route with all four load-bearing `<main>` attributes; `palette-advisor-panel.tsx` with consent, source choice, upload, processing, ready, failed, locked and unavailable states
  - [x] Add `/palette` to `playwright/tests/accessibility-hardening.spec.ts:9`'s `primaryRoutes` — the scan is a literal list, not discovery — and fix `sticky-bottom-nav.tsx:31`'s exact-equality active-tab match to a longest-prefix match, with a test pinning `/wardrobe/capsules` → Wardrobe (Decision 14)
  - [x] Disclosure rendered before the control it describes, `data-testid`-tagged, following `commerce-preferences-section.tsx:165-173`
  - [x] Locale keys in all ten catalogs + `palette-advisor-locales.spec.ts` + the `premium-locales.spec.ts` exclusion
  - [x] MSW handlers and component tests including the `affiliate_ctas_enabled = false` suppression path

- [x] **Task 8 — Mobile (AC 1, 2, 3, 4, 5, 6, 7, 8)**
  - [x] `apps/mobile/src/lib/palette-advisor.ts`; thin route `app/palette-advisor.tsx`; `src/features/premium/palette-advisor-screen.tsx`; settings entry row
  - [x] `expo-image-picker` capture reusing the existing permission-request shape; **no new media dependency**
  - [x] Ten catalogs + `palette-advisor-locales.spec.ts` + the parent-spec exclusion
  - [x] Screen tests with MSW: consent gate, both sources, dismissed-item suppression, locked state, stale `analysis_version` skipped rather than crashing

- [x] **Task 9 — Cross-cutting tests (all ACs)**
  - [x] Pact: a new `pact/http/consumer/interactions/commerce-palette-advisor.ts` (the accumulators were split by domain in `6fb1950c`; do not add to a monolith), wired into `api-contract-interactions.ts` and both consumer pacttests, with a `pact/http/provider/doubles/palette-advisor.ts` and its `state-handlers.ts` entries. Mobile and web interactions for `GET`, consent, analyze and recommendations; provider states for entitled+consented, entitled+no-consent, non-entitled, flag-off. Run `npm run test:pact` (its consumer step already enforces determinism across three runs)
  - [x] Playwright `palette-advisor.spec.ts`: locked signed-out (+ axe at both viewports), entitled seeded user through consent → wardrobe analysis → recommendations → dismiss → reload, sponsored disclosure present, and the stale-`analysis_version` fallback (stub the `GET`; a native enum makes an out-of-enum value uninsertable against real Postgres — the same wall 5.3 hit)
  - [x] `apps/api/integration/palette-advisor.integration.spec.ts` against real PostgreSQL: consent audit rows, the selfie purge on both terminal branches, erase-on-revoke, and the **two-way** cross-selection regression from Decision 7
  - [x] Maestro: `maestro/palette-advisor.yaml` proving the locked state for the harness's fresh signed-up user, opening with the same honest-scope docblock `maestro/premium-subscription.yaml:1-25` carries — that flow is the only prior premium example, since 5.3 shipped none. Flows are auto-discovered from `maestro/*.yaml`, so the registration that is actually needed is a duration entry in `scripts/maestro-flow-durations.json` (an absent flow falls back to the mean and unbalances the LPT bin-packing in `scripts/resolve-maestro-shard.mjs`). Add it to `USER_SCOPED_FLOWS` in `scripts/run-maestro.mjs` **only** if it asserts on an identity-scoped `-e` id — that list is what PR #139 corrected, and getting it wrong surfaces as an element-not-found on another device's user
  - [x] **No k6.** These are low-QPS premium settings operations, not a hot-path read like `subscriptionStatus`. Do not reflexively copy 5.2's k6 task

- [x] **Task 10 — Gates and evidence (all ACs)**
  - [x] `npm run verify:changed` green across every touched workspace with coverage ratchets holding; `npm run lint` and `npm run typecheck` clean. Run with `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres`, without which database-backed suites skip themselves and the ratchet fails on coverage rather than naming the database
  - [x] `deferred-work.md` entries: guardian visibility of derived palette data (Decision 11); **no guardian notification or `ModerationEvent` on a flagged teen selfie, and why** (Decision 8); re-analysis impossible without re-upload (Decision 8); no beauty-partner admin console, inheriting 5.1's catalog posture; the readiness report's CC-5.4 blocker and how it was discharged, **including the deliberate divergence from ADR-014's ONNX step** (Decision 2); `AffiliateClick.recommendation_id`'s now-dual meaning (Decision 7); the stale on-device claims left standing in `ux-design-specification.md:409` and `prd.md:294`; watch/widget advisor surfaces

## Test plan

Higher risk than 5.3: this story reads user images, stores derived body characteristics, and mints attributed commercial clicks. P2×I3 territory. Test IDs: `5.4-<AREA>-<nnn>`.

### Coverage matrix by AC

Every id below names a test that exists and passes. Ids are globally unique
across tiers, which cost a relabelling pass: three (`5.4-INT-010/012/013`) and
`5.4-UTIL-011` had each been used twice, and the placeholder forms
(`5.4-API-04x`, `5.4-UTIL-01x`) were minted as literal test names rather than
ranges. Unit-tier proofs that had been given `INT-` ids now carry `API-`/`CON-`
ids; the integration tier keeps `INT-`.

| AC  | P0 evidence (blocks merge)                                                                                                                                                                                                                                                                                                                                                                    | P1 evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Analyze/allocate/commit all `403` without consent (`5.4-API-010`, `5.4-API-011`, `5.4-API-012`); grant and revoke each write an `AuditLog` row (`5.4-INT-001`); revoke erases derived scalars and every saved item (`5.4-INT-002`); the consent gate hides both sources until granted (`5.4-WEB-014`, `5.4-MOB-013`, `5.4-E2E-010`)                                                           | Consent survives a fresh request context (`5.4-INT-003`); withdrawal is confirmed inline and runs the ungated `DELETE` (`5.4-WEB-016`, `5.4-MOB-014`)                                                                                                                                                                                                                                                                                                                                                                                 |
| 2   | Wardrobe derivation classifies a seeded wardrobe deterministically with `depth: null` (`5.4-API-021`); `insufficient_wardrobe` below the sample floor (`5.4-API-022`); the real journey end to end against the seeded entitled user and the live worker (`5.4-E2E-010`)                                                                                                                       | Achromatic-only wardrobe fails rather than guessing (`5.4-API-023`); the confidence floor refuses a scattered wardrobe and accepts an agreeing one (`5.4-API-024`, `5.4-API-025`); a wardrobe whose agreeing colours straddle the 0/360 hue wrap is accepted rather than refused (`5.4-API-026`, `5.4-UTIL-050`-`5.4-UTIL-054`)                                                                                                                                                                                                       |
| 3   | Selfie ready path through the engine (`5.4-API-031`, `5.4-API-034`); **object purged and `selfie_purged_at` set on all three terminal doors — `ready`, in-processor `failed`, retry-exhaustion `markFailed`** (`5.4-INT-011`, `5.4-INT-012`, `5.4-INT-013`); one idempotency key across allocate and commit (`5.4-WEB-008`, `5.4-MOB-016`)                                                    | `no_face` below the skin-pixel floor (`5.4-API-032`); every engine failure outcome is terminal and purges (`5.4-API-033`); a failed purge cannot strand `processing` (`5.4-API-035`); an undecodable upload terminates `low_quality` at the first attempt and purges, while a storage fault still propagates for BullMQ to retry (`5.4-API-036`, `5.4-API-037`)                                                                                                                                                                       |
| 4   | Rule table determinism and shape, pinned (`5.4-CON-001`–`5.4-CON-005`, `5.4-CON-031`); every `swatchHex` passes `meetsWcagAA()` (`5.4-CON-030`); every ITA° band boundary pinned on both sides and negative-`a*` undertone inputs (`5.4-UTIL-001`–`5.4-UTIL-047`)                                                                                                                             | `depth: null` renders family guidance copy on both surfaces (`5.4-WEB-018`, `5.4-MOB-018`); shade names render from locale keys, never from the server (`5.4-WEB-021`, `5.4-MOB-020`)                                                                                                                                                                                                                                                                                                                                                 |
| 5   | Advisor offer resolves per slot with undertone-exact beating wildcard (`5.4-API-040`); **two-way cross-selection regression, at the unit tier by call and at the integration tier against real SQL** (`5.4-API-044`, `5.4-API-045`, `5.4-INT-020`, `5.4-INT-021`); **two-way cross-click regression, branch follows `offer.advisor_slot` not `input.surface`** (`5.4-INT-022`, `5.4-INT-023`) | `affiliate_ctas_enabled = false` suppresses the overlay (`5.4-API-042`, `5.4-INT-027`); `commerce_affiliate_enabled = false` suppresses it and still renders first-party recommendations (`5.4-API-043`)                                                                                                                                                                                                                                                                                                                              |
| 6   | Disclosure precedes its control in the DOM, by document position (`5.4-WEB-022`, `5.4-MOB-021`, and again in `5.4-E2E-010`); dismissed item absent from the next `GET` (`5.4-API-050`); save survives reload (`5.4-E2E-010`)                                                                                                                                                                  | Undo restores a dismissed card (`5.4-WEB-026`, `5.4-MOB-022`); un-saving clears the row rather than storing a third state (`5.4-WEB-025`)                                                                                                                                                                                                                                                                                                                                                                                             |
| 7   | Guard `403` for non-entitled (`5.4-API-060`); locked panel + axe signed out at both viewports (`5.4-E2E-011`); flag-off `503` for an entitled consented caller (`5.4-API-061`); a rejected write re-resolves the surface rather than printing a line (`5.4-WEB-027`–`5.4-WEB-029`, `5.4-MOB-024`–`5.4-MOB-026`)                                                                               | Precedence order asserted explicitly (`5.4-API-062`); the signed-in non-entitled locked panel (`5.4-E2E-013`); the kill-switch note explains every disabled control (`5.4-WEB-012`, `5.4-MOB-012`); the write path's own doors -- the signed-out and in-progress rejections, the generic fallback line, the busy guard, the session re-read, the released object URL, a failed mint and a blocked popup (`5.4-WEB-034`-`5.4-WEB-042`, `5.4-MOB-027`-`5.4-MOB-030`)                                                                    |
| 8   | Two parity specs across ten catalogs × two surfaces, with the key set derived from the contract rather than hand-pinned (`5.4-I18N-WEB-01`–`09`, `5.4-I18N-MOB-01`–`09`); parent-spec exclusion in place; `/palette` present in `accessibility-hardening.spec.ts`'s route list and axe-clean at both viewports; axe on the ready state with a sponsored card (`5.4-WEB-033`)                  | `en-CA` `-our` spellings asserted in both directions (`5.4-I18N-WEB-09`); `StickyBottomNav` highlights the right tab on nested routes and none on `/palette` (`5.4-WEB-030`–`5.4-WEB-032`, `5.4-E2E-014`)                                                                                                                                                                                                                                                                                                                             |
| 9   | RLS actor matrix green including the owner-INSERT positive half (`5.4-DB-020`–`5.4-DB-030`); grant-breadth spec (`5.4-DB-001`–`5.4-DB-008`); three-registry analytics set-equality with negative fixtures (`5.4-CON-010`–`5.4-CON-022`)                                                                                                                                                       | Cleanup and erasure remove both tables' rows, scoped to their owner (`5.4-INT-028`); an advisor click's attribution id is derived server-side rather than trusted (`5.4-INT-024`, `5.4-INT-025`), and only while consent is current, against the row a revocation deliberately leaves behind (`5.4-INT-029`); the seed module graph instantiates under `tsx` in `prisma db seed` import order (`5.4-DB-040`); the advisor index stays PARTIAL on `advisor_slot IS NOT NULL`, the predicate Prisma's DSL cannot express (`5.4-DB-041`) |

### Explicitly untested, stated plainly

Real-world classification accuracy against human skin (this story asserts determinism and band boundaries, not that the answer is correct for any particular person — an accuracy study needs labelled data this project does not have); the skin-pixel gate's behaviour on real faces across lighting and camera pipelines, which is exercised only against fixture images (the Chai–Ngan YCbCr bounds are illumination-tolerant, not illumination-invariant, and a heavily warm-lit or heavily filtered selfie is expected to fail `no_face` or `low_quality` rather than to answer wrongly, but that expectation is asserted against fixtures, not photographs); real partner redirect behaviour beyond host validation, unchanged from 5.1; cross-device propagation latency, since no socket push is added, matching 5.2's and 5.3's stated deferral; full Maestro coverage of the entitled advisor state, the same harness-reachability limit both prior premium stories document; and `expo-image-picker`'s native camera path, which is mocked in unit tests and exercised only by the Maestro locked-state flow.

## Dev Notes

### Current state of every file being modified (read them before editing)

- `apps/api/src/modules/wardrobe/wardrobe-color.processor.ts:47-63,154-187` — `extractDominantHex` (note the `#808080` fallback at `:61`) and the only runtime `paletteInsights.upsert` in the repo. It writes `hex_codes` and a hardcoded `confidence_score: 1`, and **never** `undertone`. This story reads these rows; it does not modify this file.
- `apps/api/src/modules/wardrobe/wardrobe-silhouette.service.ts:259-336` — `createMyFormUploadUrl`: idempotency-key conflict handling, object-path construction, the full column write, and the stale-object `.catch(() => undefined)` cleanup at `:328-330`. The template for Task 6's allocate route. `commitMyForm` starts at `:484`.
- `apps/api/src/modules/wardrobe/silhouette-photo.processor.ts:1-106` — terminal-outcome handling, the deliberate non-catching of storage faults so BullMQ retries (`:50-53`), and the single-transaction status-plus-notification commit (`:89-104`). `:133-170` is the guardian/`ModerationEvent` path this story deliberately does not mirror; `:177-189` is `markFailed`, the third terminal door. The template for the analysis processor, plus the purge step this story adds.
- `apps/api/src/modules/wardrobe/silhouette-photo-processing.queue.ts:25-45` — why the job id must include the upload session id. Read the docblock; it describes a bug this story would otherwise reproduce exactly.
- `apps/api/src/modules/wardrobe/silhouette-photo-moderation.engine.ts` — the whole file is eleven lines: interface, verdict type, outcome union. The three-part engine shape (interface + real + fixture) to copy.
- `apps/api/src/modules/wardrobe/wardrobe.guard.ts` and `apps/api/src/modules/guardian/guardian.service.ts:1139-1160` — `WardrobeUploadGuard` → `assertWardrobeUploadAllowed`, which no-ops for non-teen roles and throws `GUARDIAN_CONSENT_REQUIRED` otherwise. Mount it unchanged; do not re-implement age logic.
- `apps/api/src/modules/commerce/commerce.module.ts:63-79` (controllers), `:80-111` (providers), `:112-114` (the export comment that names CC-5.4 directly).
- `apps/api/src/modules/commerce/commerce.module.ts:47-51` and `:117-122` — the `CommerceCacheHeadersMiddleware` rationale and its `configure()` binding to `/api/v1/commerce{/*path}`, the reason Decision 12 keeps the new routes inside the prefix.
- `apps/api/src/config/queues.ts:19-25,48-101` — the closed `QueueName` union and `queueConfigs`. A new queue is one edit in each. `apps/api/src/workers/wardrobe.bootstrap.ts:87` (`classifySilhouetteProcessingFailure`), `:153-157` (hand-wiring a processor) and `:162-183` (worker registration, including the final-attempt `markFailed`) are the template for Task 6's worker.
- `apps/api/src/modules/commerce/premium-entitlement.guard.ts:13-27` — the docblock naming CC-5.4 among its consumers. Read it before assuming any other gating shape. Do not edit it.
- `apps/api/src/modules/commerce/premium-entitlement.service.ts:191-197,385-398` — `hasPremiumAccess`, and the `auditLog.create` shape this story copies for consent events.
- `apps/api/src/modules/commerce/premium-theme.controller.ts` / `premium-theme.service.ts` — the closest complete precedent for this story's controller/service pair, including response-schema parsing in the handler and the P2023 stale-enum guard on the read path.
- `apps/api/src/modules/commerce/affiliate-click.service.ts:47-54,130-206` — offer re-validation, the 60-second dedupe replay, `UNRESOLVED_SCENARIO`, and the analytics emission that is skipped on an unresolved scenario. Decision 7's advisor branch goes here.
- `apps/api/src/modules/commerce/affiliate-offer.service.ts:194-232` (the Decision 4 short-circuit chain and its degrade-to-null catch), `:100-109` (`isAffiliateAudienceEligible`, a deliberate stub returning `true` with its parameter unread), `:125-157` (`resolveLocaleRegion` and the `'*'` sentinel) — the eligibility order and locale rules the advisor selection mirrors.
- `apps/api/src/modules/commerce/commerce.repository.ts:64` (`CommerceOfferMatch.garment_category`, non-null and staying that way), `:232-298` (`findBestOffer`, the equality filter that makes the NULL guarantee real), `:310-331` (`findActiveClickOffer`, the id-only lookup that does not).
- `packages/api-client/src/contracts/http/commerce.ts:1-51` — the two load-bearing decisions at the top (no error codes on the wire; `shopThisLook` carries no URL) and `affiliateSurfaceSchema` at `:27`.
- `packages/api-client/src/contracts/http/wardrobe.ts:797-930` — `silhouetteMyFormSchema`'s discriminated union and the upload/commit input schemas. The contract template for Task 6, and the source of Decision 12's union rule.
- `packages/db/prisma/schema.prisma:459-474` (`PaletteInsights`; `undertone` is `String?` at `:466`, `hex_codes` is `Json?` at `:467`), `:634-665` (`SilhouetteProfile`), `:667-674` (`ModerationEvent`'s relations, which include no palette target), `:824-899` (`AffiliateOffer` / `CommercePreference` / `AffiliateClick`), `:1017+` (`PremiumThemePreference`), `:198-234` (`User`, with the 5.1/5.2/5.3 back-relation block at `:228-233`).
- `packages/db/test/rls/harness.ts:9-11` (the header comment describing exactly how to add a table), `:21-31` (`guardianSharedTables`), `:33-51` (`selfOnlyTables`), `:263` (the `PaletteInsights` insert that writes `undertone`). **Note the refactor:** `rls-policies.spec.ts` no longer exists (commit `af291896` split the matrix into per-story files under `packages/db/test/rls/`); any story doc citing that path, including 5.3's, is stale.
- `packages/config/src/flags.ts:44-90` — the four premium/commerce flag definitions and their fail-closed comments; `flags.spec.ts:15-25,130-140` — the exact key-list and default assertions Task 4 must update.
- `packages/testing/src/cleanup.ts:255-330` — the delete-order block where the premium tables sit; `packages/testing/src/factories/premium.factory.ts` — the factory file to extend.
- `packages/utils/src/contrast.ts` — the sRGB linearization to reuse and the hex-validation posture (`#RRGGBBAA` rejected, bad input named rather than crashing) to match.
- `apps/web/src/app/settings/page.tsx` (43 lines) — the four load-bearing `<main>` attributes the new `/palette` page must also carry, and why. `playwright/tests/accessibility-hardening.spec.ts:9-14` is the literal route list that has to gain `/palette`; `apps/web/src/app/components/sticky-bottom-nav.tsx:19-22,31` is the four-tab nav and its exact-equality active-tab match.
- `apps/web/src/app/components/premium-theme-section.tsx` (571 lines) — the locked/loading/error/ready state machine, the classified-failure-to-catalog-key mapping, and the disclosure block at `:503-513`.
- `apps/web/src/app/components/commerce-preferences-section.tsx:164-174` — the disclosure-before-control shape AC 6 requires, with the comment explaining why reading order matters.
- `apps/mobile/app/wardrobe-silhouette.tsx` (13 lines) — the thin-route convention; `apps/mobile/src/features/wardrobe/wardrobe-onboarding-screen.tsx:22,195-196` — the `expo-image-picker` permission flow to reuse; `apps/mobile/src/features/wardrobe/wardrobe-hub-screen.tsx:193-203` — the link-row shape the settings entry copies.
- `apps/mobile/components/wardrobe/silhouette-editor.tsx:150,365,582-606` — the client-side `guidanceConfirmed` gate and the unconditional `confirmsBasewearGuidance: true` it sends. Read both together; Decision 5 exists because of the gap between them.

Anything a story task changes that is required for the system to keep working end-to-end is a requirement of this story whether or not an AC names it (create-story standing rule).

### What NOT to do (invention guards)

- Do **not** write a second colour-extraction path. `WardrobeColorProcessor` already produces the hex values the wardrobe source consumes; read `PaletteInsights`, do not re-download garment images.
- Do **not** write a third sRGB linearization. `packages/utils/src/contrast.ts` has one; export it (Task 2) and reuse it. Two further copies already live in the Playwright suite over `rgb()` strings, which `contrast.ts:9-20` records as outstanding duplicates — do not make it four.
- Do **not** classify undertone on a `b*/a*` ratio. `a*` is near zero for neutral skin and negative for a green- or cyan-leaning wardrobe mean, so the ratio both diverges and silently inverts. Hue angle via `atan2(b*, a*)` (Decision 3).
- Do **not** average gamma-encoded sRGB bytes. Linearize first, average in linear space or in Lab, then classify (Decision 3).
- Do **not** feed `sharp(...).stats()`'s whole-image mean to the classifier. A selfie is mostly not skin; the centre crop plus the YCbCr chroma gate is what isolates it, and its minimum-surviving-fraction floor is the only thing that can ever emit `no_face` (Decision 3).
- Do **not** add an ML model, ONNX Runtime, `expo-face-detector`, `culori`, `chroma-js`, or any colour library. The classification is arithmetic over Sharp's pixel output (Decision 3).
- Do **not** implement on-device analysis. ADR-014 rejected it explicitly and the UX spec line saying otherwise is stale (Decision 2).
- Do **not** add a `beauty` member to `GarmentCategory`, and do **not** create a parallel offer/click/conversion table. Two nullable columns on `AffiliateOffer` plus a check constraint (Decision 7).
- Do **not** let an advisor offer be selectable by `AffiliateOfferService.resolveShopThisLook`, or a garment offer by the advisor. Both directions get a regression test.
- Do **not** copy story 4.4's consent shape. A `z.literal(true)` the client always sends is not server-enforced consent, and `epics.md:576` asks for logged opt-ins (Decision 5).
- Do **not** retain the selfie after analysis, and do **not** purge only on the success branch. There are **three** terminal doors, and the third is `markFailed` in the worker's retry-exhaustion catch, which never enters the processor body (Decision 8).
- Do **not** purge before the terminal status commits. Status first, purge second (Decision 8).
- Do **not** branch the click path on the client-supplied `input.surface`. Branch on the offer row's `advisor_slot`, which the click lookup must start selecting (Decision 7).
- Do **not** assume `color_analysis_enabled` alone gates the sponsored overlay. `commerce_affiliate_enabled` and `CommercePreference.affiliate_ctas_enabled` gate it too, exactly as they gate the ritual CTA (Decision 7).
- Do **not** widen `CommerceOfferMatch.garment_category` or `shopThisLookSchema.garmentCategory` to nullable. The selection query filters on equality and can never return a NULL row (Decision 7).
- Do **not** convert, backfill or read `PaletteInsights.undertone`. It is a `String?` written only by the wardrobe seed and the RLS harness, and this story's undertone lives on `PaletteProfile` (Decision 1).
- Do **not** ship the processor without registering its queue in `apps/api/src/config/queues.ts` and its worker in `apps/api/src/workers/wardrobe.bootstrap.ts`. Everything else can be green while jobs go nowhere (Decision 12).
- Do **not** assume `playwright/tests/accessibility-hardening.spec.ts` discovers the new route. Its route list is literal (Decision 14).
- Do **not** put raw hex values, confidence scores, or image metadata into any analytics property (Decision 13).
- Do **not** leave `color_analysis_enabled` defaulting to `true`, and do **not** flip the default without also fixing `flags.spec.ts:137` and putting the literal `true` in the seed. Doing one without the other turns the feature off in every test environment (Decision 10).
- Do **not** add a second, advisor-specific commerce opt-out. `CommercePreference.affiliate_ctas_enabled` is the existing control and covers this surface (Decision 7).
- Do **not** hardcode an English shade name in a component. Shade names are locale keys resolved from `ADVISOR_RULES` (Decision 6).
- Do **not** bake English failure strings into the client libs. Classify the reason and let the component pick the catalog string — the defect 5.3's review found twice (Decision 14).
- Do **not** put the advisor in `settings.tsx` as a fourth inline section. It gets its own route on both surfaces (Decision 14).
- Do **not** touch `apps/mobile/targets/` (Swift) or the Android widget sources.
- Do **not** key the BullMQ job on the profile id alone. One row per user means every upload after the first would be silently dropped for the retention window (`silhouette-photo-processing.queue.ts:25-45`).
- Do **not** entitlement-gate `DELETE`. A lapsed subscriber must always be able to erase their data.
- Do **not** hand-edit `packages/api-client/src/generated/**` or the checked-in OpenAPI JSON. Change the Zod contract and regenerate.
- Do **not** add a k6 scenario. These are low-QPS settings operations.
- Do **not** trust any line number in this document without re-grepping. `rls-policies.spec.ts` was cited by story 5.3 and no longer exists.

### Previous-story intelligence (5.3 dev record, distilled)

- **Localize at the boundary, not in the component's fallback.** 5.3 shipped baked-English error messages in its client lib, making every translated fallback dead code; the fix required a failure-reason union and, separately, the same repair applied retroactively to 5.2's `premium.ts`. Build the union first this time.
- **Parse controller responses through their published schemas.** Both of 5.3's handlers skipped it and service drift would have reached clients as a browser-side `.strict()` failure.
- **A stored enum member the build does not know is a `P2023`, not a Zod failure.** Postgres native enums reject the row in the query engine before any application-level normalization runs. 5.3's stale-palette fallback was only reachable at the Zod layer until review caught it. This story puts seven new enums on read paths — catch `P2023` narrowly and let every other Prisma error propagate.
- **RLS actor matrices prove denial, not permission.** Seed inserts bypass RLS through the admin pool, so `WITH CHECK (false)` passes the matrix while making the first real write impossible. Drive the positive half through the `authenticated` role.
- **Grants and policies fail differently.** Correct policies with no `GRANT` deny even the owner; correct grants with no policies expose every row. Both need their own assertion.
- **Test ids must be unique.** 5.3's review found four ids used twice each across two tiers, so a failure report named two tests. Keep `5.4-<AREA>-<nnn>` globally unique.
- **Do not assert floating-point colour maths with `toBe`.** `toBeCloseTo(value, 2)`.
- **State plainly what was never executed.** 5.3 and 5.2 both carry an honest "explicitly untested" section; this story's is above and must stay accurate.
- **Run `typecheck` before considering anything done.** Vitest transpiles without typechecking.

### Git intelligence

`c0bc45d8` and `f009cadc` reshaped Maestro execution into duration-aware shards, and `c0bc45d8` added two more flows to `USER_SCOPED_FLOWS` in `scripts/run-maestro.mjs` after the local 4-way shard placed them on a device whose seeded user did not own their `-e` ids. Flows are discovered from `maestro/*.yaml`, so a new one needs a duration entry in `scripts/maestro-flow-durations.json` (`scripts/resolve-maestro-shard.mjs` bin-packs on those numbers) and an entry in `USER_SCOPED_FLOWS` only if it asserts on an identity-scoped id. `039b079b` completed 5.3's mobile surface, which is the closest template for Task 8. `af291896` split the RLS actor matrix into per-story files under `packages/db/test/rls/`, invalidating older stories' `rls-policies.spec.ts` citations. `6fb1950c` split the Pact accumulator files by domain, so Task 9's interactions go into the commerce-domain file, not one monolith. `9acb6a25` brought `scripts`, `k6` and `tools` under ESLint — new scripts are linted.

### Project structure notes

New API files under `apps/api/src/modules/commerce/`; new util `packages/utils/src/skin-tone.ts`; contract module `packages/api-client/src/contracts/http/palette-advisor.ts`; new libs `apps/{web,mobile}/src/lib/palette-advisor.ts`; new web route `apps/web/src/app/palette/page.tsx` with `app/components/palette-advisor-panel.tsx`; new mobile route `apps/mobile/app/palette-advisor.tsx` over `apps/mobile/src/features/premium/palette-advisor-screen.tsx` (a new `features/premium/` directory, following the existing `features/wardrobe/` convention); factory additions to `packages/testing/src/factories/premium.factory.ts`; one migration under `packages/db/prisma/migrations/`; two new locale parity specs per surface. Kebab-case files, feature-first, co-located specs — all existing conventions, no variances.

### References

- Epic contract: `_bmad-output/planning-artifacts/epics.md#Epic-5` (CC-5.4 at `:447-454`; sequencing at `:553`, `:566`; the consent/opt-in guardrail at `:576`)
- PRD: FR4 under Premium (`prd.md:206-207`) names selfies, wardrobe imagery, foundation tone, blush, and "curated accessories (jewelry, bags, eyewear) with optional sponsored links", and is the gating source for AC 7 — `:203` is the subscription-sync acceptance and says nothing about this feature; NFR Security 4 (`:257`) requires disclosure plus an opt-in/out toggle for third-party integrations; accessibility targets WCAG 2.2 AA (`:266`); "no dark patterns" at `:47`; the color-analysis open question, which itself presumes on-device, at `:294`
- Architecture: ADR-014 Color Analysis Architecture (`architecture.md:247`, dated `:253`) — server-side, Sharp, derived metadata only, ~3-5s per image. Its "ONNX Runtime (color inference using pre-trained model)" step is deliberately declined here and the divergence is logged (Decision 2). ADR-002 Media Pipeline; commerce module mapping (`architecture.md:109`); the `palette_insights` core table (`Data Architecture`)
- UX spec: `ux-design-specification.md:409` claims on-device analysis and is superseded by ADR-014 (Decision 2). There is **no** UX artifact for the advisor surface — no section, no reference HTML — so its layout follows the existing premium-section and wardrobe-screen conventions rather than a design source
- Readiness report: `refs/implementation-readiness-report-2025-11-13.md:189,242-245` lists the colour pipeline as a CC-5.4 blocker; Decision 2 records how it is discharged
- Story 5.3 (`5-3-premium-theme-switcher.md`) — the convention source for premium surfaces, contracts, RLS, i18n and analytics, and for most of the review lessons above
- Story 5.1 (`5-1-affiliate-shop-this-look-cta.md`) — the affiliate catalog, click token, deep-link validation and disclosure conventions this story extends
- Story 4.4 (`4-4-wardrobe-onboarding-silhouette-setup.md`) — the photo-upload lifecycle mirrored in Task 6, and the consent shape Decision 5 deliberately strengthens
- Story 4.2 (`4-2-smart-tagging-comfort-metadata.md`) — `WardrobeColorProcessor` and the pluggable-engine pattern

## Dev record

Tasks 1-6 were completed in an earlier session and are unchanged here except
where a defect below required it. Tasks 7-10 were completed in this one. What
follows is what the plan did not predict.

### Defects found and fixed in already-"done" work

- **The generated client could not send `Idempotency-Key`, so the whole selfie
  lifecycle was uncallable.** The contract registered the two idempotent POSTs
  with no `headers` block, while the controller rejects a missing or non-UUID
  `idempotency-key` with `400 INVALID_IDEMPOTENCY_KEY`. Every client built from
  the generated SDK would have hit that 400 on its first upload. Fixed by
  declaring the header on both paths (matching `wardrobe.ts`'s silhouette
  registrations) and regenerating. The bytes route was under-declared the same
  way — no `security`, no `x-upload-token`/`content-type` headers, no binary
  body — and now matches `PUT /api/v1/wardrobe/uploads/{uploadSessionId}`.

- **A sponsored advisor card could not be clicked at all.**
  `POST /api/v1/commerce/affiliate/clicks` requires `recommendationId`, which
  Decision 7 defines as the `PaletteProfile.id` for an advisor click, and nothing
  published that id. `paletteAdvisorProfileSchema` gained `profileId`
  (nullable — there is no row before the first consent grant).

- **...and the value it carries is no longer trusted from the client.** The
  60-second dedupe index is `(user_id, offer_id, recommendation_id, minute)`, so
  a caller who chooses the third column can mint unlimited attributed clicks for
  one offer inside one minute. `AffiliateClickService` now re-resolves the
  advisor `recommendation_id` from the session via
  `CommerceRepository.findPaletteProfileId`, and uses the derived value for both
  the dedupe lookup and the insert (`5.4-INT-024`). A caller with no profile is
  refused (`5.4-INT-025`). The garment path is unchanged.

- **`POST /consent` answered 201, and the contract said 200.** Nest's `@Post`
  default. Pact caught it during provider verification, which is exactly what
  that tier is for. The route creates nothing a client can address, so
  `@HttpCode(200)` is the fix rather than amending the contract.

- **The wardrobe source had no confidence floor.** Decision 3 states the rule for
  both sources ("`confidence < MIN_CONFIDENCE` (0.4) terminates as `failed`
  rather than shipping a low-confidence answer that a user will read as fact
  about their body"), and only the selfie engine implemented it. Added to the
  wardrobe derivation, terminating `insufficient_wardrobe` rather than
  `low_quality`: the `low_quality` copy is photo-specific in all ten catalogs and
  showing it to someone who never uploaded a photo would be a wrong answer
  dressed as a helpful one. `MIN_WARDROBE_SAMPLES` becomes a fast path rather
  than the binding gate as a result, which is stated in the code
  (`5.4-API-024`, `5.4-API-025`).

- **The entitled wardrobe journey was unreachable end to end.**
  `seedWardrobeItems` gives garments and `PaletteInsights` rows to the seeded
  TEEN accounts only, so `premium-active-user` — the account every premium E2E
  signs in as — reached `POST /analyze` with zero insight rows and always
  terminated `insufficient_wardrobe`. `seedPaletteAdvisorWardrobe` now seeds ten
  garments carrying `#C9A14A` for that account behind the same
  `allowsCommerceSeeding()` guard, which is what makes `5.4-E2E-010` a real
  journey rather than a stub. The classification is pinned rather than ranged:
  CIELAB hue 84.1° puts `#C9A14A` in the olive wedge.

- **Test ids were not unique.** `5.4-INT-010`, `5.4-INT-012`, `5.4-INT-013` and
  `5.4-UTIL-011` were each used twice across two tiers — the exact defect story
  5.3's review found and this story's Dev Notes warned about — and four more
  were minted as literal placeholder names (`5.4-API-04x`, `5.4-API-03x`,
  `5.4-UTIL-01x`, `5.4-UTIL-02x`). All resolved; the coverage matrix above now
  names ids that exist.

- **Three unrelated typecheck failures were left on the branch**: a
  `@ts-expect-error` attached to the call rather than the property (so it was
  both a no-op and an "unused directive" error), and two cleanup doubles missing
  the story's own two new delegates. Fixed rather than reported.

### Deliberate divergences from the plan

- **The web page renders no `<h1>` of its own.** Decision 14 pointed at
  `settings/page.tsx`, which carries a hardcoded English `<h1>Settings</h1>`
  above three sections. `/palette` hosts exactly one panel, so the panel's own
  localized heading IS the page heading; a second, untranslated one would have
  said the same thing twice, once in English only, on a surface whose every other
  word ships in ten catalogs.

- **Withdrawing consent runs `DELETE`, not `POST /consent { granted: false }`.**
  They do the same thing server-side, but the consent route mounts
  `PremiumEntitlementGuard` and checks the kill switch while `DELETE`
  deliberately does neither. Routing withdrawal through the guarded one would
  mean a reader whose subscription lapsed, or who opened the page while
  `color_analysis_enabled` was off, could no longer erase data the app still
  holds about their face — the exact case Decision 9 leaves `DELETE` ungated for.

- **The mobile selfie is re-encoded to PNG, not JPEG.** JPEG's 4:2:0 chroma
  subsampling discards exactly the Cb/Cr channels the server's skin-chroma gate
  reads (Decision 3). The silhouette editor already re-encodes to PNG for a
  weaker reason.

- **The parity specs derive their key set from the contract** rather than pinning
  it by hand, which is what story 5.3's specs do. The failure these exist to
  catch is drift between `ADVISOR_RULES` and the copy naming its shades, and a
  hand-written list would have to be edited in lockstep with the rule table by
  the same person who forgot to edit the catalogs.

- **`PremiumEntitlementService`'s Pact double moved out of the premium-theme
  doubles** into `pact/http/provider/doubles/premium-entitlement.ts`. It could
  only read the premium-theme provider state, so every palette interaction that
  crossed the guard answered `404 PREMIUM_THEME_STATE_NOT_CONFIGURED`. The guard
  is shared infrastructure, so its double is too.

- **`settings.tsx` gained its first `expo-router` import**, which meant the three
  suites that render it had to stub the module: `expo-router` transitively pulls
  in `expo-asset`, which cannot be evaluated in the browser test bundle. The
  `router` singleton rather than `useRouter`, matching `wardrobe-hub-screen.tsx`.

- **`expo-web-browser` is deliberately not mocked in the mobile screen suite.**
  Declaring a `vi.mock` for it makes Vite resolve the specifier, which wedges the
  optimizer and took three unrelated suites down — the hazard
  `apps/mobile/vitest.config.ts` documents at length. The load-bearing half (the
  click is minted with the right body before any navigation) is asserted; the
  handoff is shared code story 5.1 owns.

### Defects found and fixed in the adversarial review pass

Five, plus the test gaps around them. The first one was the reason nine CI
jobs were red.

- **The seed module graph would not instantiate under `tsx`, so `db:reset`
  failed and took every end-to-end tier with it.** `prisma db seed` runs
  `tsx prisma/seeds/index.ts`, which imports `testing/src/factories/factory.ts`
  before `./commerce.js`. That factory source `require`s `@couture/utils`, so
  the package is in the CommonJS require cache before any ESM import of it
  runs; Node then builds its ESM facade from the cached CommonJS object rather
  than letting cjs-module-lexer read the source, and the facade carries only
  `default` and `module.exports`. This story introduced the first
  `@couture/utils` import into the seeds, as a named import, and it threw
  `does not provide an export named 'buildGarmentObjectPath'` at instantiation
  time. All seven mobile E2E shards, the Playwright burn-in and the k6 smoke
  failed at `db:reset` while `lint`, `typecheck`, `verify:changed`, every
  coverage ratchet, Pact and the whole integration tier stayed green — Vitest
  resolves the package through its own bundler resolution and `typecheck` reads
  `../utils/dist/index.d.ts`, so neither can see it. Fixed by reaching it
  through `unwrapCjsNamespace`, the interop shim `seeds/wardrobe.ts` already
  uses, keeping the bare specifier so the root typecheck still resolves the
  Playwright helpers that import this module. Guarded by `5.4-DB-040`, which
  spawns a real `tsx` subprocess over a probe whose import ORDER mirrors the
  seed entry point; it is red against the defect and green against the fix.

- **Hue spread was measured linearly over a circular quantity, in both
  confidence formulas.** `hueAngleDegrees` wraps to `[0, 360)`, and a plain
  interquartile range over its output reads 359 degrees and 1 degree as 358
  apart when they are 2 apart. That is not a corner case for a wardrobe:
  magentas and fuchsias sit just below 360 in CIELAB while reds, corals and
  pinks sit just above 0, so a wardrobe holding both was refused
  `insufficient_wardrobe` while its colours agreed to within 22 degrees — the
  measured spread went from 341 to 22 degrees and the confidence from 0.00 to
  0.75. `hueAngleInterquartileSpread` in `packages/utils` measures each angle's
  deviation from the sample's mean direction instead, and because the
  interquartile range is translation-invariant it returns exactly the old value
  for any sample that does not wrap: no recalibration, only the wrap fixed. One
  implementation now serves both pipelines rather than two copies of the same
  arithmetic.

- **A deterministic decode failure in the analysis worker burned the whole
  retry budget and then reported the wrong reason.** The upload route already
  decodes these bytes: `verifyGarmentImage` runs `sharp().metadata()` and
  `.stats()` at PUT time under the same 4096-pixel limit the engine uses, and
  rejects a file that is not an image, a lying `mimeType` or an oversized frame
  before any of it is stored. What was unguarded is the narrower window between
  that decode and the worker's: an object that comes back from storage
  truncated or corrupted, or a codec path `.metadata()` accepts and
  `.resize().raw()` does not. Narrow, but deterministic — the throw propagated,
  BullMQ retried an input that could never succeed, and `markFailed` terminated
  it as `timeout` or `storage_error`, telling the user the service was slow
  when their photo was unreadable. It terminates `low_quality` on the first
  attempt now, and still purges. The DOWNLOAD keeps the opposite posture
  deliberately, with `5.4-API-037` pinning that too, because catching both at
  one level would turn a recoverable storage outage into a permanent verdict on
  a photo that was never read.

- **An advisor click's attribution id was resolved by row existence while
  answering with the consent message.** Decision 9 keeps the `PaletteProfile`
  row alive through a revocation on purpose, with nulled scalars and
  `consent_revoked_at` stamped, so a user who had erased their palette kept
  minting attributed advisor clicks and `findPaletteProfileId`'s
  `PALETTE_CONSENT_REQUIRED_MESSAGE` was describing a check it was not making.
  It applies `hasCurrentConsent`'s rule now, asserted against real SQL in
  `5.4-INT-029` because the surviving row is the whole point.

- **`5.4-E2E-014` asserted the bottom nav visible at the default 1280-wide
  viewport**, where `min-[768px]:hidden` guarantees it is not. The locator
  resolved fourteen times and read `hidden` every time. Fixed with the 375x812
  viewport story 3.6's own bottom-nav spec uses.

### Two more defects, found by running the tiers the branch had never run

Both surfaced once `db:reset` worked and the E2E tiers reached their tests for
the first time.

- **`5.4-E2E-012` asserted an empty `<ul>` was visible.** The test stubs a
  retired `analysis_version` so every stored `item_key` resolves to nothing,
  which is exactly the state it exists to pin — result panel intact, no cards,
  no error. But an empty list has no content and therefore no bounding box, so
  Playwright reports it `hidden` however correct the DOM is: the fixture made
  the assertion impossible to satisfy by construction. `toBeAttached` is the
  claim that was meant. Burn-in was otherwise 148 passed, 1 failed.

- **`5.4-MOB-016` had a real race, not a flake.** Its MSW handlers recorded
  `seen.commitKey` synchronously from the request headers and `seen.commitBody`
  from `await request.json()`, while the assertions gated on
  `waitFor(() => expect(seen.commitKey).toBeTruthy())`. The key is therefore set
  one microtask before the body, so the gate could open with `commitBody` still
  undefined. Locally that microtask always won and the suite passed 678/678
  across six runs; on a loaded CI runner it lost, and the quality gate failed
  with `expected undefined to deeply equal { uploadSessionId: 'session-1' }`.
  Recording the body first makes the key's truthiness mean the whole request was
  captured. The web equivalent (`5.4-WEB-008`) awaits the upload call directly
  rather than gating on a spy, so it never had the race.

### Test gaps closed in the same pass

The web panel and the mobile screen both had docblocks arguing that a rejected
write must re-resolve the surface rather than print a line, and coverage put
several of those cases at zero: the `signed_out` rejection, the `in_progress`
re-read, the generic fallback line, the busy guard, the session re-read on
every press, the object URL released whichever way an upload ends, a failed
click mint and a blocked popup. The web panel goes 77 to 92 percent statements
and 79 to 96 percent lines; the mobile screen 86 to 93 percent statements; the
mobile lib's reason classification 61 to 73 percent branches. Both workspace
ratchets move up with them, so deleting the new tests fails the run.

### Reviewed and found sound

- **The two-way cross-selection guarantee is enforced by the database**, not
  only by the two queries' `WHERE` clauses:
  `CHECK (num_nonnulls(garment_category, advisor_slot) = 1)` makes a row that
  could satisfy both selections unrepresentable.
- **Every test id claimed in the coverage matrix exists**, and no id is used
  twice across the 174 in the story.
- **The locale drafts read idiomatically and match the register each catalog
  already uses** — `vous` in `fr-FR`, `du` in `de-DE`, the informal imperative
  in `tr-TR` — consistent with story 5.3's shipped copy in the same files.

### The deferred backlog, closed on the same PR

A later pass over `deferred-work.md`'s story 5.4 section. Two of the entries
turned out to be wrong about the code rather than hard to fix, and finding that
out was most of the value.

- **The integration tier was already running in CI.** The entry called "no
  workflow runs `test:integration`" the highest-value item in the list.
  `apps/api/vitest.config.ts` includes `integration/**/*.spec.ts` alongside
  `src/**`, so `quality-gate`'s `test:coverage` step has been running all 26
  suites against the PostgreSQL and Redis containers it declares; this branch's
  own head-commit run logs `✓ integration/palette-advisor.integration.spec.ts
(11 tests)`. The unused thing is the `test:integration` SCRIPT, not the
  evidence. What was genuinely missing is the tripwire: fourteen suites skip
  themselves on a failed schema probe, which is right for a laptop and silent
  when CI points them at the wrong database — the failure
  `apps/api/vitest.config.ts` records from 2026-08-18, where sixty-one tests
  skipped behind a coverage failure that named coverage. `5.4-INT-031` scrapes
  the probe set out of the sibling suites rather than pinning a list nobody
  would maintain, and fails the run when `CI` is set and a probed table does not
  resolve. Verified red against a database that does not exist.

- **A retired `analysis_version` does not empty the card list.** The entry,
  `5.4-MOB-023`'s docblock and `5.4-E2E-012`'s all said every stored `item_key`
  resolves to nothing on a rules bump. `resolveRecommendations` builds its cards
  from the CURRENT `ADVISOR_RULES` keyed on the stored undertone and depth and
  never reads `analysis_version`; no read path does. `5.4-INT-032` pins that
  against real SQL. What a bump actually costs the reader is the palette above
  the cards, shown exactly like a current result, so the fix is the sentence the
  entry asked for attached to the condition that is actually reachable:
  `commerce.premium.palette.staleVersion`, ten catalogs, both surfaces, above
  the numbers it qualifies. The two empty-list fixtures stay, relabelled as the
  hostile fixtures they are.

- **The garment click's dedupe key is derived now too.** Story 5.4 closed this
  for the advisor path and scoped the garment half out. The change is one
  hoist: `findRecommendationScenario` was already user-scoped and already ran on
  every click, just after the dedupe check had used the untrusted value. Moving
  it above lets its answer gate the key. A sentinel rather than a rejection,
  because a forged id and one whose row rotated behind the Redis and on-device
  ritual caches are indistinguishable here and Decision 7 forbids failing the
  second. `5.4-INT-036` proves the collapse against the real unique index over
  HTTP; `5.4-INT-035` moves the analytics id to the stored value, because an
  event carrying an id no click row has is worse than no id.

- **The advisor offer lookup has query-plan evidence.** An advisor cohort the
  size of the garment one, and `5.4-PLAN-01`..`-04` mirroring
  `5.1-PLAN-02`/`-04`/`-05`/`-06`. `5.4-PLAN-01` asserts `advisor_slot` is in
  the Index Cond rather than that the index is merely named, and deliberately
  does not forbid the garment index: the `'*'` sentinel branch of the BitmapOr
  carries no slot predicate and either index serves it, which is a choice
  between two index scans rather than the table scan being ruled out.

- **Three planning documents no longer contradict shipped behaviour.** ADR-014
  records the declined ONNX step, and two things it did not anticipate: the
  derived palette lands on `PaletteProfile` rather than
  `wardrobe_items.color_palette`, and the selfie is purged rather than left at
  rest. `ux-design-specification.md`'s "on-device palette detection" is
  corrected, and `prd.md`'s open question is struck through and answered in
  place rather than deleted, so a link to it lands on the answer.

Left open: three CI-plumbing items that need a runner rather than a checkout —
per-attempt Maestro artifacts, the Linux-only Pact consumer flake, and the
`open-settings.yaml` emulator flake. Each is recorded in `deferred-work.md` with
what a fix needs. Shipping any of them from here would be an unverified guess
about shared infrastructure.

### Gates

`npm run lint`, `npm run typecheck` and `npm run test:pact` (including its
three-run consumer determinism check and full provider verification) are green.
`npm run verify:changed` is green across all eight touched workspaces with
`DATABASE_URL` set, and every workspace's coverage ratchet holds under
`test:coverage`. `apps/api/integration/palette-advisor.integration.spec.ts` is
green against local PostgreSQL: 10 tests, including all three purge doors and
both cross-selection directions.

Not executed here: the Playwright suite and the Maestro flow, which need the
full local stack and an Android device respectively.

## Open questions

None block Tasks 1-6. Two are product taste calls, resolved here with a stated default rather than left blocking; revisit if the outcome looks wrong once built:

1. **Should a guardian see a teen's derived palette?** Default taken: **no** — `selfOnlyTables`, per Decision 11. Guardian consent gates whether the upload may happen at all, which is the mandate the repo actually has; surfacing a derived body characteristic to a guardian is a separate mandate no planning document grants, and the neighbouring `PaletteInsights` being guardian-shared is about garment colours, not skin. Logged in `deferred-work.md` so product can reverse it deliberately. Reversal is a category move in `harness.ts` plus a migration, not a redesign.

2. **Should the wardrobe source offer foundation recommendations at all?** Default taken: **yes, degraded and labelled**. A `depth: null` palette yields undertone-family guidance with copy that says a selfie would give a shade match. The alternative — hiding foundation entirely for wardrobe-sourced palettes — reads as a broken feature rather than an honest limit, and the epic AC names foundation without qualifying the source. If this turns out to be a support burden, hiding the slot is a one-line change in the rule-table lookup, not a schema change.
