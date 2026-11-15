# Tea615 Review — Round 52 (f49027e4..13688db2)

- **Branch / HEAD**: `feat/story-6-15-step0-r49` at `13688db2d6923f835c2c0e32edfc0d40ef48c362` (`docs(story-6-15): close Step 55 as done with PRs #226 and #229`)
- **Review Range**: `f49027e4..13688db2` (`8` commits across `15` code/test files and `3` documentation/status files; `671` insertions, `82` deletions)
- **Shared Checkout Integrity**: `/Users/murat/opensource/cc/couture-cast-wt-615` kept strictly read-only (`git status --short` empty); all probes and mutation tests executed in detached worktree `/tmp/wt-615-mutant-r52` and pruned after completion.
- **Verification Counts**:
  - `npx tsc -p apps/mobile/tsconfig.json --noEmit` -> exit `0`
  - `node --test scripts/ci/font-scale-reads.test.mjs scripts/lib/live-font-capture.test.mjs scripts/lib/live-font-pages.test.mjs scripts/lib/live-font-scale-proof.test.mjs scripts/lib/live-font-text-probe.test.mjs scripts/lib/maestro-ios-driver-port.test.mjs` -> `304 passed, 0 failed` (`33` suites)
  - `swift test --package-path apps/mobile/modules/text-layout-probe/ios` -> `86 passed, 0 failed` (`0.034s`)
  - `gradle -p apps/mobile/modules/text-layout-probe/android/unit-tests testDebugUnitTest` + `junit-report-check.mjs` -> `105 passed, 0 failed` (`TextLayoutSnapshotTest`: `76`, `TextLayoutProbeWireTest`: `29`)
  - Codex security diff scan (`f49027e4..13688db2`) -> `0` reportable security vulnerabilities (`/private/tmp/codex-security-scans/couture-cast-wt-615/13688db2_r52/report.md`)

---

## Findings Summary

| ID       | Priority | Location                                                                                                                                                                                                                                                | Title                                                                                                                                                                                                                                                                          |
| :------- | :------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P2-1** | **P2**   | `apps/mobile/modules/text-layout-probe/android/src/main/java/expo/modules/textlayoutprobe/TextLayoutSnapshot.kt:525-547`, `apps/mobile/modules/text-layout-probe/ios/TextLayoutProbeWire.swift:465-487`, `scripts/lib/live-font-text-probe.mjs:750-756` | `scrollViewport` widens `y` by outer vertical scroll travel, breaking `overflowRegionOf` when a horizontal carousel straddles or scrolls past an outer `ScrollView` edge                                                                                                       |
| **P2-2** | **P2**   | `scripts/lib/live-font-pages.mjs:137-155`, `scripts/lib/live-font-capture.mjs:487-508`                                                                                                                                                                  | `attachPages` calls `stitchPages` without `records`, throwing `live_font_scroll_short_drag_unconfirmed` or duplicating clamped card text on short final drags                                                                                                                  |
| **P2-3** | **P2**   | `scripts/lib/live-font-scale-proof.mjs:1420-1495`                                                                                                                                                                                                       | `recordTexts` and `lostText` miss `2 -> 1` cross-page text drops under three counterexamples: false `sticky` collapse one drag step apart, all-page `scrolledAway` copy in `settled`, and many-to-one `.some()` copy matching                                                  |
| **P2-4** | **P2**   | `scripts/lib/live-font-text-probe.mjs:1033-1058`                                                                                                                                                                                                        | `hiddenOwner` only checks containment against identified elements in `answer.elements`, so an unlabelled `<View testID>` or unidentified accessible card still lets a neighboring card steal its hidden badge, and tied-area holders suppress `live_font_text_probe_ambiguous` |
| **P3-1** | **P3**   | `scripts/lib/maestro-ios-driver-port.mjs:215-232`                                                                                                                                                                                                       | Exhausting all `4` `MARKER_GENERATIONS` with dead takeover markers leaves the dead marker files on disk and permanently bricks that port across future runs                                                                                                                    |

---

## Detailed Findings

### [P2-1] `scrollViewport` widens `y` by outer vertical scroll travel, breaking `overflowRegionOf` when a horizontal carousel straddles or scrolls past an outer `ScrollView` edge

- **Location**:
  - `apps/mobile/modules/text-layout-probe/android/src/main/java/expo/modules/textlayoutprobe/TextLayoutSnapshot.kt:525-547`
  - `apps/mobile/modules/text-layout-probe/ios/TextLayoutProbeWire.swift:465-487`
  - `scripts/lib/live-font-text-probe.mjs:750-756`
