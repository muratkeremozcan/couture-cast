package expo.modules.textlayoutprobe

import android.content.res.Resources
import android.graphics.Matrix
import android.os.Build
import android.text.Layout
import android.text.StaticLayout
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.HorizontalScrollView
import android.widget.ScrollView
import android.widget.TextView
import java.util.Collections
import java.util.IdentityHashMap
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.roundToInt

/** A rect as the wire carries it: left, top, right, bottom in screen pixels. */
data class ProbeRect(val left: Int, val top: Int, val right: Int, val bottom: Int) {
  val isEmpty: Boolean get() = right <= left || bottom <= top

  /** The overlap with [other], or null when the two share no area. */
  fun intersect(other: ProbeRect): ProbeRect? {
    val cut = ProbeRect(
      maxOf(left, other.left),
      maxOf(top, other.top),
      minOf(right, other.right),
      minOf(bottom, other.bottom)
    )
    return if (cut.isEmpty) null else cut
  }

  fun offset(dx: Int, dy: Int) = ProbeRect(left + dx, top + dy, right + dx, bottom + dy)
}

/** A scroll view's travel on one axis: its current offset and the largest one, in pixels. */
data class ScrollTravel(val offset: Int, val maximum: Int)

/**
 * A view's own translation and scale (View.getTranslationX/Y, getScaleX/Y). Its translation moves
 * it and everything in it after its scale, so its scale applies only to what it holds; a negative
 * scale flips its content on that axis (an inverted list). Rotation is not read.
 */
data class ProbeTransform(
  val translationX: Float = 0f,
  val translationY: Float = 0f,
  val scaleX: Float = 1f,
  val scaleY: Float = 1f
) {
  companion object {
    val NONE = ProbeTransform()

    fun of(view: View) = ProbeTransform(view.translationX, view.translationY, view.scaleX, view.scaleY)
  }
}

data class ProbeCuts(
  val visible: ProbeRect?,
  val clip: ProbeRect?,
  val scrolledAway: Boolean,
  val offWindow: Boolean
)

/** One axis of a rect. */
data class Span(val lo: Int, val hi: Int) {
  /** The overlap with lo..hi, or null when it is empty. */
  fun narrow(lo: Int, hi: Int): Span? {
    val cut = Span(maxOf(this.lo, lo), minOf(this.hi, hi))
    return if (cut.hi > cut.lo) cut else null
  }
}

data class ProbeWindow(val id: Int, val rect: ProbeRect, val z: Int, val focused: Boolean)

data class ProbeRecord(
  val kind: String,
  val text: String,
  val viewRect: ProbeRect,
  val visibleRect: ProbeRect?,
  val clipRect: ProbeRect?,
  val contentRect: ProbeRect,
  val lineCount: Int,
  val maxLines: Int?,
  val ellipsized: Int,
  val unlimitedLineCount: Int?,
  val window: Int,
  val scrolledAway: Boolean,
  val offWindow: Boolean = false,
  val opacity: Double = 1.0
)

/**
 * One accessibility element, listed apart from the text records (TEA ruling 2026-11-14): never
 * judged and never counted as text. A view important for accessibility with a non-empty
 * contentDescription; [identifier] is its React Native testID (the view tag keyed
 * `R.id.react_test_id`, which React Native's accessibility delegate exposes as the node's
 * resource-id), null when it has none; [rect] is its box like a record's viewRect; [hasText] says
 * whether a text view the probe reports as a record sits at or under it.
 */
data class ProbeElement(
  val identifier: String?,
  val label: String,
  val rect: ProbeRect,
  val hasText: Boolean,
  val window: Int
)

data class ProbeSnapshot(
  val windows: List<ProbeWindow>,
  val records: List<ProbeRecord>,
  val elements: List<ProbeElement> = emptyList()
)

/**
 * The React Native classes the probe recognises, looked up by name so this file compiles without
 * React Native (the Robolectric project stands in classes of the same names). `ReactOverflowView`
 * is how React Native's views carry `overflow`: ReactViewGroup clears `clipChildren` and clips its
 * children itself in dispatchDraw when overflow is not visible, which no Android clip flag shows.
 */
