# CoutureCast first outfit and first garment

Review and proposed re-spec / 2026-11-20 / Baseline `75515d3c` / Web and native

## Decision to test

Put a wearable-looking outfit before setup. Make one change to the look immediately useful and
reversible, then offer to add one garment. Returning members should still land on today's weather
and outfit and be able to reach Planner, Wardrobe and Community directly.

Murat's wife, the de facto product owner, finds the app useful for herself. Her concern that teens
may get bored or find it cluttered is a hypothesis. The first pass covers new users across age
groups and checks the effect on returning users. It proposes no change to CoutureCast's audience,
release gates or activation definitions. The brief and roadmap keep their existing targets.
[Project brief](../project-knowledge/couturecast_brief.md) /
[Roadmap](../project-knowledge/couturecast_roadmap.md) / [PRD](prd.md) /
[Existing UX specification](ux-design-specification.md).

## Current experience

### Observed in the local checkout

- **Signed-out mobile-width web.** In clean Chromium at 390 x 844 CSS pixels, Home showed
  header and bottom navigation, Plan week, category chips and Create my outfit card before the
  sample entry. **Try a sample wardrobe** was about 2,040 CSS pixels from the top. In this
  viewport, tapping the card launcher or Planner is easier to discover than entering the preview.
  The static look below them is marked **EXAMPLE**. This is a hierarchy observation from one
  viewport and locale. [Web Home](../../apps/web/src/app/page.tsx) /
  [Home hero](../../apps/web/src/app/components/lookbook-prism-layout.tsx).
- **Eligible guest preview.** From Home, the existing gate accepted a synthetic eligible date and
  showed **Office oxford** with garment illustrations under reset, exit and preview navigation.
  The outfit and swap buttons were visible on the first preview screen. **Try another look** sat
  below the tiles and explanation. Swapping loafers for white sneakers changed the displayed
  garment. Trying another look produced **Silk midi**. Browser Back from Sample wardrobe
  returned to Silk midi, and reload retained it. This is a working interaction to reuse.
  [Guest outfit](../../apps/web/src/app/components/guest-preview/guest-preview-outfit.tsx) /
  [Guest preview story](../implementation-artifacts/spec-6-16-guest-wardrobe-outfit-preview.md).
- **Signed-in empty fixture.** A separate local Chromium session used a synthetic member bearer
  and intercepted read responses. Home showed the member entry and hid the guest entry. Wardrobe
  showed **No garments added yet** and a visible **+ Add Garment**. The button opened
  **Take Photo** and **Choose File** in the capture dialog. Closing returned focus to the
  button. Guided closet setup opened a separate permission screen. With the garment list
  returning a fixture HTTP 503, Wardrobe showed the error and the empty message together,
  with no list Retry. No file was selected or uploaded.
  [Web Wardrobe](../../apps/web/src/app/wardrobe/page.tsx) /
  [Capture dialog](../../apps/web/src/app/components/garment-capture-modal.tsx).

### Supplied signed-in production walkthrough

The available evidence is from desktop Chrome. Settings retained the session and complimentary
Premium after reload. Searching for Chicago yielded five suggestions and no location was saved.
Wardrobe and Community loaded empty. Selecting **Cold and wet** changed the Community filter and
still showed zero looks. Initial session resolution briefly displayed signed-out content. The
reviewer used browser Back from Profile, Wardrobe and Capsules because the accessible view offered
no obvious in-app Back. The Home hero labeled the look **EXAMPLE** next to NYC/18&deg;C. Those values
describe the example. Home also displayed **All personalization services reporting healthy**.
Planner and outfit-card failures are recorded separately below.

### Established by code and prior specifications

- Web Home's **Lookbook Prism** renders a static recommendation and weather numbers. The share
  launcher independently requests a real ritual when clicked. Native Home has a signed-out
  welcome and uses the member ritual for real weather and outfits. Its no-location state leads to
  guided location setup. Native Planner has a Settings entry.
  [Share launcher](../../apps/web/src/app/components/ritual-share-card-launcher.tsx) /
  [Native Home](<../../apps/mobile/app/(tabs)/index.tsx>) /
  [Native Settings](<../../apps/mobile/app/(tabs)/settings.tsx>).
- CC-6.16 already provides bundled sample looks, swaps, preview weather, choices, a 13+ gate and
  bounded local state. Verified members opening guest preview are redirected to Home. Conversion
  can transfer the three comfort settings only after member review and confirmation. The existing
  post-review destination is wardrobe onboarding for an active member or the guardian-pending path
  when applicable. A signed-in sample surface would reuse the pure sample catalog and selector
  under member navigation. [Guest preview story, D1-D10](../implementation-artifacts/spec-6-16-guest-wardrobe-outfit-preview.md).
