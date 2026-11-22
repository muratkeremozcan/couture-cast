# Epic 7 UX review

Reviewed the Epic 7 working-tree draft on `docs/epic-7-product-clarity` (CC-7.1 to CC-7.18, the
product decisions and `epic-7-context.md`) against the screens in this checkout: web Home
(`page.tsx`, `lookbook-prism-layout.tsx`, `home-ritual.tsx`), Wardrobe, Community, Profile and the
bottom nav, plus native `app/(tabs)` and `src/features`. Reviewer role: UX lead. Testers are named
by role only. This review complements `epic-7-codex-review.md`; it repeats a Codex finding only
where the UX change differs.

Assumptions made without asking:

- The fold is 390 x 664 CSS px for phone web (844 minus browser chrome and the 64 px tab bar in
  mobile Safari) and the visible area above the tab bar on the smallest supported native phone.
  The epic's 1,688 px Home height budget stays as written.
- Observations of rendered layout come from code reading and the context file's production walk.
  No app or test suite was run for this review.
- Tab names below are proposals for the CC-7.8 baseline study to confirm with teens.

## Verdict

The epic diagnoses the right problems and its reliability lane is sound. As a UX plan it is not yet
aggressive enough, and it adds new surfaces faster than it removes old ones.

- Home today carries three dead calls to action, a filter chip row that does nothing for members,
  a marketing hero below the feed, and the only Open wardrobe and Sign out links at the very bottom.
  CC-7.6 names some of this; it misses the dead controls and the native equivalents.
- Saved looks, the AI lookbook, capsules and Planner have no single home. The epic spreads them
  across Wardrobe and Home, which recreates the clutter it is removing. A Looks tab fixes this.
- Today's outfit renders as a list of category words ("Top", "Bottom") on web and as text on
  native. "Detailed but empty" starts here; no story makes the outfit a picture.
- The first-run order is unspecified. A five-step survey in front of the first look breaks the
  30-second target in CC-7.8. Show a look first, ask one mood question inline, and ask for an
  account when the member saves.
- The rule-based lookbook can ship before the AI foundation. Today CC-7.12 waits on CC-7.11, so
  the empty-app fix waits on the riskiest story.
- Lanes C and D have no placement or element budget, so the app will re-clutter after CC-7.8's
  exit study. Add a screen budget that every later story must pass.

Recommendation: approve Lane A as written with the CC-7.1 changes below. Re-cut Lane B around the
target IA, add the seven new stories at the end of this file, split CC-7.7 and CC-7.12, and move
CC-7.8's exit study to the end of the epic.

## Target information architecture

Five tabs, in this order, on web and native. Labels are 12 px minimum, sentence case, with one icon
set shared by both platforms.

| Tab       | Job                                       | Moves in                                        | Moves out                              |
| --------- | ----------------------------------------- | ----------------------------------------------- | -------------------------------------- |
| Today     | Decide what to wear in seconds            | Closet strip, one Plan row, one Community row   | Feed, chips, marketing hero, dead CTAs |
| Closet    | See, add and fix my pieces                | Garment detail (CC-7.3), insights row (CC-7.17) | Capsules, Silhouette, explainer card   |
| Looks     | Every outfit I saved, new ideas, my plan  | Saved looks, capsules, lookbook, Planner, trips | (new tab)                              |
| Community | See and share what others wear            | Spotlight inside the feed, weekly challenge row | Eight chips, explainer paragraph       |
| Profile   | Account, places, style, Premium, sign out | Sign out, Silhouette, color palette, About      | Long settings copy                     |

Rules that hold the IA together:

1. Each tab opens on its own content within the fold. No tab opens on a banner, an explanation or
   setup progress.
2. One primary button per screen. Secondary actions are text buttons or sit in a "More" menu.
3. A sub-screen always has a top bar with a back control and a title. Overlays close with an X and
   the system back gesture, and return focus to the control that opened them.
4. Planner lives in Looks > Plan. Free members see the Plan segment with a one-line Premium note
   and a sample week. Today keeps a single "Plan your week" row for one-tap access (CC-7.5 AC 4).
5. "Wardrobe" becomes "Closet" in the tab bar and screen titles, keeping routes and test ids. The
   baseline study checks the label with teens before it ships.

### Today, returning member

```text
+--------------------------------------------+
| CoutureCast                   Chicago  12 C|  app bar 56
+--------------------------------------------+
| Cool and rainy. Bring a layer.             |  one line
| +----------------------------------------+ |
| |  [rain jacket]    [hoodie]             | |
| |  [straight jeans] [ankle boots]        | |  outfit picture
| |                   [umbrella]           | |  about 320 tall
| |  Rainy day layers                      | |
| |  Warm enough for 9 to 14 C             | |
| +----------------------------------------+ |
| (    Wear this    )   Shuffle   Swap       |  1 primary
|                                            |
| Your closet                       See all >|
| [img] [img] [img] [img] [ + ]              |  strip 72
| - - - - - - - - fold 664 - - - - - - - - - |
| Plan your week                           > |  one row
| 3 new looks in your climate              > |  one row
+--------------------------------------------+
| Today | Closet | Looks | Community | Profile|
+--------------------------------------------+
```

"Wear this" saves the look to the account for today with one tap and shows the saved state. It
becomes the wear log entry point once CC-7.17 ships. Shuffle and Swap are text buttons. Weather
alerts appear as one line above the outfit and expand on tap.

