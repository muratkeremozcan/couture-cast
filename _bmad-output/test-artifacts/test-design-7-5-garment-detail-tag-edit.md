# Test design: Story CC-7.5 garment detail and tag edit

Updated: 2026-11-25. Initial plan from spec-7-5 (ready-for-dev, baseline ea93273b).
Updated: 2026-11-25. Ownership lists the files as written; added UNIT-009 (shared tag rules) and
the singular category label decision.

Status: active

## Scope

Spec: `_bmad-output/implementation-artifacts/spec-7-5-garment-detail-tag-edit.md`. Acceptance
criteria from epics.md CC-7.5:

1. Tapping a ready garment opens its detail with back, photo, category, material and comfort range.
2. Tags edit; Done saves with CC-7.1 states; the change survives reload on web and native.
3. Garment images use color plus category alt text ("Blue top").
4. Style this piece opens from the detail.

Plus the spec's contract rule: without `x-couture-garment-color: 1`, list and PATCH responses keep
today's strict keys (installed builds parse strictly).

## Risk assessment

| ID  | Risk                                                                                | P   | I   | Score | Mitigation (test IDs)                                            |
| --- | ----------------------------------------------------------------------------------- | --- | --- | ----- | ---------------------------------------------------------------- |
| R1  | `colorFamily` leaks to legacy clients and breaks strict parsing in installed builds | 2   | 3   | 6     | 7.5-UNIT-010..014, 7.5-INT-001, 7.5-PACT-001..002                |
| R2  | Done reports Saved but the write did not persist, or the grid shows stale tags      | 2   | 3   | 6     | 7.5-E2E-001, 7.5-INT-002, 7.5-MAE-001, 7.5-CMP-005               |
| R3  | Undo misfires: re-PATCHes the wrong tags or loses the failure state                 | 2   | 2   | 4     | 7.5-CMP-006..007, 7.5-E2E-001, 7.5-NAT-004                       |
| R4  | Error outcomes collapse (409, 403, network) or drop the draft                       | 2   | 2   | 4     | 7.5-CMP-008..010, 7.5-NAT-005, 7.5-E2E-002                       |
| R5  | Ownership bypass: header path reads or edits another member's garment               | 1   | 3   | 3     | 7.5-UNIT-015, 7.5-INT-003                                        |
| R6  | Classifier move changes community caption output                                    | 2   | 2   | 4     | 7.5-UNIT-001..004                                                |
| R7  | Wrong or untranslated alt text (word order, missing color, untagged)                | 2   | 2   | 4     | 7.5-UNIT-005..008, 7.5-CMP-002, 7.5-NAT-002, locale parity specs |
| R8  | Back loses grid scroll (CC-7.6 depends on it) or `?garment=` reload breaks          | 2   | 2   | 4     | 7.5-CMP-003..004, 7.5-E2E-001                                    |
| R9  | Native hub does not refresh after a detail save                                     | 2   | 2   | 4     | 7.5-NAT-006, 7.5-MAE-001                                         |
| R10 | Maestro edit mutates the shared fixture wardrobe and breaks capsule flows           | 2   | 2   | 4     | 7.5-MAE-001 restores the original tag before exit                |

Gate: every score 6 risk needs a passing P0 test at two levels before merge.

## Test matrix

Priorities follow `test-priorities-matrix.md`. Levels: UNIT (pure function, contract schema,
Nest controller/service with doubles), INT (Nest over pg17 integration DB), PACT, CMP (web vitest
component), NAT (mobile jest component), E2E (Playwright phone 390x844), MAE (Maestro Android PR
lane).

### Shared utilities (`packages/utils`)

| ID           | P   | Behavior                                                                                       |
| ------------ | --- | ---------------------------------------------------------------------------------------------- |
| 7.5-UNIT-001 | P1  | `classifyRgbColorFamily` maps a representative RGB per family to each of the 11 families       |
| 7.5-UNIT-002 | P1  | Boundary pixels (near-gray low saturation, near-black, near-white) classify as before the move |
| 7.5-UNIT-003 | P1  | `colorFamilyFromHex`: `#RRGGBB`, lowercase, no-hash input; malformed, empty, null give null    |
| 7.5-UNIT-004 | P1  | Community caption imports the shared classifier (same table identity; no local copy left)      |
| 7.5-UNIT-005 | P0  | `formatGarmentAlt('en-US', {colorFamily:'blue', category:'top'})` is exactly "Blue top"        |
| 7.5-UNIT-006 | P1  | No color gives the category alone ("Top"); no category gives "Untagged garment"                |
| 7.5-UNIT-007 | P1  | All 10 locales produce a non-empty string with no unresolved placeholder and no raw enum key   |
| 7.5-UNIT-008 | P2  | Word order per locale (es/fr/it/pt adjective after noun) exact for one pair each               |
| 7.5-UNIT-009 | P0  | Shared tag rules: draft, unchanged check, singular category labels, save failure names         |