class ReactNativeTextClasses(
  val reactTextView: Class<*>,
  val reactEditText: Class<*>?,
  val overflowView: Class<*>,
  val preparedLayoutTextView: Class<*>?,
  val compoundView: Class<*>?,
  val reactSwitch: Class<*>? = null,
  /** The view tag key React Native's BaseViewManager.setTestId stores testID under. */
  val testIdKey: Int
) {
  companion object {
    const val REACT_TEXT_VIEW = "com.facebook.react.views.text.ReactTextView"
    const val REACT_EDIT_TEXT = "com.facebook.react.views.textinput.ReactEditText"
    const val PREPARED_LAYOUT_TEXT_VIEW = "com.facebook.react.views.text.PreparedLayoutTextView"
    const val OVERFLOW_VIEW = "com.facebook.react.uimanager.ReactOverflowView"
    const val COMPOUND_VIEW = "com.facebook.react.uimanager.ReactCompoundView"
    const val REACT_SWITCH = "com.facebook.react.views.switchview.ReactSwitch"
    const val REACT_ID_CLASS = "com.facebook.react.R\$id"
    const val TEST_ID_NAME = "react_test_id"

    /**
     * The key of React Native's testID view tag: `com.facebook.react.R.id.react_test_id`, read
     * from React Native's R class, or by name from the app's resources when a minified build has
     * dropped that class; null when neither has it.
     */
    fun testIdKey(loader: ClassLoader?, resources: Resources?, packageName: String?): Int? {
      val fromClass =
        try {
          Class.forName(REACT_ID_CLASS, false, loader).getField(TEST_ID_NAME).getInt(null)
        } catch (_: ReflectiveOperationException) {
          0
        }
      if (fromClass != 0) return fromClass
      val fromResources =
        if (resources != null && packageName != null) {
          resources.getIdentifier(TEST_ID_NAME, "id", packageName)
        } else {
          0
        }
      return if (fromResources != 0) fromResources else null
    }

    /**
     * Null when a class every React Native app links is missing (a minified or renamed build), or
     * when the testID tag key cannot be found, which would leave every element's identifier null.
     */
    fun load(
      loader: ClassLoader?,
      resources: Resources? = null,
      packageName: String? = null
    ): ReactNativeTextClasses? {
      fun find(name: String): Class<*>? =
        try {
          Class.forName(name, false, loader)
        } catch (_: ClassNotFoundException) {
          null
        }
      val text = find(REACT_TEXT_VIEW) ?: return null
      val overflow = find(OVERFLOW_VIEW) ?: return null
      val testIdKey = testIdKey(loader, resources, packageName) ?: return null
      return ReactNativeTextClasses(
        text,
        find(REACT_EDIT_TEXT),
        overflow,
        find(PREPARED_LAYOUT_TEXT_VIEW),
        find(COMPOUND_VIEW),
        find(REACT_SWITCH),
        testIdKey
      )
    }
  }
}

/**
 * Builds one record per shown text view in every window root, with the windows they belong to.
 * Runs on the main thread, where the views' layouts are stable between frames.
 */
class TextLayoutSnapshot(private val classes: ReactNativeTextClasses) {

  fun capture(roots: List<View>): ProbeSnapshot {
    val shown = roots.withIndex().filter { (_, root) -> root.isAttachedToWindow && root.isShown }
    val order = shown.sortedWith(compareBy({ windowLayer(it.value) }, { it.index }))
    val windows = shown.map { (id, root) ->
      ProbeWindow(
        id = id,
        rect = screenRect(root),
        z = order.indexOfFirst { it.index == id },
        focused = root.hasWindowFocus()
      )
    }
    val records = mutableListOf<ProbeRecord>()
    val elements = mutableListOf<ProbeElement>()
    for ((id, root) in shown) {
      val recorded = Collections.newSetFromMap(IdentityHashMap<View, Boolean>())
      collect(root, id, screenRect(root), records, recorded)
      collectElements(root, id, recorded, listing = true, elements)
    }
    return ProbeSnapshot(windows, records, elements)
  }

  private fun collect(
    view: View,
    window: Int,
    windowRect: ProbeRect,
    out: MutableList<ProbeRecord>,
    recorded: MutableSet<View>
  ) {
    if (!view.isShown) return
    record(view, window, windowRect)?.let {
      out.add(it)
      recorded.add(view)
    }
    if (view is ViewGroup) {
      for (index in 0 until view.childCount) {
        collect(view.getChildAt(index), window, windowRect, out, recorded)
      }
    }
  }