### Today, new or empty member

```text
+--------------------------------------------+
| CoutureCast                    Set city  > |
+--------------------------------------------+
| Idea for today        Sample pieces        |
| (Cozy) (Sporty) (Chic) (Any)               |  mood, inline
| +----------------------------------------+ |
| |  [cardigan]  [tee]                     | |
| |  [midi skirt] [tights] [boots]         | |
| |  Cozy and put together                 | |
| |  Picked for: Cozy, mild weather        | |
| +----------------------------------------+ |
| (   Save this look   )   Shuffle   Swap    |
|                                            |
| Add your first piece                     > |  one row
| - - - - - - - - fold 664 - - - - - - - - - |
| Tune my style (4 quick questions)        > |
+--------------------------------------------+
| Today | Closet | Looks | Community | Profile|
+--------------------------------------------+
```

The mood row is the first survey question. Choosing a mood reshuffles the look in place. The rest
of CC-7.9's survey is one optional row below the fold.

### Closet

```text
+--------------------------------------------+
| Closet                  (+ Add)    [More]  |  More: Setup,
+--------------------------------------------+  Silhouette link
| (All) (Tops) (Bottoms) (Shoes) (More v)    |  one chip row
| +-------------------+ +-------------------+|
| |                   | |                   ||
| |      photo        | |      photo        ||
| |                   | |                   ||
| | Blue top          | | Wide jeans        ||
| +-------------------+ +-------------------+|
| +-------------------+ +-------------------+|
| |      photo        | |  Needs tags       ||  badge only
| | Black boots       | |  photo            ||  when action
| +-------------------+ +-------------------+|  is needed
| - - - - - - - - fold 664 - - - - - - - - - |
| Finish closet setup (2 of 4)             > |  one row, end
+--------------------------------------------+
| Today | Closet | Looks | Community | Profile|
+--------------------------------------------+
```

Empty state: one illustration, "Add your first piece", the Add button and "Add a whole outfit
from one photo" once CC-7.15 ships. Tapping a garment opens its detail (CC-7.3), where Style this
piece lives.

### Looks

```text
+--------------------------------------------+
| Looks                                      |
| [ Saved ]  [ Ideas ]  [ Plan ]             |  segments
+--------------------------------------------+
| (All) (Today) (Capsules)                   |
| +-------------------+ +-------------------+|
| |  outfit collage   | |  outfit collage   ||
| |                   | |                   ||
| | Rainy day layers  | | Gym after school  ||
| | Saved Tue         | | 1 piece missing   ||  state line
| +-------------------+ +-------------------+|
| +-------------------+ +-------------------+|
| |  outfit collage   | |  outfit collage   ||
| - - - - - - - - fold 664 - - - - - - - - - |
+--------------------------------------------+
| Today | Closet | Looks | Community | Profile|
+--------------------------------------------+
```

Ideas holds the lookbook by mood (CC-7.12): one look at a time per mood with Shuffle and pinned
pieces. Plan holds the week (Premium) and later trips (CC-7.18). An empty Saved segment shows two
idea looks and "Save a look to see it here".

### Community

```text
+--------------------------------------------+
| Community                        (+ Post)  |
| Your climate v                             |  one filter
| This week: Layer it up                 > x |  one row
| +----------------------------------------+ |
| |                                        | |
| |               photo                    | |
| |                                        | |
| | Rainy walk to school              ...  | |  ... = Report,
| | (heart) 12   (fire) 3                  | |  Share
| +----------------------------------------+ |
| - - - - - - - - fold 664 - - - - - - - - - |
| +----------------------------------------+ |
+--------------------------------------------+
| Today | Closet | Looks | Community | Profile|
+--------------------------------------------+
```

City Spotlight posts join the feed with a "Near you" label. When no post is eligible the screen
shows "No looks in your climate yet" and one "See all climates" button.

### Profile

```text
+--------------------------------------------+
| Profile                                    |
| (M)  Member name                           |
|      Teen account, guardian approved       |
+--------------------------------------------+
| Account                                  > |
| Places                     Chicago       > |
| Style                      Cozy, Sporty  > |
| Premium                    Active        > |
| Notifications                            > |
| Language                   English       > |
| About and privacy                        > |
|                                            |
| Sign out                                   |
+--------------------------------------------+
| Today | Closet | Looks | Community | Profile|
+--------------------------------------------+
```

Style holds the CC-7.9 answers, Silhouette and the color palette advisor. Each row opens a
sub-screen with a back control.

## First-run flow

The first look comes before any question or account. The account ask comes at the moment the visitor
has something to keep.

1. **Guest Today.** One sample look teaser and "Show me looks" as the only primary action. Sign in
   and Create account stay as text links.
2. **Age check.** The existing 13+ birthdate gate from CC-6.16. The date is kept for sign-up so it
   is never asked twice.
3. **First look.** One complete illustrated look for sample weather with the inline mood row,
   Shuffle and Swap. Target: on screen within 30 seconds of opening the app, median.
4. **Make it yours.** Choosing a mood reshuffles in place. After the first change, "Save this look"
   becomes the primary action.
5. **Save asks for an account.** Saving opens a sheet: "Keep your looks on any phone. Create a free
   account." Sign-up reuses the gate's birthdate. Under-18 sign-up collects the guardian email and
   continues straight into the app.
