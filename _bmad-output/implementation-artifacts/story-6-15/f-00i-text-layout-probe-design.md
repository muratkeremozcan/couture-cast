# F-00i text layout probe: design for TEA review

Updated: 2026-11-14. Story 6.15, TD-01 and F-00i. Learning path Step 55. The r44 TEA rulings
(offWindow by translation, non-clipping and inverted scroll views, opacity refusal, ReactSwitch,
accessibilityAncestor) are in the wire contract below, with the answer-level `elements` list and
the iOS `behindModal` field from the label-element and accessibility-modal rulings, and the r45
rulings (offWindow needs the whole untranslated rect within reach; Android lines, padding clips
and scroll travel mapped through the view's global transform; no answer below API 29). r46:
`behindModal` carries `opaque`, and only an opaque modal view leaves the records behind it out.
Every record on both platforms carries `accessibilityHidden` from the accessibility-hidden ruling.

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

API floor (r45 P2-5). Below API 29 the Android module registers no receiver
(`TextLayoutProbeReceiver.register` returns null), so a dump request gets no answer at all and the
harness fails the leg as `live_font_text_probe_missing`. Nothing answers with unmapped boxes:
`View.transformMatrixToGlobal`, which maps every box, line and clip, is API 29 as well, and the
record builder has no fallback below it. A Robolectric case at API 28 holds this.

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

| Field            | Meaning                                                                                                                                                                            |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `visibleRect`    | `viewRect` cut by every clipping ancestor and the window; null when nothing shows                                                                                                  |
| `clipRect`       | `viewRect` cut by its reach (below); null when no part of it can be brought into view                                                                                              |
| `scrolledAway`   | `visibleRect` null and `clipRect` not null: only a scroll position hides it, on the window or wholly off it                                                                        |
| `offWindow`      | a translation put it wholly outside the window and out of reach: the rule below (r44 P1-1)                                                                                         |
| `opacity`        | the effective opacity, unrounded on both platforms; only exactly 0 is invisible. iOS records hidden views too, at 0, as Android does alpha                                         |
| `scrollViewport` | where the nearest scroll view that can move the text sideways shows now, cut by every clipper above it and the window, never widened; null when none holds it (r49 P2-2, r52 P2-1) |

Reach, per axis, from the window inward: every clipping ancestor cuts the band so far, and a
scroll view that can move on that axis then widens it by its travel, whether or not it clips
(r44 P2-1: an iOS scroll view with `clipsToBounds` false cuts nothing but still moves its
content; an Android scroll view always cuts to its viewport). With `cur` its offset and
`max` its largest offset (Android: child extent less the padded viewport; iOS: `contentSize`
plus the adjusted insets less the bounds; no travel when that is 0 or less, or scrolling is
disabled: `getScrollEnabled()` false on React Native's Android scroll views, `isScrollEnabled`
false on iOS), the band is `[V.start - cur, V.end + (max - cur)]`, where V is the scroll view's
viewport cut by everything above it, outer scroll views' bands included. A larger offset moves
the content up, so at offset 0 only content below V can scroll in and at `max` only content
above. Nested scroll views compose inner to outer, each with its own travel. `cur` and `max` are
in the scroll view's own units, so on screen each is multiplied by the size of the scale the
scroll view and every ancestor above it compose on that axis (r45 P2-5): under a parent scaled by
0.5 the content travels half as far (Android the product of `getScaleX`/`getScaleY`, iOS the
composed `a` or `d`, the composition that also says whether it is inverted). A text only partly
off the window with no scroll view above is cut by the window on every edge.

Inverted scroll views (r44 P2-2). A scroll view is inverted on an axis when its content is
flipped on screen there: on Android the product of the scale (`getScaleX`, `getScaleY`) of the
scroll view and every ancestor above it is negative on that axis; on iOS the linear parts of the
layer transforms of the scroll view and every ancestor above it, composed, have a negative `a`
(x) or `d` (y). The composition matters: React Native's inverted list sets `scaleY: -1` on the
iOS component view that holds the UIScrollView and `scale: -1` (both axes) on Android's
ReactScrollView, and a flip inside a flip scrolls the usual way. An inverted scroll view's larger
offset moves its content down (or right) on screen, so its band mirrors:
`[V.start - (max - cur), V.end + cur]`. Android boxes come from the four corners of the view
mapped through every matrix on the way (`transformMatrixToGlobal`), anchored at
`getLocationOnScreen`, so a flipped scroll view's own box is where it is laid out. The same
mapping carries everything else read in a view's own pixels (r45 P2-5): `contentRect` (the lines'
left, right, first top and last bottom past the padding), an ancestor's `clipToPadding` rect and
its `clipBounds`. So under a parent scaled by 0.5 the lines take half the height with the box, and
under a vertical flip a top padding cuts at the bottom on screen and a text's line sits above its
own top padding. Line extents round outward to the pixels they touch.