  /**
   * Every accessibility element under [view], in tree order, the way the accessibility tree shows
   * them: a view not VISIBLE or at alpha 0 is left out with everything under it; an element's own
   * descendants are listed too (Android's tree keeps them). The whole subtree is still walked for
   * hasText, alpha-0 parts included, as records include them. True when a recorded text view sits
   * at or under [view].
   */
  private fun collectElements(
    view: View,
    window: Int,
    recorded: Set<View>,
    listing: Boolean,
    out: MutableList<ProbeElement>
  ): Boolean {
    val skipped = view.visibility != View.VISIBLE || view.alpha <= 0f
    val label = view.contentDescription?.toString().orEmpty()
    val index =
      if (listing && !skipped && label.isNotEmpty() && view.isImportantForAccessibility) {
        out.add(ProbeElement(testId(view), label, screenRect(view), hasText = false, window))
        out.size - 1
      } else {
        -1
      }
    var found = view in recorded
    if (view is ViewGroup) {
      for (child in 0 until view.childCount) {
        if (collectElements(view.getChildAt(child), window, recorded, listing && !skipped, out)) {
          found = true
        }
      }
    }
    if (index >= 0) out[index] = out[index].copy(hasText = found)
    return found
  }

  /** React Native's testID: the view tag BaseViewManager.setTestId keys `R.id.react_test_id`. */
  private fun testId(view: View): String? =
    (view.getTag(classes.testIdKey) as? String)?.takeIf { it.isNotEmpty() }

  private fun record(view: View, window: Int, windowRect: ProbeRect): ProbeRecord? {
    val reading = read(view) ?: return null
    val viewRect = screenRect(view)
    val cuts = clips(view, viewRect, windowRect)
    return ProbeRecord(
      kind = reading.kind,
      text = reading.text,
      viewRect = viewRect,
      visibleRect = cuts.visible,
      clipRect = cuts.clip,
      contentRect = reading.content(view),
      lineCount = reading.lineCount,
      maxLines = reading.maxLines,
      ellipsized = reading.ellipsized,
      unlimitedLineCount = reading.unlimitedLineCount,
      window = window,
      scrolledAway = cuts.scrolledAway,
      offWindow = cuts.offWindow,
      opacity = effectiveOpacity(view)
    )
  }

  private class Reading(
    val kind: String,
    val text: String,
    val layout: Layout?,
    val paddingLeft: Int,
    val paddingTop: Int,
    val maxLines: Int?,
    val unlimitedLineCount: Int?
  ) {
    val lineCount = layout?.lineCount ?: 0
    val ellipsized = layout?.let { (0 until it.lineCount).sumOf(it::getEllipsisCount) } ?: 0

    /**
     * The laid-out text's own extents on screen: its lines' left and right, its first top and last
     * bottom, in the view's own pixels, mapped like its box through its own and every ancestor's
     * matrix (r45 P2-5), so a scaled or flipped ancestor scales or flips the lines with the view.
     */
    fun content(view: View): ProbeRect {
      val layout = layout ?: return screenRect(view)
      val left = paddingLeft.toFloat()
      val top = paddingTop.toFloat()
      if (lineCount == 0) return mapToScreen(view, left, top, left, top, outward = true)
      val lines = 0 until lineCount
      return mapToScreen(
        view,
        left + lines.minOf(layout::getLineLeft),
        top + layout.getLineTop(0),
        left + lines.maxOf(layout::getLineRight),
        top + layout.getLineBottom(lineCount - 1),
        outward = true
      )
    }
  }

  /** The text read of a text renderer, or null for a view that renders no text of its own. */
  private fun read(view: View): Reading? {
    val type = view.javaClass
    if (type == classes.reactSwitch) return switchReading(view)
    if (view is TextView) {
      val kind = when (type) {
        classes.reactTextView -> "ReactTextView"
        classes.reactEditText -> "ReactEditText"
        else -> "unknown:${type.name}"
      }
      val value = view.text?.toString() ?: ""
      // An empty input draws its hint, which is what the hierarchy shows; TextView keeps the
      // hint's Layout to itself, so the hint is laid out again at the same width.
      val hint = if (value.isEmpty()) view.hint?.toString().orEmpty() else ""
      val text = value.ifEmpty { hint }
      if (!kind.startsWith("unknown:") && text.isBlank()) return null
      val maxLines = limit(view.maxLines)
      val layout = if (hint.isNotEmpty()) hintLayout(view, hint) else view.layout
      return Reading(
        kind,
        text,
        layout,
        // An input scrolls its own text; a text view's scroll offset is 0.
        view.paddingLeft - view.scrollX,
        view.paddingTop - view.scrollY,
        maxLines,
        if (hint.isNotEmpty()) layout?.lineCount else unlimitedLines(layout, maxLines, view)
      )
    }
    if (type == classes.preparedLayoutTextView) {
      val prepared = PreparedLayoutRead.of(view)
        ?: return Reading("unknown:${type.name}", reflectedText(view), null, 0, 0, null, null)
      val text = prepared.layout.text?.toString() ?: ""
      if (text.isBlank()) return null
      val maxLines = limit(prepared.maximumNumberOfLines)
      return Reading(
        "PreparedLayoutTextView",
        text,
        prepared.layout,
        view.paddingLeft,
        // onDraw translates by paddingTop plus the prepared layout's vertical offset.
        view.paddingTop + prepared.verticalOffset.roundToInt(),
        maxLines,
        preparedUnlimitedLines(prepared.layout, maxLines)
      )
    }
    if (classes.compoundView?.isInstance(view) == true) {
      return Reading("unknown:${type.name}", reflectedText(view), null, 0, 0, null, null)
    }
    return null
  }

