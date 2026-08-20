---
baseline_commit: 1d8303b3e1bcff794c8cef0b717a066660ea1bb7
status: in-progress
---

<!-- markdownlint-disable MD013 MD024 MD036 -->

# Story 5.3: Premium theme switcher

Status: in-progress

**Story key:** `5-3-premium-theme-switcher` · **Epic:** 5 — Commerce & Premium Enhancements (Phase 2)
**Baseline commit:** `1d8303b` (branch tip == `main` after story 5.2, PR #129, and the Maestro-gating PR #130)
**Prepared:** 2026-08-18 by the create-story workflow (Claude Sonnet 5), from exhaustive analysis of `epics.md`, `prd.md`, `architecture.md`, the UX spec (incl. `refs/ux/ux-color-themes.html`), story 5.2 (`5-2-premium-subscription-lifecycle.md`, now `done`), story 5.1's RLS/i18n conventions, and live-codebase research across four parallel investigations (tokens/theming infra, settings surfaces post-5.2, RLS/i18n/analytics patterns, watchOS native code).

## Story

As a Premium subscriber,
I want optional interface palettes (e.g., Midnight Noir)
so that the app matches my aesthetic.

(Verbatim from `epics.md:439`; `:440` is the "Acceptance Criteria" heading that follows it. "Midnight Noir" is the epic's illustrative example name, and the PRD adds a second one, "Aurora Dawn" (`prd.md:204`). See Decision 1 for why neither ships.)

## Traceability: epic AC → story AC

| Epic AC (`epics.md:442-444`)                                                 | Story AC                         | Kind                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Provide a theme gallery respecting brand guidelines and WCAG AA contrast. | AC 1, AC 2                       | source                                                                                                                                                                                                                                                                                                                   |
| 2. Apply chosen palette across mobile/web/watch instantly with persistence.  | AC 3, AC 4, AC 5                 | source (watch scoped — see Decision 5)                                                                                                                                                                                                                                                                                   |
| 3. Fall back gracefully to default theme if asset missing.                   | AC 6                             | source (scoped — see Decision 6)                                                                                                                                                                                                                                                                                         |
| —                                                                            | AC 7 (disclosure + localization) | derived: repo convention, **not** the PRD. `prd.md:272` names only English, Spanish, and French; the ten-catalog requirement comes from CC-3.2's shipped i18n surface and the `*-locales.spec.ts` parity gate every feature area has followed since 5.1/5.2. Do not cite `prd.md:272` as the authority for ten catalogs. |
| —                                                                            | AC 8 (RLS + analytics)           | derived: repo convention — every new user table registers in the RLS matrix; PRD FR7 requires event coverage for new user actions                                                                                                                                                                                        |

No epic AC is orphaned.

## Acceptance Criteria

1. **Theme gallery.** A signed-in, Premium-entitled user sees a theme gallery (mobile Settings, web `/settings`) offering exactly three palettes — **Jewel Radiance**, **Autumn Umber**, **Winter Metallic** — plus an implicit "Default" (the current monochrome + gold system). Each palette renders as a swatch card using the exact hex values from `refs/ux/ux-color-themes.html` (Decision 2). **Spring Bloom is explicitly out of scope** — the UX spec marks it "(future)" (`ux-design-specification.md:82`); do not add a fourth option.
2. **WCAG AA contrast, verified not assumed.** A new `@couture/utils` contrast helper (Decision 3) computes relative-luminance contrast ratios. The PRD's accessibility NFR targets **WCAG 2.2 AA** (`prd.md:265`); SC 1.4.3 (contrast minimum) and SC 1.4.11 (non-text contrast) are byte-identical between WCAG 2.1 and 2.2, so the formula and the 4.5/3.0 thresholds are the same either way. Cite 2.2 in code comments to match the PRD. Every text/background pairing the gallery renders is proven ≥4.5:1 (normal text) or ≥3:1 (large text/non-text UI) by a unit test pinning the ratio to two decimals with `toBeCloseTo(x, 2)` — not eyeballed, and not `toBe`, because these are floating-point results (see Decision 3). Two of the three themes' "primary" accent-fill-plus-white-text combos fail the 4.5:1 floor (Autumn Umber's Maple 4.28:1, Winter Metallic's Steel 3.57:1) and are restricted to large/bold text or icon-only use; the three "card-preview" pairings from the UX reference file all pass comfortably (8.01–11.58:1) and are the only combos used for body text.
3. **Persistence.** Selecting a palette (or reverting to Default) persists server-side via `PremiumThemePreference`, one row per user, surviving reload, re-login, and cross-device sign-in (mobile ↔ web share one account).
4. **Instant apply, web + mobile.** On successful save, the choice re-colors the surface immediately without a page reload: web via a `data-theme` attribute on `<html>` driving CSS custom properties (extending the existing `[data-focus-surface]` pattern in `globals.css`); mobile via a React Context (`AppThemeProvider`/`useAppTheme()`) that the gallery and its own preview card read live. Per Decision 4, this story wires the token layer and demonstrates it on the theme gallery/settings surface itself — it does not retrofit existing hero, lookbook, or button chrome to consume the new tokens; that is deferred, tracked per-surface.
5. **Entitlement gating.** Non-entitled and signed-out users see a locked upsell state, following `apps/web/src/app/components/planner-rail.tsx:81-96`'s locked pattern: a `data-testid`-tagged panel, one line of plain copy naming Premium, and one visible control pointing at the subscribe path. No modal, no fake urgency, no countdown, per the PRD's "no dark patterns" guardrail (`prd.md:47`). See Decision 11 for the one intentional divergence from that template. `PremiumEntitlementGuard` — shipped dormant in story 5.2 (`premium-entitlement.guard.ts:13-27`), whose docblock names CC-5.5's planner API as its first production consumer with "CC-5.3/5.4 follow" — mounts on a production write path in this story. If 5.3 lands before 5.5, this story is the guard's actual first production mount; do not treat the docblock's ordering as a constraint on merge order, and do not "correct" the docblock as part of this story.
6. **Graceful fallback.** An unknown/stale theme key (e.g., a value from a since-removed palette), a failed fetch, or a signed-out/non-entitled state all render the Default theme cleanly — never a blank screen, a thrown error, or a stuck loading state. "Asset missing" (epic AC 3's wording) is interpreted per Decision 6: this story ships no downloadable image/font assets per theme, so the fallback path is data-validation and network-failure handling, not an asset-loader.
7. **Disclosure and localization.** New locale keys under `commerce.premium.theme.*` ship in all ten locale catalogs on both surfaces (`de-DE`, `en-CA`, `en-US`, `es-419`, `fr-CA`, `fr-FR`, `it-IT`, `pt-BR`, `pt-PT`, `tr-TR`), with a new dedicated parity spec per surface following the `premium-locales.spec.ts` precedent (5.2's own comment explains why a new feature area gets its own spec rather than extending an existing pinned-key one).
8. **RLS and analytics.** `PremiumThemePreference` registers in the `selfOnlyTables` RLS category (`rls-policies.spec.ts:36-49`) — same owner-only, non-guardian-shared template as `CommercePreference` — and passes the full actor matrix in CI. A `premium_theme_selected` server-side event (pseudonymous HMAC subject) is registered across all three analytics registries with a `{ theme }` property allowlist, following the `premium_entitlement_activated` four-step registration pattern exactly.

## Decisions

### Decision 1 — Palette names: the epic's "Midnight Noir" is illustrative, not literal

Recon fact: no document defines a palette called "Midnight Noir." Nor "Aurora Dawn," the _second_ illustrative name the PRD adds at `prd.md:204` ("optional interface color themes (e.g., 'Midnight Noir', 'Aurora Dawn')"). Two upstream documents each invent throwaway example names, and neither name has a hex value anywhere in the repository. That is the tell that both are placeholders rather than a specification.

The UX spec (`ux-design-specification.md:77-84`) and its interactive reference (`refs/ux/ux-color-themes.html`) are, by contrast, unambiguous and detailed: three shipped palettes (**Jewel Radiance**, **Autumn Umber**, **Winter Metallic**) plus one explicitly future one (**Spring Bloom**), each with named, quoted hex values. The epic's and PRD's example names predate the UX pass that later named the real palettes; the UX alignment note at `epics.md:534` records a complexity bump for CC-5.3 "to align palette tokens with new component demos," confirming the UX spec is the newer, authoritative source. This story ships the UX spec's three named palettes. Neither "Midnight Noir" nor "Aurora Dawn" appears anywhere in code, copy, or locale strings.

### Decision 2 — Palette values, verified by hand (not eyeballed)

Source: `refs/ux/ux-color-themes.html:43-57,113-210` (the "Color Theme Explorer" the UX spec explicitly names as the engineering reference, `ux-design-specification.md:113`). Per theme: a **primary** accent, **secondary** accent, and a **card-preview** background/text/border pairing.

**Two source documents disagree; the HTML wins, deliberately.** The UX spec's prose (`ux-design-specification.md:78-80`) lists a third color per palette that the reference HTML does not use: Wine Red `#722F37` for Jewel Radiance and Chestnut `#8C5331` for Autumn Umber. The HTML instead pairs Jewel Radiance with Amethyst `#6C3AA8` and carries no Chestnut at all, while adding the neutral card-preview colors (Pearl, Frost, Cocoa, Glacier, Ice, Gunmetal) the prose never mentions. This story ships the HTML's values because the spec itself designates that file as the precise-values reference for engineering (`:113`), and because only the HTML defines complete, demo-verified pairings rather than loose accent lists. Wine Red and Chestnut appear nowhere in this story's code, tokens, or locale strings. Do not "restore" them from the prose.

Contrast ratios below are sRGB-linearized relative-luminance calculations, computed during story creation and re-pinned by the Decision 3 utility's own unit tests. Treat the utility's test output as the source of truth if these ever drift:

| Theme           | Primary           | Secondary                      | Card-preview bg → text                                    | Card text contrast                        | Primary + white text contrast                                |
| --------------- | ----------------- | ------------------------------ | --------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------ |
| Jewel Radiance  | Emerald `#0D6F62` | Amethyst `#6C3AA8`             | Pearl `#F4F6FB` → Sapphire `#1F4E79`                      | **8.01:1** (8.0120) — passes small text   | **6.06:1** (6.0567) — passes small text                      |
| Autumn Umber    | Maple `#B1683A`   | Wheat `#D9B38C` (dark text)    | Frost `#F3EDE6` → Cocoa `#3E2A23`                         | **11.58:1** (11.5795) — passes small text | **4.28:1** (4.2764) — FAILS small text, passes large/UI only |
| Winter Metallic | Steel `#7E889A`   | Platinum `#C9CDD8` (dark text) | Ice `#E9EDF6` → Gunmetal `#2F333D` (flattened, see below) | **10.78:1** (10.7771) — passes small text | **3.57:1** (3.5742) — FAILS small text, passes large/UI only |

The parenthesised four-decimal values are the exact computed results. The two-decimal figures are what the unit tests assert via `toBeCloseTo(ratio, 2)`. Do not assert with `toBe` against a rounded literal; these are floating-point results and an exact-equality assertion fails immediately.

**Winter Metallic's card preview is flattened from a gradient to a solid, on purpose.** The reference HTML renders it as `background:linear-gradient(135deg,#F7FBFF,#E9EDF6)` (`ux-color-themes.html:57`). Neither carrier in this story can hold a gradient: web's `--theme-card-bg` is a single custom property (Decision 11) and mobile's `cardBg` is a single `StyleSheet` color (Decision 12), and `expo-linear-gradient` is **not** an installed mobile dependency. Rather than add a dependency mid-story or let each surface flatten it differently, both surfaces use the solid **Ice `#E9EDF6`** end. That is the darker of the two stops, so it is the worst case for contrast against Gunmetal text, and it is the value already audited at 10.78:1 above. The Glacier end `#F7FBFF` would measure 12.15:1, so nothing is lost accessibility-wise. If a future story wants the real gradient, it owns adding `expo-linear-gradient` and re-shaping `cardBg` into a stop list on both surfaces.

Consequence for implementation: the gallery's body-copy text always uses the card-preview pairing (all three pass at 8.01–11.58:1). A theme's `primary` swatch may be used as a small pill/badge fill with white text only for Jewel Radiance; for Autumn Umber and Winter Metallic, `primary`-fill-plus-white-text is restricted to large/bold text (≥18px/24px regular or ≥14px/18.66px bold) or icon-only controls per SC 1.4.3/1.4.11's 3:1 floor. Any new pairing introduced later must be checked with `meetsWcagAA()` before shipping — do not extrapolate from these three.

### Decision 3 — Contrast helper: consolidate the two copies that already exist, do not write a third

**Prior art, read this before writing any luminance math.** This repository already contains two working, mathematically correct WCAG contrast implementations:

- `playwright/support/helpers/accessibility.ts:84` — exported `contrastRatio(left, right)`, takes CSS `rgb()` strings (the shape `getComputedStyle` returns), correctly gamma-linearizes, and is consumed by `playwright/tests/commerce-affiliate-preferences.spec.ts:239`.
- `playwright/tests/accessibility-hardening.spec.ts:131` — an inline duplicate of the same function. The helper's own docblock (`accessibility.ts:80-82`) records why it was left alone: that spec gates every primary route, so it was not refactored in a change that could not run it.

So the mistake to avoid here is not "no contrast utility exists." It is adding a **third** copy of the math while two sit in the tree. This story makes `@couture/utils` the canonical home, leaving exactly one real implementation plus one knowingly-deferred duplicate:

- New `packages/utils/src/contrast.ts` holds the math, over **hex** inputs (what the palette data actually is).
- `playwright/support/helpers/accessibility.ts` keeps its `rgb()`-string signature for computed-style callers and becomes a thin adapter: parse `rgb()` to hex with the `parseRgb` it already has, then delegate to `@couture/utils`. Its existing callers do not change.
- The inline copy in `accessibility-hardening.spec.ts` stays untouched, for the reason its own docblock gives. Note it in `deferred-work.md` so the last duplicate has an owner rather than being forgotten.

**The delegation needs no new build wiring.** `playwright/` is not an npm workspace, but `@couture/utils` is symlinked into root `node_modules` and `prepare:playwright` already runs `npm run build --workspace @couture/utils` ahead of `@couture/api-client`, which the Playwright suite imports today. The package resolves through `dist/`, so the only requirement is the build step that already exists. If a Playwright run fails to resolve the import, the fix is running `prepare:playwright`, not vendoring the function back into the helper.

The utility itself:

`packages/utils/src/contrast.ts` (new, sibling to `accessibility.ts`, same pure-function style, no classes):

```ts
export function contrastRatio(hexA: string, hexB: string): number
export function meetsWcagAA(
  foregroundHex: string,
  backgroundHex: string,
  opts?: { largeText?: boolean }
): boolean
```

`contrastRatio` implements the standard WCAG relative-luminance formula (sRGB gamma-correct linearization, `(L1 + 0.05) / (L2 + 0.05)` with `L1` the lighter color), matching the two existing copies line for line so the adapter above is a pure delegation with no behavior change. `meetsWcagAA` thresholds at 4.5 (normal text, default) or 3.0 (`largeText: true`). Export both from `packages/utils/src/index.ts` alongside the existing `formatWeatherAltText`/`getAnnouncementUrgency` block.

Unit tests pin the six ratios in the Decision 2 table (three card-preview pairs, three primary+white pairs) as regression fixtures, asserted with `toBeCloseTo(ratio, 2)` against the two-decimal figures. This is the mechanism that keeps the table honest if a designer ever nudges a hex value. Add one adapter test proving `playwright/support/helpers/accessibility.ts`'s `rgb()` entry point returns the same number as the hex path for the same color, so the delegation cannot silently drift.

### Decision 4 — Scope boundary: primitive + one demonstration surface, not a full re-skin

Recon fact (tokens/theming investigation): **no design-token package, no theme mechanism, and no theme-switcher UI exist anywhere in this repo today.** `packages/tokens/` is described in `architecture.md:85-88` but was never built — treat that line as aspirational intent, not current state. Brand colors are hardcoded ad hoc across dozens of files on both web (`bg-[#...]` Tailwind arbitrary values, e.g. `lookbook-prism-layout.tsx:191,229,251,295-364`) and mobile (raw hex in `StyleSheet.create` blocks, plus two unrelated, narrower light/dark objects — `constants/colors.ts` and `components/hero/hero-theme.ts`, both OS-`useColorScheme()`-driven and orthogonal to premium palettes; do not conflate the two axes, and do not touch either file).

Given that, retrofitting every existing branded surface (hero, lookbook grid, buttons everywhere) to consume a new premium-palette token is an unbounded, multi-file, high-regression-risk scope this story does not take on — exactly the kind of scope creep story 5.2's Decision 2 refused for planner/palette-analysis/themes work generally. This story instead:

- Builds the **primitive**: persisted preference, API, web CSS-variable layer, mobile Context/hook, verified contrast data.
- Demonstrates it **live on one real surface**: the theme gallery/settings section itself re-colors its own swatch cards, selected-state indicator, and a small preview card on selection — proving the plumbing end-to-end without inventing a fake demo screen.
- Explicitly does **not** reskin the hero canvas, Lookbook Prism, chip system, or button hierarchy elsewhere in the app. Any future story that wants a given surface to read the new tokens is that surface's owner, exactly as CC-5.2 Decision 2 assigned surface-gating ownership to CC-5.3/5.4/5.5 individually. Record this boundary in `deferred-work.md`.

### Decision 5 — Watch is explicitly out of visual scope, by design intent already on record

Recon fact (watchOS investigation): the watchOS companion app is real, substantial, native SwiftUI (`apps/mobile/targets/watchos/`, ~1200 lines across 6 files, generated into the Xcode project via a genuine Expo config plugin, `plugins/with-watchos.js`) with its own hardcoded color constants (`WatchContentView.swift:4-6`: onyx/gold/cloud) and its own sync channel (`WatchConnectivityManager` + shared `UserDefaults` App Group — the "Watch Isolation Principle" from story 3.4's dev notes forbids the watch target from making direct HTTP calls at all).

**Two documents name the watch, not one.** Epic AC 2 says "apply chosen palette across mobile/web/watch instantly" (`epics.md:443`), and the PRD's FR5.3 acceptance repeats it in stronger terms: "palette changes apply instantly across mobile/web/watch surfaces" (`prd.md:205`). The PRD line is the harder contract of the two, so it is the one this decision has to answer, not just the epic.

The UX spec answers both directly: **"Wearable cards adopt the monochrome palette (white body, charcoal text, gold ring indicator) so the watch face feels consistent with the app without the heavy black background"** (`ux-design-specification.md:381`, section 8.1, Widgets & wearables). This is a deliberate design decision that the watch stays monochrome+gold regardless of the wearer's in-app palette choice; glanceable legibility on a 1.5-inch screen beats aesthetic parity. The UX spec is the newest of the three documents and is the one that actually reasoned about the wearable surface, so it governs. This story therefore:

- Ships **no changes** to any Swift or Kotlin file under `apps/mobile/targets/` or `apps/mobile/android/**/widget*`.
- Treats the "watch" mention in **both** `epics.md:443` and `prd.md:205` as satisfied by this explicit, cited design decision, not by native code changes.
- Records a `deferred-work.md` entry naming both citations, in case product later wants complications to tint their accent ring by theme — a small, well-scoped follow-up once this story's server-side preference already exists to read from. Cite the PRD line there too, so a future reader does not rediscover it and think the requirement was missed rather than answered.

### Decision 6 — "Fall back gracefully to default theme if asset missing" — what that means here

This story ships **no downloadable image, font, or texture assets per theme** — palettes are pure color tokens (Decision 2). So "asset missing" cannot mean a failed image fetch (nothing to fetch); it is interpreted as the three real failure modes this feature actually has:

1. An unknown/stale `theme` value (a key from a since-removed palette, or a client cache holding a value the server no longer recognizes) → render Default, never crash on an unmapped enum.
2. A failed `GET /api/v1/commerce/premium/theme` (network error, timeout) → render Default while surfacing a quiet inline error, matching the existing `load_failed` pattern in `subscription-section.tsx`'s `SectionState` — do not block the rest of the settings page.
3. A non-entitled or signed-out state (including a stored preference from a since-lapsed subscription) → render Default regardless of the stored row's value. Decision 7 below states why this is a resolution rule, not a bug.

If a future story adds real per-theme assets (textures, custom fonts), this is the fallback path it inherits — noted so it isn't rebuilt from scratch.

### Decision 7 — Effective theme is resolved from entitlement + preference together, server-side

A user can select a theme, then let Premium lapse. The stored `PremiumThemePreference` row is **not deleted** on downgrade (it's a harmless preference, not a privilege-bearing row like `PremiumEntitlement` — no RLS worker-only treatment needed, see Decision 8), but it must **not** render once entitlement is lost, matching the epic's framing ("As a Premium subscriber..."). Rather than making every client independently combine two API responses (`/subscription` + `/commerce/premium/theme`), `GET /api/v1/commerce/premium/theme`'s service computes and returns entitlement inline via the same `PremiumEntitlementService.hasPremiumAccess(userId)` the guard uses (`premium-entitlement.service.ts:191-197`) — one round trip, one source of truth per client. See Decision 9 for the exact response shape.

### Decision 8 — Data model

New enum + model, following 5.1/5.2's Prisma conventions exactly (cuid ids, `@@map`, snake_case columns, lowercase enum values for JSON, no mapping layer):

```prisma
enum PremiumThemeKey { jewel_radiance autumn_umber winter_metallic }

/// RLS: owner-only (selfOnlyTables), same template as CommercePreference.
/// A cosmetic preference, not privilege-bearing — unlike PremiumEntitlement,
/// this table is safe for the authenticated user to read/write directly.
model PremiumThemePreference {
  id         String           @id @default(cuid())
  user       User             @relation(fields: [user_id], references: [id], onDelete: Cascade)
  user_id    String           @unique
  theme      PremiumThemeKey?
  created_at DateTime         @default(now())
  updated_at DateTime         @updatedAt

  @@map("PremiumThemePreference")
}
```

- Absent row or `theme: null` = Default. Do not add a `default`/`none` member to the enum — an absent selection and an explicit "none" value would be two spellings of the same fact (the exact trap 5.2 Decision 3 named for `PremiumEntitlementStatus`).
- **Reset is an upsert to `null`, never a delete.** Note that absent-row and `theme: null` are themselves two spellings of Default, which is the same shape this model just refused for the enum. It is tolerable here only because one spelling is unreachable by choice: a row appears the first time a user touches the gallery and is never removed after. So the rules are explicit rather than inferred. **Write path:** `PUT` with `{ theme: null }` upserts the row with `theme = null`; it must not `delete`. **Read path:** absent row and `theme: null` resolve identically to Default, with no branch that can tell them apart. **Downgrade path:** entitlement loss changes nothing about the row (Decision 7). A dev who implements delete-on-reset gets behavior that passes a single-user unit test and diverges the moment `updated_at` or an analytics count matters.
- `User` gains the back-relation `premium_theme_preference PremiumThemePreference?`. The three 5.2 back-relations to sit beside are at `schema.prisma:216-218` (`premium_entitlement`, `billing_events`, `billing_customer`); `:213-215` is the 5.1-and-earlier block (`silhouette_profile`, `commerce_preference`, `affiliate_clicks`). Re-grep before editing, per the line-number caveat in Dev Notes.
- RLS: add `'PremiumThemePreference'` to `selfOnlyTables` (`rls-policies.spec.ts:36-49`, next to `'CommercePreference'` at line 47) — full CRUD via `private.can_manage_self_row("user_id")`, same migration-SQL template as `CommercePreference`'s grant/policy block (`20260811090000_add_commerce_affiliate/migration.sql:219-249`). Do **not** touch `targetTables` (`:716`) or either `privateTables` const (`:803`, `:2760`) — those belong to other tests' fixtures.
- Migration: next timestamp dir after `20260812090000_add_premium_subscription` (e.g. `..._add_premium_theme`), hand-authored SQL mirroring the `CommercePreference` grant/RLS block, then `npm run db:generate`.
- Factory: extend `packages/testing/src/factories/premium.factory.ts` (sibling builder, not a new file — this is the same "premium" domain) with `createPremiumThemePreference(overrides)` + `persistPremiumThemePreference`, following the `CommercePreferenceFixture` pattern (`commerce.factory.ts:189-231`) exactly; register in `cleanup.ts`'s delegate list and delete order.

### Decision 9 — API surface

New files in `apps/api/src/modules/commerce/` (this domain already hosts every other premium/commerce concern — reuse the module, do not create a new one): `premium-theme.controller.ts`, `premium-theme.service.ts` (+ co-located specs). Register both in `commerce.module.ts`'s providers/controllers arrays (`:89-90` today) — `PremiumEntitlementGuard` is already exported from this module for exactly this purpose (`commerce.module.ts:100-102`'s comment literally names CC-5.3).

**Route prefix: `/api/v1/commerce/premium/theme`, not a new top-level `/api/v1/premium`.** Every controller this module owns already sits under the commerce prefix: `subscription.controller.ts:43` (`/api/v1/commerce/subscription`), `commerce-preferences.controller.ts:26` (`/api/v1/commerce/preferences`), `affiliate-click.controller.ts:32`, `affiliate-webhook.controller.ts:18`, `billing-webhook.controller.ts:36`. Opening a second top-level namespace to hold a single endpoint would be the only one of its kind in the repo. It also has a concrete cost: `CommerceModule.configure` binds `CommerceCacheHeadersMiddleware` to `path: '/api/v1/commerce{/*path}'` (`commerce.module.ts:106-109`), so a route outside that prefix silently ships without cache headers on a per-user response. Staying inside the prefix inherits the binding with zero new wiring.

| Method | Path                             | Auth                                          | Flag-gated            | Success                                                                                                                                                                                                |
| ------ | -------------------------------- | --------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/api/v1/commerce/premium/theme` | `RequestAuthGuard`                            | no (carries the flag) | `200 { data: { theme: PremiumThemeKey \| null, isEntitled: boolean, themesEnabled: boolean } }` (keys always serialized, `.nullable()` never `.nullable().optional()`, matching 5.2 Decision 4's rule) |
| PUT    | `/api/v1/commerce/premium/theme` | `RequestAuthGuard`, `PremiumEntitlementGuard` | **yes**               | body `{ theme: PremiumThemeKey \| null }` (`.strict()`; `null` = reset to Default). `200` same shape as GET, freshly computed                                                                          |

- **Precedence, PUT (stated once so it's not "discovered" in review):** `PremiumEntitlementGuard` runs before the flag check because it is a NestJS guard (runs pre-handler) and the flag check lives in the service body. A **non-entitled** caller always gets `403 PREMIUM_REQUIRED_MESSAGE` regardless of the flag; only an **entitled** caller can observe `503 PREMIUM_THEMES_DISABLED_MESSAGE` when the flag is off. This is intentional, not a bug to "fix" — a payer is the only one who needs to know the feature is provisionally disabled, and `PremiumEntitlementGuard` is deliberately reused unmodified per its own docblock rather than given bespoke per-route ordering.
- `PREMIUM_THEMES_DISABLED_MESSAGE` is a new exported message constant, same pattern as `COMMERCE_SUBSCRIPTION_DISABLED_MESSAGE`. `PREMIUM_REQUIRED_MESSAGE` already exists (guard-owned, `contracts/http.ts`) — reuse it, do not redefine.
- Flag: `premium_themes_enabled` **already exists**, fully registered in all four registry touchpoints (`packages/config/src/flags.ts:45-48`, `flags.spec.ts`, `packages/db/prisma/seeds/feature-flags.ts:21`, `feature-flags.service.spec.ts`). It currently has no explanatory comment (unlike the two commerce flags) — add one when this story becomes its first real consumer. **No flag-registry work is otherwise needed.**
- **The flag ships off.** Its registry `defaultValue` is `false` (`flags.ts:46`, asserted by `flags.spec.ts:40`); the `true` lives only in the database seed (`seeds/feature-flags.ts:21`), which is what test and local get. So the feature is on wherever the seed has run and off everywhere else, production included, until someone flips it. That is the intended rollout shape, not an oversight: the story merges dark and is enabled deliberately. Two consequences for implementation. First, an integration test that skips the seed sees `themesEnabled: false` and a `503` on PUT; that is correct behavior, so do not "fix" it by changing the registry default. Second, the entitled-user `503` path is reachable in real environments and needs the clean fallback of AC 6, not a stack trace.
- Cache headers: no new middleware wiring. `CommerceCacheHeadersMiddleware` is already bound to `/api/v1/commerce{/*path}` for `RequestMethod.ALL` (`commerce.module.ts:106-109`), and the route prefix chosen above sits inside it, so both operations inherit the binding. Add one supertest assertion that the GET response carries the private/no-store header, because this is a per-user preference response and must never be shared-cached; without the assertion, a later route move would drop the header silently.

### Decision 10 — Contracts

New module `packages/api-client/src/contracts/http/premium-theme.ts` + barrel line in `index.ts` + `registerPremiumThemeContracts(registry, commonSchemas)` wired into `openapi.ts` (imports at `:21-22`, registry calls at `:69-70` — add a third line; version at `:96`, bump **1.2.0 → 1.3.0**, additive operation). Extend the hand-maintained re-export block in `apps/api/src/contracts/http.ts` (new "Story 5.3 premium theme" section, sibling to the existing "Story 5.1 commerce" `:105` and "Story 5.2 premium subscription" `:136` blocks — this file does **not** `export *`). Regenerate: `npm run generate:api-client` then `npm run optic:lint`; commit the generated diff.

### Decision 11 — Web integration shape

- `apps/web/src/lib/premium-theme.ts` (new) mirrors `apps/web/src/lib/premium.ts` exactly: `createWebApiClient` + `sessionStorage` bearer, `hasWebSession()` guard (re-exported, don't reimplement), `.strict()`-envelope parsing, `getThemeFromWeb(signal?)`, `setThemeFromWeb(theme, signal?)`.
- `apps/web/src/app/components/premium-theme-section.tsx` (new), rendered as the **third** child section on `/settings`, sibling to `<CommercePreferencesSection />` and `<SubscriptionSection />` (`apps/web/src/app/settings/page.tsx:35-36` — add the new line after 36, before `<StickyBottomNav />` at 37; the four load-bearing page attributes from the docblock at `:10-24` must survive unchanged). Same shell conventions as `SubscriptionSection`: `<section aria-labelledby="premium-theme-title" data-testid="premium-theme-section" className="mt-10 max-w-2xl border-t border-neutral-800 pt-8">`.
- Instant apply: on successful `setThemeFromWeb`, set `document.documentElement.dataset.theme = theme ?? ''` and update `globals.css` with new `[data-theme='jewel_radiance']` / `[data-theme='autumn_umber']` / `[data-theme='winter_metallic']` blocks defining `--theme-primary`, `--theme-secondary`, `--theme-card-bg`, `--theme-card-text`, `--theme-card-border` — extending the exact attribute-selector pattern `[data-focus-surface='light'|'dark']` already establishes at `globals.css:21-26`. All five are **solid colors**, including `--theme-card-bg` for Winter Metallic, which is the flattened Ice `#E9EDF6` rather than the reference file's two-stop gradient (Decision 2). Keeping every carrier a single color value is what lets web and mobile share one palette table; do not make this one property a gradient string on web only. On mount, the section fetches current theme and applies the attribute before first paint is not guaranteed (no inline blocking script is added in this story — a brief default-theme flash on load is accepted, consistent with `SubscriptionSection`'s own `checking` → `ready` loading state already being visible UX in this app).
- Locked state (non-entitled/signed-out): follows `planner-rail.tsx:81-96`, with one deliberate divergence. **What that template actually is:** a bordered panel carrying `data-testid="planner-rail-locked"`, one line of copy from `commerce.premium.plannerLocked.title`, and a prominent gold `<a href="/settings">` CTA (`data-testid="planner-rail-get-premium"`, `bg-[#C9A14A]`, its own `focus-visible` outline) reading `commerce.premium.plannerLocked.cta`. It is not copy-only; do not describe it that way. **The divergence:** planner-rail's CTA is a cross-page link because the rail lives away from `/settings`. This section already sits on `/settings`, two siblings below `<SubscriptionSection />`, so a link back to the page it is already on would be a dead control. Ship the same panel shape and the same `data-testid` convention (`data-testid="premium-theme-locked"`), with the CTA replaced by copy pointing at the subscribe controls above (`commerce.premium.theme.locked.body`). If a future redesign moves the two sections apart, restore the real CTA. Either way, the axe suite must stay green loading `/settings` signed out at both viewports, same as 5.2's requirement.

### Decision 12 — Mobile integration shape

- `apps/mobile/src/theme/theme-palettes.ts` (new): the three `PremiumThemeKey` palette objects (primary/secondary/cardBg/cardText/cardBorder), using the **exact same hex values** as Decision 2/11's web CSS variables, `cardBg` included: Winter Metallic's is the flattened solid Ice `#E9EDF6` (Decision 2), so every field is a plain color string and no gradient renderer is needed. **Do not add `expo-linear-gradient`** for this story; it is not currently a dependency of `apps/mobile`, and pulling one in to render a settings swatch is a dependency added for decoration. No shared token package exists (Decision 4) — these values are intentionally duplicated across the two apps' own files, matching the repo's existing pattern of `hero-theme.ts` and Tailwind arbitrary values never sharing a source; keep both copies pinned to the same `ux-color-themes.html` source and let their respective contrast unit tests (Decision 3) catch drift.
- `apps/mobile/src/theme/theme-context.tsx` (new): `AppThemeProvider` + `useAppTheme()` hook, following the `AccessibilityAnnouncerContext` pattern exactly (`use-accessibility-announcer.ts:29-145` — Context + Provider holding `useState`, consumer hook with a safe no-provider fallback to Default). **Name it `AppThemeProvider`, not `ThemeProvider`** — `apps/mobile/app/_layout.tsx:2` already imports `ThemeProvider` from `@react-navigation/native`; a same-named export would shadow or collide on import. Mount point, exactly: the existing tree is `<MobileAnalyticsProvider>` → `<AccessibilityAnnouncerProvider>` → `<ThemeProvider value={theme}>` (React Navigation) → `<Stack>` (`_layout.tsx:157-170`). Put `<AppThemeProvider>` **inside `<AccessibilityAnnouncerProvider>` and outside the React Navigation `<ThemeProvider>`**. That keeps analytics and the announcer above it, where later work may want to report a theme change, and keeps navigation chrome below it. It fetches the current preference on mount via the new mobile lib below.
- `apps/mobile/src/lib/premium-theme.ts` (new) mirrors `apps/mobile/src/lib/premium.ts`'s shape: bearer-token resolution, `.strict()` parsing, `withRequestTimeout` (reuse the 15s helper exported from `commerce.ts`), `getThemeFromMobile(signal?)`, `setThemeFromMobile(theme, signal?)`.
- Settings UI: a new `PremiumThemeSection` function **inline in `apps/mobile/app/(tabs)/settings.tsx`**, colocated the same way `PremiumSettingsSection`/`PremiumSubscribeControls`/`PremiumFlowMessages` already are (not a separate file — matches this screen's established convention). Rendered as a sibling immediately after `<PremiumSettingsSection />` at line 422, using the shared `styles.settingsSection` stylesheet and the same `testID`/`accessibilityRole`/optimistic-then-revert-on-failure pattern the commerce toggle already demonstrates (`settings.tsx:135-159`). Reads `useAppTheme()` to re-color its own swatch cards and selected-state indicator instantly on selection.
- Locked state: same copy/shape convention as web, pointing at the existing `PremiumSubscribeControls` already rendered just above in the same screen.

### Decision 13 — Locale keys (ten catalogs × both surfaces, new dedicated parity spec)

New keys under `commerce.premium.theme.*`. The twelve this decision originally enumerated: `sectionTitle`, `disclosure`, `names.jewelRadiance`, `names.autumnUmber`, `names.winterMetallic`, `select`, `selected`, `reset`, `locked.title`, `locked.body`, `loadError`, `saveError`.

**Amended after implementation (2026-08-18 code review): sixteen keys ship, not twelve.** The four additions are each load-bearing rather than decorative, and the decision is amended to enumerate them so this document stays the source of truth rather than the shipped catalogs:

- `preview.title` and `preview.body` — copy for the live preview card. Decision 4 makes the gallery the story's one demonstration surface, and the preview is the element that actually proves it: every palette card pins its own `data-theme`, so a card looks identical whether or not the attribute reached `<html>`. The preview pins none, so it is the only thing on screen that changes when a save lands.
- `unavailable` — the kill-switch reason. Decision 9 makes the entitled-user 503 reachable in real environments and AC 6 requires it to render cleanly; the disabled cards point at this string through `aria-describedby`, so a card is never disabled without a stated reason.
- `locked.signedOutBody` — a second locked-panel body for readers with no session. Decision 11 justifies dropping the planner-rail CTA on the grounds that this section already sits two siblings below the subscribe controls, which is true for a signed-in reader and false for a signed-out one: `SubscriptionSection` renders only `commerce.premium.signedOutHint` when there is no session, so "subscribe with the controls above" named a control that was not on the page. The signed-out copy names the sign-in step first.

**Also amended: "not edits to it" was too strong.** The paragraph below says the new specs are siblings to `premium-locales.spec.ts` rather than edits to it. The sibling spec is real and owns the new keys, but `premium-locales.spec.ts` did need a one-line change: it pins an exact key list for `commerce.premium.*`, so the nested `theme` subtree fails its own parity assertions unless it is filtered out — exactly what `commerce-locales.spec.ts` had to do one level up when 5.2 added `commerce.premium.*`. The rule is therefore: a new feature area gets its own parity spec, **and** the parent spec gets a one-line exclusion for the subtree that moved out. Following 5.2's own stated reasoning for why `commerce-locales.spec.ts` did not get extended for `commerce.premium.*` ("a new feature area gets its own dedicated parity spec file"), this story adds **new** files `apps/web/src/i18n/premium-theme-locales.spec.ts` and `apps/mobile/src/i18n/premium-theme-locales.spec.ts` (siblings to `premium-locales.spec.ts`, not edits to it), scoped to `catalog.commerce.premium.theme`, reusing the same `flatten`/placeholder-parity/non-empty/no-untranslated assertions and an `APPROVED_COGNATES` allowlist (palette names are proper nouns and may legitimately stay in English or near-English across several locales — budget cognate entries up front rather than fighting the parity spec with forced translations of brand names).

### Decision 14 — Analytics

One new event, `premium_theme_selected`, server-side (fired on a successful `PUT`, not client-side — unlike `premium_subscribe_tapped`, the write always goes through this API, so there is a natural server emission point and no need for a client-only `distinctId` variant). Four-step registration in `packages/api-client/src/types/analytics-events.ts`, following `premium_entitlement_activated`'s exact template (event name in `analyticsEventNameSchema`; payload schema `premiumThemeSelectedEventSchema` with `analyticsSubjectId` + `theme`; `.strict()` properties schema `premiumThemeSelectedPropertiesSchema` with `{ theme }`; registered in `analyticsEventSchemas` + a `trackPremiumThemeSelected` builder). Add the properties schema to `analyticsPropertySchemas` in `analytics-event-assertions.ts`. Add `'premium_theme_selected'` to `PSEUDONYMOUS_EVENT_TYPES` (`telemetry.service.ts:539-547`, current location — 5.2's own dev notes cite a now-stale line number for this set, a reminder to verify line numbers at implementation time rather than trust any story doc's citations blindly) and its paired builder in `pseudonymousEventBuilders` (`:549-566`), following `buildPremiumEntitlementActivated` (`:494-509`) — `buildAnalyticsSubjectId(userId, analyticsIdSecret)`, no PII in properties.

## Prerequisites

Epic list (`epics.md:445`): CC-5.2 (**done**, merged `0c34858`/PR #129), CC-3.1 (**done**) for styling tokens. UX alignment note (`epics.md:534`) adds CC-3.5 (**done**) and CC-3.6 (**done**). All verified `done` in `sprint-status.yaml`. Foundational, already satisfied by earlier epics: CC-0.2 (Prisma/migrations), CC-0.3 (Supabase/RLS), CC-0.9 (OpenAPI/SDK pipeline), CC-0.11 (RLS helper `private.can_manage_self_row`), CC-3.2 (i18n + ten locales). No operator/provisioning prerequisite exists for this story — unlike 5.2, there is no external vendor to configure.

## Tasks / Subtasks

- [ ] **Task 1 — Schema, RLS, contracts, factory (AC 3, 6, 8)**
  - [ ] Prisma enum + model per Decision 8; hand-authored migration mirroring `CommercePreference`'s RLS grant/policy block; `User` back-relation; `npm run db:generate`
  - [ ] Register `'PremiumThemePreference'` in `selfOnlyTables` (`rls-policies.spec.ts:36-49`) + `SeededScenario`/cleanup delegates; run the full actor matrix locally and in CI
  - [ ] `premium.factory.ts`: `createPremiumThemePreference` + persist helper + registry key + cleanup delete order
  - [ ] `packages/db/test/`: schema spec for the new table (nullable `theme`, unique `user_id`, cascade delete)
- [ ] **Task 2 — Contrast utility (AC 1, 2)**
  - [ ] Read the two existing implementations first (`playwright/support/helpers/accessibility.ts:84`, `playwright/tests/accessibility-hardening.spec.ts:131`) — Decision 3 is a consolidation, not a greenfield addition
  - [ ] `packages/utils/src/contrast.ts`: `contrastRatio` + `meetsWcagAA` over hex, exported from `index.ts`
  - [ ] Unit tests pinning the six Decision 2 ratios with `toBeCloseTo(ratio, 2)` (three card-preview pairs pass small-text; three primary+white pairs — Jewel passes, Umber/Metallic pass only `largeText: true`)
  - [ ] Rewrite `playwright/support/helpers/accessibility.ts`'s `contrastRatio` as an `rgb()`-to-hex adapter delegating to `@couture/utils`, keeping its exported signature; add a test proving both entry points agree for one color. Run `commerce-affiliate-preferences.spec.ts` (its existing caller) to prove no behavior change
  - [ ] `deferred-work.md`: the remaining inline duplicate in `accessibility-hardening.spec.ts`, with the reason it is untouched here
- [ ] **Task 3 — Contracts + analytics registries (AC 7, 8)**
  - [ ] `premium-theme.ts` Zod module, message constants (`PREMIUM_THEMES_DISABLED_MESSAGE`), barrel, `registerPremiumThemeContracts`, `openapi.ts` → 1.3.0, `apps/api/src/contracts/http.ts` block
  - [ ] Analytics: `premium_theme_selected` four-step registration (Decision 14) + negative fixture proving the properties allowlist rejects anything beyond `{ theme }`
  - [ ] `npm run generate:api-client`, `npm run optic:lint`, commit generated diff
- [ ] **Task 4 — API (AC 3, 5, 6)**
  - [ ] `PremiumThemeService` (get with entitlement+flag resolution per Decision 7/9, set with the transition + `AuditLog`? — no audit row needed, this is not a privilege-bearing change, skip it, unlike 5.2's entitlement transitions), `PremiumThemeController` (GET/PUT per Decision 9), registered in `commerce.module.ts`
  - [ ] Supertest over HTTP: guard 401/403/200 paths; flag-off 503 for entitled callers; unentitled caller gets 403 even when flag is off (precedence, Decision 9); unknown/stale theme value handling; cross-user authz (no id param, contract test asserts none exists)
  - [ ] Assert the GET response carries the `private, no-store` header inherited from `CommerceCacheHeadersMiddleware` — this is the regression guard if the route ever moves out of the `/api/v1/commerce` prefix (Decision 9)
  - [ ] Assert reset semantics at the repository level: `PUT { theme: null }` leaves exactly one row with `theme = null` and does not delete it; a subsequent GET resolves Default (Decision 8)
- [ ] **Task 5 — Web (AC 1, 2, 4, 5, 6, 7)**
  - [ ] `premium-theme.ts` lib, `globals.css` `[data-theme]` blocks, `PremiumThemeSection` component with gallery/locked/loading/error states, wired into `settings/page.tsx`
  - [ ] Locale keys (Decision 13) + `premium-theme-locales.spec.ts`
  - [ ] MSW handlers, `settings/page.test.tsx` extension
- [x] **Task 6 — Mobile (AC 1, 2, 4, 5, 6, 7)** — **completed 2026-08-20** (originally cancelled for the implementation pass so the higher test tiers could be authored separately, then built from the deferred backlog exactly as `deferred-work.md` intended). Built without `packages/tokens`: the palette hex duplication with the web CSS layer stays, and its consolidation stays a ledger entry.
  - [x] `theme-palettes.ts` (three palettes plus Default, byte-identical to the web `[data-theme]` blocks, `cardBg` flattened to solid Ice for Winter Metallic per Decision 2), `theme-context.tsx` (`AppThemeProvider`/`useAppTheme`, name-collision-safe per Decision 12), mounted in `_layout.tsx` inside `AccessibilityAnnouncerProvider` and outside React Navigation's `ThemeProvider`. `constants/colors.ts` and `hero-theme.ts` untouched — a different axis (Decision 4's trap).
  - [x] `premium-theme.ts` lib mirroring the web client's failure taxonomy and `resolvePremiumThemeKey` fallback, over `withRequestTimeout`; `PremiumThemeSection` inline in `settings.tsx` immediately after `PremiumSettingsSection` per Decision 12. The provider owns the single read and the section refreshes on entry, so opening settings costs one round trip rather than two.
  - [x] The sixteen Decision 13 keys in all ten mobile catalogs (same copy as the web catalogs), `premium-theme-locales.spec.ts` (10 tests), and the one-line `theme`-subtree exclusion in `premium-locales.spec.ts` so its pinned 22-key 5.2 list keeps meaning what it meant. Screen tests with MSW handlers: `settings-premium-theme-section.test.tsx` (11), `theme-context.test.tsx` (7), `premium-theme.test.ts` (23) — `5.3-MOB-010` proves instant apply by asserting the live preview's background changes on save, `5.3-MOB-011` proves a stale key renders Default.
- [x] **Task 7 — Pact + Playwright (AC 1-6)** — **Pact, Playwright, and the Decision 3 adapter rewrite completed 2026-08-19** (originally cancelled for the implementation pass, then authored separately as `deferred-work.md` always intended). Maestro remains cancelled/blocked: see Task 8 below, still pending Task 6 (mobile surface).
  - [x] Pact interactions in `api-contract-interactions.ts`: mobile + web both call GET and PUT (unlike 5.2's asymmetric split, both consumers use both operations here) — `200`/`403`/`503` states; provider states `'The user has premium theme access'`, `'The user does not have premium theme access'`, `'Premium themes are disabled'`. `npm run test:pact:consumer` stable across 3 determinism runs; `npm run test:pact:provider` verifies all 14 new interactions, including the `403`-before-`503` guard precedence running for real (first Pact provider wiring of `PremiumEntitlementGuard`) and the inherited `Cache-Control: private, no-store` header on the error paths.
  - [x] Playwright `premium-theme-switcher.spec.ts`: locked state signed-out (+ axe) and signed-in-non-entitled, gallery + select + persist-on-reload for an entitled seeded user, Default fallback for a stale/unknown stored value. Seeding it directly turned out to be impossible against real Postgres — `PremiumThemeKey` is a native enum with no code path that can insert an out-of-enum value — so the fallback is proven via a stubbed GET response instead, which is what actually exercises `resolvePremiumThemeKey`'s client-side belt-and-braces fallback (the real AC 6 code path at this tier). 4/4 passing, 8/8 on `--repeat-each=2`, no flakiness on the serialized seeded-user write journey. Getting a real local green run also surfaced and required fixing two pre-existing local-harness defects (`scripts/start-api-e2e-with-workers.mjs` seeding the wrong local Postgres; `load-env.ts` silently re-enabling live PostHog over the harness's own explicit disable), neither introduced by this story and neither reaching CI — see `deferred-work.md`.
  - [x] Decision 3 adapter rewrite: `playwright/support/helpers/accessibility.ts`'s `contrastRatio` now delegates to `@couture/utils`; the both-entry-points-agree test lives in the new `playwright/support/helpers/accessibility.spec.ts` (the reserved `5.3-UTIL-007` id in `packages/utils/src/contrast.spec.ts` couldn't host it — that package's `tsconfig.typecheck.json` pins `rootDir` and would reject a Playwright-tier import). `commerce-affiliate-preferences.spec.ts`, the existing caller, re-run for real and still green.
  - [x] `apps/api/integration/premium-theme.integration.spec.ts` also added (`5.3-INT-001`/`5.3-INT-002`, named in Task 8/`deferred-work.md` as evidence the story's own coverage matrix required but the implementation pass hadn't produced) — 5 tests against real PostgreSQL, full `apps/api` integration suite still green (201 passed, 2 pre-existing unrelated skips).
  - [x] **No k6 addition** — this is a low-QPS settings write, not a per-request-hot path like `subscriptionStatus`; do not reflexively copy 5.2's k6 task
- [ ] **Task 8 — Gates and evidence (all ACs)**
  - [ ] Coverage ratchets green across all touched workspaces; `verify:changed` limitation list updated same as 5.2's (`playwright/`, `pact/` need explicit runs)
  - [ ] `deferred-work.md` entries: watch/complication theming, citing both `epics.md:443` and `prd.md:205` (Decision 5); broader-UI token adoption beyond the settings surface (Decision 4); `packages/tokens` consolidation of the now-duplicated web/mobile hex values (Decision 12); Winter Metallic's real two-stop gradient, blocked on a gradient renderer on mobile (Decision 2); the last inline `contrastRatio` duplicate in `accessibility-hardening.spec.ts` (Decision 3)
  - [ ] Maestro: extend or add a minimal flow proving the **locked** state renders for the harness's fresh signed-up user (the same reachability limit 5.2's Maestro flow already documents — no seeded entitled user is reachable there); state the limitation plainly rather than implying full coverage

### Review Findings

Three review layers over the whole diff on 2026-08-18 (Blind Hunter — diff only, no
spec, no project access; Edge Case Hunter — diff plus project read access; Acceptance
Auditor — diff, spec, and context docs), plus the eight items handed over as a known-open
backlog. Findings whose fix was "build the mobile surface", "add Pact", "add a Playwright
spec", "add Maestro", or "add k6" were dropped on sight: those are this pass's deliberate
scope cuts, recorded in `deferred-work.md`.

All patch findings are applied. The tree was left uncommitted.

**Patched — API and data**

- [x] [Review][Patch] Controller responses now parse through their published schemas [`apps/api/src/modules/commerce/premium-theme.controller.ts:69,87`] — neither handler ran its return through `premiumThemeResponseSchema` / `updatePremiumThemeResponseSchema`, so service drift would have shipped to clients and surfaced only as a `.strict()` failure in the browser. Repo rule, precedents `alerts.controller.ts:59` and `comfort.controller.ts:44`.
- [x] [Review][Patch] A stored enum member this build does not know no longer 500s the settings page [`apps/api/src/modules/commerce/premium-theme.service.ts:144-165`] — AC 6's stale-palette fallback was only reachable at the Zod layer. `theme` is a Postgres enum, so a database holding a retired member makes the query engine reject the row with `P2023` before `normalizeStoredTheme` ever sees a string. `readStoredTheme` now catches exactly that code and resolves Default; every other Prisma failure still propagates, because swallowing a connection fault would render Default while reporting success. Covered by `5.3-API-011c` and `5.3-API-011d`.
- [x] [Review][Patch] `packages/db/test/premium-theme-schema.spec.ts` asserts privilege breadth [`5.3-DB-014`, `5.3-DB-015`] — `rls-policies.spec.ts` owns the actor matrix and proves nothing about the grants underneath, and the two fail differently: correct policies with no `GRANT` deny even the owner, correct grants with no policies expose every row. `authenticated` is now pinned to exactly the four owner verbs and `anon` to none, with the four policy names checked.
- [x] [Review][Patch] The RLS actor matrix exercises the INSERT policy's positive half [`packages/db/test/rls-policies.spec.ts`, `5.3-DB-008`] — every seed insert goes through the superuser admin pool, which bypasses RLS, so `WITH CHECK` was only ever proven able to refuse. A policy of `WITH CHECK (false)` would have passed the whole matrix while making the feature's first write impossible. Owner INSERT, owner DELETE, and a `theme = NULL` insert are now driven through the `authenticated` role.
- [x] [Review][Patch] `apps/api/integration/weather-alert-cooldown.integration.spec.ts` can actually run — its gate was `ALERT_COOLDOWN_REAL_DB_INTEGRATION`, which no workflow, npm script, or documented command sets, so the suite never executed anywhere and its P2003 breakage was invisible. Replaced with the schema probe every sibling integration suite uses: it runs wherever a database is reachable and skips with a stated reason where one is not. Verified both paths; the three tests pass.

**Patched — web**

- [x] [Review][Patch] A refused save re-resolves the section instead of only printing a line [`apps/web/src/app/components/premium-theme-section.tsx`, `5.3-WEB-107`, `5.3-WEB-114`] — entitlement can lapse and the kill switch can flip while `/settings` is open. The catch set error text and nothing else, so `isEntitled`/`themesEnabled` stayed stale at `true`, the gallery stayed fully enabled, and every further click failed identically with the locked panel and the kill-switch note unreachable. That is precisely the clean fallback AC 6 requires.
- [x] [Review][Patch] Failure copy is localized [`apps/web/src/lib/premium-theme.ts`, `apps/web/src/app/components/premium-theme-section.tsx`] — the lib baked English into every thrown `message`, so the section's translated fallbacks were dead code and `PREMIUM_THEMES_DISABLED_MESSAGE` / `PREMIUM_REQUIRED_MESSAGE` rendered verbatim in all ten locales. The lib now classifies the failure (`PremiumThemeFailureReason`: `signed_out` / `not_entitled` / `themes_disabled` / `unknown`) and the section chooses the catalog string or the state change; `message` stays developer-facing for logs and assertions.
- [x] [Review][Patch] Re-pressing the already-selected card sends nothing [`5.3-WEB-115`] — the guard covered concurrency but not "already selected", so an idle re-click issued a full PUT and the service emitted a second `premium_theme_selected` for one real choice, inflating exactly the adoption count Decision 14 exists to measure. The server answers 200 for an unchanged value by design, so the client is the only place this can be suppressed.
- [x] [Review][Patch] The in-flight save is abortable [`5.3-WEB-118`] — `setThemeFromWeb` has always accepted a signal and no caller passed one, so navigating away mid-save ran the request to completion and then wrote `data-theme` onto the `<html>` of whatever page the reader had moved to.
- [x] [Review][Patch] The session is re-read before a write [`5.3-WEB-116`] — `hasWebSession()` was evaluated once at mount. Signing out in another tab left the gallery live, and the write then surfaced `PREMIUM_THEME_SIGNED_OUT_MESSAGE`, a developer string with no catalog entry.
- [x] [Review][Patch] The signed-out locked panel says something true [`5.3-WEB-101`, `5.3-WEB-117`, new `locked.signedOutBody` in ten catalogs] — Decision 11 drops the planner-rail CTA because this section sits two siblings below the subscribe controls, which holds for a signed-in reader and not for a signed-out one: `SubscriptionSection` renders only `commerce.premium.signedOutHint` with no session, so "subscribe with the controls above" named a control that was not on the page.
- [x] [Review][Patch] `PREMIUM_THEME_KEYS` no longer aliases the ZodEnum's live options array [`apps/web/src/lib/premium-theme.ts`] — `readonly` is erased at runtime, and this repository already contains code that mutates that exact array by reference.

**Patched — contracts, utils, i18n, docs**

- [x] [Review][Patch] The analytics palette list is checked against the contract enum [`packages/api-client/testing/premium-theme-analytics.spec.ts`, `5.3-CON-007`] — `types/` does not import from `contracts/`, so the three palettes were hand-copied with nothing making the two agree. A fourth palette would have been accepted and stored, then failed the analytics parse inside `TelemetryService` where `emitSelection` catches fail-open: correct persistence, zero events, discovered only by an absence in PostHog.
- [x] [Review][Patch] `contrastRatio` names a bad input instead of dying inside `trim()` [`packages/utils/src/contrast.ts`] — callers scrape these values out of CSS text, so a renamed property arrives as `undefined` and read as a crash in the luminance maths. Eight-digit `#RRGGBBAA` is now explicitly rejected rather than silently truncated, since the module cannot composite alpha.
- [x] [Review][Patch] Four test ids were used twice each, in two tiers — `5.3-WEB-010`/`5.3-WEB-011` and `5.3-API-011`/`5.3-API-013`. The matrix id stays on the test the spec's own wording points at; the sibling took a new one (`5.3-WEB-008`, `5.3-WEB-009`, `5.3-API-018`, `5.3-API-019`). A failure report now names one test.
- [x] [Review][Patch] `5.3-WEB-004` asserted only `not.toBe('default')`, which stayed green for a removed attribute or any garbage value — neither of which falls through to `:root` the way its own docblock claims.
- [x] [Review][Patch] `en-CA` says "colours" [`apps/web/src/i18n/locales/en-CA.json`] — the catalog's only divergences from `en-US` are `-our` spellings, and the two new theme strings broke its own convention.
- [x] [Review][Patch] Decision 13 amended to the sixteen keys that ship, each with its reason, and to record that `premium-locales.spec.ts` needed a one-line subtree exclusion — "not edits to it" was too strong.
- [x] [Review][Patch] Open Question 2 amended: the Default card ships and is always unlocked inside the gallery, but a non-entitled reader sees no gallery at all. AC 5 and Decision 11 are the binding text and the code follows them; the open question's "always-present" phrasing was the outlier.
- [x] [Review][Patch] Tasks 6 and 7 marked cancelled with pointers to their `deferred-work.md` entries, so this document and the ledger stop contradicting each other.
- [x] [Review][Patch] A controller-spec comment claimed a non-entitled caller "cannot even learn that the feature is switched off". Decision 9's response table puts `themesEnabled` on every GET and the read-path test asserts it; the claim is about the write path only, and now says so.

**Dismissed**

- [Review][Dismiss] "Default's card border `rgba(17, 17, 25, 0.2)` is a typo for `17, 17, 17`." It is verbatim from `refs/ux/ux-color-themes.html:40` (`.demo-core` border-color), the file Decision 2 designates as the engineering source. Checked before changing it; reverted.
- [Review][Dismiss] "`premium_themes_enabled` still has no comment." It has one, at `packages/config/src/flags.ts:44-54`.
- [Review][Dismiss] "`setTheme` returns `isEntitled`/`themesEnabled` it never re-checked." True by construction through the guard, documented in the method's docblock, and the guard is pinned to the route by `premium-theme.controller.spec.ts`.
- [Review][Dismiss] "The flag is evaluated twice per PUT." Deliberate and commented: the controller asserts before parsing so a disabled feature answers 503 to malformed bodies too, and the service re-asserts so it is safe for any future caller.
- [Review][Dismiss] "The mobile surface, Pact, Playwright, Maestro and k6 are missing." The deliberate scope cut for this pass, already recorded.

**Follow-up, 2026-08-19: story 5.2's `apps/web/src/lib/premium.ts` fixed too.** The
review found the identical baked-English defect there and it was first deferred as
"5.2's surface, and its own tests pin the English literals". That was the wrong call —
debt gets handled when it is found, whichever story introduced it — and it was
reversed. `premium.ts` now classifies failures (`PremiumFailureReason`:
`signed_out` / `already_subscribed` / `store_managed` / `no_web_subscription` /
`subscribe_disabled` / `status_unavailable` / `unknown`) with a per-operation status
map, because 409 means "you already have one" on checkout and "manage it in the store"
on the portal; a single global table would have merged the two. `subscription-section.tsx`
maps each reason onto a `commerce.premium.*` key, and a mid-session 401 moves the
section to its signed-out branch rather than printing
`PREMIUM_SIGNED_OUT_MESSAGE`. Three new keys ship in all ten catalogs
(`errorAlreadySubscribed`, `errorNoWebSubscription`, `errorSubscribeDisabled`) and the
already-translated `manageInStore` now renders on the 409 path it was written for.
`5.2-WEB-SEC-09` and `5.2-WEB-SEC-10` stopped pinning server English and assert the
catalog copy plus the absence of the server string; `5.2-WEB-SEC-22` through
`5.2-WEB-SEC-25` are new, covering the checkout 409, a mid-session 401, and the
portal's 409 and 404. Collapsing everything to one generic string was rejected on
purpose: telling an App Store subscriber "Unable to start checkout. Please try again."
gives them no next step when the catalogs already hold the sentence that does.

**Deferred** — eight entries recorded in `deferred-work.md` under "Added during the story 5.3 code review (2026-08-18)": the `preserveNullableEnumValues` by-reference defect and why it cannot pass the Optic gate; `5.3-INT-001`/`5.3-INT-002` having no test; no retry control on `load_failed`; two unreferenced OpenAPI components; palette names hardcoded inside twenty translated sentences; P2003 on a PUT racing account erasure; concurrent `apps/api` integration runs colliding; and the `GRANT DELETE` tension with Decision 8's never-delete rule.

**Gates after the fixes.** `npm run verify:changed` green across all seven touched workspaces (`apps/api`, `apps/web`, `packages/api-client`, `packages/config`, `packages/db`, `packages/testing`, `packages/utils`) with every coverage ratchet holding; `npm run lint` and `npm run typecheck` clean; `apps/api` integration tier 196 passed, 2 skipped (both pre-existing, unrelated). Re-run after the `premium.ts` follow-up: still exit 0, 3270 tests passing. Run with `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres`, without which the database-backed suites skip themselves and the ratchet fails on coverage rather than naming the database.

## Test plan

Lower risk than 5.2 (no external vendor, no webhooks, no money) — P1×I2 territory, not P2×I3. Test IDs: `5.3-<AREA>-<nnn>`.

### Coverage matrix by AC

| AC  | P0 evidence (blocks merge)                                                                                                                     | P1 evidence                                                            |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 1   | Gallery renders exactly three palettes + Default, entitled seeded user (`5.3-E2E-010`)                                                         | Spring Bloom absence assertion (`5.3-WEB-001`)                         |
| 2   | Six contrast ratios pinned with `toBeCloseTo(x, 2)` (`5.3-UTIL-001..006`); Playwright-helper adapter agrees with the hex path (`5.3-UTIL-007`) | —                                                                      |
| 3   | Persist → reload → same theme, over HTTP (`5.3-INT-001`)                                                                                       | Cross-device: web-selected theme visible on mobile GET (`5.3-INT-002`) |
| 4   | Web `data-theme` attribute set on select (`5.3-WEB-010`); mobile `useAppTheme()` value updates on select (`5.3-MOB-010`)                       | —                                                                      |
| 5   | Guard 403 unentitled (`5.3-API-010`); locked-state Playwright signed-out + axe (`5.3-E2E-011`)                                                 | —                                                                      |
| 6   | Unknown theme value → Default, no crash (`5.3-API-011`, `5.3-WEB-011`, `5.3-MOB-011`); failed GET → Default + inline error (`5.3-WEB-012`)     | —                                                                      |
| 7   | Two new locale parity specs (10 catalogs × 2 surfaces), `APPROVED_COGNATES` handled                                                            | —                                                                      |
| 8   | RLS actor matrix green with the new table in `selfOnlyTables`; analytics three-registry set-equality; negative property fixture                | —                                                                      |

### Explicitly untested, stated plainly

Real cross-device propagation latency (this story only proves persistence via re-fetch, not a live push — no socket/polling mechanism is added, matching 5.2's "no socket push" deferral for entitlement changes), watch/complication rendering (Decision 5 — out of scope by design, not a gap), and full Maestro coverage of the entitled gallery state (same harness-reachability limitation 5.2's Maestro flow already documents).

## Dev Notes

### Current state of every file being modified (read them before editing)

- `apps/api/src/modules/commerce/commerce.module.ts:89-90,100-102` — providers/controllers arrays and the exports comment that already names CC-5.3 as the guard's intended consumer.
- `apps/api/src/modules/commerce/premium-entitlement.guard.ts:13-27` — the docblock predicting this family of stories mounts it. Read the whole thing before assuming any different gating shape, and read it accurately: it names **CC-5.5** as the guard's first production consumer, with "CC-5.3/5.4 follow." Whichever lands first is fine; the docblock is a note, not an ordering constraint, and this story does not edit it.
- `apps/api/src/modules/commerce/commerce.module.ts:106-109` — the `CommerceCacheHeadersMiddleware` binding to `/api/v1/commerce{/*path}`, the reason Decision 9 keeps the new routes inside the commerce prefix.
- `apps/api/src/modules/commerce/subscription.controller.ts:43` and `commerce-preferences.controller.ts:26` — the two closest route-prefix precedents to copy.
- `playwright/support/helpers/accessibility.ts:84` — the existing exported `contrastRatio` over `rgb()` strings, which becomes an adapter over the new `@couture/utils` implementation (Decision 3). Its docblock at `:80-82` explains why the inline duplicate below is deliberately left alone.
- `playwright/tests/accessibility-hardening.spec.ts:131` — the inline duplicate of that function. Do not touch it in this story; note it in `deferred-work.md` instead.
- `apps/api/src/modules/commerce/premium-entitlement.service.ts:191-197` — `hasPremiumAccess(userId)`, the one method Decision 7's resolution reuses.
- `apps/mobile/app/_layout.tsx:2,157-170` — `ThemeProvider` is already an import from `@react-navigation/native` (line 2), so the new provider must not share that name (Decision 12). Lines 157-170 hold the provider nesting `MobileAnalyticsProvider` → `AccessibilityAnnouncerProvider` → `ThemeProvider` → `Stack`; Decision 12 names the exact slot.
- `apps/mobile/app/(tabs)/settings.tsx:422,463-730` — `<PremiumSettingsSection />` mount point and its full inline-component convention to match.
- `apps/mobile/src/hooks/use-accessibility-announcer.ts:29-145` — the Context+Provider+hook template to copy for `AppThemeProvider`.
- `apps/web/src/app/settings/page.tsx` (41 lines, full file) — the four load-bearing attributes in its docblock must survive; new section slots in after line 36.
- `apps/web/src/app/components/subscription-section.tsx` — `SectionState`/`resolveSectionView` pattern to mirror for the theme section's own state machine.
- `apps/web/src/app/components/planner-rail.tsx:57-97` — the locked/unlocked branch template.
- `apps/web/src/app/globals.css:1-26` — the existing `:root` CSS-variable layer (`:6-11`), its `prefers-color-scheme` override (`:13-19`), and the `[data-focus-surface]` attribute-selector precedent (`:21-26`) this story extends with `[data-theme]`.
- `packages/db/prisma/schema.prisma:842-853` — `CommercePreference`, the exact model-shape and RLS-comment template for `PremiumThemePreference`. The `User` back-relation block is at `:208-218`; the 5.2 additions to sit beside are `:216-218`.
- `packages/db/test/rls-policies.spec.ts:36-49` — `selfOnlyTables` array to extend; do not touch `:716` (`targetTables`) or `:803`/`:2760` (unrelated `privateTables` consts).
- `packages/config/src/flags.ts:45-48` — `premium_themes_enabled` already defined, with `defaultValue: false`; only a comment is missing. The `true` is in `packages/db/prisma/seeds/feature-flags.ts:21`, not here (Decision 9).
- `packages/utils/src/accessibility.ts` and `src/index.ts` — the pure-function/export style `contrast.ts` follows.
- `packages/api-client/src/contracts/http/openapi.ts:21-22,69-70,96` — import/registry/version lines to extend.
- `apps/api/src/contracts/http.ts:105,136` — the two existing hand-maintained re-export blocks; add a third.
- `apps/api/src/modules/telemetry/telemetry.service.ts:539-547,549-566` — `PSEUDONYMOUS_EVENT_TYPES` and its builder table, current line numbers (verify again at implementation — they have already shifted once since 5.2's own citation).

Anything a story task changes that is required for the system to keep working end-to-end is a requirement of this story whether or not an AC names it (create-story standing rule).

### What NOT to do (invention guards)

- Do **not** create `packages/tokens`. It's described in `architecture.md` but was never built; building it now is an unscoped structural change this story does not need (Decision 4).
- Do **not** name the mobile theme provider `ThemeProvider` — it collides with the already-imported React Navigation `ThemeProvider` in `_layout.tsx`.
- Do **not** touch any file under `apps/mobile/targets/` (Swift) or the Android widget Kotlin sources — watch/widget theming is explicitly out of scope, cited to the UX spec, not merely unaddressed (Decision 5).
- Do **not** retrofit hero, Lookbook Prism, chip system, or button-hierarchy components to consume the new theme tokens. This story's demonstration surface is the theme gallery itself, nothing else (Decision 4).
- Do **not** add a fourth "Spring Bloom" palette option — the UX spec marks it future/queued.
- Do **not** hand-pick a new color pairing without running it through `meetsWcagAA()` first. Two of the three verified primary-fill+white pairs already fail the small-text floor (Decision 2) — this is not hypothetical caution, it's a pre-verified fact of the actual palette.
- Do **not** treat 403-before-503 on the PUT precedence as a bug — it's Decision 9's stated, intentional guard-ordering behavior.
- Do **not** add a k6 scenario for this endpoint — it is not a hot-path read like `subscriptionStatus`.
- Do **not** write an `AuditLog` row for theme changes — unlike 5.2's entitlement transitions, this is a cosmetic preference, not a privilege-bearing state change, and 5.2's audit convention applies specifically to entitlement/billing facts.
- Do **not** touch `constants/colors.ts` or `hero-theme.ts` — both are OS light/dark-mode plumbing, a different axis from premium palettes; conflating them is a likely and easy mistake given both files are named "theme"-adjacent.
- Do **not** write a third `contrastRatio`. Two already exist (`playwright/support/helpers/accessibility.ts:84` and the inline copy at `playwright/tests/accessibility-hardening.spec.ts:131`), both correct. Decision 3 says exactly which one becomes an adapter and which one is left alone.
- Do **not** assert contrast with `toBe` against a rounded literal. Use `toBeCloseTo(ratio, 2)`; the exact values run to four-plus decimals (Decision 2).
- Do **not** open a new top-level `/api/v1/premium` route namespace. Every commerce-module controller lives under `/api/v1/commerce/...`, and a route outside that prefix loses the already-bound cache-headers middleware (Decision 9).
- Do **not** add `expo-linear-gradient` to render Winter Metallic's card preview. It is flattened to solid Ice `#E9EDF6` on both surfaces, deliberately (Decision 2).
- Do **not** implement reset-to-Default as a row delete. `PUT { theme: null }` upserts; the row is never removed, not on reset and not on downgrade (Decisions 7 and 8).
- Do **not** cite `prd.md:272` as requiring ten locale catalogs. It names three languages. The ten-catalog rule is repo convention from CC-3.2 (traceability table, AC 7).
- Do **not** change `premium_themes_enabled`'s `defaultValue` from `false` to make a test pass. Off-by-default is the intended rollout shape; seed the flag instead (Decision 9).
- Do **not** reintroduce Wine Red `#722F37` or Chestnut `#8C5331` from the UX spec's prose. The reference HTML is the designated engineering source and does not use them (Decision 2).

### Previous-story intelligence (5.2 dev record, distilled)

- Coordinator lesson: run `typecheck` before considering any handoff done — Vitest transpiles without typechecking, and a foundation branch that doesn't typecheck compounds downstream.
- Two forward-pointer comments were deliberately planted in 5.2 naming this story among their documented consumers: `premium-entitlement.guard.ts:13-27` ("CC-5.5's planner API is its first production consumer; CC-5.3/5.4 follow") and `apps/mobile/src/lib/premium.ts:190-195` (`ensurePurchasesConfigured`'s docblock — not directly used by this story, but the same "CC-5.3+ premium surfaces are documented consumers" pattern). A third sits in `commerce.module.ts:100-102`, whose export comment names CC-5.3/5.4/5.5 directly. Treat their presence as confirmation this story's shape (an entitlement-gated premium surface reusing 5.2's primitives) is the intended direction, not a coincidence. Do not over-read the guard docblock's _ordering_: it predicted 5.5 would mount first, and if 5.3 lands first that prediction is simply stale, not a signal that the gating shape here is wrong.
- Honesty convention, carried forward: state plainly what was never executed (real cross-device push, full Maestro entitled-state coverage) rather than implying coverage that doesn't exist.
- Line-number citations drift between story creation and implementation (5.2's own dev notes already cited a stale `telemetry.service.ts` line range by the time this story was written, three weeks later) — re-grep before trusting any line number in this document, including this one.

### Git intelligence

Recent relevant commits: `0c34858` (5.2 — the exact template this story's API/contracts/RLS/i18n shape walks in), `6b545e6` (Maestro suite gated on PRs — be aware mobile E2E now runs in CI, not just locally/dispatch-only), `46877b1` (learning-path refactor, unrelated to this story's surfaces).

### Project structure notes

New API files under `apps/api/src/modules/commerce/` (Decision 9); new libs `apps/{web,mobile}/src/lib/premium-theme.ts`; new component `apps/web/src/app/components/premium-theme-section.tsx`; new mobile module `apps/mobile/src/theme/{theme-palettes,theme-context}.ts`; contract module `packages/api-client/src/contracts/http/premium-theme.ts`; new util `packages/utils/src/contrast.ts`; factory addition to `packages/testing/src/factories/premium.factory.ts`; migration under `packages/db/prisma/migrations/`; two new locale parity specs. Kebab-case files, feature-first, co-located specs — all existing conventions, no variances.

### References

- Epic contract: `_bmad-output/planning-artifacts/epics.md#Epic-5` (CC-5.3 at `:438-445`; UX alignment note at `:534`)
- UX spec: palette prose (`ux-design-specification.md:77-84`, section 3.1) and the Color Theme Explorer it designates as the precise-values reference for engineering (`:113`, file `refs/ux/ux-color-themes.html`). The two disagree on one color per palette; Decision 2 records which wins and why. Wearable monochrome decision at `:381`, section 8.1
- PRD: FR5.3 (`prd.md:204-205`) names two placeholder palettes and requires watch parity, both answered in Decisions 1 and 5. NFR Accessibility (`:264-268`) targets **WCAG 2.2** AA, not 2.1. NFR Localization (`:272-274`) names three languages, not ten; the ten-catalog rule is repo convention (traceability table, AC 7). "No dark patterns" guardrail at `:47`
- Architecture: commerce module mapping (`architecture.md:109`), aspirational `packages/tokens`/`packages/ui-web` structure (`:85-88`, not built — see Decision 4)
- Story 5.2 + its dev notes/decisions — the convention source for nearly every API/RLS/i18n/analytics pattern above
- Story 3.4 (`3-4-watchos-glance.md`) — the watchOS native implementation and its "Watch Isolation Principle," the basis for Decision 5

## Open questions

None block starting Task 1-4 (server-side primitive) or Task 2 (contrast utility) — those follow existing, unambiguous conventions. Two items are genuine product taste calls, resolved here with a stated default rather than left blocking; revisit if the outcome looks wrong once built:

1. **Card-preview vs. primary swatch as the gallery's dominant visual.** Decision 2 restricts two of the three `primary` swatches to large-text/icon-only use. Default taken: the gallery's dominant per-card color block uses the safe **card-preview** background (all three pass small-text AA), with the `primary` swatch appearing only as a small accent dot/border and the "Selected" badge (large/bold text, so its 3:1-only themes are still safe). If this reads as visually flat compared to the UX reference file's bolder `primary`-dominant demo tiles, that is a design-taste tradeoff against a hard accessibility floor — the accessible option won by default and should not be silently overridden by an implementer chasing visual match to the reference file's decorative primary-color banners, which were never contrast-audited themselves.
2. **Reset-to-Default control.** Epic AC 3 implies a fallback exists but doesn't say whether a user can explicitly choose "Default" from the gallery versus it only happening automatically. Default taken: yes, Default renders as a fourth, always-present, always-unlocked card in the gallery (a Premium subscriber who dislikes all three named palettes should not be stuck), distinct from the "locked" state a non-entitled user sees for the three named ones.

   **Resolved as built (2026-08-18 code review), and the wording above was half stale.** The Default card ships and is always unlocked _within the gallery_, so a subscriber is never stuck with a palette they dislike. What does not ship is "always-present": a non-entitled reader sees no gallery at all, because AC 5 and Decision 11 both describe a whole-panel locked state and `resolveSectionView` gates the entire gallery on entitlement. Those two are the binding text and the code follows them; this open question's phrasing was the outlier. There is no per-card locked state, and no reason for one — a reader with no entitlement has Default already, which is exactly what the locked panel sits on top of.