- CC-4.4's guided setup owns a server-resumable permission, capture, tagging and silhouette
  sequence. **Use starter wardrobe** skips capture and creates zero garments. The Wardrobe Hub
  also has direct capture and tagging. Use that entry for the first garment and leave guided
  setup reachable with its own progress. [Wardrobe onboarding story](../implementation-artifacts/4-4-wardrobe-onboarding-silhouette-setup.md) /
  [Native Wardrobe](../../apps/mobile/src/features/wardrobe/wardrobe-hub-screen.tsx).

### Hypotheses and evidence gaps

| Hypothesis                                                                            | What would help distinguish it                                                                                                             |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| The first look is hard to find because several actions compete on Home.               | First taps and scrolls improve when the sample is the clear first action.                                                                  |
| Changing a piece or seeing another look makes the experience more fun.                | Participants make another change voluntarily or say they would try another look after the first task.                                      |
| The starting outfit itself may feel irrelevant.                                       | Participants reach and understand the sample but pass on several styles or describe why the first look misses. Watch for this across ages. |
| An optional city link beside the outfit makes weather personalization easier to find. | Members can explain sample versus live weather and choose when to set a city without blocking on it.                                       |

The walkthroughs show interface behavior and placement. They establish neither boredom nor an
age-specific preference. Real photo upload and tagging, a populated member journey, fresh OAuth,
native running builds, and the proposed experience remain untested in this review.

## Proposed screen hierarchy

| State                  | First screen and action                                                                                           | Adjacent or secondary actions                                                                             |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Session resolving      | Stable Home frame with **Checking your session** and an outfit placeholder.                                       | Retry on a transient failure.                                                                             |
| Signed-out Home        | One compact, labeled sample teaser and **Try a sample look** as the first action. Open the existing preview gate. | Keep **Sign in** and **Create account** accessible. Place secondary marketing content below.              |
| Eligible guest preview | A complete, labeled illustrated look. Put **Try another look** by its title and **Swap** on each garment.         | **Exit preview**, account creation, explanation and preview controls.                                     |
| Signed-in empty        | **Outfit idea**, using a live suggestion when available. Offer **Try another look** for bundled samples.          | **Add one garment** and, when needed, **Set your city**.                                                  |
| Returning / populated  | **Today's outfit**, saved-city weather and any active weather alerts.                                             | Wardrobe, Community and Profile in member navigation, **Plan week** on Home, and daily details on demand. |

**Progressive reveal.** On member Home, position **Plan week** as a clearly labeled secondary
action near the outfit, a single tap from Home, alongside stable Community navigation. On
narrow web and native, use the existing member nav. On wide web, use actual route links with a
visible Home destination. Keep native Planner's Settings entry and keep capsule and silhouette
entry points in Wardrobe. Move comparison
and extended weather detail behind labeled affordances, and show share only beside a real,
eligible outfit source. The guest preview keeps its own navigation and existing eligibility
boundaries. For guests who want to explore weather, offer **Change sample weather** within the
preview. Keep **Why this works**, browsing, preferences and reset in the preview. **Set your
city** is for eligible signed-in members. When a live outfit is available to an empty member,
prioritize **Add one garment** and offer the live alternatives that the product already supports.

## First-run sequence

1. **Home to a first look.** A guest taps **Try a sample look**, completes the existing local
   eligibility gate and sees one complete illustrated outfit. No account or permissions precede
   the outfit. An eligible empty member can see a look in Home without entering guided setup.
   Use the shared sample selector to make the first displayed look and its alternatives
   deterministic and testable without a wardrobe or external service.
2. **Change the look.** **Try another look** visibly changes the composition, title and its
   explanation together. Keep a per-piece **Swap** near the garment, with a clearly marked
   current piece and undo. After the first change, give **Add one garment** the primary
   continuation position for an eligible empty member and leave **Try another look** available.
   Keep the sample visible while the user decides.
3. **Set city if useful.** From a member sample with no saved city, open existing city search
   with explicit confirm, Cancel and Back. Return to the same look after cancel or a failed save.
   After a confirmed primary city save, request the live outfit and weather. Keep the labeled
   sample available during loading or failure. Only replace it when usable live data arrives.
   The same missing-city fallback applies to a returning member, with the closet still one tap away.
   [Web location settings](../../apps/web/src/app/components/locations/locations-section.tsx) /
   [Native location entry](../../apps/mobile/app/locations.tsx).
4. **Bridge guest to member.** The guest can keep exploring or choose **Add your own garment**.
   Explain that adding requires an account and that samples stay in the preview. Keep CC-6.16's
   verified session, comfort review, consent routing and local expiry. For this explicit garment
   intent, after the review and authorization, propose landing at the Wardrobe Hub's add entry
   with a clear **Add one garment** action. Keep the default conversion destination for existing
   entry points. A canceled signup or sign-in returns to the same sample inside its validity
   window. After successful conversion, member Home shows its own sample or live state.
