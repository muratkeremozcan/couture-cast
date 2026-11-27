---
title: 'Story CC-7.20: Account style profile'
type: feature
ticket: '7-20-account-style-profile'
created: '2026-11-27'
status: in-review
baseline_revision: 'f6b06a60399480770da29e060bb41b7e843dcc2f'
route: full
route_source: auto
risk: high
review: thorough
review_source: pinned
lenses_ran: []
review_loop_iteration: 0
context:
  - '_bmad-output/planning-artifacts/epics.md'
  - '_bmad-output/implementation-artifacts/epic-7-context.md'
  - '_bmad-output/test-artifacts/test-design-7-20-account-style-profile.md'
---

<frozen-after-approval reason="story brief delegates product and privacy choices">

## Intent

Members can get a relevant first suggestion with an empty closet, then add or clear their style
answers in their own time. The preference flow and today's controls work on web and native.

## Boundaries and decisions

- Show the first look before its optional row of four mood pictures: Sporty, Chic, Cozy and
  Classic. Classic gives members a fourth distinct look direction. Keep the existing guest age
  gate. Guest answers stay in the CC-6.16 preview until the explicit CC-7.21 review flow.
- **Tune my style** opens from Today or Profile > Style. Three screens ask for palette, texture
  and fit, then pieces to avoid. Two visual swatches represent the bundled neutral and colorful
  palettes. Fit describes the cut of garments. Every choice has a picture and a short label.
  Skip leaves that screen's stored answers intact. Continue or Finish saves that screen's answers
  before advancing. Failed saves retain the user's draft for retry. Use first-party catalog art.
- Store five bounded answers in an API-only, owner-keyed table. Guardian-pending members can use
  the flow. Capture no free text, body data, photos or telemetry about the answers. Never import
  legacy device-only answers silently. Clear restores defaults and keeps existing saved looks
  and swaps readable. Existing settings links stay reachable from Profile > Style.
- Today and Looks > Ideas share account-scoped temporary temperature and mood choices. The
  override expires at local midnight, is clearable, and stays on this device for the current
  signed-in session. It previews a labeled sample on Today when a live outfit exists. Keep the
  actual forecast and alerts visible. Reset or expiry returns Today to its ordinary outfit.
- Weather eligibility remains the first constraint on sample results. Avoid choices favor
  looks without those pieces and filter optional swaps. Keep a complete weather-eligible fallback
  when the catalog has no matching alternative. Clear restores default catalog ranking. The new
  complete lookbook and its persistence rules belong to CC-7.22.
- AC5 remains unmeasured. The target is five of six participants finishing within 60 seconds.
  The recorded Epic 7 owner decision moves usability review to the post-epic walkthrough.

## I/O and edge cases

| Scenario                        | Expected behavior                                                                                                         |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Empty profile                   | First look is usable. GET returns null choices and an empty avoid list.                                                   |
| Save, Skip, reopen              | Save applies only the completed screen fields. Skip adds no write. Reopening reads saved selections.                      |
| Another account or old response | New owner starts from own data. Discard previous-session responses and override state.                                    |
| Clear                           | Delete is idempotent and restores default profile selection without changing day choices or saved looks.                  |
| Day override                    | Selecting a temperature or mood refreshes Ideas and the Today preview immediately; midnight and reset clear the override. |

</frozen-after-approval>

## Code map

- `packages/db/prisma/schema.prisma` and `packages/db/prisma/migrations/` add owner-keyed storage
  with cascading deletion, RLS and revoked direct client grants. Follow the SavedLook migration.
- `apps/api/src/modules/personalization/` adds guarded, private no-store GET/PATCH/DELETE at
  `/api/v1/personalization/style-profile`. Reuse the ritual guard and `toBadRequest`. Use atomic
  partial upsert and idempotent clear. Derive the owner from `AuthContext` exclusively.
- `packages/api-client/src/contracts/http/style-profile.ts`, its index, the API HTTP bridge and
  OpenAPI registry own `styleProfileResponseSchema` and strict request validation. Every method
  returns 200 with `{ data: { mood, palette, texture, fit, avoid } }`. PATCH accepts only sent
  fields. Nullable enums: `active/chic/cozy/classic`, `neutral/colorful`, `smooth/textured`,
  `fitted/relaxed`. A unique avoid list accepts `crop-top`, `mini-skirt`, `leggings`. Generate the
  OpenAPI document and SDK through the repo commands. Rebuild dist before checking callers.
- `packages/utils/src/sample-wardrobe/style-profile.ts` defines `styleProfileSelection(profile,
day)`, `styleLocalDay(now?)` and `activeStyleDay(record, now?)`. Export via the utils barrel.
  `createMemberSampleOutfit(weather, inputs)` and `looksIdeas(inputs)` use optional shared inputs.
  Preserve the no-argument Ideas order for Plan and saved-look historical reconstruction. Extend
  the selector and catalog with first-party fit and classic metadata. Put strings in shared
  locale data for all ten locales.
- Web `home-ritual.tsx`, `guest-preview/guest-preview.tsx`, `looks-screen.tsx` and
  `settings/style/page.tsx` host controls. Read the verified owner and pin auth in
  `use-web-session.ts`; fence the result and any cached sample by full session scope. Never write
  a scope token to storage. Keep the shell ready while the optional profile fetch settles.
- Native `(tabs)/index.tsx`, `features/preview/member-sample-outfit.tsx`,
  `features/preview/guest-preview-screen.tsx`, `features/looks/looks-screen.tsx` and
  `features/settings/style-settings-screen.tsx` mirror the web entries. Fence dispatch and result
  with account ID and `mobileIdentityEpoch`. Use one day store per platform so tabs agree.

## Tasks and acceptance

- [x] Add storage, guarded account contract and generated artifacts.
- [x] Apply shared style ranking and local-day scope, using unchanged selection defaults when empty.
- [x] Deliver picture controls and the three-screen optional flow on web and native. Remove the
      old style selectors from member sample controls. Keep save and swap behavior.
- [x] Give controls stable IDs for TEA. Use `style-mood-{choice}`, `style-tune-{open,next,skip}`,
      `style-{palette,texture,fit,avoid}-{choice}`, `style-profile-clear`, `style-day-open`,
      `style-day-temperature-{cool,mild,warm}`, `style-day-mood-{choice}` and `style-day-reset`.
      Expose choice state via `aria-pressed` or native `accessibilityState.selected`.
- [x] Cover the flows in the [TEA plan](../test-artifacts/test-design-7-20-account-style-profile.md).
      TEA owns the plan, tests, route fixtures and CI repairs. Builder owns production code. Leave
      the shared index to the builder and keep test files under TEA ownership.
- [x] Add Step 77 to the learning path with links to the finished test files.
- [ ] Mark the sprint entry done before the final push.

Given a new member, the first look and its normal next action are available before any answer.
When they finish a screen, change the day controls, or clear their profile, the visible selection
and account responses follow the table above. Verify on an adult and a guardian-pending member.

## Implementation notes

- The generated SDK sends JSON request bodies directly. Describe the unique avoid values in the
  OpenAPI field and enforce them through Zod and the database so the generated DTO uses a JSON array.
- Today preserves the weather forecast and switches to the labeled sample for an active override,
  or when a member without usable closet pieces has saved style answers. Overrides are held in
  memory across tab navigation for the current app session.

## Review triage log

## Verification

Use Node 24.22.3. Rebuild Prisma and shared packages, then run per-workspace typechecks and lint
for touched files. Use CI for all suites under the epic rules. Verify the full workflow rollup
at the final PR head. No local suites or database writes.