6. **Success moment.** The saved look lands in Looks > Saved with a confirmation line "Saved to
   Looks" and a View link. The Looks tab shows a dot until visited. For a guardian-pending teen the
   same moment happens; capture and posting show their pending state only when tapped.
7. **Tune and add, later.** Today shows "Tune my style" (CC-7.9 remaining questions, three screens
   at most) and "Add your first piece". Neither blocks anything. "Set city" appears on the app bar
   until a city is saved.

Guest answers carry into the account only through CC-6.16's review-and-confirm screen, extended to
show the chosen mood and colors next to the comfort settings.

```text
Step 5 sheet                                Step 3 first look
+--------------------------------------+    +--------------------------------------+
| Keep this look                     x |    | Idea for today      Sample pieces    |
|                                      |    | (Cozy)(Sporty)(Chic)(Any)            |
| Create a free account to save looks  |    |  [outfit picture]                    |
| and see them on any phone.           |    |  Cozy and put together               |
|                                      |    | ( Save this look ) Shuffle  Swap     |
| ( Create account )                   |    +--------------------------------------+
| I have an account                    |
+--------------------------------------+
```

## Findings

| ID  | Severity | Story             | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Proposed change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --- | -------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U1  | high     | CC-7.6            | Web Home renders three dead calls to action to every visitor: "Preview outfits" (`href="#"`, analytics only), "See the planner" (`#wardrobe`, no such anchor) and "Start wardrobe upload" (file picker that only records an event) in `analytics-event-actions.tsx`. Below them sit a marketing hero ("Plan confident outfits in under 90 seconds", commute and meeting copy) and the member's only Open wardrobe and Sign out links, at the page bottom. | Add to CC-7.6: "Remove `AnalyticsEventActions` and the Daily ritual hero section from Home on every viewport; keep the analytics events behind the real controls that perform those actions. Remove the header tagline. Move Sign out to Profile. Home has no link or button whose only effect is an analytics event; a test enumerates Home's interactive elements and fails on any without a navigation or state change."                                                                                                   |
| U2  | high     | CC-7.6            | The Personal, Community and Sponsored chips change nothing a member can see on web: every chip maps to the `auto` feed and only rewrites the signed-out demo copy. On native the same chips silently switch the scenario to morning, midday and evening, duplicating `ScenarioToggles` under a "Sponsored" label on a teen surface. CC-7.6 AC 2 names the web chips only.                                                                                 | Replace CC-7.6 AC 2 with: "Remove the Personal, Community and Sponsored chip row from Home on web and native, the embedded Community feed and its climate chips, reactions and Report controls, and the Lookbook Prism heading. Native Home keeps one scenario control for morning, midday and evening, shown only when the forecast differs by scenario."                                                                                                                                                                    |
| U3  | high     | CC-7.5, CC-7.1    | Saved looks, capsules, the lookbook and Planner have no shared home. CC-7.1 AC 3 puts Saved looks on Wardrobe, CC-7.12 puts the lookbook on Home and Wardrobe, capsules hang off a Wardrobe header button and Planner sits behind a Home button. Wardrobe would hold two grids and Home three entry points.                                                                                                                                               | Add new story CC-7.19 (Looks tab). Replace CC-7.1 AC 3 with: "Looks > Saved lists every saved look and capsule, newest first. Each opens to the exact garments and swaps that were saved after reload, on another browser and on native." Replace CC-7.5 AC 1 with: "The Closet tab opens on the garment grid. Add is the one primary button. Capsules move to Looks; Silhouette and setup move to the More menu and Profile > Style. At 390 x 664 a populated account shows four garment tiles; an empty account shows Add." |
| U4  | high     | CC-7.1            | Members can save from two places with two controls and two lists today: Home's sample "Save" with its own "Saved" list (`couturecast.member-sample-bookmarks`, `sample-idea-controls.tsx`) and Style this piece's "Save look" with "Saved on this device" at the bottom of its dialog. A member who saved in one place looks for it in the other.                                                                                                         | Add to CC-7.1: "Every save control in the app uses one shared component with the states Save, Saving, Saved and Failed, and writes to one account list. The Home sample list and the Style this piece device list are removed after migration. Saved looks appear only in Looks > Saved."                                                                                                                                                                                                                                     |
| U5  | high     | CC-7.6            | Today's outfit has no pictures. Web `LiveOutfit` renders each garment as a bordered text chip with its category name; native `OutfitRecommendationCard` shows text, a badge details panel and a Shop this look block on the outfit card. The core moment of the app reads as a form.                                                                                                                                                                      | Add new story CC-7.20 (Today's outfit as a picture). Add to CC-7.6: "Today's outfit is a picture of the pieces (member photos, catalog illustrations for missing slots) with a one-line name and a one-line weather reason. Commerce blocks never appear on the Today card; Shop this look stays one tap away in the look's detail with its CC-5.1 disclosure."                                                                                                                                                               |
| U6  | high     | CC-7.9, CC-7.12   | The epic never states where the survey sits in first use. Five survey steps plus the age gate in front of the first look cannot meet CC-7.8's 30-second median, and the earlier first-use review already chose "outfit before setup".                                                                                                                                                                                                                     | Add new story CC-7.24 (look first, account on save). Replace CC-7.9 AC 1 with: "Style mood is asked inline on the first look as one row of four choices, with no screen of its own. The remaining questions (colors, textures, fit, pieces to avoid) form an optional 'Tune my style' flow of at most three screens, each with Skip, reachable from Today and Profile > Style. No question blocks the first look or sign-up."                                                                                                 |
| U7  | high     | CC-7.12           | The lookbook depends on CC-7.11, so the fix for "detailed but empty" waits on the AI foundation and its consent work. The existing rule-based selector and sample catalog can already produce mood looks.                                                                                                                                                                                                                                                 | Split CC-7.12. CC-7.12a: "Rule-based lookbook from the style profile, weather and catalog, with swap, shuffle, pin and save" (prerequisites CC-7.1, CC-7.9, CC-7.10 slice). CC-7.12b: "AI-ranked and AI-described looks on the same surface, falling back to CC-7.12a" (prerequisites CC-7.11, CC-7.12a). Ship CC-7.12a in Lane B's window.                                                                                                                                                                                   |
| U8  | high     | CC-7.12           | AC 1 places the lookbook on both Home and Wardrobe: two to three looks for each of three moods, so six to nine outfit cards added to two screens the epic is trying to calm.                                                                                                                                                                                                                                                                              | Replace CC-7.12 AC 1 with: "Looks > Ideas shows one look at a time for the selected mood, with the member's moods as one chip row. Today shows only the top look as its outfit for an empty or small closet. No other screen embeds lookbook cards."                                                                                                                                                                                                                                                                          |
| U9  | high     | Epic-wide         | Teens are the main users and a guardian-pending teen cannot capture garments or post. No Lane B or C story checks that this teen gets a complete product. Today the teen's first run leads into blocked capture.                                                                                                                                                                                                                                          | Add to CC-7.6, CC-7.12a and CC-7.24: "A guardian-pending teen can use Today, the lookbook, Shuffle, Swap, Save and Looks with the same tap counts as an approved member. Capture and posting show the pending state only when tapped, in one line with a 'Remind my guardian' action. An end-to-end test covers this account through every Lane B task in CC-7.8."                                                                                                                                                            |
| U10 | high     | CC-7.7            | Each tab looks like a different app: Home is a black gradient page framing a light lookbook card with gold accents; Wardrobe is a light zinc admin layout titled "Wardrobe Hub" with a "Your Digital Closet" card; Community is a dark page with an inset light card; Profile is neutral-950 dark. The box-in-a-box framing adds a container level on Home and Community. Wardrobe strings are hard-coded English.                                        | Add new story CC-7.23 (one app shell). Replace CC-7.7 AC 3 with: "All tabs share one app shell: the same page surface, a 56 px top bar with the screen title, one card level and the tokens published for web and native. Light and dark follow the system setting on every tab. Every member-facing string on the changed screens comes from the locale catalogs."                                                                                                                                                           |
| U11 | high     | Lanes C and D     | CC-7.12, CC-7.13, CC-7.15, CC-7.17 and CC-7.18 each add controls or sections, and none states where it lives or what it displaces. CC-7.8's exit study runs before them, so the epic can end cluttered again.                                                                                                                                                                                                                                             | Add new story CC-7.21 (screen budget guard) to Lane B. Add to every story from CC-7.9 onward: "Name the tab and screen this story changes and pass the CC-7.21 screen budget at 390 x 844 on web and native." Move CC-7.8's exit study after the last member-facing story in the epic and keep a midpoint study after CC-7.7.                                                                                                                                                                                                 |
| U12 | medium   | CC-7.1            | AC 2 asks for confirmation within 1 second and undo, and leaves the pattern open. The owner did not notice today's save notice, which renders as a status line far from the button.                                                                                                                                                                                                                                                                       | Replace CC-7.1 AC 2 with: "Tapping Save changes the control to Saving within 100 ms. When the server confirms, the control reads Saved with a check and a bar appears at the bottom of the screen for 5 seconds: 'Saved to Looks', View, Undo. Undo removes the look and restores the Save control. A failure keeps the look on screen, sets the control to Failed and shows 'Could not save. Try again.' with Retry. Offline, Save shows 'You are offline. Save when you reconnect.' Screen readers hear each state once."   |
| U13 | medium   | CC-7.4            | AC 2 reserves final height for sections that may end empty (City Spotlight, the setup banner), so an empty section still costs space or collapses later. Tab switches on web are page loads that refetch and lose scroll.                                                                                                                                                                                                                                 | Add to CC-7.4: "A section whose emptiness is unknown at first paint renders nothing until its data arrives and then appears only below the fold or at the end of the screen. Returning to a tab within the session shows its last content and scroll position immediately and refreshes in place without moving visible content. No content is inserted above the viewport after the first tap on a screen."                                                                                                                  |
| U14 | medium   | CC-7.5            | AC 3 asks for a back control everywhere and leaves the pattern open. Web Wardrobe and Profile show their Home link only from 768 px, so phones get none; Planner opens as an overlay on Home with its own close; native has `wardrobe-back-button.tsx` on some sub-screens.                                                                                                                                                                               | Replace CC-7.5 AC 3 with: "Every screen below a tab (garment detail, saved look, post detail, Plan, capsules, setup, each Profile row) shows a top bar with a back arrow labeled with the parent screen and a title. Overlays close with X, Escape, swipe down and system back, and return focus to their opener. Browser back and the native back gesture return to the parent with its scroll position."                                                                                                                    |
| U15 | medium   | CC-7.5            | The web tab bar uses emoji icons and 10 px uppercase labels with wide tracking; native uses FontAwesome icons at 28 pt. CC-7.5 AC 4 allows "four or five" tabs without naming them.                                                                                                                                                                                                                                                                       | Replace CC-7.5 AC 4 with: "The tab bar shows Today, Closet, Looks, Community and Profile in that order on web and native, with one shared icon set, labels at 12 px or larger in sentence case and an active state that does not rely on color alone. The baseline study confirms each label with at least three teens before release."                                                                                                                                                                                       |
| U16 | medium   | CC-7.5, CC-5.5    | Planner is Premium, so a Planner tab or Home button sends free members to a lock. The epic's one-tap rule does not say what free members see.                                                                                                                                                                                                                                                                                                             | Add to CC-7.19: "Looks > Plan shows the week for Premium members. Free members see a sample week, one line on what Premium adds and one Upgrade button; no other screen shows a Planner lock. Today's 'Plan your week' row opens Looks > Plan in one tap for every member."                                                                                                                                                                                                                                                   |
| U17 | medium   | CC-7.7            | Community stacks a heading, an explainer paragraph, eight filter chips (`auto`, `all`, six climate bands), a weekly challenge card, City Spotlight with its own empty skeleton, a post button and full cards with reactions, Withdraw or Report. AC 1 moves Report behind the detail view, which hides a teen safety control.                                                                                                                             | Replace CC-7.7 AC 1 with: "Community opens on a title row with Post, one 'Your climate' filter that opens a sheet with All climates and the six bands, the weekly challenge as one dismissible row, then the feed. Spotlight posts appear in the feed labeled 'Near you'. Cards show the photo, title, author and one reaction row; a '...' button on each card offers Report or Withdraw in one tap. The explainer paragraph moves into the filter sheet."                                                                   |
| U18 | medium   | CC-7.7            | Above the first garment on phone web: a two-row action grid (Outfit capsules, Silhouette, + Add Garment), the setup banner, an error slot and a card titled "Your Digital Closet" with a paragraph. Each card shows a status badge in green for every status, including failed, plus a Style this piece button.                                                                                                                                           | Add to CC-7.7: "Closet shows the title row with Add and More, one category chip row, then the grid. Garment cards show the photo and short name; a badge appears only when the member must act (Needs tags, Failed, Processing), colored by meaning. Style this piece moves to the garment detail. Setup progress is one row after the grid until setup completes."                                                                                                                                                           |
| U19 | medium   | CC-7.7            | Web Profile has no Sign out (it lives at the bottom of Home), and sections render in build order: account, locations, commerce, subscription, theme. Native Profile also hosts language, palette and planner links. Native Home's header carries an About button.                                                                                                                                                                                         | Replace the Profile half of CC-7.7 AC 2 with: "Profile lists Account, Places, Style, Premium, Notifications, Language and About and privacy as one-line rows with their current value, each opening a sub-screen, then Sign out. Planner leaves Profile for Looks > Plan. The About button leaves Home's header for Profile. Each row's help text is one line with 'Learn more'."                                                                                                                                             |
| U20 | medium   | CC-7.6, CC-7.7    | Copy speaks to commuting adults: "Weather-aware wardrobe plans for every commute", "Optimized for 18 C morning train commute", "Match Score: 96%", "the commute, the meeting, and the vibe". CC-7.6 AC 5 limits length and says nothing on voice or reading level.                                                                                                                                                                                        | Add new story CC-7.25 (teen voice and copy). Add to CC-7.6 AC 5: "Home copy reads at US grade 6 or below, uses school, weekend and going-out situations, and shows no match scores or percentages."                                                                                                                                                                                                                                                                                                                           |
| U21 | medium   | CC-7.12           | Swap is the only editing tool in the lookbook. The adult tester asked for a shuffler with pinned pieces, and AC 5 lets a generated look replace the sample "while it finishes", which can swap content under the member's finger.                                                                                                                                                                                                                         | Add to CC-7.12a: "Each piece has a pin. Shuffle replaces every unpinned piece and keeps the look weather-appropriate. Pinned state survives reload until the look is saved or reset." Add to CC-7.12b: "A generated look replaces the sample only if the member has not tapped the look; otherwise a 'New ideas ready' button appears and nothing moves."                                                                                                                                                                     |
| U22 | medium   | CC-7.10           | The expanded taxonomy multiplies swap options per slot. Today's swap dialog lists every candidate for the category in one flat list.                                                                                                                                                                                                                                                                                                                      | Add to CC-7.10: "The swap sheet groups options by subtype, lists the member's own pieces first and weather-appropriate options before others, and shows at most 12 options before 'Show more'. The current piece is marked and choosing it again closes the sheet."                                                                                                                                                                                                                                                           |
| U23 | medium   | CC-7.8            | The exit bar uses completion, time to first outfit and a debrief word. It has no per-screen comprehension or ease measure, so a pass can hide a confusing tab.                                                                                                                                                                                                                                                                                            | Add to CC-7.8 AC 3: "Five-second test on Today, Closet, Looks and Community: at least five of six participants state the screen's job. First tap is correct on at least 80% of task attempts. Median single ease rating is 6 or higher on a 7-point scale for every task. Each 'cluttered' or 'confusing' remark is recorded with the screen it refers to."                                                                                                                                                                   |
| U24 | medium   | CC-7.3            | The story names the detail contents and leaves the interaction open: how a member opens it, how delete feels for a teen, and where the member lands after.                                                                                                                                                                                                                                                                                                | Add to CC-7.3: "Tapping a garment opens its detail with a back control; edits save on Done with the CC-7.22 states. Deleting a piece used by no saved look shows 'Deleted' with Undo for 5 seconds. Deleting a piece used by saved looks or capsules asks once, naming how many looks it affects. After delete the member returns to the grid at the same scroll position."                                                                                                                                                   |
| U25 | medium   | CC-7.9            | Survey format is unspecified. Text lists of style terms ("cozy sophisticated", "casual chic") are hard for a 13-year-old to judge without pictures.                                                                                                                                                                                                                                                                                                       | Add to CC-7.9: "Every survey choice is a picture with a short label; colors are swatches; pieces to avoid are toggles on illustrations. No free text. A progress line shows the step. Answers apply as soon as each screen is done, so leaving early keeps them."                                                                                                                                                                                                                                                             |
| U26 | medium   | CC-7.3, CC-7.7    | Every garment image has the alt text "Uploaded garment"; status color does not match meaning; Shuffle and Swap results are not announced; 10 px nav labels fall below readable size for large-text users.                                                                                                                                                                                                                                                 | Add to CC-7.3 and CC-7.7: "Garment images use the short name as alt text. Look changes announce the new look name once through a polite live region. Status badges carry text and an icon in addition to color. Verify 200% text scaling at 320 px with no clipped or overlapping labels on every changed screen."                                                                                                                                                                                                            |
| U27 | medium   | CC-7.6            | Native Home stacks the chip row, Plan week, weather header, hourly ribbon, scenario toggles, an Add garment prompt, the outfit card with badge details and Shop this look, and the spotlight teaser. CC-7.6 lists web elements only, so native can pass while still busy.                                                                                                                                                                                 | Add to CC-7.6: "Native Today matches the web sketch: one weather line, the outfit picture, one primary action, the closet strip, the Plan row and the Community row. The hourly ribbon opens from the weather line. A native screenshot at the smallest supported phone is attached to the PR."                                                                                                                                                                                                                               |
| U28 | low      | CC-7.13           | A drafted description that fills the field on its own can feel like the app speaking for the teen.                                                                                                                                                                                                                                                                                                                                                        | Add to CC-7.13: "The composer offers a 'Suggest a description' button. A suggestion appears as editable text marked 'Suggested' until the member edits or accepts it."                                                                                                                                                                                                                                                                                                                                                        |
| U29 | low      | CC-7.14           | "Confirm or change them in one step" has no layout.                                                                                                                                                                                                                                                                                                                                                                                                       | Add to CC-7.14: "One screen shows the cutout and each suggested tag as a selected chip; 'Looks right' is the primary button; a field with low confidence shows 'Pick one' and blocks Looks right until chosen."                                                                                                                                                                                                                                                                                                               |
| U30 | low      | CC-7.15           | Review of several detected pieces has no layout or default.                                                                                                                                                                                                                                                                                                                                                                                               | Add to CC-7.15: "Detected pieces appear in a grid, each kept by default with a Remove toggle and an Edit tags link; the save button counts the kept pieces ('Add 4 pieces')."                                                                                                                                                                                                                                                                                                                                                 |
| U31 | low      | CC-7.17           | Insights have no placement and could land on Today.                                                                                                                                                                                                                                                                                                                                                                                                       | Add to CC-7.17: "Insights live in one collapsed row at the top of Closet ('You wore 40% of your closet this month'), opening a sub-screen. Today shows no statistics."                                                                                                                                                                                                                                                                                                                                                        |
| U32 | low      | CC-7.18           | Trips have no placement.                                                                                                                                                                                                                                                                                                                                                                                                                                  | Add to CC-7.18: "Trips live in Looks > Plan below the week, and a trip's packing list opens from the trip."                                                                                                                                                                                                                                                                                                                                                                                                                   |
| U33 | low      | CC-7.4            | No motion rules exist for the new save, shuffle and tab interactions.                                                                                                                                                                                                                                                                                                                                                                                     | Add to CC-7.4: "Transitions last 200 ms or less, never move content the member did not touch, and become instant under reduced motion. Nothing autoplays."                                                                                                                                                                                                                                                                                                                                                                    |
| U34 | low      | Product decisions | The tester's competitor list has no UX disposition. Several items would add new surfaces.                                                                                                                                                                                                                                                                                                                                                                 | Record: pinned shuffle is adopted in CC-7.12a; week calendar is Looks > Plan; one piece styled three ways is CC-7.16; color season is the existing palette advisor under Profile > Style; collage canvas, moodboards, outfit selfies and shopping match are deferred because each adds a surface Epic 7 is removing.                                                                                                                                                                                                          |
| U35 | low      | CC-7.2            | The editor states are named; the post's own view after an edit is not.                                                                                                                                                                                                                                                                                                                                                                                    | Add to CC-7.2 AC 3: "After a successful edit the card and detail show the new text at once with an 'Edited' label; a held edit shows 'Waiting for review' on the author's view only."                                                                                                                                                                                                                                                                                                                                         |