- **Failure Scenario**:
  In both `TextLayoutSnapshot.scrollViewport` (Kotlin lines `531-545`) and `TextLayoutProbeWire.scrollViewport` (Swift lines `470-485`), the loop walks ancestors from outermost to innermost and calls `y = widen(y, level.scrollY, scaleY)` at the end of each ancestor iteration (`line 544` in Kotlin, `line 484` in Swift).
  When an outer vertical `ScrollView` (`page`, `box = [0, 200, 1080, 2200]`, `scrollY = (0, 3600)`) contains an inner horizontal `ScrollView` (`carousel`, `scrollX != null`), the outer `ScrollView`'s iteration first narrows `y` to `[200, 2200]` and immediately widens `y` across the outer `ScrollView`'s entire vertical scroll travel (`[200 - offset, 3800 - offset]`) before visiting `carousel`. As a result, `carousel`'s `scrollViewport` is **not** clipped vertically by the outer `ScrollView`'s visible viewport `[0, 200, 1080, 2200]` (only by `windowRect`):
  1. **Missed volatile classification (`scrolled` / `offscreen` instead of `volatile`)**: When `carousel` (`[0, 2140, 1080, 2300]`) straddles the bottom edge of `page` (`[0, 200, 1080, 2200]`), the accessibility hierarchy clips `volatileRegions[0]` to what is visible inside `page` (`[0, 2140, 1080, 2200]`). Because `widen` expanded `y` to `[200, 3800]`, `scrollViewport` is `[0, 2140, 1080, 2300]` whose vertical centre is `(2140 + 2300) / 2 = 2220 > 2200`. `overflowRegionOf` returns `-1` and classifies every sideways-scrolled chip in that carousel as `'scrolled'` (`offscreen`) instead of `'volatile'`.
  2. **False volatile capture (`volatile` instead of `scrolled`)**: When `page` scrolls a non-volatile horizontal carousel above `page`'s top clip `y = 200` to screen `y = 40..160` (where `page` clips it out of sight, `visibleRect = null`), `widen` keeps `y = [-400, 3200]` so `scrollViewport` is `[0, 40, 1080, 160]`. If a sticky header volatile region occupies `[0, 40, 1080, 160]` above `page`, `overflowRegionOf` falsely attaches the hidden carousel's sideways-scrolled records to that header volatile region.
- **Probe Evidence**:
  ```js
  // Probe3a: Carousel [0, 2140, 1080, 2300] straddling bottom of outer vertical ScrollView [0, 200, 1080, 2200];
  // hierarchy volatileRegions[0] is clipped to [0, 2140, 1080, 2200].
  matchTextProbe({
    platform: 'android',
    nodes: [],
    answer: {
      windowRect: [0, 0, 1080, 2400],
      windows: [],
      elements: [],
      records: [
        {
          text: 'Sunny 24°',
          viewRect: [1220, 2160, 1460, 2210],
          rect: [1220, 2160, 1460, 2210],
          visibleRect: null,
          hidden: false,
          alpha: 1,
          scale: [1, 1],
          scrolledAway: true,
          scrollViewport: [0, 2140, 1080, 2300],
          clippedAxes: [],
          lines: ['Sunny 24°'],
        },
      ],
    },
    volatileRegions: [[0, 2140, 1080, 2200]],
  })
  // Observed output:
  // Probe3a.carousel_straddling_outer_scroll_bottom: { kinds: [ 'scrolled' ], volatile: [], offscreen: [ 0 ] }
  // Probe3b.non_volatile_carousel_scrolled_under_header_volatile: { kinds: [ 'volatile' ], volatile: [ { record: 0, region: 0 } ], offscreen: [] }
  ```
- **Fix Direction**:
  Do not call `widen(x, ...)` / `widen(y, ...)` in `scrollViewport` (`TextLayoutSnapshot.kt:543-544`, `TextLayoutProbeWire.swift:483-484`), or also intersect `x` and `y` with clipping ancestors below the horizontal scroll view so `scrollViewport` represents the actual visible on-screen viewport of the horizontal scroll container clipped by every outer clipper (including outer vertical `ScrollView`s) and the window.

---

### [P2-2] `attachPages` calls `stitchPages` without `records`, throwing `live_font_scroll_short_drag_unconfirmed` or duplicating clamped card text on short final drags

- **Location**:
  - `scripts/lib/live-font-pages.mjs:137-155`
  - `scripts/lib/live-font-capture.mjs:487-508`