  /**
   * React Native's Switch (a SwitchCompat) draws no text unless showText is on, so it is the
   * known kind ReactSwitch with empty text and no layout. With showText on, or when showText
   * cannot be read, it is unknown: the thumb text has a layout of its own that the TextView
   * Layout does not describe, so the leg fails.
   */
  private fun switchReading(view: View): Reading {
    val showText =
      try {
        view.javaClass.getMethod("getShowText").invoke(view) as? Boolean
      } catch (_: ReflectiveOperationException) {
        null
      }
    if (showText == false) return Reading("ReactSwitch", "", null, 0, 0, null, null)
    return Reading("unknown:${view.javaClass.name}", reflectedText(view), null, 0, 0, null, null)
  }

  /**
   * One ancestor on the way up: the rects it cuts its descendants to, its scroll travel and its
   * own translation and scale.
   */
  class Level(
    val cuts: List<ProbeRect>,
    val scrollX: ScrollTravel? = null,
    val scrollY: ScrollTravel? = null,
    val transform: ProbeTransform = ProbeTransform.NONE
  )

  private fun clips(view: View, viewRect: ProbeRect, windowRect: ProbeRect): ProbeCuts {
    val levels = mutableListOf<Level>()
    var parent = view.parent
    while (parent is View) {
      val ancestor = parent as View
      val bounds = screenRect(ancestor)
      val scrollView = ancestor is ScrollView || ancestor is HorizontalScrollView
      // A scroll view always cuts its content to its viewport, whatever its parent's flags.
      val cuts = ancestorClips(ancestor, bounds) + if (scrollView) listOf(bounds) else emptyList()
      levels.add(
        Level(
          cuts,
          scrollX = (ancestor as? HorizontalScrollView)?.let { travel(it) },
          scrollY = (ancestor as? ScrollView)?.let { travel(it) },
          transform = ProbeTransform.of(ancestor)
        )
      )
      parent = ancestor.parent
    }
    return cuts(viewRect, levels, windowRect, ProbeTransform.of(view))
  }

  /**
   * The rects in screen space that [ancestor] cuts its descendants' drawing to. Its padding and
   * clip bounds are in its own pixels, so they are mapped through its matrix like its box (r45
   * P2-5): under a vertical flip its top padding cuts at its bottom on screen.
   */
  private fun ancestorClips(ancestor: View, bounds: ProbeRect): List<ProbeRect> {
    val cuts = mutableListOf<ProbeRect>()
    // A parent with clipChildren clips each child's drawing, and so its subtree, to its bounds.
    if ((ancestor.parent as? ViewGroup)?.clipChildren == true) cuts.add(bounds)
    if (overflowClips(ancestor)) cuts.add(bounds)
    if (ancestor is ViewGroup && ancestor.clipToPadding &&
      (ancestor.paddingLeft or ancestor.paddingTop or ancestor.paddingRight or ancestor.paddingBottom) != 0
    ) {
      cuts.add(
        mapToScreen(
          ancestor,
          ancestor.paddingLeft.toFloat(),
          ancestor.paddingTop.toFloat(),
          (ancestor.width - ancestor.paddingRight).toFloat(),
          (ancestor.height - ancestor.paddingBottom).toFloat()
        )
      )
    }
    ancestor.clipBounds?.let {
      cuts.add(mapToScreen(ancestor, it.left.toFloat(), it.top.toFloat(), it.right.toFloat(), it.bottom.toFloat()))
    }
    return cuts
  }