Counts: 11 high, 16 medium, 8 low.

## Measurable UX acceptance bars

Add these to the epic header as bars every member-facing story meets, checked by CC-7.21 where
automated and by CC-7.8 where observed.

| Bar                                | Threshold                                                                                                                                                              |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Time to first outfit, guest        | Median 30 s or less from opening the app, age check included (study)                                                                                                   |
| Time to Today's outfit, member     | Outfit picture visible within 2 s of a cold load at p75 on a throttled 4G profile                                                                                      |
| Taps to first look, guest          | 2 taps plus birthdate entry                                                                                                                                            |
| Taps to save a look                | 1 tap from any look surface                                                                                                                                            |
| Taps to any saved look             | 2 or fewer from any tab                                                                                                                                                |
| Taps to the camera or file chooser | 1 from Closet, 2 from Today                                                                                                                                            |
| Taps to Plan                       | 1 from Today                                                                                                                                                           |
| Above the fold at 390 x 664        | Today: weather line, outfit picture and primary action. Closet: four tiles or Add. Looks: two saved looks or one idea. Community: top of the first photo within 300 px |
| Primary actions                    | Exactly one per screen                                                                                                                                                 |
| Interactive targets above the fold | 7 or fewer, excluding the tab bar, garment tiles and look tiles                                                                                                        |
| Chip rows                          | At most one per screen                                                                                                                                                 |
| Container levels                   | Page and card only; no card inside a card                                                                                                                              |
| Paragraphs                         | No paragraph over two lines at 390 px; button labels three words or fewer                                                                                              |
| Screen height                      | Today 1,688 px or less (epic); chrome above the Closet grid 160 px or less                                                                                             |
| Layout stability                   | CLS 0.1 or less per tab load and switch (epic); zero shift after the first tap on a screen                                                                             |
| Contrast                           | Text 4.5:1, large text and icons 3:1, in light and dark; gold text only through the gold-ink token                                                                     |
| Touch targets                      | 44 x 44 CSS px or pt with 8 px spacing                                                                                                                                 |
| Text size                          | Body 16 px, labels and tab labels 12 px minimum; 200% scaling at 320 px without clipping                                                                               |
| Save feedback                      | Control state changes within 100 ms; Saved within 1 s at p95 or "Still saving" shown                                                                                   |
| Reading level                      | US grade 6 or below for English member-facing strings                                                                                                                  |
| Motion                             | 200 ms or less; instant under reduced motion; no autoplay                                                                                                              |