### Contract (`packages/api-client`)

| ID           | P   | Behavior                                                                                            |
| ------------ | --- | --------------------------------------------------------------------------------------------------- |
| 7.5-UNIT-010 | P0  | Legacy `garmentListResponseSchema` and `updateGarmentTagsResponseSchema` reject a `colorFamily` key |
| 7.5-UNIT-011 | P0  | WithColor schemas accept `colorFamily` enum and null; reject a missing key and unknown values       |
| 7.5-UNIT-012 | P1  | OpenAPI doc declares the header param on GET list and PATCH tags; version 1.10.0                    |
| 7.5-UNIT-013 | P2  | `WARDROBE_GARMENT_COLOR_HEADER` constant value is `x-couture-garment-color`                         |

### API (`apps/api`)

| ID           | P   | Behavior                                                                                                                           |
| ------------ | --- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 7.5-UNIT-014 | P0  | Controller: no header, `0`, `true`, empty give responses without the key; `1` adds it (list and PATCH)                             |
| 7.5-UNIT-015 | P0  | PATCH with header keeps ownership 404 and guardian 403 behavior unchanged                                                          |
| 7.5-UNIT-016 | P1  | Service: `color_palette` null or missing `dominant` gives `colorFamily: null`                                                      |
| 7.5-INT-001  | P0  | pg17: garment with stored dominant hex; GET without header has exact legacy keys; with header `colorFamily` matches the classifier |
| 7.5-INT-002  | P0  | pg17: PATCH tags with header returns new tags plus `colorFamily`; subsequent GET reads them back                                   |
| 7.5-INT-003  | P1  | pg17: member B PATCH on member A garment with header is refused, A's tags unchanged                                                |
| 7.5-PACT-001 | P1  | Consumer: list garments with header returns `colorFamily`                                                                          |
| 7.5-PACT-002 | P1  | Consumer: PATCH tags with header returns `colorFamily`; provider double supplies it                                                |

### Web

| ID          | P   | Behavior                                                                                                                                       |
| ----------- | --- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 7.5-CMP-001 | P0  | `lib/wardrobe`: list and PATCH send the header and parse WithColor                                                                             |
| 7.5-CMP-002 | P0  | Ready card is a button named by the alt text; image alt "Blue top"; non-ready cards are not links                                              |
| 7.5-CMP-003 | P0  | Tap opens `?garment=<id>` detail with back, photo, localized category, material, comfort, Edit tags, Style this piece; grid hidden but mounted |
| 7.5-CMP-004 | P1  | Back restores the grid at the same scroll; reload with `?garment=` reopens detail; unknown id shows "no longer in your closet" with back       |
| 7.5-CMP-005 | P0  | Edit and Done: PATCH body exact, detail and grid show new tags, status bar "Saved" with Undo                                                   |
| 7.5-CMP-006 | P0  | Undo re-PATCHes the previous tags exactly and shows "Undone"                                                                                   |
| 7.5-CMP-007 | P1  | Undo failure shows the retry notice; tags stay at the saved values                                                                             |
| 7.5-CMP-008 | P0  | Unchanged Done: "No changes", zero requests                                                                                                    |
| 7.5-CMP-009 | P1  | 409, 403 and network failure each render their own message and keep the draft                                                                  |
| 7.5-CMP-010 | P1  | Material clears to null; category and comfort cannot be cleared                                                                                |
| 7.5-CMP-011 | P1  | Style this piece from detail opens the existing panel anchored on this garment                                                                 |
| 7.5-CMP-012 | P2  | Works without the status bar provider (fallback inline status)                                                                                 |

### Mobile

| ID          | P   | Behavior                                                                                                                                              |
| ----------- | --- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7.5-NAT-001 | P0  | `lib/wardrobe`: header sent, WithColor parsed                                                                                                         |
| 7.5-NAT-002 | P0  | Hub: ready card pressable, `router.push({pathname:'/wardrobe-garment', params:{id}})`, label "Blue top", raw id not rendered; non-ready not pressable |
| 7.5-NAT-003 | P0  | Detail screen: header back, photo, localized tags, Edit tags, Style this piece; missing or non-ready id shows the empty state                         |
| 7.5-NAT-004 | P0  | Done saves with "Saved" and Undo; Undo re-PATCHes previous tags; unchanged shows "No changes" with no request                                         |
| 7.5-NAT-005 | P1  | 409, 403, network: distinct messages, draft kept                                                                                                      |
| 7.5-NAT-006 | P0  | Save calls `notifyWardrobeChanged`; hub subscriber reloads in place                                                                                   |

