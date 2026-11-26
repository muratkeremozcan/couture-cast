# Epic 7 context: First-use clarity and member reliability

<!-- Compiled from planning artifacts, the 2026-11-21 phone evidence and two reviews. Edit freely. -->

Updated: 2026-11-21: created from tester and owner feedback, a phone-width production walk, the
Codex review and the UX review.

Updated: 2026-11-26: CC-7.8 formal usability studies dropped (owner decision, CC-7.10 D8); the
product owner reviews with her own account after Epic 7 ships.

## Goal

Make CoutureCast simple enough that a teen can use it without help, make every save stick, and
fill an empty account with useful outfits before the member uploads anything. Epic 7 fixes broken
persistence first, then removes clutter and navigation friction around a five-tab layout, then
adds style preferences, a lookbook and carefully gated AI, and finally adds the planning features
that competing closet apps use to keep members coming back.

## Evidence

### Tester feedback (one adult, phone web, 2026-11-20 and 2026-11-21)

- Made two sample looks and could not save or preview them. Could not find a mini skirt or
  hosiery, although the catalog has both, so discoverability failed.
- Background cleanup made the photo high contrast and left the background visible. On 2026-11-21
  the owner confirmed the saved photo now matches the preview; cutout quality is unverified.
- Community showed no other members' looks.
- Description edits saved in one session. The owner's retest on 2026-11-21 found that title and
  description edits look applied and do not persist.
- Summary: the app is detailed but empty, and adding garments one at a time is tedious. Requested
  a short survey (colors, palette, textures, today's temperature, mood such as active wear, casual
  chic or cozy sophisticated) that generates editable looks with swappable pieces, and an AI-drafted
  one or two sentence description for posts.
- Compared two competing closet apps and asked for a blend. One is built on member uploads
  (wardrobe stats, shuffler with pinned pieces, collage canvas, moodboards, week calendar with
  weather, outfit selfies, social feed). The other is built on AI (closet from a selfie, one piece
  styled three ways, outfit calendar, trip planner, virtual try-on, color season, shopping match).

### Owner and family feedback (2026-11-21)

- A teen family member could not use the app: it is cluttered and too busy.
- Navigation is hard. Wardrobe content should be at the top without scrolling.
- In a phone browser, switching tabs makes content jump while it loads.
- Saving a look from Style this piece does not stick.

### Phone-width production walk (2026-11-21, owner account, Chrome at 500 CSS px)

Chrome's minimum window width is 500 CSS px, so CC-7.7 rebaselines at 390 x 844.

| Check                        | Observation                                                         |
| ---------------------------- | ------------------------------------------------------------------- |
| Home cold load               | Shift score 0.574 (good is 0.1 or less); signed-out sample first    |
| Home length                  | 3,701 CSS px; embeds the Community feed with eight climate chips    |
| Home to Wardrobe             | A setup banner inserts above the closet; first garment about 450 px |
| Community                    | Tall empty Spotlight skeleton collapses and moves the feed up       |
| Style this piece, Save look  | No visible confirmation; saved to browser storage only              |
| Style this piece, companions | Generic catalog icons; the member's garments are never companions   |
| Garment tagging              | The tested garment opened with manual selections                    |
| Garment management           | No garment edit or delete on web                                    |

Details: on Home, City Spotlight caused a 0.47 shift and Latest looks 0.10. After reload a saved
look appears under "Saved on this device" at the bottom of the dialog, below all three looks.

### Code facts (verified in the reviews)

- Saved looks are written to `localStorage` only, by design in `_bmad-output/plan-style-one-piece.md`.
  When the app shell's storage probe fails, `apps/web/src/app/layout.tsx` installs an in-memory
  store, so a save can vanish on reload. Home sample bookmarks keep a second, separate list.
- Community text edits write through `PATCH /api/v1/community/posts/:postId/text`; screening runs
  inside the 7-second privacy transaction. Web and native already apply `post.text_changed`, and a
  Playwright spec already covers edit and reload, so CC-7.4 starts by reproducing.
- The sample catalog already includes a mini skirt, opaque tights and ribbed socks.
- Web preselects confident tag suggestions when inference returns them.
- The API has TensorFlow screening and tag inference and no generative AI provider.
- `OutfitCapsule` stores owner-scoped outfits of member garments; sample items are not garments.
- Web Home carries three analytics-only actions, a marketing hero, a chip row that changes nothing
  for members, and the only Open wardrobe and Sign out links at the bottom. Today's outfit renders
  as category words on web and text on native. Each tab uses a different visual frame.

## Target layout

Five tabs on web and native: Today, Closet, Looks, Community, Profile. Wireframes for each tab and
the first-run flow are in `reviews/epic-7-ux-review.md`.

## Stories

Lane A: reliability

- 7.1 Shared save, undo and status feedback
- 7.2 Saved looks follow the account
- 7.3 Import device-saved looks for the same member
- 7.4 Community post edits persist
- 7.5 Garment detail and tag edit
- 7.6 Garment delete
- 7.7 Signed-in shell without flashes

Lane B: clarity

- 7.8 Teen and adult usability studies (dropped 2026-11-26: owner review after the epic instead)
- 7.9 One app shell and visual system
- 7.10 Screen budget guard
- 7.11 Five-tab navigation and back pattern
- 7.12 Looks tab for saved looks, ideas and plans
- 7.13 Calm Today with one primary job
- 7.14 Today's outfit as a picture
- 7.15 Calm Community with an empty state
- 7.16 Calm Closet and Profile
- 7.17 Teen voice and copy

Lane C: fill the empty app

- 7.18 Find mini skirts, tights and socks
- 7.19 Garment subtypes
- 7.20 Account style profile
- 7.21 First run with the look first and the account on save
- 7.22 Lookbook with shuffle and pinned pieces
- 7.23 AI-written look ideas (text only)
- 7.24 Photo AI consent and processor approval
- 7.25 Suggested Community descriptions
- 7.26 Clean garment cutouts
- 7.27 Suggested tags that are right
- 7.28 Add several photos at once
- 7.29 Several garments from one flat-lay photo

Lane D: keep members coming back

- 7.30 Style this piece with my own garments
- 7.31 Wear log
- 7.32 Closet insights
- 7.33 Trips
- 7.34 Packing list

## Sequencing

1. CC-7.8 is dropped (owner decision 2026-11-26): no baseline, midpoint or exit study gates any
   story. The product owner uses her own account and comments after Epic 7 ships.
2. Lane A in order: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7.
3. Lane B in order: 7.9, 7.10, 7.11, 7.12, 7.13, 7.14, 7.15, 7.16, 7.17.
4. Lane C: 7.18 and 7.20 may overlap Lane B; 7.19 follows 7.5 and 7.18; 7.21 and 7.22 follow
   7.12. 7.23 gates 7.24, which gates every photo AI story. 7.26 may start any time with an
   on-device or server model.
5. Lane D: 7.30 after 7.5; 7.31 after 7.14; 7.33 after 7.22.
6. The owner's review of her own account runs after the last member-facing story.

## Guardrails

- Teens aged 13 to 17 are the main audience. The age gate, guardian consent and Community
  screening hold for every story. A guardian-pending teen gets a complete product without photos.
- No member photo goes to an external model without the consent from CC-7.24, and no feature
  generates images of a member's body or face. Model output is untrusted data.
- Each screen has one primary action and passes the CC-7.10 screen budget.
- Web and native ship together for every member-facing story unless the story says otherwise.
- Repository artifacts name testers by role only.