## Story changes

- **Split** CC-7.7 into CC-7.7a (Community) and CC-7.7b (Closet and Profile). Each ships with its
  own screenshots and budget check.
- **Split** CC-7.12 into CC-7.12a (rule-based lookbook, Lane B window) and CC-7.12b (AI ranking and
  descriptions after CC-7.11).
- **Merge** the Home wardrobe strip into CC-7.6 and keep CC-7.5 to the tab bar, tab openings and
  back pattern.
- **Reorder** Lane B: CC-7.8 baseline, CC-7.23 shell and CC-7.21 guard, CC-7.5 with CC-7.19, CC-7.6
  with CC-7.20, CC-7.7a and CC-7.7b, CC-7.25, CC-7.8 midpoint. Lane C: CC-7.9 and the CC-7.10
  slice, CC-7.12a, CC-7.24, then CC-7.11 and the AI stories. CC-7.8 exit runs after the last
  member-facing story.
- **Clutter risk**: CC-7.12 (two surfaces), CC-7.17 (statistics with no home), CC-7.18 (new
  surface) and CC-7.13 (composer button) each need the placement lines in U8, U31, U32 and U28.
  CC-7.6 AC 1's Community teaser stays only as a single row below the fold and hides when no post
  is eligible.

## New stories proposed