### End to end

| ID          | P   | Behavior                                                                                                                                                                                            |
| ----------- | --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7.5-E2E-001 | P0  | Local real API at 390x844: seeded ready garment, tap, detail shows tags, edit material and comfort, Done, "Saved", reload shows persisted tags in detail and grid, back keeps scroll, Undo restores |
| 7.5-E2E-002 | P1  | Mocked network at 390x844: alt "Blue top" on grid and detail, 409 / 403 / offline messages, unchanged "No changes" with zero PATCH, Style this piece opens panel                                    |
| 7.5-E2E-003 | P1  | axe on the detail and edit states (`checkA11y`), back control and tag choices reachable by keyboard                                                                                                 |
| 7.5-MAE-001 | P0  | Android: open seeded garment, change material, Done, "Saved", relaunch, reopen detail, material persisted, restore original material, assert restored                                               |

## Ownership

Builder owns source, the two locale parity specs (`wardrobe-detail-locales.spec.ts` in web and
mobile) and the alt-text updates in `apps/web/src/app/wardrobe/page.styling.test.tsx` and
`playwright/tests/style-one-piece.spec.ts`.

TEA owns:

- `packages/utils/src/garment-color.spec.ts` (UNIT-001..003)
- `apps/api/src/modules/community/community-photo-caption.spec.ts` (UNIT-004; the caption had no spec)
- `packages/utils/src/sample-wardrobe/garment-alt.spec.ts` (UNIT-005..008)
- `packages/utils/src/sample-wardrobe/garment-detail.spec.ts` (UNIT-009)
- `packages/api-client/testing/wardrobe-contract.spec.ts` additions (UNIT-010..013) and the
  `community-openapi-contract.spec.ts` version pin (1.10.0)
- `apps/api/src/modules/wardrobe/wardrobe.controller.spec.ts` additions (UNIT-014) and
  `wardrobe.service.garment-color.spec.ts` (UNIT-015..016)
- `apps/api/integration/wardrobe-garment-color-http.integration.spec.ts` (INT-001..003)
- Pact: `pact/http/consumer/interactions/wardrobe-tags.ts`, `shared.ts` client pick, web and
  mobile consumer registrations, `pact/http/provider/doubles/wardrobe.ts` and the
  `A ready blue garment exists for user` state (PACT-001..002)
- `apps/web/src/lib/wardrobe.test.ts` additions and the header fix to the list test (CMP-001)
- `apps/web/src/app/wardrobe/garment-detail.test.tsx` and `page.garment-detail.test.tsx`
  (CMP-002..012)
- `apps/mobile/src/lib/wardrobe.test.ts` additions (NAT-001), `wardrobe-hub-screen.test.tsx`
  additions plus the raw-id assertion updates (NAT-002, NAT-006),
  `garment-detail-screen.test.tsx` (NAT-003..005)
- `playwright/tests/wardrobe-garment-detail.spec.ts`, `playwright/support/helpers/ready-garment.ts`
  and the colorFamily-tolerant list parse in `style-one-piece-fixtures.ts` (E2E-001..003)
- `maestro/garment-detail-tag-edit-flow.yaml` plus its `scripts/maestro-flow-durations.json`
  estimate (MAE-001)

Decision (2026-11-25, builder and TEA): one garment's category reads in the singular (Top, Outer
layer, Dress) on the detail, the grid card label and the editor chips, from one shared helper.

## Test-ability asks for the builder

- `data-testid`: `garment-card-<id>` (exists), `garment-open-<id>`, `garment-detail`, `garment-detail-back`,
  `garment-detail-photo`, `garment-detail-category`, `garment-detail-material`, `garment-detail-comfort`,
  `garment-edit-tags`, `garment-tag-done`, `garment-tag-option-<field>-<value>`, `garment-detail-missing`,
  `style-piece-open` (reuse). Mobile `testID` the same names; Maestro reads them.
- Detail renders tag values from the PATCH response, so tests assert the server's answer.
- Expose the undo window from the CC-7.1 constant; tests use fake timers, never sleeps.

## Execution

CI is the proof (RULES). Locally only tsc and eslint on touched files. Integration runs on the CI
pg17 lane. Playwright E2E-001 runs on the local PR lane (real API and worker); E2E-002 and 003 are
mocked and run everywhere the wardrobe specs run. MAE-001 runs on the Android PR shard.
Each new test file carries the learning path Step 63 cross-link comment.

## Exit criteria

- All P0 and P1 tests above pass in CI on the PR head; no skips added.
- R1 and R2 each covered at two levels and green.
- Burn-in of the new Playwright spec through the existing burn-in workflow stays green.