  private fun overflowClips(view: View): Boolean {
    if (!classes.overflowView.isInstance(view)) return false
    val overflow =
      try {
        classes.overflowView.getMethod("getOverflow").invoke(view) as String?
      } catch (_: ReflectiveOperationException) {
        null
      }
    return overflow != null && overflow != "visible"
  }

  companion object {
    /**
     * visibleRect: [viewRect] cut by every level's cuts and the window. clipRect: the text's
     * reach ([reach]). scrolledAway: not visible, yet within reach, on the window or off it;
     * offWindow: wholly off the window and out of reach because of a translation ([offWindow]).
     * Levels run nearest first; [own] is the text view's own transform.
     */
    fun cuts(
      viewRect: ProbeRect,
      levels: List<Level>,
      windowRect: ProbeRect,
      own: ProbeTransform = ProbeTransform.NONE
    ): ProbeCuts {
      var visible: ProbeRect? = viewRect
      for (level in levels) for (cut in level.cuts) visible = visible?.intersect(cut)
      visible = visible?.intersect(windowRect)
      val clip = reach(viewRect, levels, windowRect)
      val off =
        clip == null && disjoint(viewRect, windowRect) &&
          untranslated(viewRect, levels, own).let { (rect, moved) ->
            offWindow(viewRect, windowRect, clip, rect, reach(rect, moved, windowRect))
          }
      return ProbeCuts(visible, clip, scrolledAway = visible == null && clip != null, offWindow = off)
    }

    /**
     * The reach (clipRect). On each axis, from the window inward, every level's cuts narrow the
     * band so far and a scroll view that can move on that axis then widens it by its own travel
     * ([widen]). So a scroll view's band is its padded viewport cut by everything above it (outer
     * scroll views' bands included) widened by its travel, nested scroll views compose, and a
     * scroll view with no travel (no overflow, scrolling disabled) cuts as any clipper does. A
     * scroll view is inverted on an axis when the product of its own scale and every ancestor's
     * above it is negative there: its content then moves the other way on screen (React Native's
     * inverted lists set scaleY -1, or scale -1 on Android). The same product scales its travel,
     * which is in its own pixels, onto the screen.
     */
    private fun reach(viewRect: ProbeRect, levels: List<Level>, windowRect: ProbeRect): ProbeRect? {
      var x: Span? = Span(windowRect.left, windowRect.right)
      var y: Span? = Span(windowRect.top, windowRect.bottom)
      var scaleX = 1f
      var scaleY = 1f
      for (level in levels.asReversed()) {
        scaleX *= level.transform.scaleX
        scaleY *= level.transform.scaleY
        for (cut in level.cuts) {
          x = x?.narrow(cut.left, cut.right)
          y = y?.narrow(cut.top, cut.bottom)
        }
        x = widen(x, level.scrollX, scaleX)
        y = widen(y, level.scrollY, scaleY)
      }
      return if (x != null && y != null) viewRect.intersect(ProbeRect(x.lo, y.lo, x.hi, y.hi)) else null
    }

    /**
     * The view and its levels as they would lie with every translation removed. Removing a view's
     * translation moves it and everything inside it rigidly by that translation times the scales
     * of the views outside it, so each rect moves back by the sum of those scaled translations
     * from itself outward. Scroll offsets, travel, scales and the window stay.
     */
    fun untranslated(
      viewRect: ProbeRect,
      levels: List<Level>,
      own: ProbeTransform = ProbeTransform.NONE
    ): Pair<ProbeRect, List<Level>> {
      var shiftX = 0f
      var shiftY = 0f
      var scaleX = 1f
      var scaleY = 1f
      fun back(rect: ProbeRect) = rect.offset(-shiftX.roundToInt(), -shiftY.roundToInt())
      val moved = ArrayList<Level>(levels.size)
      for (level in levels.asReversed()) {
        shiftX += level.transform.translationX * scaleX
        shiftY += level.transform.translationY * scaleY
        moved.add(Level(level.cuts.map(::back), level.scrollX, level.scrollY, level.transform))
        scaleX *= level.transform.scaleX
        scaleY *= level.transform.scaleY
      }
      shiftX += own.translationX * scaleX
      shiftY += own.translationY * scaleY
      return back(viewRect) to moved.asReversed()
    }

    /**
     * The band of positions a scroll view can bring into [span]. A larger scroll offset moves the
     * content up (or left), so a text now at p shows after a further scroll by d when p - d lies
     * in span, for d from -offset (back to the start) to maximum - offset (to the end): the band
     * runs from span start minus offset to span end plus (maximum minus offset). Offsets are in
     * the scroll view's own pixels, so on screen they move the content by [scale], the product of
     * the scroll view's and every ancestor's scale on that axis (r45 P2-5): under a parent scaled
     * by 0.5 the content travels half as far on screen. A negative scale is an inverted scroll
     * view, where a larger offset moves the content down (or right) on screen, so the band
     * mirrors: span start minus (maximum minus offset) to span end plus offset, both times the
     * scale's size.
     */
    private fun widen(span: Span?, travel: ScrollTravel?, scale: Float): Span? {
      if (span == null || travel == null) return span
      val size = abs(scale)
      val back = (travel.offset * size).roundToInt()
      val ahead = ((travel.maximum - travel.offset) * size).roundToInt()
      return if (scale < 0) Span(span.lo - ahead, span.hi + back) else Span(span.lo - back, span.hi + ahead)
    }

    /**
     * A scroll view's travel on its axis: the child's extent less the padded viewport, the current
     * offset clamped into it; null when the content does not overflow or scrolling is disabled
     * (React Native's scroll views carry scrollEnabled, read by name).
     */
    fun travel(scroll: ViewGroup): ScrollTravel? {
      val child = scroll.getChildAt(0) ?: return null
      val horizontal = scroll is HorizontalScrollView
      val enabled =
        try {
          scroll.javaClass.getMethod("getScrollEnabled").invoke(scroll) as? Boolean ?: true
        } catch (_: ReflectiveOperationException) {
          true
        }
      if (!enabled) return null
      val maximum =
        if (horizontal) child.width - (scroll.width - scroll.paddingLeft - scroll.paddingRight)
        else child.height - (scroll.height - scroll.paddingTop - scroll.paddingBottom)
      if (maximum <= 0) return null
      val offset = if (horizontal) scroll.scrollX else scroll.scrollY
      return ScrollTravel(offset.coerceIn(0, maximum), maximum)
    }

    /**
     * Off the window: a translation put it there. The view has no reach (no clipRect), lies wholly
     * outside the window (a zero-size view by its corner), and with every translation removed
     * ([untranslated]) its whole rect lies within reach: [untranslatedClip], the reach computed
     * again, is [untranslatedRect] itself. With no clipper or scroll view above, that is the
     * untranslated rect lying wholly inside the window (r45 P2-3); merely overlapping it is not
     * enough, since the part outside is a layout overflow the translation did not cause. So a
     * parked sheet or drawer whose text sits whole in it (or in its scroll view's band) is
     * offWindow; a text wholly off the window by layout alone, or overflowing the window or a
     * clipper even untranslated, is not, and the harness fails it as cut to nothing. One a scroll
     * view's band reaches is scrolledAway.
     */
    fun offWindow(
      viewRect: ProbeRect,
      windowRect: ProbeRect,
      clip: ProbeRect?,
      untranslatedRect: ProbeRect,
      untranslatedClip: ProbeRect?
    ): Boolean =
      clip == null && disjoint(viewRect, windowRect) && untranslatedClip != null &&
        untranslatedClip == untranslatedRect

    /**
     * The view's box on screen: the bounding box of its four corners mapped through its own and
     * every ancestor's matrix ([mapToScreen]). With no scale that is the origin plus the size; a
     * flipped view (an inverted list's scroll view, scale -1) has its origin at its visual bottom
     * or right, which the corners correct.
     */
    fun screenRect(view: View): ProbeRect =
      mapToScreen(view, 0f, 0f, view.width.toFloat(), view.height.toFloat())

    /**
     * A rect in [view]'s own pixels on screen: the bounding box of its four corners mapped through
     * the view's own and every ancestor's matrix (transformMatrixToGlobal), anchored where
     * getLocationOnScreen puts the view's origin, which adds the window's place on the screen.
     * Rounded to the nearest pixel, or with [outward] to the pixels the rect touches (a text's
     * fractional line extents). transformMatrixToGlobal is API 29: below it the receiver is never
     * registered (TextLayoutProbeReceiver.register), so nothing here runs and no answer is sent.
     */
    fun mapToScreen(
      view: View,
      left: Float,
      top: Float,
      right: Float,
      bottom: Float,
      outward: Boolean = false
    ): ProbeRect {
      val at = IntArray(2)
      view.getLocationOnScreen(at)
      val matrix = Matrix()
      view.transformMatrixToGlobal(matrix)
      val origin = floatArrayOf(0f, 0f)
      matrix.mapPoints(origin)
      val corners = floatArrayOf(left, top, right, top, left, bottom, right, bottom)
      matrix.mapPoints(corners)
      val dx = at[0] - origin[0]
      val dy = at[1] - origin[1]
      val xs = listOf(corners[0], corners[2], corners[4], corners[6])
      val ys = listOf(corners[1], corners[3], corners[5], corners[7])
      // A thousandth of slack, so float error on a whole pixel does not spill into the next one.
      fun low(value: Float) = if (outward) floor(value + SLACK).toInt() else value.roundToInt()
      fun high(value: Float) = if (outward) ceil(value - SLACK).toInt() else value.roundToInt()
      return ProbeRect(low(xs.min() + dx), low(ys.min() + dy), high(xs.max() + dx), high(ys.max() + dy))
    }

    private const val SLACK = 0.001f

    /**
     * Whether [rect] lies entirely outside [area]: no shared area, or for a zero-size rect, its
     * corner outside the area. A zero-size view inside the window is cut to nothing, not away.
     */
    fun disjoint(rect: ProbeRect, area: ProbeRect): Boolean =
      if (rect.isEmpty) {
        rect.left !in area.left..area.right || rect.top !in area.top..area.bottom
      } else {
        rect.intersect(area) == null
      }

    /**
     * The opacity the view draws with: the product of its own and every ancestor's alpha up to the
     * window root, and exactly 0 when it or any ancestor is not VISIBLE (INVISIBLE or GONE).
     */
    fun effectiveOpacity(view: View): Double {
      var opacity = 1.0
      var current: View? = view
      while (current != null) {
        if (current.visibility != View.VISIBLE) return 0.0
        opacity *= current.alpha.toDouble().coerceIn(0.0, 1.0)
        current = current.parent as? View
      }
      return opacity
    }

    /**
     * Stacking group of a window root, lowest first: the base application window, other
     * application windows (dialogs, the composer's modal), sub-windows (popups, panels), then
     * system windows. Within a group, later-added windows are above.
     */
    fun windowLayer(root: View): Int {
      val type = (root.layoutParams as? WindowManager.LayoutParams)?.type ?: return 1
      return when {
        type == WindowManager.LayoutParams.TYPE_BASE_APPLICATION -> 0
        type < WindowManager.LayoutParams.FIRST_SUB_WINDOW -> 1
        type <= WindowManager.LayoutParams.LAST_SUB_WINDOW -> 2
        else -> 3
      }
    }

    /** TextView and React Native report no limit as -1 or Int.MAX_VALUE. */
    fun limit(maxLines: Int): Int? = if (maxLines <= 0 || maxLines == Int.MAX_VALUE) null else maxLines

    /**
     * The line count of the same text at the same width with no line limit. A layout with no
     * limit is that count already; a limited one is laid out again from the view's own text (an
     * ellipsized Layout holds the text with the ellipsis already in place) without the limit.
     * A prepared layout holds no source text, so a limited one reports null.
     */
    fun unlimitedLines(layout: Layout?, maxLines: Int?, textView: TextView): Int? {
      if (layout == null) return null
      if (maxLines == null) return layout.lineCount
      val text = textView.text ?: return null
      return relaidLines(text, layout, textView.includeFontPadding, BreakSettings.of(textView))
    }

    /**
     * A prepared layout keeps only its Layout. With ellipsizeMode clip its text is the source text
     * and is laid out again without the cap, with the break settings the Layout itself carries;
     * an ellipsizing Layout holds its text with the ellipsis in place (Layout.Ellipsizer), which
     * cannot be laid out again, so that is null.
     */
    fun preparedUnlimitedLines(layout: Layout, maxLines: Int?): Int? {
      if (maxLines == null) return layout.lineCount
      val text = layout.text ?: return null
      if (text.javaClass.name.contains("Ellipsizer")) return null
      return relaidLines(
        text,
        layout,
        layout.topPadding != 0 || layout.bottomPadding != 0,
        BreakSettings.of(layout)
      )
    }

    /**
     * The line breaking a re-layout must repeat. A TextView carries it; a Layout alone exposes it
     * from API 35 (Layout.getBreakStrategy and its siblings), and below that StaticLayout's
     * defaults are what a PreparedLayoutTextView's layout was built with unless React Native set
     * them, which cannot be read.
     */
    class BreakSettings(
      val breakStrategy: Int,
      val hyphenationFrequency: Int,
      val justificationMode: Int?
    ) {
      companion object {
        fun of(textView: TextView) = BreakSettings(
          textView.breakStrategy,
          textView.hyphenationFrequency,
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) textView.justificationMode else null
        )

        fun of(layout: Layout): BreakSettings? =
          if (Build.VERSION.SDK_INT >= 35) {
            BreakSettings(layout.breakStrategy, layout.hyphenationFrequency, layout.justificationMode)
          } else {
            null
          }
      }
    }