**Story CC-7.19: Looks tab for saved looks, ideas and plans**
As a member, I want one place for every outfit I saved, new ideas and my week, so that I always
know where a look is.
**Acceptance Criteria**

1. A Looks tab sits between Closet and Community on web and native, with Saved, Ideas and Plan
   segments. It opens on Saved when the member has a saved look and on Ideas otherwise.
2. Saved lists saved looks and capsules newest first as picture tiles with a name and one state
   line (saved date, "1 piece missing", "Needs review"). Filters: All, Today, Capsules.
3. Ideas hosts the lookbook (CC-7.12a): one look at a time for the selected mood with Shuffle, pin,
   Swap and Save.
4. Plan shows the Premium week. Free members see a sample week, one line on what Premium adds and
   one Upgrade button. Today's "Plan your week" row opens Plan in one tap.
5. Capsules move here from the Wardrobe header; `/wardrobe/capsules` redirects to Looks with the
   Capsules filter selected.
6. Every save confirmation offers "View" that opens the saved look in Looks.
7. Tests prove each segment's first content is above the fold at 390 x 664, deep links to a saved
   look open it with a back control to Saved, and a free account sees no lock outside Plan.
   **Prerequisites:** CC-7.1, CC-7.23.

**Story CC-7.20: Today's outfit as a picture**
As a teen member, I want to see today's outfit as clothes, so that I can decide at a glance.
**Acceptance Criteria**

