---
title: 'Story CC-7.5: Garment detail and tag edit'
type: feature
ticket: '7-5-garment-detail-tag-edit'
created: '2026-11-25'
status: in-review
baseline_revision: 'ea93273baba410b83b1b77d6abbd71c6d016b089'
route: full
route_source: auto
risk: medium
review: thorough
review_source: pinned
lenses_ran:
  - codex-correctness
  - codex-security
review_loop_iteration: 0
context:
  - '_bmad-output/planning-artifacts/epics.md'
  - '_bmad-output/implementation-artifacts/epic-7-context.md'
  - '_bmad-output/implementation-artifacts/spec-7-1-shared-save-undo-status-feedback.md'
---

<frozen-after-approval reason="human-owned intent - do not modify unless human renegotiates">

## Intent

**Problem:** Members cannot open a ready garment or fix its tags after first tagging. Grid cards
are inert, web alt text is the fixed string "Uploaded garment", mobile labels every image with the
capture title and prints the raw garment id, and the API never exposes the garment color it
already computes (`color_palette.dominant`).

**Approach:** Tapping a ready garment opens a detail view on web and native with back, photo,
category, material and comfort range, an inline tag editor whose Done saves through the CC-7.1
feedback (Saved with Undo, No changes, distinct errors), Style this piece, and color plus category
alt text from a new opt-in `colorFamily` field.

## Decisions (owner delegated; recorded here)

- D1 Color: classify the stored dominant hex into the 11 families the community caption already
  uses, moved to `packages/utils` so both share one classifier. Exposed as nullable `colorFamily`
  only when the request sends `x-couture-garment-color: 1` (6.3/6.7b/6.14 precedent: web and
  native parse garment responses with strict schemas, so an added key would break installed
  builds). Applies to `GET /garments` and `PATCH /garments/:id/tags`. OpenAPI minor bump.
- D2 Web detail is an in-page view keyed by `/wardrobe?garment=<id>`: the grid stays mounted
  (hidden), so back keeps scroll (CC-7.6 needs it) and reload reopens the detail.
- D3 Native detail is a pushed stack route `app/wardrobe-garment.tsx?id=<id>` with a header back
  control. It reads the garment from the list endpoint (no new single-garment GET); a missing or
  no-longer-ready id shows a localized "no longer in your closet" state with back. After save it
  calls `notifyWardrobeChanged`; the hub subscribes and reloads in place.