offWindow (r44 P1-1, r45 P2-3). A record is `offWindow` when all three hold: its `clipRect` is
null; its `viewRect` lies wholly outside the window (a zero-size view by its origin); and with
every translation removed its whole rect is within reach: the reach computed again is the
untranslated rect itself. With no clipper or scroll view above, that is the r45 ruling's words:
the untranslated rect lies wholly inside the window, not merely overlapping it, since the part
outside is a layout overflow the translation did not cause. The reach form keeps a parked
sheet's text below the fold of the sheet's own scroll view `offWindow` (in place it would be
`scrolledAway`), and makes one that the sheet itself cuts in part, untranslated, not
`offWindow`. Removing translations: each view
on the way, the text view included, has a translation (Android `translationX`/`translationY`;
iOS the layer transform's `tx`/`ty`) applied after its own scale, so it moves the view and
everything inside it rigidly by that translation mapped through the linear parts (scale, flip;
rotation on iOS) of the views outside it. Each rect, the text's and every ancestor's cut, moves
back by the sum of those mapped translations from itself outward; scroll offsets, travel, the
linear parts and the window stay. So a sheet or drawer parked off the window by a translation is
`offWindow`, while a text wholly off the window by layout alone (a non-scrolling footer pushed
past the bottom, a row item pushed past the right) has no reach either way and is not: it has
`visibleRect` null, `clipRect` null, `scrolledAway` false and `offWindow` false, a full clip the
harness fails in every stage and in the cold control. A text that the translation does not hide
(off the window even untranslated, overflowing the window or a clipper untranslated, or cut to
nothing by a clipper) is not `offWindow` either.

Opacity refusal (r44 P3-1). A record whose effective opacity is not a number from 0 to 1 (NaN,
from a NaN alpha anywhere up the chain) is never coerced or dropped: the whole answer is a
refusal in place of the windows and records, written and delivered as any answer (chunked and
hashed in logcat on Android, `<token>.json` on iOS):

```json
{
  "version": 1,
  "token": "<token>",
  "platform": "android",
  "error": { "code": "text_probe_opacity_invalid", "record": 3, "kind": "ReactTextView" }
}
```

`record` is the index the first such record has among the records, `kind` its kind. iOS writes
the same shape with `"platform":"ios"` and sorted keys. The harness fails the leg on it.

ReactSwitch (r44 3, Android). `com.facebook.react.views.switchview.ReactSwitch` (a
SwitchCompat) is the known kind `ReactSwitch` when `showText` is false: its text is reported as
the empty string, with no layout (`contentRect` = `viewRect`, `lineCount` 0, `maxLines` and
`unlimitedLineCount` null). With `showText` true, or when `showText` cannot be read, it stays
`unknown:<class>` and fails the leg: the thumb text has its own layout, which the TextView
`Layout` does not describe.

accessibilityAncestor (r44 4, iOS only). Each iOS record carries `accessibilityAncestor`:
`{"identifier": "<accessibilityIdentifier>", "rect": [left, top, right, bottom]}` with `rect` in
window points to a thousandth like `viewRect`, naming the text view itself or else its nearest
ancestor below the window that is an accessibility element (`isAccessibilityElement`) with a
non-empty `accessibilityIdentifier` (React Native's `testID`); `null` when none is. Android
records omit the field.

Harness invariants: `scrolledAway` implies `visibleRect` null; `offWindow` implies
`visibleRect` null, `clipRect` null and `scrolledAway` false; a record with `visibleRect` null
that is not `scrolledAway` has `clipRect` null. A text wholly below the fold that a scroll view
reaches is `scrolledAway`; one no band reaches (no scroll view above, or too little travel) is
cut to nothing unless a translation put it off the window, which makes it `offWindow`.

## Accessibility elements and accessibility-modal, 2026-11-14

TEA ruling: label elements do not look like text records. Native reports accessibility elements
in their own answer-level list, `elements`, on both platforms; they are never judged and never
counted as text. Each answer is now
`{version, token, platform, windows, records, elements}` (iOS keys sorted, Android in that
order); the opacity refusal keeps its shape and carries no `elements`.

```json
{
  "identifier": "save-button",
  "label": "Save",
  "rect": [10, 20, 110, 64],
  "hasText": true,
  "window": 0
}
```

| Field        | Meaning                                                                                |
| ------------ | -------------------------------------------------------------------------------------- |
| `identifier` | React Native's `testID`, a non-empty string, or null when the element has none         |
| `label`      | the accessibility label, a non-empty string, as UIKit or Android hands it over         |
| `rect`       | `[left, top, right, bottom]` in the units and rounding of `viewRect` (px, pt to 0.001) |
| `hasText`    | a text view the probe reports as a record sits at or under the element                 |
| `window`     | the window id, as records name it                                                      |

Which views are elements, in deterministic order (window order, then tree order, the element
before what lies inside it):

- iOS: `isAccessibilityElement` true with a non-empty `accessibilityLabel`; `identifier` from
  `accessibilityIdentifier`, null when empty. The walk leaves out a view that is hidden, at alpha
  or layer opacity 0, or has `accessibilityElementsHidden`, with everything under it, and lists
  nothing inside an element, since the accessibility tree shows an element as a leaf. React
  Native composes some labels: an accessible view without its own label reads its subviews'
  labels, and a multiline input's backing `RCTUITextView` joins its label and placeholder.
- Android: a view `isImportantForAccessibility` (an explicit NO, or an ancestor's
  NO_HIDE_DESCENDANTS, makes it false; a non-empty content description makes AUTO true) with a
  non-empty `contentDescription`. The walk leaves out a view not VISIBLE or at alpha 0 with
  everything under it, and lists elements inside elements, as Android's tree keeps them. React
  Native joins `accessibilityLabel`, the busy or mixed state and `accessibilityValue.text` into
  the content description; an input's placeholder stays its hint and is not in the label.
- `hasText` walks the element's whole subtree, hidden and faded parts included, because records
  include them at opacity 0. On iOS an element inside a TextInput's record (its backing text view,
  which the record walk does not enter) has `hasText` true as well: the record reports what it
  draws.

Android `identifier`: React Native's `BaseViewManager.setTestId` stores `testID` as the view tag
keyed `com.facebook.react.R.id.react_test_id` (and, for now, as the plain tag), and
`ReactAccessibilityDelegate` exposes that keyed tag as the node's `viewIdResourceName`, which the
Maestro hierarchy reads as `resource-id`. The probe reads the keyed tag, a string, null when empty.
The key comes from React Native's R class (`com.facebook.react.R$id.react_test_id`), or by name
from the app's resources (`getIdentifier("react_test_id", "id", <package>)`) when a minified build
dropped that class; when neither has it the app gives no answer, so identifiers cannot silently
read null. The plain tag is not read, since other code can set it.

iOS `behindModal` (accessibility-modal ruling: same rule as partial cover; records behind the
modal leave matching but stay clip-judged with key null, unless the modal view's frame contains
them, then they are left out like a whole cover). Each iOS record carries `behindModal`: null, or
`{"rect": [left, top, right, bottom], "opaque": boolean}`, the frame in window points to a
thousandth of the topmost shown view with `accessibilityViewIsModal` true in the record's window,
when the record's view is neither that view nor inside it. Topmost is the last such view in tree
order (a later sibling or a deeper view draws above); a hidden or alpha-0 view and everything under
it are passed over. No modal view in the window gives null. Android records omit the field: modal
content there is its own window, judged by the covered-window rule.

`opaque` (TEA ruling r46, PROBE_F3D): the harness classifies `invisible` and `offWindow` before
`behindModal`, and a record is `modalCovered` only when `opaque` is true and `rect` contains it; a
transparent backdrop (React Native's transparent `Modal`) leaves the records behind it clip-judged
with key null. Native reads `opaque` once per window from the modal view, so every record behind
the same modal view carries the same value. It is true only when all of these hold:

- the modal view itself, or a view under it whose frame covers the modal view's whole frame
  (equal or larger, compared to a thousandth as the wire writes them), paints an opaque
  background: its layer's backgroundColor at alpha exactly 1 and a corner radius of 0;
- that view, every view between it and the modal view, the modal view and every view from the
  window down to it are drawn whole: not hidden, alpha and layer opacity exactly 1, no layer mask;
- none of those views clips (clipsToBounds or masksToBounds) to a rect that leaves part of the
  modal frame out;
- no view from the modal view down to the opaque view, the modal view included, clips with a
  layer corner radius above 0 (TEA ruling r47 P2, R47_F3): its rounded corners cut the fill's
  corners, so what lies behind shows there. A square clipping view cuts nothing; a corner radius
  without clipping rounds only that view's own background.

`isOpaque` is a drawing hint and is not read. The layer's backgroundColor is read because React
Native's view returns its backgroundColor prop even when a shaped sublayer paints it (non-uniform
corners or borders) and leaves the layer's own background nil; such a view does not count. A
clear modal view over a full-size `rgba(0, 0, 0, 0.5)` backdrop, a black backdrop at alpha 0.4,
an opaque card over part of the frame, two opaque halves, and a hidden or faded opaque child all
give false. Reading false where the view does cover only leaves those records clip-judged.

## Accessibility-hidden records, 2026-11-14

TEA ruling: native flags a record that is hidden from accessibility (no accessible element on its
ancestor chain, accessibilityElementsHidden or isAccessibilityElement false, Android
importantForAccessibility no or no-hide-descendants). Every record on both platforms carries
`accessibilityHidden`, a required JSON boolean. It says nothing about drawing: a hidden record
keeps its rects and opacity.

- iOS: true when any view from the record's view up to the window, both included, has
  `accessibilityElementsHidden` true, or when neither the record's view nor any view above it up
  to the window is an accessibility element (`isAccessibilityElement`). The record's own view
  counts as an element the way React Native presents its text: a paragraph answers
  `isAccessibilityElement` NO and presents its text through `accessibilityElements`, which is
  empty when the Text has `accessible={false}`, so it counts when one of those is an element; a
  TextInput carries its `accessible` and `accessibilityElementsHidden` props on its backing text
  field or text view (its `accessibilityElement`), so those are read there.
- Android: true when the record's view or any ancestor up to the window root has
  `importantForAccessibility` NO_HIDE_DESCENDANTS, or the view itself has NO and no ancestor is
  important for accessibility (`isImportantForAccessibility`) and focusable as a group
  (`isFocusable`, React Native's `accessible`, or `isScreenReaderFocusable`). NO on an ancestor
  leaves that ancestor out of the tree and nothing under it.
- React Native sets these as the views carry them: `importantForAccessibility` as given,
  `aria-hidden` as accessibilityElementsHidden on iOS and no-hide-descendants on Android, and
  `accessible` as `isAccessibilityElement` (iOS views), the paragraph's elements (iOS Text) and
  focusability (Android). The probe reads these settings from the views.
- Real case: the Partnered pill Text in `apps/mobile/components/home/home-spotlight-teaser.tsx`
  (`accessible={false}`, `accessibilityElementsHidden`, `importantForAccessibility`
  no-hide-descendants, `aria-hidden`), beside the accessible link, is `true` on both platforms;
  the link's own texts and the Shop control's text are `false`.

## Harness rules after Antigravity r48, 2026-11-14

- Short final drag (P2-1): the drag that reaches the bottom moves only the travel left. When no
  anchor of that last page measures a whole drag, its anchors are the shifts a drag can make
  (above the tolerance, at most a whole drag). If they agree within SHIFT_SPREAD of their median,
  that median is the step; if they disagree, the stitch fails as
  `live_font_scroll_short_drag_ambiguous`. A page that shares no moving text keeps the median
  fallback. Only the last page may be short.
- Accessibility-hidden attach (P2-2): a flagged record joins an identified element only when the
  element's label holds the record's text as whole words and the element's frame holds the
  record or sits within one of the record's lines of it (at least the tolerance). The Home
  teaser's pill sits 3 px below its link and the in-app browser caption 6 px below the shop
  button.
- iOS driver port lock (P2-3): a lock is written to a temporary file and linked into place. A
  dead runner's lock is taken over by one runner only, through an exclusive takeover marker named
  after that lock's content; the winner reads the lock again and renames its own record over it
  only while the content is unchanged. A failing port probe in the failure path is logged, and
  the Maestro failure stays the error.
- Volatile proof scales (P2-4): every proof capture, live before, settled and updated included,
  is at its stage's scale in the leg. The font-scale guard also reads property names spelled as
  strings: element access (string or plain template), computed names, quoted names.
- Sideways overflow and lost copies (P3-1): superseded by the r49 rules below.

## Harness and wire rules after Antigravity r49, 2026-11-14

- `scrollViewport` (P2-2, wire, both platforms, required): the viewport of the nearest scroll view
  that can move the text sideways (Android a HorizontalScrollView with travel, iOS a UIScrollView
  with horizontal travel), where that scroll view shows now: its box cut by every clipper above it,
  outer scroll views' viewports included, and the window, never widened by any travel (r52 P2-1); null when none holds the text. A record scrolled away
  sideways joins the volatile region whose box holds that viewport's centre; a record with no
  viewport joins none this way (fail closed). Window geometry missed padded carousels and gave a
  sibling carousel's record away.
- Accessibility-hidden attach (P2-1): an identified element whose frame holds the record decides
  it, the smallest of several; one whose label lacks the record's words leaves it unmatched.
  Bordering, within one record line, applies only when no identified element holds the record.
- iOS driver port lock (P2-3): a lock is its runner's by pid and token, so a lock of this process
  under another token is live and only the io that holds a lock releases it. Takeover markers are
  named after the dead lock's content and a generation and hold their runner's pid and token; a
  generation whose runner died passes the takeover to the next, four at most, and the lock is
  never absent during it. A filesystem without hard links fails as
  `maestro_driver_port_lock_unsupported`.
- Short final step (P2-4): only a capture that records `reachedBottom` (scrollPages saw the next
  drag show the same page) may take one; it needs at least two agreeing texts, else
  `live_font_scroll_short_drag_unconfirmed`. A node shown once on, and at one place across, every
  earlier page is chrome on the last page whatever it does there.
- Font-scale guard (P2-5): keys fold through parentheses, `+` of strings, plain templates and
  string constants; a key that folds to nothing on a dimensions value or PixelRatio fails as
  unverifiable.
- Lost copies (P3-1): copies are counted over the scroll-through, each once: records of one text
  whose content places (viewRect moved by the page's contentOffset) overlap are one copy, and a
  record at one screen place on every page, of any kind there, is one copy.

## Harness rules after Antigravity r52, 2026-11-14

Owner rule: r52 is the one local review round of PR 230; its accepted findings are fixed in PR 230
with no re-review.

- `scrollViewport` narrows only (P2-1): a carousel its outer vertical scroll view cuts keeps the cut
  viewport, so the chip joins the region the hierarchy cuts the same way. `reach` keeps widening.
- The capture's own stitch (`attachPages`) takes the probe records, as the judge's stitch does
  (P2-2), so both place a short last drag alike.
- Copies (P2-3): a record at one screen place on every page is one sticky copy only when no other
  page holds a record of its text at its content place at another screen place (a short last
  drag overlaps the sticky chip with itself in content place, at the same screen place). Copies
  match one to one, so the count is never below any page's own. Residual: a virtualized list
  that unmounts the far copy stays indistinguishable from a sticky header.
- Accessibility-hidden attach (P2-4): among the smallest identified holders, those whose label holds
  the words own the record (several are ambiguous, none leaves it unmatched). Bordering applies only
  when no element (any identifier) and no hierarchy node holds the record without also holding the
  bordering element; an element or node named by the record's own text is the record's own box
  (the teaser pill's element) and blocks nothing.
- Port lock takeover (P3-1): generations are walked until one places or a live marker is found,
  with a runaway bound (`maestro_driver_port_takeover_runaway`); only the winner removes dead
  markers.
