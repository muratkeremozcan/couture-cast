# F-00i text layout probe: design for TEA review

Updated: 2026-11-14. Story 6.15, TD-01 and F-00i. Learning path Step 55.

## Problem

The live-font capture holds only text and bounds per node, read from the Maestro hierarchy.
`clipping()` in `scripts/lib/live-font-scale-proof.mjs` compares a box with its parent, so a
label whose laid-out text is taller than its visible box passes when the hierarchy rect stays
inside the parent. `composer-008-updated-1.5.png` (Show watermark cut to the top half of Show)
and `settings-008-updated-1.5.png` (Language title cut at the baseline) are real cases with
`structuralPass: true`.

## What is read

A local Expo module, `apps/mobile/modules/text-layout-probe`, reports one record per rendered
text view in every window of the app, at the moment the harness asks:

| Field         | Android                                                         | iOS                                                                                   |
| ------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `text`        | `TextView.getText()`                                            | `RCTParagraphComponentView.attributedText.string`                                     |
| `viewRect`    | the view's rect on screen                                       | the view's frame in window coordinates                                                |
| `visibleRect` | `getGlobalVisibleRect` (already cut by every clipping ancestor) | `viewRect` cut by each ancestor with `clipsToBounds` and by the window                |
| `contentRect` | top padding to `layout.getLineBottom(lineCount - 1)`, on screen | the attributed string's bounding rect at the view's width, unlimited lines, on screen |
| `lineCount`   | `layout.getLineCount()`                                         | lines from a TextKit layout at the view's width                                       |
| `ellipsized`  | sum of `layout.getEllipsisCount(line)`                          | `contentRect` taller than `viewRect`                                                  |

Android text views: `ReactTextView` (an `AppCompatTextView`) and, when React Native's prepared
text layout flag is on (a later SDK may turn it on), `PreparedLayoutTextView`, whose `Layout` is
read from its prepared layout. A text view of any other class is reported with `kind: unknown`
and fails the leg, so a renderer change cannot hide text from the probe.

Windows: Android enumerates `WindowInspector.getGlobalWindowViews()` (API 29+; the proof
emulators are API 32 and 36), so the composer's modal dialog window is read with the Activity;
iOS walks every window of every connected scene.

## How the harness asks and reads

- Android: the module registers a runtime broadcast receiver for
  `com.couturecast.textlayoutprobe.DUMP` with a `token` extra. The harness sends it with
  `adb shell am broadcast -a ... --es token <n> -p <package>`; the app writes the JSON to logcat
  under tag `TextLayoutProbe` in numbered base64 chunks (logcat truncates long lines) and a final
  `done <token> <sha256>` line. The harness reads `adb logcat -d -s TextLayoutProbe`, reassembles
  by token and checks the hash. No storage permission, no `run-as`, so it works on Release.
- iOS: the module observes the Darwin notification `com.couturecast.textlayoutprobe.dump`; the
  harness posts it with `xcrun simctl spawn <udid> notifyutil -p ...` after writing the token to
  the app's `Library/Caches/text-layout-probe/request` through `simctl get_app_container ... data`.
  The app writes `<token>.json` beside it, and the harness polls for it.
- `makeCapture` asks right after its hierarchy read and adds the records to the capture; a missing
  or hash-mismatched answer after three asks fails the leg (`live_font_text_probe_missing`).

## Build gating

The module does nothing unless the build was made with `COUTURE_TEXT_LAYOUT_PROBE=1`, which
`app.config.ts` turns into `extra.textLayoutProbe: true`; the native side reads that once at
startup and registers nothing otherwise. Only `scripts/run-live-font-proof.mjs` builds set it.
Guards: a config spec that the production and preview EAS profiles and the resolved Release
config (`resolved-app-config.mjs`) give `textLayoutProbe: false`; the receiver is registered
`RECEIVER_NOT_EXPORTED` on API 33+ with the broadcast sent to the package (`-p`), and on API 32 it
is registered with a signature-level permission the harness holds through `adb shell` (shell
UID). Alternative if you prefer no production footprint at all: exclude the module from
autolinking unless the variable is set, at the cost of a second native fingerprint for proof
builds.

## How it is judged

Per text node, matched to its hierarchy node by text and overlap with the hierarchy rect:

- `clipped` when `contentRect.bottom > visibleRect.bottom + tolerance` or
  `contentRect.top < visibleRect.top - tolerance` (2 px Android, 1 pt iOS), or when `ellipsized`
  is larger than at the cold launch at the same scale. A label the app truncates on purpose
  (`numberOfLines` with an ellipsis, such as a chip) is ellipsized at the cold launch too, so it
  is not a clip; a label that fits at the cold launch and is cut live is.