5. **Add one real item.** The member enters the existing capture flow, chooses a file or camera,
   reviews the image and confirms. Show upload and processing progress, then confirm the
   minimum supported tags. Show the saved garment in Wardrobe as soon as that state is confirmed.
   Offer **Back to today's outfit** as the next action. Surface the item in an outfit only when
   the real recommendation includes it. A completed first garment is a persisted item with
   confirmed tags, distinct from a processing upload and from completion of guided setup.
   Keep pre-upload work in the current flow. Leaving with unsaved edits offers **Keep editing**
   or **Discard**. Reopening Wardrobe after a confirmed upload shows the processing garment
   and its next action. An account change clears private drafts and results.

## Acceptance criteria

- **AC1. Find the payoff** At 390 x 844 in the default locale, signed-out Home's first viewport
  contains an understandable sample teaser and **Try a sample look** as its sole primary action.
  After eligibility, the outfit title, example weather and **Try another look** lead the initial
  screen. At 320 px or large text, order stays intact and content scrolls without clipping or
  horizontal page overflow.

- **AC2. Change and recover** Another result changes the look and explanation together. A valid
  swap changes the selected piece and its explanation and can be undone. If there is no
  alternative, keep the current look and explain. If feedback leaves no matching look, offer
  **Review choices** and **Reset choices**. An expired, invalid or incompatible guest snapshot
  leads back to the gate.

- **AC3. Know what is real** Example weather and outfits are labeled together wherever they appear,
  including fallback. A guest interaction uses only the sample catalog and the existing guest
  telemetry boundary. No real member data is created by samples. Only verified live data can be
  presented as a live forecast or member recommendation, and only an eligible real source can
  launch share.

- **AC4. Set city without losing the look** With no saved city, an eligible member can ignore **Set
  your city**, search, dismiss, confirm a result or retry a failure. Search with zero results
  offers an editable query. Save failure retains the candidate and sample, and retry reads back
  ambiguous saves before repeating a write. Successful save uses the selected primary city and
  updates Home when the live fetch succeeds.

- **AC5. Recover from session and service delays** Slow session restoration avoids the sign-in
  flash and retains a known session across a transient failure. Retry returns to the correct member
  or guest state when resolved. Outfit, Wardrobe and Community each distinguish loading, confirmed
  empty and error. Wardrobe only shows "No garments added yet" after a successful zero-item read.
  Show a retry for a failed first load and keep owned last-known content on refresh failure,
  labeled when stale. When there is no usable outfit and the fetch fails, show an example with a
  distinct live-outfit Retry. A filtered Community feed with zero results offers **Clear filters**.
  Preserve the existing unavailable state when Community is gated. Ignore late responses after
  navigation, owner changes or a newer request.

- **AC6. Add and resume one garment** An authorized empty member can add one fixture garment and
  confirm tags through the existing capture path without completing silhouette or guided setup.
  Request permissions only after the relevant source action. Denial offers available alternatives.
  A recoverable upload or tag failure retains the user's work and retries the failed step without
  duplicate garments. If an item is already committed or still processing, resume that item. If
  processing fails terminally, explain and offer a supported recovery.

- **AC7. Respect authorization and conversion** Under-13 visitors remain blocked. Guardian-pending
  members see their existing consent state and cannot enter restricted capture or publishing.
  Eligible members retain existing allowance, privacy and access rules. Conversion applies only
  confirmed comfort settings. Neither a sample interaction nor an early capture emits completed
  activation or guided-onboarding telemetry.

- **AC8. Preserve navigation and returning utility** Back or Cancel closes the active overlay first
  and restores focus to its opener. In-app Back returns to the previous surface with safe draft or
  look state. Native system Back and browser history behave predictably. A direct link has a safe
  fallback to Home, or to Wardrobe from its child routes. Profile and Wardrobe provide obvious Home
  navigation, and Capsules provides **Back to Wardrobe**. Member Home exposes Community and Plan
  week in one action without scrolling through setup.

- **AC9. Verify accessibility and locales** Check touch targets against the existing 44 px/pt
  minimum, accessible garment and action names, readable large text, focus and live status,
  keyboard, reduced motion, screen-reader behavior and all current locale catalogs. Verify loading
  and error messages remain actionable with long translations. Preserve existing Premium, Community
  and moderation controls.

## Functional follow-ups from the production walk

Use separate defects and verification results. The walkthrough captured visible outcomes. HTTP
status, response shape, request IDs, active location and root cause were unavailable.

### Planner fails after Retry