1. Today's outfit renders as a composed picture of its pieces on web and native: the member's
   garment photos where the outfit uses them and catalog illustrations for the other slots.
2. The card shows a short look name and one weather reason ("Warm enough for 9 to 14 C"). Comfort
   notes, badge details and Shop this look move to the look's detail.
3. A missing or failed photo shows the catalog illustration for its subtype with no broken image.
4. The picture reserves its final size before images load and passes the CC-7.4 shift budget.
5. Each piece is a 44 px target that opens Swap; long press or the detail offers pin.
6. Visual snapshots cover a full closet, an empty closet, a missing photo and dark mode at
   390 x 844 and the smallest native phone.
   **Prerequisites:** CC-7.4, CC-7.10 slice.

**Story CC-7.21: Screen budget guard**
As the product owner, I want every screen checked against a clutter budget, so that later stories
cannot make the app busy again.
**Acceptance Criteria**

1. An automated check loads Today, Closet, Looks, Community and Profile at 390 x 844 with empty,
   populated and guardian-pending fixtures on web, and the matching native screens.
2. It fails when a screen has more than one primary button, more than seven interactive targets
   above the fold (excluding the tab bar and garment or look tiles), more than one chip row, a card
   inside a card, or a paragraph longer than two lines.
3. It fails when Today exceeds 1,688 px or the chrome above the Closet grid exceeds 160 px.
4. It runs in the PR gate within the CI time budget. Raising a limit needs a recorded owner
   decision in the story file.