- **Failure Scenario**:
  `stitchPlaces` (`scripts/lib/live-font-capture.mjs:487-504`) and `pageCaptures` (`scripts/lib/live-font-scale-proof.mjs:393-398`) pass `records: pages.map((page) => page.textProbe?.records ?? [])` so that unclamped probe `viewRect`s measure each drag step alongside hierarchy `nodes` (which Android `AccessibilityNodeInfo` clamps to the viewport).
  However, `attachPages` (`scripts/lib/live-font-pages.mjs:147-150`), which `scrollThrough` (`line 119`) calls during capture before `pageCaptures` ever runs, calls `stitchPages` **without `records`**:
  ```js
  capture.fullText = stitchPages(
    pages.map((page) => page.nodes),
    { expectedShift, reachedBottom }
  )
  ```
  Combined with the new `r52` `shortFinalStep` check (`texts.size < 2` when `reachedBottom === true`), this breaks `attachPages` in two concrete cases when a scroll-through reaches the bottom on a short final drag:
  1. **Unconfirmed abort (`Probe 2a`)**: If `2` distinct texts move by the short final step (`180px`), where `"Row A"` is fully inside the viewport in both hierarchy `nodes` and `textProbe.records` while `"Row B"` is clamped at the viewport bottom in hierarchy `nodes` (`[0, 760][200, 800]` on page 1 -> `[0, 580][200, 640]` on page 2, height `40` vs `60`) and unclamped in `textProbe.records` (`[0, 760, 200, 820]` -> `[0, 580, 200, 640]`), `stitchPlaces` with `records` succeeds (`offsets: [0, 600, 780]`), whereas `attachPages` sees only `1` moving hierarchy text (`"Row A"`) and **throws `live_font_scroll_short_drag_unconfirmed: final drag of 180 px measured by 1 text`**, aborting `scrollThrough`.
  2. **Silent text duplication (`Probe 2b`)**: If all moving cards on the penultimate page have hierarchy `nodes` clamped by the viewport (e.g. `"Card A"` top-clamped and `"Card B"` bottom-clamped), `attachPages` sees `0` hierarchy anchors on the last drag, `shortFinalStep` returns `null`, and `attachPages` falls back to `expectedShift` (`600px` instead of `180px`), duplicating `"Card A"` and `"Card B"` in `capture.fullText`.
- **Probe Evidence**:
  ```js
  // Observed output from Probe 2a and Probe 2b:
  // Probe2.attachPages_omits_records: {
  //   withRecordsOffsets: [ 0, 600, 780 ],
  //   attachErr: 'live_font_scroll_short_drag_unconfirmed: final drag of 180 px measured by 1 text'
  // }
  // Probe2b.attachPages_duplicates_clamped_cards: {
  //   withRecordsFullText: [ '["","Top"]', '["","Mid"]', '["","Card A"]', '["","Card B"]' ],
  //   attachedFullText: [ '["","Top"]', '["","Mid"]', '["","Card A"]', '["","Card B"]', '["","Card A"]', '["","Card B"]' ]
  // }
  ```
- **Fix Direction**:
  Pass `records: pages.map((page) => page.textProbe?.records ?? [])` to `stitchPages` in `attachPages` (`scripts/lib/live-font-pages.mjs:147-150`) so `attachPages` and `pageCaptures` use identical anchor sets.

---

### [P2-3] `recordTexts` and `lostText` miss `2 -> 1` cross-page text drops under three counterexamples

- **Location**: `scripts/lib/live-font-scale-proof.mjs:1420-1495`
- **Failure Scenario**:
  Commit `e4e94b51` replaced per-page `Math.max` in `recordTexts` with cross-page deduplication using `sticky(entry)`, `sameScreen(copy, entry)`, and `sameCopy(copy, entry)`, and kept `lostText` comparing `recordTexts(cold, platform, true)` against `recordTexts(live, platform, false)`. Three concrete failure modes allow a `2 -> 1` copy loss in `settled` to pass with `lost: []`:
  1. **Counterexample A — False `sticky(entry)` collapse when two scrolling copies sit one drag step (`SHIFT`) apart (`lines 1453-1455`)**:
     `sticky(entry)` checks `every.every((list) => list.some((other) => sameScreen(other, entry)))`. On a 2-page capture (`SHIFT = 1200`), if Copy 1 of `'Save'` sits at `y = 300..340` on page 0 (moving to `y = -900..-860` on page 1) and Copy 2 of `'Save'` sits one drag step lower at `y = 1500..1540` on page 0 (`scrolledAway: true` on page 0, moving into view at `y = 300..340` on page 1), both `every[0]` (via Copy 1) and `every[1]` (via Copy 2) contain a `'Save'` record at screen `[40, 300, 200, 340]`. `sticky(Copy 2)` returns `true` and merges Copy 2 (`content y = 1500`) into Copy 1 (`content y = 300`) via `sameScreen`, counting `1` copy in `cold` instead of `2`. When `settled` drops Copy 2 completely, `textLost` returns `pass: true, lost: []`.
  2. **Counterexample B — Copy 2 stays `scrolledAway: true` (`visibleRect: null`) on every page of `settled` (`lines 1447-1449, 1491`)**:
     `lostText` calls `recordTexts(live, platform, false)` (`compared = false`), which includes `'scrolled'` records in `now`, on the assumption that `hiddenText` will catch any unrendered copy. However, `hiddenText` (`line 1383`) only inspects `invisible`, `offWindow`, `elements`, and `groups`—never `'scrolled'`. When font scaling pushes Copy 2 below the bottom of the scroll range or past a horizontal clip so Copy 2 has `visibleRect: null, scrolledAway: true` on **every** page of `settled` (never visible on any page), `recordTexts(settled, 'android', false)` still counts `2` copies while `hiddenText` ignores `'scrolled'`, so both `textLost` and `textHidden` return `pass: true`.
  3. **Counterexample C — Many-to-one `.some()` in `recordTexts` collapses two distinct copies on page 1 into a single copy from page 0 (`lines 1466-1472`)**:
     Each entry on a later page checks `copies.slice(0, before).some(...)` without consuming matched copies from `copies.slice(0, before)` and with a permissive `±tolerance` (`±4px`) box overlap in `sameCopy`. If page 0 has `1` compared `'Save'` at `content = [40, 300, 200, 340]` (while a second adjacent `'Save'` chip was sideways-scrolled on page 0) and page 1 shows `2` compared `'Save'` chips at `[40, 300, 120, 340]` and `[120, 300, 200, 340]` that both overlap page 0's single `copies[0]` entry within `tolerance`, both match `copies[0]` and neither is added, yielding `recordTexts = 1` on a capture where page 1 alone has `2` compared copies.