**Reproduction.** Signed in on desktop Chrome at `couture-cast-web.vercel.app` with complimentary
Premium. From **Home > Plan week**, the **7-Day Outfit Planner** opened and showed **Unable to load
the outfit planner**. One **Retry** led to the same error.

**Verify the fix.** In a controlled environment, use an equivalent entitled fixture with a
confirmed primary city and compare the no-city, offline/transient and unentitled cases. Inspect the
response status and error category for `GET /api/v1/commerce/premium/planner`. Verify a seven-day
response renders ready and per-day states, a transient failure followed by Retry renders the
recovered week, and expected lock or missing-city states are actionable. Check desktop rail and
narrow overlay. [Planner client](../../apps/web/src/lib/planner.ts) /
[Planner rail](../../apps/web/src/app/components/planner-rail.tsx).

### Outfit-card source unavailable

**Reproduction.** In the same desktop session, **Home > Create my outfit card** briefly showed
**Preparing card**, then **This source is unavailable**. No card creation or sharing was observed.

**Verify the fix.** With a fixture that has an eligible real recommendation, verify the launcher
gets a usable ritual, exposes the scenario's source, prepares a preview and can export a card.
Verify retry recovers from transient source or render failure. Reproduce missing city, unavailable
recommendation, example-only and unauthorized cases with correct next steps. Capture whether
failure is at `GET /api/v1/ritual` or `POST /api/v1/share-cards/prepare`.
[Share launcher](../../apps/web/src/app/components/ritual-share-card-launcher.tsx) /
[Share dialog](../../apps/web/src/app/components/share-card-dialog.tsx).

The Home health claim is static copy in this checkout. Remove it from the first-run surface.
If a product status is shown, scope it to a measured capability and timestamp so it can reflect
current evidence. The fixed example city's label and Community's observed empty result are
independent of both functional issues.

## Uncoached phone usability plan

- Recruit about six people, three teens aged 13-17 and three adults, including a returning adult.
  Obtain adult consent and parent or guardian permission plus teen assent before the session.
  Participation is voluntary and can stop at any time. The organizer handles consent separately.
  Keep research notes to coarse cohort and anonymous session number. Collect no names, exact
  ages, locations, account identifiers, photos, recordings or personal wardrobe information.
- Use phones and an isolated build or interactive prototype. Provide a synthetic eligibility
  input on a task card if needed, a disposable member state and the same neutral garment image
  preloaded on each phone. Simulate the sign-in handoff in the prototype and mark that step in
  the notes. Use a fresh state for each run. Where both current and proposed flows are available,
  vary the order across participants and interpret second-run results with practice in mind.
- Start at guest Home. Say **"See if you can find a look you'd wear."** Observe the first tap,
  time to first outfit, alternate or swap behavior, when they recognize a wearable look, and any
  abandonment point or reason. After completion or a predefined two-minute observation window,
  ask what they would do next before mentioning another look. Record spontaneous repeat actions
  separately from their answer to **"Would you try another look?"**
- Start an empty member task with **"Add one item of clothing you could use here."** Let the
  participant find the control, select the provided image and finish tagging without clues.
  Record time, backtracking, permission confusion, point of abandonment and whether they can
  tell the item was saved. If using a prototype, success measures navigation and comprehension.
  Have the returning participant start with a populated fixture and check whether they can
  find today's outfit, Planner and Community and return Home without guidance.
- Use `completed unprompted`, `completed after help`, `stopped` or `blocked by the build`
  per task. Record counts and reasons across both cohorts. Ask which outfit or wording caused
  hesitation and what they thought the weather label meant. Treat this small sample as directional.
  If people reach the sample quickly but reject the styling, test the catalog's range. If they
  struggle before seeing it, revise the entry and action hierarchy. If a returning user loses a
  daily action, revise member navigation before expanding the first-run work.

## Delivery order

1. Prototype the guest entry and the first look action using the existing sample selector.
   Compare the current and proposed phone flows. Keep the choice of primary action provisional
   until the uncoached sessions show what participants actually tap.
2. Specify and implement the empty-member bridge, city placement and one-garment capture
   continuation against isolated accounts and existing permissions. Verify states on web and
   native with empty, partially onboarded, guardian-pending and populated fixtures.
3. Triage and verify Planner and outfit-card failures independently. Run guest/account boundaries,
   returning navigation and first garment recovery through the existing
   [Playwright guest suite](../../playwright/tests/guest-preview.spec.ts),
   [wardrobe onboarding suite](../../playwright/tests/wardrobe-onboarding-flow.spec.ts),
   [planner suite](../../playwright/tests/planner.spec.ts) and
   [share-card suite](../../playwright/tests/share-card-export.spec.ts) as applicable.
