---
title: 'Story CC-7.17: Teen voice and copy'
type: feature
ticket: '7-17-teen-voice-copy'
created: '2026-11-27'
status: built
baseline_revision: 'a80ed17fda2d24ff748219c3983e01ed937bd384'
route: full
route_source: auto
risk: medium
review: thorough
review_source: pinned
lenses_ran: [independent-full-review, codex-security-diff]
review_loop_iteration: 0
context:
  - '_bmad-output/planning-artifacts/epics.md'
  - '_bmad-output/implementation-artifacts/epic-7-context.md'
  - '_bmad-output/test-artifacts/test-design-7-17-teen-voice-copy.md'
---

<frozen-after-approval reason="human-owned intent">

## Intent

Use the words a teen needs to pick an outfit, find a piece, share a look or use their account.
Apply the same voice in the current first run, five member tabs, sample closet and share card.

## Boundaries and decisions

Keep the current age check, guardian consent, account and photo privacy behavior.
Keep legal and safety meaning when shortening copy.
Use everyday scenarios in sample copy and retain existing saved look IDs, share payload fields,
locale keys and interpolation variables that carry meaning.
Treat grades as a prose measure and check short labels by word count and familiarity.
Member names, captions and other user-entered text retain their original wording.
CC-7.21 owns changes to first-run order and account timing.

</frozen-after-approval>

## Code map

- Add the guide to `_bmad-output/planning-artifacts/ux-design-specification.md`.
- Update the existing strings in `apps/web/src/i18n/locales/` and `apps/mobile/assets/locales/`.
  Follow the actual render paths through Today, wardrobe, Looks, Community, Profile and first run.
- Update the shared preview in `packages/utils/src/sample-wardrobe/strings/` and any rendered
  outfit messages in that package. Keep the catalog data, scoring and example IDs stable.
- Update the share composer copy in both apps and the export copy in
  `apps/api/src/modules/share-cards/assets/`. Keep export eligibility and approved projection fields.
- Update the weather notes and badges supplied by
  `apps/api/src/modules/personalization/ritual-generation.engine.ts`.
- Reuse existing shell, dialog and responsive layout components and test IDs.

Coordinate with the builder for the guide, spec, sprint, learning path, review and publication.
The implementation owner handles web, native, shared sample and API production code.
TEA owns test code, fixtures, snapshots and all CI failures in the same worktree.
No local suites, DB, staging or commits by the implementation owner.

Keep the sample ID `sample:l:office-oxford`. English renders School day and A button-up shirt,
dark jeans and loafers for school. The share scenario keys retain their IDs and render
Before school, Midday, and Going out in both apps and the export. Simplify labels around them.
Preserve the existing layout test IDs. Confirm effective content on both clients.

## Tasks and acceptance

- [x] Document second person, short sentences, familiar situations, picture-backed garment terms,
      and words for weather and fit.
- [x] Given a member reads app-written English in the five tabs or first run, then prose reads at
      US grade six or below and button labels use up to three words.
- [x] Given a member opens Home, browseable samples or a share card, then the copy uses everyday
      settings such as school, weekends and going out.
- [ ] Given a member uses any of the ten supported locales, then changed strings load in that
      locale, and long labels can wrap at 320 px or dp in both themes.
- [ ] Integrate the [acceptance plan](../test-artifacts/test-design-7-17-teen-voice-copy.md),
      review the pinned diff, and link coverage in learning path Step 74.
- [ ] Mark the spec and sprint done before the final push.

## Implementation notes

The live Today details use localized API comfort notes and reasoning badges.
Older recommendations can still carry the old morning and rain bullets.
Their existing badge keys let the read path update those lines without changing stored data.
The golden fixture generator reproduced all 1,379 baseline hashes before exporting the new
strings. The copy-free output matched for garment selection, badge keys and forecast evidence.

## Plan change log

The hourly forecast uses the same chance buckets as sample looks. Its labels say rain or snow
because the live forecast can include either. Sample explanations show the result of the rain
setting without repeating the setting label. The existing thresholds still pick the outfit.

The first CI run showed the sample entry text and bottom tabs clipping at 320 px with 200% text.
The guest entry, age check and first look have compact spacing and wrap their labels.
The bottom tabs grow with their text and the page clears the measured height.
The member capture flow uses plain upload statuses and keeps the private closet disclosure.
The first [Android visual run](https://github.com/muratkeremozcan/couture-cast/actions/runs/46003648554)
passed. The web visual job now attaches the four Today screenshots after comparison so they
can be checked even when a copy change stays within the baseline tolerance.
Its 320 dp captures showed truncated sample look names in Plan. At enlarged text sizes, the
Looks controls stack and each sample day puts the full look name below the weekday.
The six Android Home and Community baselines come from the pixel-reviewed first run.

## Review triage log

The independent full review and Codex Security used `a80ed17fda2d24ff748219c3983e01ed937bd384`
through `90eac8cd4ddf486b896a25f3ad6de7f81184127c`. Codex Security completed 93 static worklist
receipts, with 24 inventory exclusions and zero reportable findings.
Review found six high, four medium and one low item.

| Finding | Verdict | Action                                                                                              |
| ------- | ------- | --------------------------------------------------------------------------------------------------- |
| P1-1    | High    | Use 8 dp spacing for the hourly card and pass the design token guard.                               |
| P1-2    | High    | Translate the web permission action under the button's actual key.                                  |
| P1-3    | High    | Migrate web unit expectations to the rendered copy.                                                 |
| P1-4    | High    | Migrate mobile unit expectations to the rendered copy.                                              |
| P1-5    | High    | Migrate Playwright selectors and refresh reviewed baselines from CI.                                |
| P1-6    | High    | Migrate Maestro assertions for the Turkish Today and German Community runs.                         |
| P2-1    | Medium  | Handle nonfinite and trace chances, wrap longer forecast labels, and name rain and snow accurately. |
| P2-2    | Medium  | Update the capsule placeholder, remaining old prompts, long buttons and badge fallback text.        |
| P2-3    | Medium  | Finish the Italian and Brazilian Portuguese copy and expand locale and narrow-layout coverage.      |
| P2-4    | Medium  | Drop the rain setting interpolation from explanation templates to eliminate the blank label.        |
| P3-1    | Low     | Update Step 74 links, stale test copy and sprint status.                                            |

## Verification

CI proves behavior across the locale, renderer, browser and Android lanes.
Check every workflow at the published head. Local checks are limited to lint and type checks.
