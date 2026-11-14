package expo.modules.textlayoutprobe

import android.app.Activity
import android.app.Dialog
import android.content.Context
import android.os.Looper
import android.text.StaticLayout
import android.text.TextUtils
import android.util.TypedValue
import android.view.View
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.view.inspector.WindowInspector
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import com.facebook.react.uimanager.OverflowViewGroup
import com.facebook.react.views.textinput.ReactEditText
import com.facebook.react.views.text.PreparedLayout
import com.facebook.react.views.text.PreparedLayoutTextView
import com.facebook.react.views.text.ReactTextView
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Story 6.15 F-00i: the record builder against real Android layouts (native graphics, so text is
 * measured and broken into lines as on a device). React Native's groups clear clipChildren and cut
 * by overflow; OverflowViewGroup stands in for them.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class TextLayoutSnapshotTest {
  private val twoLines = "Show watermark\nCard preview"

  private fun host(content: (Context) -> View): Activity {
    // React Native activities have no action bar, whose title would be one more text view.
    val controller = Robolectric.buildActivity(Activity::class.java)
    controller.get().setTheme(android.R.style.Theme_Material_NoActionBar)
    val activity = controller.setup().get()
    val root = FrameLayout(activity).apply { clipChildren = false }
    root.addView(content(activity), FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
    activity.setContentView(root)
    shadowOf(Looper.getMainLooper()).idle()
    return activity
  }

  private fun snapshot(): ProbeSnapshot {
    val classes = ReactNativeTextClasses.load(javaClass.classLoader)
    assertNotNull("the stand-ins resolve by React Native's names", classes)
    return TextLayoutSnapshot(classes!!).capture(WindowInspector.getGlobalWindowViews()).also(::assertConsistent)
  }

  /** The harness validator's invariants (scripts/lib/live-font-text-probe.mjs), on every answer. */
  private fun assertConsistent(snapshot: ProbeSnapshot) {
    assertTrue("at most one focused window", snapshot.windows.count { it.focused } <= 1)
    val ids = snapshot.windows.map { it.id }.toSet()
    for (record in snapshot.records) {
      assertTrue("$record names a listed window", record.window in ids)
      if (record.scrolledAway) assertNull("$record scrolled away", record.visibleRect)
      if (record.visibleRect != null) assertNotNull("$record has a clipRect", record.clipRect)
      if (record.offWindow) {
        assertNull("$record off the window", record.visibleRect)
        assertNull("$record off the window is out of reach", record.clipRect)
        assertFalse("$record off the window is not scrolled away", record.scrolledAway)
      }
      if (record.visibleRect == null && !record.scrolledAway) {
        assertNull("$record is cut to nothing", record.clipRect)
      }
    }
  }

  private fun label(context: Context, value: String = twoLines) = ReactTextView(context).apply {
    text = value
    setTextSize(TypedValue.COMPLEX_UNIT_PX, 20f)
    includeFontPadding = false
  }

  private fun oneLineHeight(context: Context): Int {
    val probe = label(context, "Show watermark")
    probe.measure(View.MeasureSpec.makeMeasureSpec(300, View.MeasureSpec.EXACTLY), 0)
    return probe.measuredHeight
  }

  /** The height a text takes with no height limit, as Yoga gives a React Native text. */
  private fun natural(view: View): Int {
    view.measure(
      View.MeasureSpec.makeMeasureSpec(300, View.MeasureSpec.AT_MOST),
      View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED)
    )
    return view.measuredHeight
  }

  /** A label laid out at its natural height inside [container], whatever the container's height. */
  private fun inside(container: OverflowViewGroup, text: View): OverflowViewGroup {
    container.addView(text, FrameLayout.LayoutParams(MATCH_PARENT, natural(text)))
    return container
  }

  private fun only(snapshot: ProbeSnapshot, text: String = twoLines): ProbeRecord =
    snapshot.records.single { it.text == text }

  private fun column(context: Context, vararg children: View) = LinearLayout(context).apply {
    orientation = LinearLayout.VERTICAL
    clipChildren = false
    children.forEach { addView(it) }
  }

  @Test
  fun aFixedHeightTextViewWithTwoLinesHasContentTallerThanItsVisibleRect() {
    lateinit var text: ReactTextView
    host { context ->
      text = label(context)
      column(context).apply {
        addView(text, LinearLayout.LayoutParams(MATCH_PARENT, oneLineHeight(context)))
      }
    }
    val record = only(snapshot())
    assertEquals("ReactTextView", record.kind)
    assertEquals(2, record.lineCount)
    assertNull(record.maxLines)
    assertEquals(2, record.unlimitedLineCount)
    assertEquals(0, record.ellipsized)
    assertEquals(record.viewRect, record.visibleRect)
    assertEquals(record.viewRect, record.clipRect)
    assertEquals(record.viewRect.top, record.contentRect.top)
    assertTrue(
      "content ${record.contentRect} taller than visible ${record.visibleRect}",
      record.contentRect.bottom > record.visibleRect!!.bottom + 2
    )
    assertEquals(text.layout.getLineBottom(1), record.contentRect.bottom - record.viewRect.top)
    assertFalse(record.scrolledAway)
  }

  @Test
  fun maxLinesOneWithAnEndEllipsisIsEllipsizedWithTheUnlimitedCountBeside() {
    host { context ->
      column(
        context,
        label(context, "A long label that cannot fit on one line of this narrow box").apply {
          maxLines = 1
          ellipsize = TextUtils.TruncateAt.END
          layoutParams = LinearLayout.LayoutParams(120, WRAP_CONTENT)
        }
      )
    }
    val record = snapshot().records.single()
    assertEquals(1, record.lineCount)
    assertEquals(1, record.maxLines)
    assertTrue("ellipsized ${record.ellipsized}", record.ellipsized > 0)
    assertTrue("unlimited ${record.unlimitedLineCount}", record.unlimitedLineCount!! >= 2)
  }

  @Test
  fun anOverflowHiddenContainerOfOneLineCutsTheMutantButNotTheHealthyCopy() {
    host { context ->
      val mutant = inside(OverflowViewGroup(context, "hidden"), label(context))
      val healthy = inside(OverflowViewGroup(context, "hidden"), label(context, "Healthy\nlabel"))
      column(context).apply {
        addView(mutant, LinearLayout.LayoutParams(MATCH_PARENT, oneLineHeight(context)))
        addView(healthy, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))
      }
    }
    val snapshot = snapshot()
    val mutant = only(snapshot)
    // The text view keeps its two-line box: only the container's own clipping cuts it, which no
    // Android clip flag shows (getGlobalVisibleRect reports the whole box).
    assertEquals(2, mutant.lineCount)
    assertEquals(mutant.viewRect.bottom, mutant.contentRect.bottom)
    assertTrue(mutant.clipRect!!.bottom < mutant.contentRect.bottom - 2)
    assertEquals(mutant.clipRect, mutant.visibleRect)
    assertFalse(mutant.scrolledAway)
    val healthy = only(snapshot, "Healthy\nlabel")
    assertEquals(healthy.viewRect, healthy.clipRect)
    assertTrue(healthy.contentRect.bottom <= healthy.clipRect!!.bottom)
  }

  @Test
  fun aCentredShortLineHasItsOwnLeftAndRightInsideTheView() {
    host { context ->
      column(
        context,
        label(context, "Hi").apply {
          gravity = android.view.Gravity.CENTER_HORIZONTAL
          layoutParams = LinearLayout.LayoutParams(300, WRAP_CONTENT)
        }
      )
    }
    val record = only(snapshot(), "Hi")
    assertTrue("left ${record.contentRect}", record.contentRect.left > record.viewRect.left + 100)
    assertTrue("right ${record.contentRect}", record.contentRect.right < record.viewRect.right - 100)
    assertTrue(record.contentRect.right > record.contentRect.left)
  }

  @Test
  fun aLongWordInANarrowClippingParentRunsPastTheClipRect() {
    val word = "Unbreakablewatermarkcaption"
    host { context ->
      val text = label(context, word)
      text.measure(0, 0)
      column(context).apply {
        addView(
          OverflowViewGroup(context, "hidden").apply {
            addView(text, FrameLayout.LayoutParams(text.measuredWidth, WRAP_CONTENT))
          },
          LinearLayout.LayoutParams(60, WRAP_CONTENT)
        )
      }
    }
    val record = only(snapshot(), word)
    assertEquals(1, record.lineCount)
    assertTrue(
      "content ${record.contentRect} past clip ${record.clipRect}",
      record.contentRect.right > record.clipRect!!.right + 2
    )
  }

  @Test
  fun overflowVisibleWithClipChildrenOffDoesNotCut() {
    host { context ->
      column(context).apply {
        addView(
          inside(OverflowViewGroup(context, "visible"), label(context)),
          LinearLayout.LayoutParams(MATCH_PARENT, oneLineHeight(context))
        )
      }
    }
    val record = only(snapshot())
    assertEquals(record.viewRect, record.clipRect)
    assertEquals(record.viewRect, record.visibleRect)
  }

  /** A 100 px scroll viewport 50 px below the window top, its content three tall rows. */
  private fun scrolled(
    context: Context,
    by: Int,
    row: (Context) -> View,
    onScroll: (ScrollView) -> Unit
  ): View {
    val scroll = ScrollView(context)
    scroll.addView(
      column(
        context,
        View(context).apply { layoutParams = LinearLayout.LayoutParams(MATCH_PARENT, 80) },
        row(context),
        View(context).apply { layoutParams = LinearLayout.LayoutParams(MATCH_PARENT, 400) }
      )
    )
    onScroll(scroll)
    scroll.post { scroll.scrollTo(0, by) }
    return FrameLayout(context).apply {
      addView(scroll, FrameLayout.LayoutParams(MATCH_PARENT, 100).apply { topMargin = 50 })
    }
  }

  @Test
  fun aTextCutOnlyByTheScrollViewportKeepsItsWholeClipRect() {
    lateinit var scroll: ScrollView
    host { context -> scrolled(context, 0, { label(it) }) { scroll = it } }
    shadowOf(Looper.getMainLooper()).idle()
    val record = only(snapshot())
    val viewport = TextLayoutSnapshot.screenRect(scroll)
    assertTrue("the label straddles the viewport bottom", record.viewRect.bottom > viewport.bottom)
    assertEquals(record.viewRect, record.clipRect)
    assertEquals(viewport.bottom, record.visibleRect!!.bottom)
    assertFalse(record.scrolledAway)
  }

  @Test
  fun anOverflowHiddenContainerInsideScrollContentCutsTheClipRect() {
    host { context ->
      scrolled(context, 0, { inner ->
        inside(OverflowViewGroup(inner, "hidden"), label(inner)).apply {
          layoutParams = LinearLayout.LayoutParams(MATCH_PARENT, 12)
        }
      }) {}
    }
    val record = only(snapshot())
    assertEquals(record.viewRect.top + 12, record.clipRect!!.bottom)
    assertFalse(record.scrolledAway)
  }

  @Test
  fun aTextScrolledFullyOutIsScrolledAwayWithNoVisibleRect() {
    lateinit var scroll: ScrollView
    host { context -> scrolled(context, 140, { label(it) }) { scroll = it } }
    shadowOf(Looper.getMainLooper()).idle()
    val record = only(snapshot())
    // Above the viewport but still inside the window: the viewport alone puts it away.
    assertTrue(record.viewRect.bottom <= TextLayoutSnapshot.screenRect(scroll).top)
    assertTrue(record.viewRect.bottom > 0)
    assertTrue(record.scrolledAway)
    assertNull(record.visibleRect)
    // Off the top of the window too, but only scrolling hides it.
    assertEquals(record.viewRect, record.clipRect)
    assertFalse(record.offWindow)
  }

  /** Puts [text] at its natural height with its top 10 px above the window bottom. */
  private fun nearTheWindowBottom(spacer: View, text: View) {
    val activity = spacer.context as Activity
    val window = TextLayoutSnapshot.screenRect(activity.window.decorView)
    spacer.layoutParams.height = window.bottom - TextLayoutSnapshot.screenRect(spacer).top - 10
    text.layoutParams.height = natural(text)
    spacer.requestLayout()
    shadowOf(Looper.getMainLooper()).idle()
  }

  @Test
  fun scrollContentRunningPastTheWindowBottomKeepsItsWholeClipRect() {
    lateinit var spacer: View
    lateinit var text: View
    host { context ->
      spacer = View(context).apply { layoutParams = LinearLayout.LayoutParams(MATCH_PARENT, 0) }
      text = label(context).apply { layoutParams = LinearLayout.LayoutParams(MATCH_PARENT, 0) }
      ScrollView(context).apply {
        addView(
          column(
            context,
            spacer,
            text,
            View(context).apply { layoutParams = LinearLayout.LayoutParams(MATCH_PARENT, 400) }
          )
        )
      }
    }
    nearTheWindowBottom(spacer, text)
    val record = only(snapshot())
    val window = TextLayoutSnapshot.screenRect((spacer.context as Activity).window.decorView)
    assertTrue("half past the window bottom", record.viewRect.bottom > window.bottom)
    assertTrue(record.viewRect.top < window.bottom)
    // The root views clip at the window edge, as the scroll view's own viewport does: scrolled off.
    assertEquals(record.viewRect, record.clipRect)
    assertTrue(record.contentRect.bottom <= record.clipRect!!.bottom)
    assertFalse(record.scrolledAway)
  }

  @Test
  fun aFixedTextRunningPastTheWindowBottomIsCut() {
    lateinit var spacer: View
    lateinit var text: View
    host { context ->
      spacer = View(context).apply { layoutParams = LinearLayout.LayoutParams(MATCH_PARENT, 0) }
      text = label(context).apply { layoutParams = LinearLayout.LayoutParams(MATCH_PARENT, 0) }
      column(context, spacer, text)
    }
    // No ancestor clips, so the window is the only cut (the Activity's content frame and decor
    // would clip at the same edge otherwise).
    var ancestor = text.parent
    while (ancestor is android.view.ViewGroup) {
      ancestor.clipChildren = false
      ancestor = ancestor.parent
    }
    nearTheWindowBottom(spacer, text)
    val record = only(snapshot())
    val window = TextLayoutSnapshot.screenRect((spacer.context as Activity).window.decorView)
    // Partly off with no scroll view above: the window cuts it, and it is not off the window.
    assertEquals(window.bottom, record.clipRect!!.bottom)
    assertFalse(record.offWindow)
    assertFalse(record.scrolledAway)
    assertTrue(record.viewRect.bottom > record.clipRect!!.bottom)
    assertTrue(
      "content ${record.contentRect} past clip ${record.clipRect}",
      record.contentRect.bottom > record.clipRect!!.bottom + 2
    )
  }

  @Test
  fun aContainerSmallerThanItsScrollViewCutsOnlyTheAxisItDoesNotScroll() {
    host { context ->
      val scroll = ScrollView(context)
      scroll.addView(
        column(
          context,
          View(context).apply { layoutParams = LinearLayout.LayoutParams(300, 40) },
          label(context).apply { layoutParams = LinearLayout.LayoutParams(300, WRAP_CONTENT) },
          // Content past the viewport, so the scroll view has travel to bring the label in.
          View(context).apply { layoutParams = LinearLayout.LayoutParams(300, 400) }
        )
      )
      // A 150 x 60 hidden-overflow container holding a 300 x 100 vertical scroll view.
      OverflowViewGroup(context, "hidden").apply {
        addView(scroll, FrameLayout.LayoutParams(300, 100))
        layoutParams = FrameLayout.LayoutParams(150, 60)
      }.let { container -> FrameLayout(context).apply { addView(container) } }
    }
    val record = only(snapshot())
    // Across the scroll axis the container is a real clip; along it the text scrolls into view.
    assertEquals(record.viewRect.left + 150, record.clipRect!!.right)
    assertEquals(record.viewRect.top, record.clipRect!!.top)
    assertEquals(record.viewRect.bottom, record.clipRect!!.bottom)
    assertEquals(record.viewRect.top - 40 + 60, record.visibleRect!!.bottom)
  }

  // Antigravity r42 P2: the three probes that showed clipRect blind to the scroll axis.

  @Test
  fun aHorizontalScrollViewCutsTheClipRectVertically() {
    host { context ->
      FrameLayout(context).apply {
        addView(
          HorizontalScrollView(context).apply {
            // Content as tall as the label, so only the scroll view itself can cut it.
            addView(
              LinearLayout(context).apply {
                addView(label(context), LinearLayout.LayoutParams(200, 80))
              },
              FrameLayout.LayoutParams(WRAP_CONTENT, 80)
            )
          },
          FrameLayout.LayoutParams(390, 40).apply { topMargin = 100 }
        )
      }
    }
    val record = only(snapshot())
    assertEquals(80, record.viewRect.bottom - record.viewRect.top)
    assertEquals(record.viewRect.top + 40, record.clipRect!!.bottom)
    assertEquals(record.visibleRect, record.clipRect)
  }

  @Test
  fun aVerticalScrollViewCutsTheClipRectHorizontally() {
    host { context ->
      FrameLayout(context).apply {
        addView(
          ScrollView(context).apply {
            addView(
              LinearLayout(context).apply {
                clipChildren = false
                addView(label(context, "Wide"), LinearLayout.LayoutParams(300, 30))
              },
              FrameLayout.LayoutParams(300, WRAP_CONTENT)
            )
          },
          FrameLayout.LayoutParams(200, 100).apply { topMargin = 100 }
        )
      }
    }
    val record = only(snapshot(), "Wide")
    assertEquals(300, record.viewRect.right - record.viewRect.left)
    assertEquals(record.viewRect.left + 200, record.clipRect!!.right)
  }

  @Test
  fun aScrollViewWiderThanTheWindowDoesNotCutItsScrollableContent() {
    lateinit var spacer: View
    host { context ->
      spacer = View(context)
      FrameLayout(context).apply {
        clipChildren = false
        addView(
          HorizontalScrollView(context).apply {
            addView(
              LinearLayout(context).apply {
                addView(spacer, LinearLayout.LayoutParams(0, 30))
                addView(label(context, "Edge"), LinearLayout.LayoutParams(60, 30))
                // Content past the viewport, so the scroll view has travel to bring "Edge" in.
                addView(View(context), LinearLayout.LayoutParams(100, 30))
              }
            )
          },
          FrameLayout.LayoutParams(0, 100).apply { topMargin = 100 }
        )
      }
    }
    val window = TextLayoutSnapshot.screenRect((spacer.context as Activity).window.decorView)
    // The scroll view is 60 px wider than the window; the label straddles the window's right edge.
    (spacer.parent.parent as View).layoutParams.width = window.right + 60
    spacer.layoutParams.width = window.right - 30
    spacer.requestLayout()
    shadowOf(Looper.getMainLooper()).idle()
    val record = only(snapshot(), "Edge")
    assertTrue(record.viewRect.left < window.right && record.viewRect.right > window.right)
    assertEquals(record.viewRect, record.clipRect)
    assertEquals(window.right, record.visibleRect!!.right)
  }

  @Test
  fun aStackedActiveAndInactiveGlyphReportTheirOwnOpacity() {
    host { context ->
      FrameLayout(context).apply {
        addView(label(context, "Home active"))
        addView(label(context, "Home inactive").apply { alpha = 0f })
      }
    }
    val records = snapshot().records
    assertEquals(1.0, records.single { it.text == "Home active" }.opacity, 0.0)
    assertEquals(0.0, records.single { it.text == "Home inactive" }.opacity, 0.0)
  }

  @Test
  fun opacityMultipliesUpTheTreeAndAnInvisibleAncestorMakesItZero() {
    lateinit var half: View
    lateinit var hidden: View
    host { context ->
      half = label(context, "Half of half").apply { alpha = 0.5f }
      hidden = label(context, "Behind an invisible group")
      column(
        context,
        FrameLayout(context).apply {
          alpha = 0.5f
          addView(half)
        },
        FrameLayout(context).apply {
          visibility = View.INVISIBLE
          addView(hidden)
        }
      )
    }
    assertEquals(0.25, only(snapshot(), "Half of half").opacity, 1e-6)
    assertEquals(0.0, TextLayoutSnapshot.effectiveOpacity(hidden), 0.0)
    // INVISIBLE, not alpha: the label's own alpha is 1.
    assertEquals(1f, hidden.alpha)
    assertEquals(0.0, TextLayoutSnapshot.effectiveOpacity(hidden.parent as View), 0.0)
  }

  @Test
  fun aTextInAZeroHeightOverflowHiddenContainerIsCutToNothingButNotScrolledAway() {
    host { context ->
      column(context).apply {
        addView(
          inside(OverflowViewGroup(context, "hidden"), label(context)),
          LinearLayout.LayoutParams(MATCH_PARENT, 0)
        )
      }
    }
    val record = only(snapshot())
    assertFalse(record.scrolledAway)
    assertNull(record.visibleRect)
    assertNull(record.clipRect)
  }

  @Test
  fun aDialogWindowGetsItsOwnIdAboveTheActivity() {
    val activity = host { context -> column(context, label(context, "Behind")) }
    val dialog = Dialog(activity)
    dialog.setContentView(label(activity, "On top"))
    dialog.show()
    shadowOf(Looper.getMainLooper()).idle()
    val snapshot = snapshot()
    assertEquals(2, snapshot.windows.size)
    val behind = snapshot.records.single { it.text == "Behind" }
    val onTop = snapshot.records.single { it.text == "On top" }
    assertTrue(behind.window != onTop.window)
    val z = snapshot.windows.associate { it.id to it.z }
    assertTrue("dialog z ${z[onTop.window]} above ${z[behind.window]}", z[onTop.window]!! > z[behind.window]!!)
    assertEquals(setOf(0, 1), snapshot.windows.map { it.z }.toSet())
  }

  @Test
  fun aReactInputIsReadFromItsLayoutAndAnEmptyOneFromItsHint() {
    host { context ->
      column(
        context,
        ReactEditText(context).apply {
          setText("Typed caption")
          setTextSize(TypedValue.COMPLEX_UNIT_PX, 20f)
          layoutParams = LinearLayout.LayoutParams(300, WRAP_CONTENT)
        },
        ReactEditText(context).apply {
          hint = "Write a caption\nSecond hint line"
          setTextSize(TypedValue.COMPLEX_UNIT_PX, 20f)
          layoutParams = LinearLayout.LayoutParams(300, WRAP_CONTENT)
        }
      )
    }
    val records = snapshot().records
    val typed = records.single { it.text == "Typed caption" }
    assertEquals("ReactEditText", typed.kind)
    assertEquals(1, typed.lineCount)
    val hinted = records.single { it.text == "Write a caption\nSecond hint line" }
    assertEquals("ReactEditText", hinted.kind)
    assertEquals(2, hinted.lineCount)
  }

  @Test
  fun anyOtherTextViewIsReportedAsAnUnknownKind() {
    host { context -> column(context, TextView(context).apply { text = "Plain" }) }
    assertEquals("unknown:android.widget.TextView", only(snapshot(), "Plain").kind)
  }

  @Test
  fun aPreparedLayoutTextViewIsReadFromItsPreparedLayoutAndUnknownWithoutOne() {
    host { context ->
      val paint = label(context).paint
      val layout = StaticLayout.Builder.obtain(twoLines, 0, twoLines.length, paint, 300).build()
      column(
        context,
        PreparedLayoutTextView(context).apply {
          preparedLayout = PreparedLayout(layout, -1, 0f)
          layoutParams = LinearLayout.LayoutParams(300, layout.getLineBottom(0))
        },
        PreparedLayoutTextView(context).apply {
          layoutParams = LinearLayout.LayoutParams(300, 20)
        }
      )
    }
    val records = snapshot().records
    val prepared = records.single { it.kind == "PreparedLayoutTextView" }
    assertEquals(twoLines, prepared.text)
    assertEquals(2, prepared.lineCount)
    assertNull(prepared.maxLines)
    assertTrue(prepared.contentRect.bottom > prepared.visibleRect!!.bottom + 2)
    assertEquals(
      "unknown:com.facebook.react.views.text.PreparedLayoutTextView",
      records.single { it !== prepared }.kind
    )
  }

  @Test
  fun ellipsizeModeClipKeepsTheUncappedLineCountBesideTheCappedOne() {
    host { context ->
      column(
        context,
        label(context, "One\nTwo\nThree\nFour").apply {
          maxLines = 2
          ellipsize = null
          layoutParams = LinearLayout.LayoutParams(300, WRAP_CONTENT)
        }
      )
    }
    val record = snapshot().records.single()
    // Without an ellipsis StaticLayout keeps every line (setMaxLines acts only with one); the
    // view is two lines tall, so the dropped lines show as content past the clipRect.
    assertEquals(2, record.maxLines)
    assertEquals(0, record.ellipsized)
    assertEquals(4, record.unlimitedLineCount)
    assertEquals(4, record.lineCount)
    assertTrue(
      "content ${record.contentRect} past clip ${record.clipRect}",
      record.contentRect.bottom > record.clipRect!!.bottom + 2
    )
  }

  private fun preparedLayout(
    context: Context,
    text: String,
    maxLines: Int,
    ellipsize: TextUtils.TruncateAt?
  ): StaticLayout =
    StaticLayout.Builder.obtain(text, 0, text.length, label(context).paint, 300)
      .setMaxLines(maxLines)
      .setEllipsize(ellipsize)
      .build()

  @Test
  fun aPreparedLayoutReportsItsUncappedLineCountInClipModeAndNullWhenEllipsized() {
    host { context ->
      column(
        context,
        PreparedLayoutTextView(context).apply {
          preparedLayout = PreparedLayout(preparedLayout(context, "One\nTwo\nThree\nFour", 2, null), 2, 0f)
          layoutParams = LinearLayout.LayoutParams(300, 60)
        },
        PreparedLayoutTextView(context).apply {
          preparedLayout = PreparedLayout(
            preparedLayout(context, "Five\nSix\nSeven", 1, TextUtils.TruncateAt.END),
            1,
            0f
          )
          layoutParams = LinearLayout.LayoutParams(300, 30)
        }
      )
    }
    val records = snapshot().records
    val clipped = records.single { it.text.startsWith("One") }
    assertEquals(2, clipped.maxLines)
    assertEquals(0, clipped.ellipsized)
    assertEquals(4, clipped.unlimitedLineCount)
    assertTrue(clipped.contentRect.bottom > clipped.clipRect!!.bottom + 2)
    val ellipsized = records.single { it !== clipped }
    assertEquals(1, ellipsized.maxLines)
    assertTrue(ellipsized.ellipsized > 0)
    assertNull(ellipsized.unlimitedLineCount)
  }

  @Test
  fun aPreparedLayoutsVerticalOffsetMovesItsContentDown() {
    lateinit var layout: StaticLayout
    host { context ->
      layout = preparedLayout(context, twoLines, Int.MAX_VALUE, null)
      column(
        context,
        PreparedLayoutTextView(context).apply {
          preparedLayout = PreparedLayout(layout, -1, 7.4f)
          setPadding(0, 3, 0, 0)
          layoutParams = LinearLayout.LayoutParams(300, 120)
        }
      )
    }
    val record = snapshot().records.single()
    assertEquals(record.viewRect.top + 3 + 7, record.contentRect.top)
    assertEquals(record.viewRect.top + 3 + 7 + layout.getLineBottom(1), record.contentRect.bottom)
  }

  @Test
  fun aHiddenTextAndABlankReactTextAreNotRecorded() {
    host { context ->
      column(
        context,
        label(context, "Gone").apply { visibility = View.GONE },
        label(context, " "),
        label(context, "Shown")
      )
    }
    assertEquals(listOf("Shown"), snapshot().records.map { it.text })
  }

  // TEA ruling 2026-11-14 (r43 P1): on its axis a scroll view reaches its viewport cut by
  // everything above it, widened by its travel to [V start - offset, V end + (maximum - offset)].

  /**
   * Scroll content [height] px tall holding [children] at their margins. A ScrollView measures its
   * child unbounded, ignoring the child's own height, so a spacer of that height sets the extent.
   */
  private fun content(context: Context, height: Int, vararg children: Pair<View, FrameLayout.LayoutParams>) =
    FrameLayout(context).apply {
      clipChildren = false
      addView(View(context), FrameLayout.LayoutParams(1, height))
      for ((child, params) in children) addView(child, params)
    }

  private fun at(top: Int, width: Int, height: Int) =
    FrameLayout.LayoutParams(width, height).apply { topMargin = top }

  /**
   * A 60 px hidden-overflow container at [CONTAINER_TOP] holding a 100 px scroll view placed 20 px
   * above it, so V (the viewport cut by the container) is content 20..80 at offset 0. The content
   * is 300 px (travel 200) with 20 px labels named by their content top.
   */
  private fun banded(offset: Int, vararg tops: Int): Pair<OverflowViewGroup, Map<Int, ProbeRecord>> {
    lateinit var container: OverflowViewGroup
    lateinit var scroll: ScrollView
    host { context ->
      scroll = ScrollView(context)
      scroll.addView(
        content(context, 300, *tops.map { label(context, "Row $it") to at(it, 300, 20) }.toTypedArray())
      )
      container = OverflowViewGroup(context, "hidden").apply {
        addView(scroll, FrameLayout.LayoutParams(300, 100).apply { topMargin = -20 })
      }
      FrameLayout(context).apply {
        addView(container, FrameLayout.LayoutParams(300, 60).apply { topMargin = CONTAINER_TOP })
      }
    }
    scroll.scrollTo(0, offset)
    shadowOf(Looper.getMainLooper()).idle()
    assertEquals(offset, scroll.scrollY)
    val records = snapshot().records
    return container to tops.associateWith { top -> records.single { it.text == "Row $top" } }
  }

  @Test
  fun atOffsetZeroOnlyTheContentBelowCanScrollIn() {
    val (container, rows) = banded(0, 0, 80)
    val v = TextLayoutSnapshot.screenRect(container)
    // Above V with no travel back: closed.
    assertNull(rows.getValue(0).clipRect)
    assertFalse(rows.getValue(0).scrolledAway)
    // Below V within the 200 px ahead: open, scrolled away.
    val below = rows.getValue(80)
    assertEquals(v.bottom, below.viewRect.top)
    assertEquals(below.viewRect, below.clipRect)
    assertTrue(below.scrolledAway)
  }

  @Test
  fun atTheLargestOffsetOnlyTheContentAboveCanScrollIn() {
    val (container, rows) = banded(200, 200, 280)
    val v = TextLayoutSnapshot.screenRect(container)
    val above = rows.getValue(200)
    assertEquals(v.top, above.viewRect.bottom)
    assertEquals(above.viewRect, above.clipRect)
    assertTrue(above.scrolledAway)
    // Below V with no travel ahead: closed.
    assertEquals(v.bottom, rows.getValue(280).viewRect.top)
    assertNull(rows.getValue(280).clipRect)
    assertFalse(rows.getValue(280).scrolledAway)
  }

  @Test
  fun aMiddleOffsetOpensEachSideByItsOwnRemainingTravel() {
    // Offset 100: 100 px back, 100 px ahead; the band is content 20..280.
    val (container, rows) = banded(100, 0, 10, 100, 180, 270)
    val v = TextLayoutSnapshot.screenRect(container)
    assertNull(rows.getValue(0).clipRect)
    val top = rows.getValue(10)
    assertEquals(v.top - 100, top.clipRect!!.top)
    assertEquals(top.viewRect.bottom, top.clipRect!!.bottom)
    assertEquals(rows.getValue(100).viewRect, rows.getValue(100).clipRect)
    assertTrue(rows.getValue(100).scrolledAway)
    assertEquals(rows.getValue(180).viewRect, rows.getValue(180).clipRect)
    assertTrue(rows.getValue(180).scrolledAway)
    val bottom = rows.getValue(270)
    assertEquals(v.bottom + 100, bottom.clipRect!!.bottom)
    assertEquals(bottom.viewRect.top, bottom.clipRect!!.top)
  }

  /** Antigravity r43 probe 1: a 60 px clipper over a 100 px scroll view with 5 px of travel. */
  @Test
  fun anOuterClipperCutsAtTheScrollViewsSmallTravel() {
    lateinit var container: View
    host { context ->
      val scroll = ScrollView(context)
      scroll.addView(content(context, 105, label(context, "Probe one") to at(40, 200, 50)))
      container = OverflowViewGroup(context, "hidden").apply {
        addView(scroll, FrameLayout.LayoutParams(300, 100))
      }
      FrameLayout(context).apply {
        addView(container, FrameLayout.LayoutParams(300, 60).apply { topMargin = CONTAINER_TOP })
      }
    }
    val record = only(snapshot(), "Probe one")
    val top = TextLayoutSnapshot.screenRect(container).top
    assertEquals(ProbeRect(record.viewRect.left, top + 40, record.viewRect.right, top + 60), record.visibleRect)
    assertEquals(ProbeRect(record.viewRect.left, top + 40, record.viewRect.right, top + 65), record.clipRect)
    assertFalse(record.scrolledAway)
  }

  /** Antigravity r43 probe 2: a scroll view taller than the window with 10 px of travel. */
  @Test
  fun aScrollViewTallerThanTheWindowReachesOnlyItsTravelPastTheWindow() {
    lateinit var scroll: ScrollView
    lateinit var spacer: View
    host { context ->
      scroll = ScrollView(context)
      scroll.addView(content(context, 0).also { spacer = it.getChildAt(0) })
      FrameLayout(context).apply { addView(scroll, FrameLayout.LayoutParams(MATCH_PARENT, 0)) }
    }
    val window = TextLayoutSnapshot.screenRect((scroll.context as Activity).window.decorView)
    val scrollTop = TextLayoutSnapshot.screenRect(scroll.parent as View).top
    val height = window.bottom - scrollTop + 500
    scroll.layoutParams.height = height
    spacer.layoutParams.height = height + 10
    val holder = spacer.parent as FrameLayout
    holder.addView(label(scroll.context, "Far"), at(window.bottom - scrollTop + 100, 200, 40))
    holder.addView(label(scroll.context, "Edge"), at(window.bottom - scrollTop - 10, 200, 40))
    holder.addView(label(scroll.context, "Reachable"), at(window.bottom - scrollTop + 2, 200, 6))
    scroll.requestLayout()
    shadowOf(Looper.getMainLooper()).idle()
    val records = snapshot().records
    val far = records.single { it.text == "Far" }
    assertNull(far.visibleRect)
    assertNull(far.clipRect)
    assertFalse(far.scrolledAway)
    assertTrue(far.offWindow)
    val edge = records.single { it.text == "Edge" }
    assertEquals(window.bottom + 10, edge.clipRect!!.bottom)
    assertFalse(edge.offWindow)
    // Wholly below the window but within the 10 px of travel: scrolled away, not off the window.
    val reachable = records.single { it.text == "Reachable" }
    assertFalse(reachable.offWindow)
    assertEquals(reachable.viewRect, reachable.clipRect)
    assertNull(reachable.visibleRect)
    assertTrue(reachable.scrolledAway)
  }

  /**
   * Antigravity r43 probe 3: content that does not overflow, and a React Native scroll view with
   * scrolling disabled, give no travel; the 60 px clipper above cuts as a plain clipper.
   */
  @Test
  fun noOverflowAndScrollingDisabledGiveNoTravel() {
    host { context ->
      fun probe(text: String, scroll: ScrollView, contentHeight: Int) =
        OverflowViewGroup(context, "hidden").apply {
          scroll.addView(content(context, contentHeight, label(context, text) to at(35, 200, 50)))
          addView(scroll, FrameLayout.LayoutParams(300, 200))
          layoutParams = LinearLayout.LayoutParams(300, 60)
        }
      column(
        context,
        probe("Fits", ScrollView(context), 180),
        probe("Disabled", com.facebook.react.views.scroll.ReactScrollView(context).apply { scrollEnabled = false }, 400),
        probe("Enabled", com.facebook.react.views.scroll.ReactScrollView(context), 400)
      )
    }
    val records = snapshot().records
    for (text in listOf("Fits", "Disabled")) {
      val record = records.single { it.text == text }
      assertEquals(text, record.viewRect.top + 25, record.clipRect!!.bottom)
      assertEquals(text, record.visibleRect, record.clipRect)
    }
    // The same scroll view with scrolling on reaches the whole label.
    val enabled = records.single { it.text == "Enabled" }
    assertEquals(enabled.viewRect, enabled.clipRect)
  }

  @Test
  fun aParagraphTallerThanItsScrollViewportKeepsItsWholeClipRect() {
    lateinit var scroll: ScrollView
    val paragraph = (1..12).joinToString("\n") { "Paragraph line $it" }
    host { context ->
      scroll = ScrollView(context)
      scroll.addView(
        column(context, label(context, paragraph).apply { layoutParams = LinearLayout.LayoutParams(300, WRAP_CONTENT) })
      )
      FrameLayout(context).apply {
        addView(scroll, FrameLayout.LayoutParams(300, 100).apply { topMargin = 50 })
      }
    }
    val record = only(snapshot(), paragraph)
    val viewport = TextLayoutSnapshot.screenRect(scroll)
    assertTrue(record.viewRect.bottom - record.viewRect.top > 2 * (viewport.bottom - viewport.top))
    assertEquals(record.viewRect, record.clipRect)
    assertTrue(record.contentRect.bottom <= record.clipRect!!.bottom)
    assertEquals(viewport.bottom, record.visibleRect!!.bottom)
    assertFalse(record.scrolledAway)
  }

  @Test
  fun nestedScrollViewsComposeEachWithItsOwnTravel() {
    lateinit var outer: ScrollView
    host { context ->
      // The inner viewport sits at outer content 250..350, past the outer 300 px viewport; the
      // outer travel brings it in, and the inner travel of 30 reaches its last 30 px.
      val inner = ScrollView(context).apply {
        addView(content(context, 130, label(context, "Inner") to at(90, 200, 40)))
      }
      outer = ScrollView(context).apply { addView(content(context, 550, inner to at(250, 300, 100))) }
      FrameLayout(context).apply {
        addView(outer, FrameLayout.LayoutParams(300, 300).apply { topMargin = 20 })
      }
    }
    val record = only(snapshot(), "Inner")
    val top = TextLayoutSnapshot.screenRect(outer).top
    assertEquals(top + 340, record.viewRect.top)
    assertEquals(record.viewRect, record.clipRect)
    assertTrue(record.scrolledAway)
  }

  /**
   * Coordinator alignment (TEA wording): a text wholly below the window that its scroll view can
   * bring in is scrolledAway with its clipRect, not offWindow.
   */
  @Test
  fun belowFoldTextAScrollCanReachIsScrolledAwayNotOffWindow() {
    lateinit var spacer: View
    lateinit var text: View
    host { context ->
      spacer = View(context).apply { layoutParams = LinearLayout.LayoutParams(MATCH_PARENT, 0) }
      text = label(context, "Below the fold").apply {
        layoutParams = LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT)
      }
      ScrollView(context).apply {
        addView(
          column(
            context,
            spacer,
            text,
            View(context).apply { layoutParams = LinearLayout.LayoutParams(MATCH_PARENT, 400) }
          )
        )
      }
    }
    val window = TextLayoutSnapshot.screenRect((spacer.context as Activity).window.decorView)
    spacer.layoutParams.height = window.bottom - TextLayoutSnapshot.screenRect(spacer).top + 50
    spacer.requestLayout()
    shadowOf(Looper.getMainLooper()).idle()
    val record = only(snapshot(), "Below the fold")
    assertTrue(record.viewRect.top > window.bottom)
    assertTrue(record.scrolledAway)
    assertFalse(record.offWindow)
    assertEquals(record.viewRect, record.clipRect)
    assertNull(record.visibleRect)
  }

  @Test
  fun aParkedSheetBelowTheScreenIsOffWindowAndNotScrolledAway() {
    lateinit var sheet: View
    host { context ->
      sheet = inside(OverflowViewGroup(context, "hidden"), label(context, "Parked sheet"))
      FrameLayout(context).apply { addView(sheet, FrameLayout.LayoutParams(300, 200)) }
    }
    val window = TextLayoutSnapshot.screenRect((sheet.context as Activity).window.decorView)
    (sheet.layoutParams as FrameLayout.LayoutParams).topMargin = window.bottom + 50
    sheet.requestLayout()
    shadowOf(Looper.getMainLooper()).idle()
    val record = only(snapshot(), "Parked sheet")
    assertTrue(record.viewRect.top > window.bottom)
    assertTrue(record.offWindow)
    assertFalse(record.scrolledAway)
    assertNull(record.visibleRect)
    assertNull(record.clipRect)
  }

  // Antigravity r43 P3: a prepared layout's uncapped count and its field fallbacks.

  @Test
  fun aPreparedLayoutCappedBelowItsTextIsLaidOutAgain() {
    val sentence = "A prepared single line layout holding a sentence that wraps at this width"
    lateinit var boring: android.text.BoringLayout
    host { context ->
      val paint = label(context).paint
      val metrics = android.text.BoringLayout.isBoring(sentence, paint)
      assertNotNull(metrics)
      boring = android.text.BoringLayout.make(
        sentence, paint, 200, android.text.Layout.Alignment.ALIGN_NORMAL, 1f, 0f, metrics, false
      )
      column(
        context,
        PreparedLayoutTextView(context).apply {
          preparedLayout = PreparedLayout(boring, 1, 0f)
          layoutParams = LinearLayout.LayoutParams(200, 30)
        }
      )
    }
    val record = snapshot().records.single()
    assertEquals(1, record.lineCount)
    val relaid = StaticLayout.Builder.obtain(sentence, 0, sentence.length, boring.paint, 200).build().lineCount
    assertTrue("relaid $relaid", relaid >= 3)
    assertEquals(relaid, record.unlimitedLineCount)
  }

  @Test
  fun aPreparedLayoutIsLaidOutAgainWithItsOwnBreakSettings() {
    val text = "go an go the at ax in it paragraph paragraph an in me so extraordinary or we ax if be"
    lateinit var hyphenated: StaticLayout
    lateinit var plain: StaticLayout
    host { context ->
      val paint = label(context).paint
      fun build(strategy: Int, frequency: Int) =
        StaticLayout.Builder.obtain(text, 0, text.length, paint, 150)
          .setBreakStrategy(strategy)
          .setHyphenationFrequency(frequency)
          .setMaxLines(2)
          .build()
      hyphenated = build(
        android.graphics.text.LineBreaker.BREAK_STRATEGY_HIGH_QUALITY,
        android.text.Layout.HYPHENATION_FREQUENCY_FULL
      )
      plain = build(
        android.graphics.text.LineBreaker.BREAK_STRATEGY_SIMPLE,
        android.text.Layout.HYPHENATION_FREQUENCY_NONE
      )
      column(
        context,
        PreparedLayoutTextView(context).apply {
          preparedLayout = PreparedLayout(hyphenated, 2, 0f)
          layoutParams = LinearLayout.LayoutParams(150, 60)
        }
      )
    }
    // StaticLayout.Builder's own defaults break this text into more lines.
    assertTrue("${hyphenated.lineCount} vs ${plain.lineCount}", hyphenated.lineCount < plain.lineCount)
    assertEquals(hyphenated.lineCount, snapshot().records.single().unlimitedLineCount)
  }

  @Test
  fun aPreparedLayoutWithoutAccessorsIsReadFromItsFields() {
    lateinit var layout: StaticLayout
    host { context ->
      layout = preparedLayout(context, "One\nTwo\nThree\nFour", 2, null)
      column(
        context,
        PreparedLayoutTextView(context).apply {
          preparedLayout = com.facebook.react.views.text.FieldOnlyPreparedLayout(layout, 2, 7.4f)
          setPadding(0, 3, 0, 0)
          layoutParams = LinearLayout.LayoutParams(300, 120)
        }
      )
    }
    val record = snapshot().records.single()
    assertEquals("PreparedLayoutTextView", record.kind)
    assertEquals(2, record.maxLines)
    assertEquals(4, record.unlimitedLineCount)
    assertEquals(record.viewRect.top + 3 + 7, record.contentRect.top)
  }

  private companion object {
    const val CONTAINER_TOP = 200
  }
}