    /** The line count of [text] laid out at [layout]'s width, paint and spacing, with no cap. */
    fun relaidLines(
      text: CharSequence,
      layout: Layout,
      includePad: Boolean,
      settings: BreakSettings?
    ): Int {
      val builder = StaticLayout.Builder.obtain(text, 0, text.length, layout.paint, layout.width)
        .setAlignment(layout.alignment)
        .setLineSpacing(layout.spacingAdd, layout.spacingMultiplier)
        .setIncludePad(includePad)
      if (settings != null) {
        builder.setBreakStrategy(settings.breakStrategy)
        builder.setHyphenationFrequency(settings.hyphenationFrequency)
        settings.justificationMode?.let {
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) builder.setJustificationMode(it)
        }
      }
      return builder.build().lineCount
    }

    fun hintLayout(view: TextView, hint: CharSequence): Layout? {
      val width = view.width - view.compoundPaddingLeft - view.compoundPaddingRight
      if (width <= 0) return null
      return StaticLayout.Builder.obtain(hint, 0, hint.length, view.paint, width)
        .setIncludePad(view.includeFontPadding)
        .setLineSpacing(view.lineSpacingExtra, view.lineSpacingMultiplier)
        .build()
    }

    fun reflectedText(view: View): String =
      try {
        view.javaClass.getMethod("getText").invoke(view)?.toString() ?: ""
      } catch (_: ReflectiveOperationException) {
        ""
      }
  }
}