- **Probe Evidence**:
  ```js
  // Observed outputs against 13688db2:
  // CounterexampleA.sticky_false_positive_1_step_apart: { pass: true, lost: [] }
  // CounterexampleB.settled_copy2_scrolledAway_on_all_pages: {
  //   textLost: { pass: true, lost: [] },
  //   textHidden: { pass: true, hidden: [] }
  // }
  // CounterexampleC.many_to_one_some_collapse: {
  //   textLost: { pass: true, lost: [] }
  // }
  ```
- **Fix Direction**:
  - In `lostText` (`line 1491`), count only records that are either in `COMPARED_KINDS` on at least one page or in the classes checked by `hiddenText` (`invisible`, `offWindow`, `hidden-attached`), so a copy that is `'scrolled'` on _every_ page of `live` is not credited as present.
  - In `recordTexts` (`lines 1453-1473`), a record that moved by the page shift is not `sticky` (exclude records whose shifted `content` matches a copy on another page from `sticky`, or require the same view instance / non-scrolling ancestor), and match at most one entry per page against each prior copy in `copies.slice(0, before)` (one-to-one matching, so `recordTexts` is never smaller than the single-page compared count `Math.max(...placed.map(p => count(p)))`).

---

### [P2-4] `hiddenOwner` only checks containment against identified elements in `answer.elements`, so an unlabelled `<View testID>` or unidentified accessible card still lets a neighboring card steal its hidden badge, and tied-area holders suppress `live_font_text_probe_ambiguous`

- **Location**: `scripts/lib/live-font-text-probe.mjs:1033-1058`
- **Failure Scenario**:
  Commit `a302d93d` updated `hiddenOwner` to check whether any entry in `identified = elements.filter(({ element }) => element.identifier !== null)` contains `rect` (`holders`), and if so, restrict ownership to `holders`:
  ```js
  const holders = best(
    identified.filter(({ element }) => contains(element.rect, rect, tolerance)),
    ({ element }) => area(element.rect)
  )
  const reach = bordersReach(record, rect, tolerance)
  const nearest = holders.length
    ? holders.every(({ element }) => holdsWords(normalized(element.label), text))
      ? holders
      : []
    : best(...)
  ```
  Two concrete bugs remain:
  1. **Unlabelled or unidentified holding card (`Probe 4a`)**: Native `answer.elements` only records views that have a non-empty accessibility label (`TextLayoutSnapshot.kt:347`, `TextLayoutProbeWire.swift:267`), and `identified` further filters out elements with `identifier === null`. In React Native, a normal card container `<View testID="card-2">` without an `accessibilityLabel` (where its title `'Winter coat'` is a child `<Text>`) is absent from `answer.elements`, and an accessible card `<Pressable accessibilityLabel="Winter coat">` without a `testID` has `identifier: null`. In both cases, `holders` is `[]`, so `hiddenOwner` falls through to the `16px` border reach (`best(...)`) and lets neighboring `card-1` (`14px` above `card-2`) steal `card-2`'s `accessibilityElementsHidden` `'Archived'` badge (`pass: true, hiddenAttached: [{ record: 2, element: 0, node: 0 }]`).
  2. **Tied equal-area holders where only one has `holdsWords` (`Probe 4b`)**: When two equal-area identified elements both contain `rect` (`holders.length === 2`), `holders.every(({ element }) => holdsWords(...))` returns `false` whenever one holder's label contains `text` and the other's does not, collapsing `nearest` to `[]` (`return null`) instead of filtering `holders` to matching holders or returning `ambiguous`. When two equal-area holders both contain `rect` and one (or neither) matches, or when `record.hidden` is `false` and `record` is `scrolled`, returning `null` suppresses `live_font_text_probe_ambiguous`.