- `clipping()` gains the probe check beside the box-in-parent check; the reasons are kept apart
  in the report (`clipped_by_layout` beside today's reasons).
- Your TD-05 amendment for below 0.87: an entry may list `clippedKeys`, a multiset in the
  stage-prefixed key form, each key also in `staleKeys` with its box at the stale base-scale
  height; any other clip, a clip of a key not stale, or any clip from 0.87 fails. The approval
  code and `proposedBaselines` gain the field.

## Fixtures and proofs

- Unit, `scripts/lib/live-font-text-probe.test.mjs`: chunk reassembly and hash, missing answer,
  the match of probe records to hierarchy nodes, every judging rule (content taller than visible,
  ellipsis new against cold, intentional ellipsis at cold, unknown text view kind), and the
  `clippedKeys` rules with their red cases.
- Native fixture: a route `app/text-clip-fixture.tsx` that renders only in probe builds (null
  otherwise) with two copies of one two-line label: healthy, in an auto-height container; mutant,
  in a fixed-height container with hidden overflow sized to one line, whose accessibility text and
  hierarchy rect stay inside the container. `maestro/live-font/text-clip-fixture.yaml` opens it by
  deep link. Device proof on Android 1.5 and iOS accessibility-medium: mutant red with
  `clipped_by_layout`, healthy green, the existing checks green on both (showing the gap).
- Kotlin and Swift units for the record builders where they run off-device (Robolectric for the
  Android layout read, in the standalone unit-tests pattern).
- Then every residual entry, the 5bac1637 ones included, is re-proposed from runs on the new
  harness for your approval against the updated-stage screenshots.

## Cost and order

This changes apps/mobile, so every device leg reruns once it lands; that rerun is the sweep
already planned. Order: your design approval, build with units and red proofs, your sign-off,
the device fixture proof, then the sweep.

## TEA review, 2026-11-14: approved with changes

1. Gating is autolinking exclusion, with no production footprint: a config plugin excludes the
   module from the generated Podfile and settings.gradle unless `COUTURE_TEXT_LAYOUT_PROBE=1`,
   guarded like `mobile-android-autolinking.test.mjs` (production and preview package lists lack
   it, a probe build has it; iOS through the generated ExpoModulesProvider). The fixture route
   renders null unless the probe flag is inlined, with a spec. The inert-flag option above is
   dropped.
2. The Android receiver is protected by `android.permission.DUMP`, which the shell holds.
3. iOS `contentRect` is measured at the view's `numberOfLines`, the way it renders; truncation is
   computed separately (limited against unlimited line count).
4. Ellipsis is cold-relative, and the report lists every node ellipsized at each cold launch per
   scale for review with each entry. Cold captures go through the layout clip check too (a cold
   clip fails the F-01 control).
5. Matching is one-to-one by text, then nearest rect, deterministic for repeats; a probe text
   with no hierarchy match fails (`live_font_text_probe_unmatched`), as does a hierarchy text node
   with no probe record.
6. The TD-05 stale-box condition is computed: a `clippedKeys` key passes only when its box height
   equals its cold base-launch height within tolerance.

Extra proofs: a probe that reports nothing for one node fails; a production profile with the
probe on fails the config spec.

## Wire contract after the r43 TEA rulings, 2026-11-14

Each record carries these rect and visibility fields (rects `[left, top, right, bottom]`):

| Field          | Meaning                                                                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `visibleRect`  | `viewRect` cut by every clipping ancestor and the window; null when nothing shows                                                          |
| `clipRect`     | `viewRect` cut by its reach (below); null when no part of it can be brought into view                                                      |
| `scrolledAway` | `visibleRect` null, `clipRect` not null and `offWindow` false: only a scroll position hides it                                             |
| `offWindow`    | `viewRect` lies wholly outside the window (a zero-size view by its origin), scroll views or not; `scrolledAway` is then false              |
| `opacity`      | the effective opacity, unrounded on both platforms; only exactly 0 is invisible. iOS records hidden views too, at 0, as Android does alpha |

Reach, per axis, from the window inward: every clipping ancestor cuts the band so far, and a
scroll view that can move on that axis then widens it by its travel. With `cur` its offset and
`max` its largest offset (Android: child extent less the padded viewport; iOS: `contentSize`
plus the adjusted insets less the bounds; no travel when that is 0 or less, or scrolling is
disabled: `getScrollEnabled()` false on React Native's Android scroll views, `isScrollEnabled`
false on iOS), the band is `[V.start - cur, V.end + (max - cur)]`, where V is the scroll view's
viewport cut by everything above it, outer scroll views' bands included. A larger offset moves
the content up, so at offset 0 only content below V can scroll in and at `max` only content
above. Nested scroll views compose inner to outer, each with its own travel. A text only partly
off the window with no scroll view above is cut by the window on every edge.

Harness invariants: `scrolledAway` and `offWindow` each imply `visibleRect` null; they never
both hold; a record with `visibleRect` null that is neither has `clipRect` null; an `offWindow`
record may keep a `clipRect` when a scroll view can bring it in.
