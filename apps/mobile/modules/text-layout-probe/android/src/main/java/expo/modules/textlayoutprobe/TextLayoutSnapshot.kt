package expo.modules.textlayoutprobe

import android.os.Build
import android.text.Layout
import android.text.StaticLayout
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.HorizontalScrollView
import android.widget.ScrollView
import android.widget.TextView
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

data class ProbeSnapshot(val windows: List<ProbeWindow>, val records: List<ProbeRecord>)

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
  val compoundView: Class<*>?
) {
  companion object {
    const val REACT_TEXT_VIEW = "com.facebook.react.views.text.ReactTextView"
    const val REACT_EDIT_TEXT = "com.facebook.react.views.textinput.ReactEditText"
    const val PREPARED_LAYOUT_TEXT_VIEW = "com.facebook.react.views.text.PreparedLayoutTextView"
    const val OVERFLOW_VIEW = "com.facebook.react.uimanager.ReactOverflowView"
    const val COMPOUND_VIEW = "com.facebook.react.uimanager.ReactCompoundView"

    /** Null when a class every React Native app links is missing (a minified or renamed build). */
    fun load(loader: ClassLoader?): ReactNativeTextClasses? {
      fun find(name: String): Class<*>? =
        try {
          Class.forName(name, false, loader)
        } catch (_: ClassNotFoundException) {
          null
        }
      val text = find(REACT_TEXT_VIEW) ?: return null
      val overflow = find(OVERFLOW_VIEW) ?: return null
      return ReactNativeTextClasses(
        text,
        find(REACT_EDIT_TEXT),
        overflow,
        find(PREPARED_LAYOUT_TEXT_VIEW),
        find(COMPOUND_VIEW)
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
    for ((id, root) in shown) collect(root, id, screenRect(root), records)
    return ProbeSnapshot(windows, records)
  }

  private fun collect(view: View, window: Int, windowRect: ProbeRect, out: MutableList<ProbeRecord>) {
    if (!view.isShown) return
    record(view, window, windowRect)?.let(out::add)
    if (view is ViewGroup) {
      for (index in 0 until view.childCount) collect(view.getChildAt(index), window, windowRect, out)
    }
  }

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
      contentRect = reading.content(viewRect),
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

    /** The laid-out text's own extents: its lines' left and right, its first top, last bottom. */
    fun content(viewRect: ProbeRect): ProbeRect {
      val layout = layout ?: return viewRect
      val left = viewRect.left + paddingLeft
      val top = viewRect.top + paddingTop
      if (lineCount == 0) return ProbeRect(left, top, left, top)
      val lines = 0 until lineCount
      return ProbeRect(
        left + floor(lines.minOf(layout::getLineLeft)).toInt(),
        top + layout.getLineTop(0),
        left + ceil(lines.maxOf(layout::getLineRight)).toInt(),
        top + layout.getLineBottom(lineCount - 1)
      )
    }
  }

  /** The text read of a text renderer, or null for a view that renders no text of its own. */
  private fun read(view: View): Reading? {
    val type = view.javaClass
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

  /** One ancestor on the way up: the rects it cuts its descendants to and its scroll travel. */
  class Level(
    val cuts: List<ProbeRect>,
    val scrollX: ScrollTravel? = null,
    val scrollY: ScrollTravel? = null
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
          scrollY = (ancestor as? ScrollView)?.let { travel(it) }
        )
      )
      parent = ancestor.parent
    }
    return cuts(viewRect, levels, windowRect)
  }

  /** The rects in screen space that [ancestor] cuts its descendants' drawing to. */
  private fun ancestorClips(ancestor: View, bounds: ProbeRect): List<ProbeRect> {
    val cuts = mutableListOf<ProbeRect>()
    // A parent with clipChildren clips each child's drawing, and so its subtree, to its bounds.
    if ((ancestor.parent as? ViewGroup)?.clipChildren == true) cuts.add(bounds)
    if (overflowClips(ancestor)) cuts.add(bounds)
    if (ancestor is ViewGroup && ancestor.clipToPadding &&
      (ancestor.paddingLeft or ancestor.paddingTop or ancestor.paddingRight or ancestor.paddingBottom) != 0
    ) {
      cuts.add(
        ProbeRect(
          bounds.left + ancestor.paddingLeft,
          bounds.top + ancestor.paddingTop,
          bounds.right - ancestor.paddingRight,
          bounds.bottom - ancestor.paddingBottom
        )
      )
    }
    ancestor.clipBounds?.let {
      cuts.add(ProbeRect(it.left, it.top, it.right, it.bottom).offset(bounds.left, bounds.top))
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
     * reach. On each axis, from the window inward, every level's cuts narrow the band so far and
     * a scroll view that can move on that axis then widens it by its own travel ([widen]). So a
     * scroll view's band is its padded viewport cut by everything above it (outer scroll views'
     * bands included) widened by its travel, nested scroll views compose, and a scroll view with
     * no travel (no overflow, scrolling disabled) cuts as any clipper does. Levels run nearest
     * first. scrolledAway: not visible, yet within reach, on the window or off it; offWindow:
     * wholly off the window and out of reach.
     */
    fun cuts(viewRect: ProbeRect, levels: List<Level>, windowRect: ProbeRect): ProbeCuts {
      var visible: ProbeRect? = viewRect
      for (level in levels) for (cut in level.cuts) visible = visible?.intersect(cut)
      visible = visible?.intersect(windowRect)
      var x: Span? = Span(windowRect.left, windowRect.right)
      var y: Span? = Span(windowRect.top, windowRect.bottom)
      for (level in levels.asReversed()) {
        for (cut in level.cuts) {
          x = x?.narrow(cut.left, cut.right)
          y = y?.narrow(cut.top, cut.bottom)
        }
        x = widen(x, level.scrollX)
        y = widen(y, level.scrollY)
      }
      val clip =
        if (x != null && y != null) viewRect.intersect(ProbeRect(x.lo, y.lo, x.hi, y.hi)) else null
      return ProbeCuts(
        visible,
        clip,
        scrolledAway = visible == null && clip != null,
        offWindow = offWindow(viewRect, windowRect, clip)
      )
    }

    /**
     * The band of positions a scroll view can bring into [span]. A larger scroll offset moves the
     * content up (or left), so a text now at p shows after a further scroll by d when p - d lies
     * in span, for d from -offset (back to the start) to maximum - offset (to the end): the band
     * runs from span start minus offset to span end plus (maximum minus offset).
     */
    private fun widen(span: Span?, travel: ScrollTravel?): Span? {
      if (span == null || travel == null) return span
      return Span(span.lo - travel.offset, span.hi + travel.maximum - travel.offset)
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
     * Off the window: wholly outside it (a zero-size view by its corner) and out of every scroll
     * view's reach (no clipRect). One a scroll view's band reaches is scrolledAway instead.
     */
    fun offWindow(viewRect: ProbeRect, windowRect: ProbeRect, clip: ProbeRect?): Boolean =
      clip == null && disjoint(viewRect, windowRect)

    fun screenRect(view: View): ProbeRect {
      val at = IntArray(2)
      view.getLocationOnScreen(at)
      return ProbeRect(at[0], at[1], at[0] + view.width, at[1] + view.height)
    }

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