- **Probe Evidence**:
  ```js
  // Probe 4a: Card 1 (id="card-1", label="Summer Linen Jacket, Archived", rect=[16, 100, 386, 180])
  // sits 14px above Card 2 (rect=[16, 192, 386, 272]), where Card 2 is either an unlabelled
  // <View testID="card-2"> (absent from answer.elements) or an accessible card with identifier: null,
  // and Card 2 has an accessibilityHidden "Archived" badge at [20, 194, 100, 212]:
  // Observed output:
  // Probe4a.unidentified_holder_card2_stolen_by_card1: {
  //   pass: true,
  //   code: null,
  //   hiddenAttached: [ { record: 2, element: 0, node: 0 } ]
  // }
  //
  // Probe 4b: Two overlapping equal-area identified elements [16, 100, 386, 180] hold "Archived",
  // one with label "Summer Linen Jacket, Archived" and one with label "Summer Linen Jacket":
  // Observed output:
  // Probe4b.tied_equal_area_holders_one_matching: {
  //   pass: false,
  //   code: 'live_font_text_probe_unmatched', // instead of attaching to the matching holder or flagging ambiguous
  //   ambiguousRecords: []
  // }
  ```
- **Fix Direction**:
  - Check containment against all elements in `answer.elements` (including `identifier === null`) as well as non-matching hierarchy container `nodes` that hold `rect`, so a badge inside another card's box cannot jump across the gap to a neighboring card.
  - When `holders.length > 0`, filter `holders` by `holdsWords(normalized(element.label), text)` (rather than `holders.every(...)`) so that a single word-matching holder wins and multiple word-matching holders report `ambiguous`.

---

### [P3-1] Exhausting all `4` `MARKER_GENERATIONS` with dead takeover markers leaves the dead marker files on disk and permanently bricks that port across future runs

- **Location**: `scripts/lib/maestro-ios-driver-port.mjs:215-232`
- **Failure Scenario**:
  In `takeOver` (`lines 215-232`), when an existing lock file `raw` belongs to a dead PID, each takeover attempt loops `generation = 0..3` (`MARKER_GENERATIONS = 4`):
  ```js
  for (let generation = 0; generation < MARKER_GENERATIONS; generation += 1) {
    const marker = path.join(reservations, `${base}.${generation}`)
    if (!place(markerTemporary, marker)) {
      const other = readOrNull(marker)
      if (other === null || liveRecord(parsed(other), token)) return false
      dead.push(marker)
      continue
    }
    ...
  }
  return false
  ```
  `dead` markers are only unlinked inside the `if (place(markerTemporary, marker))` success branch (`line 226`). If `4` consecutive takeover processes die (e.g., `SIGKILL` / CI timeout) after placing `.0`, `.1`, `.2`, and `.3` before reaching `renameSync(temporary, lock)`, every subsequent runner sees all `4` generations occupied by dead PIDs, pushes all `4` into `dead`, exits the loop at `line 232`, and returns `false` **without unlinking any entry in `dead`**. From that point on, `<port>.json` and `<port>.takeover.<hash>.0..3` remain on disk forever and `io.reserve(port, device)` permanently returns `false` for that port until `/tmp/couture-cast-maestro/ios-driver-ports` is manually wiped.
- **Probe Evidence**:
  ```js
  // Observed output from Probe 1:
  // Probe1.4_dead_generations_brick_port: {
  //   reserved: false,
  //   remainingFiles: [
  //     '17205.json',
  //     '17205.takeover.57a9a60ae072754d.0',
  //     '17205.takeover.57a9a60ae072754d.1',
  //     '17205.takeover.57a9a60ae072754d.2',
  //     '17205.takeover.57a9a60ae072754d.3'
  //   ]
  // }
  ```
- **Fix Direction**:
  When all `MARKER_GENERATIONS` markers for `raw` are confirmed dead (`dead.length === MARKER_GENERATIONS`), unlink `dead` before returning `false` so the next attempt in `reserve` (`attempt < 3`) can place generation `0` and recover the port.

---

## r49 Findings Closure Table

