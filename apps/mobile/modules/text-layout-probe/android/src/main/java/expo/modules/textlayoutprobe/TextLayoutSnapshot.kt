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
  val scrolledAway: Boolean
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
      scrolledAway = cuts.scrolledAway
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

  private class Cuts(val visible: ProbeRect?, val clip: ProbeRect?, val scrolledAway: Boolean)

  /**
   * visibleRect: the view's own rect cut by every ancestor that clips its descendants and by the
   * window. clipRect: the same without scroll views, whose viewport cuts are not layout clips.
   * Above a scroll view, an ancestor or the window cuts clipRect only on the edges where it cuts
   * into that scroll view's viewport: scroll content that runs past the screen (and so past the
   * root views that clip at it) is only scrolled off, while a container smaller than the scroll
   * view it holds is a real clip. A text outside every scroll view is cut by the window whole.
   */
  private fun clips(view: View, viewRect: ProbeRect, windowRect: ProbeRect): Cuts {
    var visible: ProbeRect? = viewRect
    var clip: ProbeRect? = viewRect
    // The viewport of the scroll view passed last on the way up, once there is one.
    var viewport: ProbeRect? = null
    var parent = view.parent
    while (parent is View) {
      val ancestor = parent as View
      val bounds = screenRect(ancestor)
      if (isScrollView(ancestor)) {
        viewport = bounds
        visible = visible?.intersect(bounds)
      } else {
        for (cut in ancestorClips(ancestor, bounds)) {
          visible = visible?.intersect(cut)
          clip = clip?.intersect(viewport?.let { cutInto(cut, it) } ?: cut)
        }
      }
      parent = ancestor.parent
    }
    visible = visible?.intersect(windowRect)
    clip = clip?.intersect(viewport?.let { cutInto(windowRect, it) } ?: windowRect)
    return Cuts(visible, clip, scrolledAway(viewRect, visible, clip, windowRect))
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
    fun screenRect(view: View): ProbeRect {
      val at = IntArray(2)
      view.getLocationOnScreen(at)
      return ProbeRect(at[0], at[1], at[0] + view.width, at[1] + view.height)
    }

    /**
     * Scrolled away: outside the window, or cut to nothing only once scroll viewports cut it (its
     * clipRect, which no scroll view cuts, is left). A text that a non-scroll ancestor or a
     * zero-size container cuts to nothing is not. So scrolledAway implies no visibleRect, and a
     * text with no visibleRect that is not scrolled away has no clipRect either.
     */
    fun scrolledAway(
      viewRect: ProbeRect,
      visible: ProbeRect?,
      clip: ProbeRect?,
      windowRect: ProbeRect
    ): Boolean = disjoint(viewRect, windowRect) || (visible == null && clip != null)

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

    private const val OPEN = 1 shl 29

    /** [cut] with every edge that does not cut into [viewport] opened. */
    fun cutInto(cut: ProbeRect, viewport: ProbeRect) = ProbeRect(
      if (cut.left > viewport.left) cut.left else -OPEN,
      if (cut.top > viewport.top) cut.top else -OPEN,
      if (cut.right < viewport.right) cut.right else OPEN,
      if (cut.bottom < viewport.bottom) cut.bottom else OPEN
    )

    fun isScrollView(view: View) = view is ScrollView || view is HorizontalScrollView

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
      return relaidLines(text, layout, textView.includeFontPadding, textView)
    }

    /**
     * A prepared layout keeps only its Layout. With ellipsizeMode clip its text is the source text
     * and is laid out again without the cap; an ellipsizing Layout holds its text with the
     * ellipsis in place (Layout.Ellipsizer), which cannot be laid out again, so that is null.
     */
    fun preparedUnlimitedLines(layout: Layout, maxLines: Int?): Int? {
      if (maxLines == null) return layout.lineCount
      val text = layout.text ?: return null
      if (text.javaClass.name.contains("Ellipsizer")) return null
      return relaidLines(text, layout, layout.topPadding != 0 || layout.bottomPadding != 0, null)
    }

    /** The line count of [text] laid out at [layout]'s width, paint and spacing, with no cap. */
    private fun relaidLines(
      text: CharSequence,
      layout: Layout,
      includePad: Boolean,
      textView: TextView?
    ): Int {
      val builder = StaticLayout.Builder.obtain(text, 0, text.length, layout.paint, layout.width)
        .setAlignment(layout.alignment)
        .setLineSpacing(layout.spacingAdd, layout.spacingMultiplier)
        .setIncludePad(includePad)
      if (textView != null) {
        builder.setBreakStrategy(textView.breakStrategy)
        builder.setHyphenationFrequency(textView.hyphenationFrequency)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          builder.setJustificationMode(textView.justificationMode)
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
        0f
      }

    private fun maxLinesOf(prepared: Any): Int =
      try {
        prepared.javaClass.getMethod("getMaximumNumberOfLines").invoke(prepared) as Int
      } catch (_: ReflectiveOperationException) {
        -1
      }
  }
}