- D4 "Tags" means category, material, comfort range (the API's editable set). Material may be
  cleared; category and comfort are required.
- D5 Undo re-PATCHes the previous tags. Unchanged Done shows "No changes" and sends no request.
- D6 Alt text: localized template per locale (`{{color}} {{category}}` in en, word order per
  locale); no color gives the category alone; no category gives "Untagged garment".

## Boundaries & Constraints

**Always:** CC-7.1 `useStatusBar`/undo patterns with a provider fallback; every new string in all
10 web and 10 mobile locales with parity specs; strict legacy shape for requests without the
header; ownership and guardian upload checks stay on the existing PATCH path.

**Never:** garment delete (CC-7.6); shell/flash fixes (CC-7.7); visual system or grid redesign
(CC-7.9, CC-7.16); tab and back-pattern rework (CC-7.11); subtypes (CC-7.19); own-garment
companions in Style this piece (CC-7.30); free-form tag lists; changing `garmentItemSchema`
itself.

## I/O & Edge-Case Matrix

| Scenario           | Input / State                    | Expected                                                                           | Error handling                |
| ------------------ | -------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------- |
| Open ready garment | tap ready card                   | detail with back, photo, category, material, comfort, Edit tags, Style this piece  | none                          |
| Non-ready card     | awaiting_tags/processing/failed  | existing buttons only; card not a link                                             | none                          |
| Edit and Done      | changed tags                     | PATCH 200, detail and grid show new tags, "Saved" with Undo, persists after reload | none                          |
| Undo               | within notice                    | PATCH back to previous tags, "Undone"                                              | failure shows retry notice    |
| Unchanged Done     | same tags                        | "No changes", no request                                                           | none                          |
| Concurrent update  | 409 `CONCURRENT_TAG_UPDATE`      | keep draft, distinct conflict message                                              | 409                           |
| Guardian blocked   | 403                              | keep draft, distinct not-allowed message                                           | 403                           |
| Offline / network  | fetch fails                      | keep draft, offline/retry message                                                  | network                       |
| Unknown id         | `?garment=x` or route id missing | "no longer in your closet" with back                                               | none                          |
| Color              | header sent, hex stored          | `colorFamily` e.g. `blue`; alt "Blue top"                                          | null hex: `colorFamily: null` |
| Legacy client      | no header                        | response has no `colorFamily` key                                                  | none                          |

</frozen-after-approval>

## Code Map

- `apps/api/src/modules/community/community-photo-caption.ts:3-15,177-190` -- `COLORS`, `pixelColor`; move classifier to `packages/utils/src/garment-color.ts` and import back.
- `packages/api-client/src/contracts/http/wardrobe.ts:130-196,290-306` -- add `garmentColorFamilyEnum`, `WARDROBE_GARMENT_COLOR_HEADER`, `garmentItemWithColorSchema` (extends, strict), list/update `WithColor` response schemas, header param on both registered paths. Copy `COMMUNITY_SPONSORSHIP_HEADER` pattern (`community.ts:814-840`, `2035-2070`). `openapi.ts:180` bump to 1.10.0 with a note.
- `apps/api/src/modules/wardrobe/wardrobe.controller.ts:52-56,152-182` + `wardrobe.service.ts:557-580` (`toResponse`, `garmentData`) -- read the header, add `colorFamily` from `color_palette.dominant` only when opted in; parse with the WithColor schemas.
- `apps/web/src/lib/wardrobe.ts:502-557`, `apps/mobile/src/lib/wardrobe.ts:93-197` -- send the header, parse WithColor schemas, return `GarmentWithColor`.
- `apps/web/src/app/wardrobe/page.tsx:716-803` -- ready cards become buttons opening `?garment=`; alt from shared helper; localized card label; render `GarmentDetail` when the param is set (grid hidden, mounted). `style-piece-panel.tsx` `StylePieceEntry`/`StylePiecePanel` reused from detail.
- `apps/web/src/app/wardrobe/garment-detail.tsx` (new) -- detail + inline tag editor (segmented choices), CC-7.1 feedback modeled on `saved-looks-row.tsx:175-430`.
- `apps/mobile/src/features/wardrobe/wardrobe-hub-screen.tsx:593-666` -- ready cards pressable `router.push({pathname:'/wardrobe-garment', params:{id}})`; alt label helper; drop raw id; subscribe `onWardrobeChanged`.
- `apps/mobile/app/wardrobe-garment.tsx` + `apps/mobile/src/features/wardrobe/garment-detail-screen.tsx` (new) -- Stack.Screen header back (`wardrobe-back-button.tsx` pattern), detail, editor, `useStatusBar`, Style this piece via existing `StylePieceEntry`/`StylePiecePanel`.
- Display labels: `getGuestPreviewStrings(locale).values.{categoryTitle,material,range}` (`packages/utils/src/sample-wardrobe/format.ts:20`); add `color` table and `garmentAlt` builder in `packages/utils` so web and native share one alt function.
- Locales: new `wardrobe.detail.*` namespace (not `wardrobe.tagging`, whose spec pins exact keys) in `apps/web/src/i18n/locales/*.json` and `apps/mobile/assets/locales/*.json`; new parity specs `wardrobe-detail-locales.spec.ts` in both apps.
- Test ids (TEA contract, same names on web `data-testid` and native `testID`): `garment-open-<id>`
  on ready cards, `garment-detail`, `garment-detail-back`, `garment-detail-category`,
  `garment-detail-material`, `garment-detail-comfort`, `garment-edit-tags`, `garment-tag-done`,
  `garment-tag-option-<field>-<value>` (field = category | material | comfort),
  `garment-detail-missing`; reuse `style-piece-open`. Render tags from the PATCH response. Only
  header value `1` opts in to `colorFamily`. TEA test design:
  `_bmad-output/test-artifacts/test-design-7-5-garment-detail-tag-edit.md`.
- Tests to update: `apps/web/src/app/wardrobe/page.styling.test.tsx:336`, `playwright/tests/style-one-piece.spec.ts:64` (alt "Uploaded garment").

## Tasks & Acceptance

**Execution:**

- [x] `packages/utils/src/garment-color.ts` -- shared `GARMENT_COLOR_FAMILIES`, `classifyRgbColorFamily`, `colorFamilyFromHex`; community caption imports it -- one classifier.
- [x] `packages/utils/src/sample-wardrobe/*` -- localized color names and `formatGarmentAlt(locale, {colorFamily, category})` -- one alt builder for both apps.
- [x] `packages/api-client/src/contracts/http/wardrobe.ts`, `openapi.ts`, generated client, api-client dist rebuild -- opt-in contract.
- [x] `apps/api/src/modules/wardrobe/wardrobe.controller.ts`, `wardrobe.service.ts` -- header-gated `colorFamily`.
- [x] `apps/web/src/lib/wardrobe.ts`, `apps/web/src/app/wardrobe/page.tsx`, `apps/web/src/app/wardrobe/garment-detail.tsx` -- web detail, editor, alt, labels.
- [x] `apps/mobile/src/lib/wardrobe.ts`, `apps/mobile/app/wardrobe-garment.tsx`, `apps/mobile/src/features/wardrobe/garment-detail-screen.tsx`, `wardrobe-hub-screen.tsx` -- native detail, editor, alt, labels, hub refresh.
- [x] Locales (10 web, 10 mobile) + parity specs.
- [ ] Tests per TEA plan (`_bmad-output/test-artifacts/test-design-7-5-garment-detail-tag-edit.md`), cross-link comments.
- [x] `_bmad-output/project-knowledge/learning-path-step-by-step.md` -- Step 62 to merged, add Step 63.

**Acceptance Criteria:**

- Given a member with a ready garment at 390x844, when they tap it, then the detail shows a back control, the photo, localized category, material and comfort range, Edit tags and Style this piece, on web and native.
- Given the detail, when the member changes tags and taps Done, then "Saved" with Undo shows, the detail and grid show the new tags, and a reload (web) or relaunch/refocus (native) shows them persisted.
- Given a garment whose stored color classifies as blue and whose category is top, when the grid or detail renders, then the image alt / accessibility label is "Blue top" in en-US.
- Given the detail, when Style this piece is tapped, then the existing Style this piece panel opens for that garment.
- Given a request without `x-couture-garment-color`, when garments are listed or tags updated, then the response matches today's strict schema byte for byte in keys.

## Implementation Notes

- Builder diff review: `app/wardrobe-garment.tsx` sets the shared tab bar height to 0 while the
  detail is focused, so the CC-7.1 status bar sits on the safe area of the pushed screen instead
  of floating a tab bar's height above it; leaving restores the previous height.

- Clients send `x-couture-garment-color: 1` and read the answer with
  `parseGarmentListWithColorResponse` / `parseUpdateGarmentTagsWithColorResponse` (contract
  file). Both stay strict, but a legacy response from a server that predates the header reads as
  `colorFamily: null`, so a web or native build deployed before the API keeps loading the closet.
  Existing mocked fixtures without `colorFamily` keep working for the same reason.
- The API controller parses only the opted-in responses with the WithColor schemas; the legacy
  list path keeps its current unparsed return, byte for byte.
- Per TEA finding, tag labels use the singular, capitalized category noun ("Top", "Outer
  layer") from `formatGarmentCategory` on the detail, grid card and editor chips, on web and
  native. Material and comfort come from `values.material` and `values.range`.
- `WardrobeRequestError` (web) and the mobile wardrobe error now carry the HTTP `status`, and
  `CONCURRENT_TAG_UPDATE` / `GUARDIAN_CONSENT_REQUIRED` are known codes, so
  `classifyGarmentTagSaveError` (utils) names conflict, not-allowed, offline and failed the same
  way on both platforms.
- Web ready cards: a full-card button (`garment-open-<id>`, named by the alt text) sits under
  the card actions, so the photo keeps its own `img` alt outside the button. Detail loading shows
  `garment-detail-loading`; `garment-detail-missing` only after the list loaded without the id.
- Native: header back control `garment-detail-back` (exported as `GarmentDetailBackButton`);
  hub cards carry `garment-card-<id>` on every status; the hub ignores its own
  `notifyWardrobeChanged` calls and reloads on any other.
- Existing test assertions changed: `page.styling.test.tsx` and `style-one-piece.spec.ts` alt
  "Uploaded garment" became "Top" (legacy fixture, no color); `page.test.tsx` card label
  `top · cotton` became `Top · Cotton`.

## Plan Change Log

## Review Triage Log

## Verification

**Commands:**

- `npm run build --workspace @couture/utils && npm run build --workspace @couture/api-client` -- clean
- `npx tsc --noEmit -p <workspace>` for utils, api-client, apps/api, apps/web, apps/mobile -- 0 errors
- `npx eslint --max-warnings=0 <touched files>` -- 0 warnings
- Unit, API, Playwright and native suites run in CI only. Do not run vitest, Playwright, API
  integration, native or Maestro suites locally; tsc and eslint on touched files are the local checks.
- Shared worktree with the TEA agent: never run git stash, git checkout -- <file>, git reset, git
  add or git commit; never touch a database (the default 127.0.0.1:54322 above all). The builder
  commits after review.
- Work the Execution tasks in order and tick each one in this file when done. TEA owns new test
  files listed in its test design; do not create or edit those.