| r49 ID       | Priority | Original Summary                                                                                                                                                                                                               | r52 Status                     | Verification Evidence on `13688db2`                                                                                                                                                                                                                                                                                                                                                      |
| :----------- | :------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **r49 P2-1** | P2       | `hiddenOwner` 16px border fallback lets an adjacent card steal an `accessibilityHidden` badge (`scripts/lib/live-font-text-probe.mjs`)                                                                                         | **PARTIAL**                    | Original probe with Card 2 in `answer.elements` (`identifier: 'card-2'`): `{ pass: false, code: 'live_font_text_probe_unmatched', unmatchedRecords: [ 2 ], hiddenAttached: [] }`. Still **OPEN** when Card 2 is an unlabelled `<View testID="card-2">` or has `identifier: null` (**P2-4** above).                                                                                       |
| **r49 P2-2** | P2       | `overflowRegionOf` fails when a horizontal carousel has right padding or a half-cut chip at the window edge (`scripts/lib/live-font-text-probe.mjs`, `TextLayoutSnapshot.kt`, `TextLayoutProbeWire.swift`)                     | **PARTIAL**                    | Original `paddedMiss`, `halfCutScrolled`, and `falseVolatile` probes pass (`volatile: [{ record: 0, region: 0 }]`, `falseVolatile -> kinds: ['scrolled']`). Still **OPEN** when a carousel straddles or scrolls past an outer vertical `ScrollView` clip because `scrollViewport` widens `y` by outer vertical scroll travel (**P2-1** above).                                           |
| **r49 P2-3** | P2       | `reserve` takeover protocol has 3 concurrency bugs: dead `.takeover.*` marker bricks port, TOCTOU between `read() !== raw` and `renameSync`, and same-PID overwrite (`scripts/lib/maestro-ios-driver-port.mjs`)                | **CLOSED** (with P3 edge case) | `3b.dead_marker_left_behind`: `{ res: true, holder: { device: 'DEV-A', pid: 101 }, files: [ '17205.json' ] }`; `3c.same_pid_overwrite`: `{ r1: true, r2: false, holderDevice: 'DEV-1' }`; `3d.toctou_between_read_and_rename`: `{ reads: 3, resTakeover: true, resLive: false, finalHolder: { device: 'DEV-A', pid: 101 } }`. Residual 4-dead-generation exhaustion tracked as **P3-1**. |
| **r49 P2-4** | P2       | `shortFinalStep` accepts 1-anchor chance match, sticky-header jitter on last page, and non-bottom final drag (`scripts/lib/live-font-capture.mjs`, `scripts/lib/live-font-pages.mjs`, `scripts/lib/live-font-scale-proof.mjs`) | **PARTIAL**                    | Original `4a`..`4d` probes pass (`4a`: throws `live_font_scroll_short_drag_unconfirmed`, `4b`: `offsets: [0, 600, 800]`, `4c`: `offsets: [0, 600, 1200]`, `4d`: `offsets: [0, 600, 1200]`). However, `attachPages` in `live-font-pages.mjs:147-150` omits `records` when calling `stitchPages`, breaking short final drags when hierarchy nodes are viewport-clamped (**P2-2** above).   |
| **r49 P2-5** | P2       | AST guard `nameOf` misses parenthesized, concatenated, template, and identifier-computed `fontScale` keys (`scripts/ci/font-scale-reads.test.mjs`)                                                                             | **CLOSED**                     | All 5 r49 probe fixtures (`paren-bracket.ts`, `destructure-paren-computed.ts`, `concat-bracket.ts`, `template-expr.ts`, `var-key.ts`) are flagged (`paren-bracket.ts:1:8 fontScale`, `destructure-paren-computed.ts:1:25 fontScale`, `concat-bracket.ts:1:8 fontScale`, `template-expr.ts:1:8 <unverifiable-key>`, `var-key.ts:2:8 fontScale`).                                          |
| **r49 P3-1** | P3       | `recordTexts` uses `Math.max` per page instead of cross-page content-rect deduplication (`scripts/lib/live-font-scale-proof.mjs`)                                                                                              | **PARTIAL**                    | Original `8b` probe (`far` at `y=1700`, `farOnPage1` at `y=500`) is caught (`{ pass: false, lost: [{ stage: 'settled', text: 'Save' }] }`), but `recordTexts` and `lostText` still miss `2 -> 1` drops under 3 concrete counterexamples (**P2-3** above).                                                                                                                                |
| **r49 P3-2** | P3       | `place` does not handle `EPERM`/`EXDEV`/`ENOTSUP` when `linkSync` is unsupported (`scripts/lib/maestro-ios-driver-port.mjs`)                                                                                                   | **CLOSED**                     | `3e.link_EPERM_unhandled`: `{ caught: { code: 'maestro_driver_port_lock_unsupported', message: 'maestro_driver_port_lock_unsupported: EPERM linking in ...' }, leftoverFiles: [] }`.                                                                                                                                                                                                     |

### Commit `13688db2` Docs Closure Check

- Verified `13688db2` (`_bmad-output/implementation-artifacts/sprint-status.yaml`, `_bmad-output/implementation-artifacts/story-6-15/spec-6-15-expo-sdk58-live-font-scale-layout.md`, `docs/learning-path-step-by-step.md`):
  - PR numbers `#226` (`814ce811`) and `#229` (`f49027e4`) match `git log`.
  - Anchor `#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout` at `docs/learning-path-step-by-step.md:10725` is preserved (`### Step 55: Expo SDK 58 Upgrade for Live Font-Scale Layout`).
  - No test or CI script parses those status fields in a way affected by the update.

---

## Mutation Testing (Detached Worktree `/tmp/wt-615-mutant-r52`)

Executed `12` single-line mutants targeting every r52 guard in `/tmp/wt-615-mutant-r52`, running the corresponding test suite after each mutation and restoring the file immediately:

| Mutant  | File & Line                                       | Mutation                                                                                 | Result       | Killing Test / Survival Reason                                                                                                                                                                                                   |
| :------ | :------------------------------------------------ | :--------------------------------------------------------------------------------------- | :----------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **M1**  | `scripts/lib/live-font-text-probe.mjs:1044`       | `const nearest = holders.length` -> `const nearest = false`                              | **KILLED**   | `an identified element whose frame holds the record decides it`                                                                                                                                                                  |
| **M2**  | `scripts/lib/live-font-text-probe.mjs:1045`       | `holders.every(...)` -> `holders.some(...)`                                              | **SURVIVED** | No test exercises `holders.length > 1` (two equal-area identified holders where only one matches `holdsWords`; see **P2-4**).                                                                                                    |
| **M3**  | `scripts/lib/live-font-text-probe.mjs:751-752`    | `record.scrollViewport` -> `record.clipRect` in `overflowRegionOf`                       | **KILLED**   | `a scrolled-away record joins a region sideways through its scroll viewport`                                                                                                                                                     |
| **M4**  | `scripts/lib/maestro-ios-driver-port.mjs:190`     | `? typeof record.token === 'string' && record.token !== own` -> `? false`                | **KILLED**   | `a lock of this process under another token is live, and only its own io releases it`                                                                                                                                            |
| **M5**  | `scripts/lib/maestro-ios-driver-port.mjs:224`     | `if (readOrNull(lock) !== raw) return false` -> `if (false) return false`                | **KILLED**   | `a stale lock is taken over by one runner only`                                                                                                                                                                                  |
| **M6**  | `scripts/lib/maestro-ios-driver-port.mjs:226`     | Remove `for (const each of dead) files.rmSync(each, { force: true })`                    | **KILLED**   | `a takeover marker whose runner died passes the takeover to the next generation`                                                                                                                                                 |
| **M7**  | `scripts/lib/live-font-capture.mjs:360`           | `if (texts.size < 2)` -> `if (texts.size < 1)`                                           | **KILLED**   | `a short final step needs two agreeing texts, and chrome held still stays chrome`                                                                                                                                                |
| **M8**  | `scripts/lib/live-font-capture.mjs:376`           | `reachedBottom === true` -> `true` in `dragSteps`                                        | **KILLED**   | `takes a short final drag from anchors that agree, and fails when they do not`                                                                                                                                                   |
| **M9a** | `scripts/ci/font-scale-reads.test.mjs:190`        | `if (ts.isIdentifier(node)) return constants.get(node.text) ?? null` -> `if (false) ...` | **SURVIVED** | Returning `null` falls through to `UNVERIFIABLE` (`<unverifiable-key>`), which still fails the guard; no test exercises a safe folded `const KEY = 'width'` or asserts `'fontScale'` vs `'<unverifiable-key>'` for `const` keys. |
| **M9b** | `scripts/ci/font-scale-reads.test.mjs:190`        | `if (ts.isIdentifier(node)) return constants.get(node.text) ?? null` -> `return 'width'` | **KILLED**   | `a font-scale key in parentheses, folded or unverifiable is caught`                                                                                                                                                              |
| **M10** | `scripts/lib/live-font-scale-proof.mjs:1470`      | `sameCopy(copy, entry)` -> `copy.text === entry.text`                                    | **KILLED**   | `R47_F3B: a text gone live inside a composite label group fails as lost text`                                                                                                                                                    |
| **M11** | `scripts/lib/live-font-scale-proof.mjs:1453-1454` | `const sticky = (entry) => pages.length > 1 && ...` -> `false`                           | **SURVIVED** | No unit test in `live-font-scale-proof.test.mjs` exercises `recordTexts` with a sticky record across multiple pages (see **P2-3**).                                                                                              |

---

## Security Scan Result (`codex-security-review`)

- **Scan ID / Bundle**: `13688db2_r52` (`/private/tmp/codex-security-scans/couture-cast-wt-615/13688db2_r52`)
- **Finalized Report**: `/private/tmp/codex-security-scans/couture-cast-wt-615/13688db2_r52/report.md` (`finalize_scan_contract.py` exit `0`)
- **Surfaces Reviewed**: `15` diff-scoped code and test files (`TextLayoutSnapshot.kt`, `TextLayoutSnapshotTest.kt`, `TextLayoutProbeWire.swift`, `TextLayoutProbeWireTests.swift`, `font-scale-reads.test.mjs`, `live-font-capture.mjs`, `live-font-capture.test.mjs`, `live-font-pages.mjs`, `live-font-pages.test.mjs`, `live-font-scale-proof.mjs`, `live-font-scale-proof.test.mjs`, `live-font-text-probe.mjs`, `live-font-text-probe.test.mjs`, `maestro-ios-driver-port.mjs`, `maestro-ios-driver-port.test.mjs`)
- **Findings**: `0` reportable security vulnerabilities.
  - Native probe changes (`TextLayoutSnapshot.kt`, `TextLayoutProbeWire.swift`) perform pure in-memory geometry calculations (`scrollViewport`) serialized as 4-integer arrays in the test-only layout probe response.
  - Port reservation changes (`maestro-ios-driver-port.mjs`) use `randomUUID()` tokens, `sha256` content digests, and `wx` `0o600` files inside a `0o700` directory; the 4-generation dead marker exhaustion (`P3-1`) is a local test-runner availability issue within the same user boundary and does not cross a security or privilege boundary.