5. Each new member-facing story lists the screen it changes and attaches the guard's output.
   **Prerequisites:** CC-7.23.

**Story CC-7.22: Shared save, undo and status feedback**
As a member, I want every save, delete and change to tell me clearly what happened, so that I
trust the app.
**Acceptance Criteria**

1. One shared component on web and native provides the Save, Saving, Saved and Failed states and
   a bottom status bar with up to two actions (View, Undo, Retry) shown for 5 seconds.
2. Undo is available for save, unsave, garment delete without references, and swap or shuffle on
   an unsaved look.
3. Offline, actions that need the network show "You are offline" with the action kept on screen;
   a single offline line appears under the top bar and leaves when the connection returns.
4. Every state is announced once to screen readers, and the bar never covers the primary button
   or the tab bar.
5. CC-7.1, CC-7.2, CC-7.3 and CC-7.12a use it; a test enumerates their save paths.
   **Prerequisites:** none.

**Story CC-7.23: One app shell and visual system**
As a member, I want every tab to look like the same app, so that I always know where I am.
**Acceptance Criteria**

1. Every tab and sub-screen uses one page surface, a 56 px top bar with title and optional back,
   one card level and the shared spacing and type scale, on web and native.
2. Light and dark follow the system setting on every screen; the dark page with an inset light
   card on Home and Community is removed.
3. Tokens for color, type, spacing, radius and elevation are published once and consumed by web and
   native; gold appears only on the primary action focus ring, active tab and Premium marks.
4. The signed-in session placeholder renders this shell with the final layout (CC-7.4 AC 1).
5. Visual snapshots of each tab in light and dark at 390 x 844 and the smallest native phone.
   **Prerequisites:** CC-3.6.

**Story CC-7.24: First run with the look first and the account on save**
As a new visitor, I want to see a look I like before I answer questions or sign up, so that I know
the app is worth it.
**Acceptance Criteria**

1. Guest Today shows one sample look teaser and "Show me looks" as the only primary action; Sign in
   and Create account are text links.
2. After the existing 13+ age check the visitor sees a complete look with the mood row, Shuffle,
   Swap and Save within 30 seconds median of opening the app.
3. Save opens a sheet asking for a free account; sign-up reuses the age check's birthdate. Cancel
   returns to the same look.
4. After sign-up, the CC-6.16 review screen shows the mood and colors chosen as a guest next to the
   comfort settings; only confirmed answers carry over. The saved look then appears in Looks >
   Saved with the CC-7.22 confirmation.
5. A teen whose guardian has not yet approved lands in the same place with the same tools; capture
   and posting show their pending state only when tapped.
6. "Tune my style" and "Add your first piece" appear on Today as single rows and never block a task.
7. End-to-end tests cover adult, approved teen and guardian-pending teen paths, cancel at each step
   and the under-13 block.
   **Prerequisites:** CC-6.16, CC-7.1, CC-7.9, CC-7.12a, CC-7.22.

**Story CC-7.25: Teen voice and copy**
As a teen member, I want the app to talk like me, so that it feels made for me.
**Acceptance Criteria**

1. A short voice guide in the design system: second person, short sentences, school, weekend and
   going-out situations, no fashion jargon without a picture, no percentages or match scores.
2. Every member-facing English string on Today, Closet, Looks, Community, Profile and first run is
   rewritten to US grade 6 or below and button labels of three words or fewer.
3. Commute, office and meeting language is removed from Home, the sample catalog descriptions and
   the share card.
4. All supported locales receive the new strings; long translations wrap without clipping at
   320 px.
5. Three teens read the new Today and first-run copy in the CC-7.8 midpoint study and explain each
   screen in their own words.
   **Prerequisites:** CC-7.23.

## Resolution

All findings and the seven proposed stories were applied in the 2026-11-21 Epic 7 rewrite. The
new stories took final numbers: CC-7.1 shared save feedback, CC-7.9 app shell, CC-7.10 screen
budget guard, CC-7.12 Looks tab, CC-7.14 outfit picture, CC-7.17 teen voice and CC-7.21 first
run. CC-7.7 split into CC-7.15 and CC-7.16, and CC-7.12 split into CC-7.22 and CC-7.23. The UX
bars and target layout are in the epic header.