/**
 * PreparedLayoutTextView (React Native's prepared text layout flag) is internal to React Native
 * and draws a PreparedLayout's Layout. The getter is tried first, then any field holding an object
 * that holds a Layout, so a renamed accessor still reads; null when neither is found.
 */
class PreparedLayoutRead(
  val layout: Layout,
  val maximumNumberOfLines: Int,
  val verticalOffset: Float
) {
  companion object {
    fun of(view: View): PreparedLayoutRead? {
      val prepared = preparedObject(view) ?: return null
      val layout = layoutOf(prepared) ?: return null
      return PreparedLayoutRead(layout, maxLinesOf(prepared), verticalOffsetOf(prepared))
    }

    private fun preparedObject(view: View): Any? {
      try {
        return view.javaClass.getMethod("getPreparedLayout").invoke(view)
      } catch (_: ReflectiveOperationException) {
      }
      var type: Class<*>? = view.javaClass
      while (type != null && type != ViewGroup::class.java) {
        for (field in type.declaredFields) {
          if (field.type.isPrimitive || field.type.name.startsWith("android.")) continue
          field.isAccessible = true
          val value = try { field.get(view) } catch (_: ReflectiveOperationException) { null }
          if (value != null && layoutOf(value) != null) return value
        }
        type = type.superclass
      }
      return null
    }

    private fun layoutOf(prepared: Any): Layout? {
      try {
        return prepared.javaClass.getMethod("getLayout").invoke(prepared) as? Layout
      } catch (_: ReflectiveOperationException) {
      }
      for (field in prepared.javaClass.declaredFields) {
        if (Layout::class.java.isAssignableFrom(field.type)) {
          field.isAccessible = true
          return field.get(prepared) as? Layout
        }
      }
      return null
    }

    private fun verticalOffsetOf(prepared: Any): Float =
      try {
        prepared.javaClass.getMethod("getVerticalOffset").invoke(prepared) as Float
      } catch (_: ReflectiveOperationException) {
        field(prepared, "verticalOffset") as? Float ?: 0f
      }

    private fun maxLinesOf(prepared: Any): Int =
      try {
        prepared.javaClass.getMethod("getMaximumNumberOfLines").invoke(prepared) as Int
      } catch (_: ReflectiveOperationException) {
        field(prepared, "maximumNumberOfLines") as? Int ?: -1
      }

    /** A declared field's value by name, as layoutOf falls back to a field when the getter is gone. */
    private fun field(prepared: Any, name: String): Any? {
      val found = prepared.javaClass.declaredFields.firstOrNull { it.name == name } ?: return null
      return try {
        found.isAccessible = true
        found.get(prepared)
      } catch (_: ReflectiveOperationException) {
        null
      }
    }
  }
}
