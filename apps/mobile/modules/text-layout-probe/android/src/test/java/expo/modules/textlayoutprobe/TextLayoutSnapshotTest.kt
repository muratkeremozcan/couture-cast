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
    assertEquals(record.viewRect.intersect(TextLayoutSnapshot.screenRect(scroll.rootView)), record.clipRect)
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
}