---

## TEA rulings (tea615, 2026-11-14)

Every finding was checked against the code at `13688db2` before ruling. The report's metadata is
partly wrong and is kept as Antigravity wrote it: the head is `13688db2ed5b`, not
`13688db2d692`; the range holds 4 commits, not 8; commits `e4e94b51` and `a302d93d` do not exist
(the changes it names are in `5c25a4d5`); the docs live in
`_bmad-output/implementation-artifacts/` and `_bmad-output/project-knowledge/`, not `docs/`.
The findings themselves hold.

Owner rule: r52 is the single local round; every accepted finding is fixed in PR 230 with red
first proof and no re-review of the fixes.

| ID     | Ruling           | Fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| :----- | :--------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P2-1   | Accept, P2       | `scrollViewport` (Kotlin `TextLayoutSnapshot.kt:525`, Swift `TextLayoutProbeWire.swift:465`) widens each outer level by its scroll travel before the inner sideways scroll view narrows, so a carousel cut by an outer vertical scroll view keeps its uncut box. The viewport is where the carousel shows now: narrow by every clipper's on-screen box, outer scroll views' viewports included, and never widen. `reach` keeps its widening. Red first in both native suites with a carousel straddling an outer vertical scroll view's bottom edge, and in the JS matcher the chip joins the volatile region. Update the r49 design line ("outer scroll views' bands included"). |
| P2-2   | Accept, P2       | `attachPages` (`live-font-pages.mjs:147`) stitches without the probe `records` that `pageCaptures` passes, so on a short final drag with viewport-clamped nodes the capture throws `live_font_scroll_short_drag_unconfirmed` or doubles cards. Pass `records: pages.map((page) => page.textProbe?.records ?? [])`. Red first through `attachPages`, plus a test that `attachPages` and `pageCaptures` give the same offsets for one scroll-through.                                                                                                                                                                                                                               |
| P2-3 A | Accept           | `sticky` matches by screen place alone, so two copies one drag apart read as one sticky copy. A record at one screen place on every page is one copy only when no page holds another record of its text at its content place (a moving copy seen again). Residual, recorded in the design doc: a virtualized list that unmounts the far copy stays indistinguishable from a sticky header. Kills M11.                                                                                                                                                                                                                                                                             |
| P2-3 B | Reject           | `scrolled` means within a scroll view's reach (`cuts`/`reach`), so the user can scroll to it; a carousel chip that a larger font pushes past the viewport is still there. Vertically it cannot happen: `scrollPages` reaches the bottom or fails as `live_font_scroll_bottom_unreached`. No change.                                                                                                                                                                                                                                                                                                                                                                               |
| P2-3 C | Accept           | Each later-page entry is matched against earlier copies with `.some()`, so two copies on one page can both match one earlier copy and the count drops below that page's own. Match one to one (an earlier copy pairs with at most one entry per page); the count is never below any page's compared count.                                                                                                                                                                                                                                                                                                                                                                        |
| P2-4 a | Accept           | With no identified element holding the badge, bordering lets a neighbouring card take it even when the badge sits in another card's box (an unlabelled `View testID`, or an accessible card with no identifier). Rule: a record may join a bordering element only when no element (any identifier) and no hierarchy node holds the record without also holding that element. The iOS Home teaser pill and in-app browser caption still join their link and button (their card holds both); the fixtures in `scripts/lib/fixtures/live-font-text-probe-records.mjs` must stay green.                                                                                               |
| P2-4 b | Accept           | Tied smallest holders where only one label holds the words return unmatched. Among the smallest holders, those whose label holds the words win: one owns, several are ambiguous, none leaves it unmatched. Kills M2.                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| P3-1   | Accept           | Four dead takeover generations block that port for good (the candidate loop in `maestro-driver-sync.mjs:201` moves on, but the port stays dead until the reservations directory is wiped). Every dead generation is a crashed runner's leftover and the winner removes them all, so drop the cap of 4: walk generations until one places or a live marker is found, with a large runaway bound that fails as a named error. Removing dead markers outside the winner path would allow two winners, so do not. Red first with five dead generations; the forced-order race tests stay green.                                                                                       |
| M9a    | Accept, test gap | Add a guard test where `const KEY = 'width'` on a dimensions value passes and `const KEY = 'fontScale'` is reported as `fontScale`, so identifier folding is pinned.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

Security lens: 0 reportable findings, matching the scan; P3-1 is a same-user availability issue.
