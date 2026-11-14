package expo.modules.textlayoutprobe

import android.app.Activity
import android.app.Dialog
import android.content.Context
import android.content.res.Resources
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
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import com.facebook.react.uimanager.OverflowViewGroup
import com.facebook.react.views.textinput.ReactEditText
import com.facebook.react.views.text.PreparedLayout
import com.facebook.react.views.text.PreparedLayoutTextView
import com.facebook.react.views.text.ReactTextView
import org.json.JSONObject
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

  // TEA ruling 2026-11-14: a scrolled-away counterpart is usable because native viewRect is the
  // real layout box, never clamped to the window. These build the record from real views.

  /** The record [text] has in the answer's JSON, as the harness reads it. */
  private fun wired(snapshot: ProbeSnapshot, text: String): JSONObject {
    val records = JSONObject(TextLayoutProbeWire.json("t-away", snapshot)).getJSONArray("records")
    return (0 until records.length()).map(records::getJSONObject).single { it.getString("text") == text }
  }

  private fun JSONObject.rectOf(name: String): ProbeRect =
    getJSONArray(name).let { ProbeRect(it.getInt(0), it.getInt(1), it.getInt(2), it.getInt(3)) }

  @Test
  fun aTextScrolledBelowTheWindowKeepsItsFullViewRectOnTheRecordAndTheWire() {
    lateinit var scroll: ScrollView
    lateinit var spacer: View
    host { context ->
      spacer = View(context).apply { layoutParams = LinearLayout.LayoutParams(MATCH_PARENT, 0) }
      scroll = ScrollView(context).apply {
        // 400 px of content in a 200 px wide viewport: the viewport cuts across the scroll axis.
        addView(
          column(
            context,
            spacer,
            label(context, "Below the fold").apply { layoutParams = LinearLayout.LayoutParams(400, 40) },
            View(context).apply { layoutParams = LinearLayout.LayoutParams(MATCH_PARENT, 160) }
          ),
          FrameLayout.LayoutParams(400, WRAP_CONTENT)
        )
      }
      FrameLayout(context).apply { addView(scroll, FrameLayout.LayoutParams(200, MATCH_PARENT)) }
    }
    val window = TextLayoutSnapshot.screenRect((scroll.context as Activity).window.decorView)
    val viewport = TextLayoutSnapshot.screenRect(scroll)
    // The label's top 100 px below the window bottom; 200 px of travel reach it.
    val below = window.bottom - viewport.top + 100
    spacer.layoutParams.height = below
    spacer.requestLayout()
    shadowOf(Looper.getMainLooper()).idle()
    assertEquals(0, scroll.scrollY)
    assertEquals(window.bottom, viewport.bottom)
    val snapshot = snapshot()
    val record = only(snapshot, "Below the fold")
    // The whole laid-out box: wholly below the window and past its right edge, never clamped.
    val box = ProbeRect(viewport.left, viewport.top + below, viewport.left + 400, viewport.top + below + 40)
    assertTrue("$window is narrower than the 400 px label", window.right < box.right)
    assertEquals(box, record.viewRect)
    assertTrue(record.scrolledAway)
    assertFalse(record.offWindow)
    assertNull(record.visibleRect)
    // The band reaches the whole label down the scroll axis; across it the viewport cuts at 200.
    assertEquals(ProbeRect(box.left, box.top, box.left + 200, box.bottom), record.clipRect)
    val json = wired(snapshot, "Below the fold")
    assertEquals(box, json.rectOf("viewRect"))
    assertTrue(json.isNull("visibleRect"))
    assertEquals(record.clipRect, json.rectOf("clipRect"))
    assertTrue(json.getBoolean("scrolledAway"))
  }

  @Test
  fun aChipScrolledPastTheWindowRightKeepsItsFullViewRectOnTheRecordAndTheWire() {
    lateinit var scroll: HorizontalScrollView
    lateinit var spacer: View
    host { context ->
      spacer = View(context)
      scroll = HorizontalScrollView(context).apply {
        addView(
          LinearLayout(context).apply {
            addView(spacer, LinearLayout.LayoutParams(0, 80))
            // An 80 px chip in a 40 px tall viewport: the viewport cuts across the scroll axis.
            addView(label(context, "Chip"), LinearLayout.LayoutParams(120, 80))
            addView(View(context), LinearLayout.LayoutParams(300, 80))
          },
          FrameLayout.LayoutParams(WRAP_CONTENT, 80)
        )
      }
      FrameLayout(context).apply {
        addView(scroll, FrameLayout.LayoutParams(MATCH_PARENT, 40).apply { topMargin = 100 })
      }
    }
    val window = TextLayoutSnapshot.screenRect((scroll.context as Activity).window.decorView)
    val viewport = TextLayoutSnapshot.screenRect(scroll)
    // The chip's left 235 px past the window's right edge, as a chip at x 1315 on a 1080 px screen.
    val past = window.right - viewport.left + 235
    spacer.layoutParams.width = past
    spacer.requestLayout()
    shadowOf(Looper.getMainLooper()).idle()
    assertEquals(0, scroll.scrollX)
    assertEquals(window.right, viewport.right)
    val snapshot = snapshot()
    val record = only(snapshot, "Chip")
    val box = ProbeRect(viewport.left + past, viewport.top, viewport.left + past + 120, viewport.top + 80)
    assertEquals(window.right + 235, box.left)
    assertEquals(box, record.viewRect)
    assertTrue(record.scrolledAway)
    assertFalse(record.offWindow)
    assertNull(record.visibleRect)
    // The travel reaches the whole chip along x; across the axis the 40 px viewport cuts it.
    assertEquals(ProbeRect(box.left, box.top, box.right, box.top + 40), record.clipRect)
    val json = wired(snapshot, "Chip")
    assertEquals(box, json.rectOf("viewRect"))
    assertTrue(json.isNull("visibleRect"))
    assertEquals(record.clipRect, json.rectOf("clipRect"))
    assertTrue(json.getBoolean("scrolledAway"))
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

  // TEA ruling 2026-11-14 (r44 3): React Native's Switch is known, with empty text, while it shows
  // no text; with showText on its thumb text has a layout of its own, so it stays unknown.
  private fun switchRecord(showText: Boolean): ProbeRecord {
    host { context ->
      column(context, com.facebook.react.views.switchview.ReactSwitch(context).apply {
        text = "Label"
        this.showText = showText
        textOn = "On"
        textOff = "Off"
      })
    }
    return snapshot().records.single { it.kind.contains("Switch") }
  }

  @Test
  fun aReactSwitchShowingNoTextIsAKnownKindWithEmptyText() {
    val record = switchRecord(showText = false)
    assertEquals("ReactSwitch", record.kind)
    assertEquals("", record.text)
    assertEquals(record.viewRect, record.contentRect)
    assertEquals(0, record.lineCount)
    assertNull(record.maxLines)
    assertNull(record.unlimitedLineCount)
  }

  @Test
  fun aReactSwitchShowingTextIsUnknown() {
    assertEquals(
      "unknown:com.facebook.react.views.switchview.ReactSwitch",
      switchRecord(showText = true).kind
    )
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
    // Past the travel by layout: cut to nothing, not offWindow (r44 P1-1).
    assertFalse(far.offWindow)
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

  // TEA ruling 2026-11-14 (r44 P1-1): offWindow only when a translation of the view or an
  // ancestor put the text off the window; off the window by layout alone it is cut to nothing.

  /** A 200 px hidden-overflow sheet holding "Parked sheet", [place] moving it below the window. */
  private fun parked(place: (sheet: View, below: Int) -> Unit): ProbeRecord {
    lateinit var sheet: View
    host { context ->
      sheet = inside(OverflowViewGroup(context, "hidden"), label(context, "Parked sheet"))
      FrameLayout(context).apply { addView(sheet, FrameLayout.LayoutParams(300, 200)) }
    }
    val window = TextLayoutSnapshot.screenRect((sheet.context as Activity).window.decorView)
    place(sheet, window.bottom + 50)
    shadowOf(Looper.getMainLooper()).idle()
    val record = only(snapshot(), "Parked sheet")
    assertTrue(record.viewRect.top > window.bottom)
    assertNull(record.visibleRect)
    assertNull(record.clipRect)
    assertFalse(record.scrolledAway)
    return record
  }

  @Test
  fun aParkedSheetBelowTheScreenIsOffWindowAndNotScrolledAway() {
    val record = parked { sheet, below -> sheet.translationY = below.toFloat() }
    assertTrue(record.offWindow)
  }

  @Test
  fun aSheetLaidOutBelowTheScreenIsCutToNothingNotOffWindow() {
    val record = parked { sheet, below ->
      (sheet.layoutParams as FrameLayout.LayoutParams).topMargin = below
      sheet.requestLayout()
    }
    assertFalse(record.offWindow)
  }

  /** Antigravity r44 PROBE_4B: a non-scrolling footer pushed past the window bottom by layout. */
  @Test
  fun r44AFooterPushedPastTheWindowBottomIsCutToNothingNotOffWindow() {
    lateinit var spacer: View
    host { context ->
      spacer = View(context).apply { layoutParams = LinearLayout.LayoutParams(MATCH_PARENT, 0) }
      column(context, spacer, label(context, "Footer").apply {
        layoutParams = LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT)
      })
    }
    val window = TextLayoutSnapshot.screenRect((spacer.context as Activity).window.decorView)
    spacer.layoutParams.height = window.bottom + 40
    spacer.requestLayout()
    shadowOf(Looper.getMainLooper()).idle()
    val record = only(snapshot(), "Footer")
    assertTrue(record.viewRect.top > window.bottom)
    assertFalse(record.offWindow)
    assertNull(record.clipRect)
    assertNull(record.visibleRect)
    assertFalse(record.scrolledAway)
  }

  /** Antigravity r44: a row item pushed past the window right by layout, with no scroll view. */
  @Test
  fun r44ARightOverflowRowItemPastTheWindowIsCutToNothingNotOffWindow() {
    lateinit var spacer: View
    host { context ->
      spacer = View(context)
      FrameLayout(context).apply {
        clipChildren = false
        addView(
          LinearLayout(context).apply {
            clipChildren = false
            addView(spacer, LinearLayout.LayoutParams(0, 30))
            addView(label(context, "Row item"), LinearLayout.LayoutParams(80, 30))
          },
          FrameLayout.LayoutParams(WRAP_CONTENT, 30).apply { topMargin = 100 }
        )
      }
    }
    val window = TextLayoutSnapshot.screenRect((spacer.context as Activity).window.decorView)
    spacer.layoutParams.width = window.right + 20
    spacer.requestLayout()
    shadowOf(Looper.getMainLooper()).idle()
    val record = only(snapshot(), "Row item")
    assertTrue(record.viewRect.left > window.right)
    assertFalse(record.offWindow)
    assertNull(record.clipRect)
    assertNull(record.visibleRect)
    assertFalse(record.scrolledAway)
  }

  /** The text's own translation counts as its ancestors' do. */
  @Test
  fun aTextItsOwnTranslationMovesPastTheWindowRightIsOffWindow() {
    lateinit var text: View
    host { context ->
      text = label(context, "Slid away")
      FrameLayout(context).apply { addView(text, FrameLayout.LayoutParams(200, WRAP_CONTENT)) }
    }
    val window = TextLayoutSnapshot.screenRect((text.context as Activity).window.decorView)
    text.translationX = (window.right + 10).toFloat()
    shadowOf(Looper.getMainLooper()).idle()
    val record = only(snapshot(), "Slid away")
    assertTrue(record.viewRect.left > window.right)
    assertTrue(record.offWindow)
    assertNull(record.clipRect)
  }

  /** A phone-sized window for the rules that take rects directly. */
  private val screen = ProbeRect(0, 0, 1080, 2400)

  @Test
  fun aTranslationIsUndoneAsTheScaleOfTheViewsOutsideItMapsIt() {
    // A text 300 px translated under a parent scaled by 2 lies 600 px further on screen.
    val scaled = TextLayoutSnapshot.Level(emptyList(), transform = ProbeTransform(scaleX = 2f, scaleY = 2f))
    val own = ProbeTransform(translationY = 300f)
    val text = ProbeRect(10, 2700, 110, 2740)
    val (back, _) = TextLayoutSnapshot.untranslated(text, listOf(scaled), own)
    assertEquals(ProbeRect(10, 2100, 110, 2140), back)
    assertTrue(TextLayoutSnapshot.cuts(text, listOf(scaled), screen, own).offWindow)
    // Without the scale the same translation leaves it off the window: not offWindow.
    assertFalse(TextLayoutSnapshot.cuts(text, emptyList(), screen, own).offWindow)
  }

  @Test
  fun aTranslatedSheetsTextOffTheWindowEvenUntranslatedIsNotOffWindow() {
    // A sheet at 2450..2850 translated by 100 lies at 2350..2750 untranslated.
    val sheet = ProbeRect(0, 2450, 1080, 2850)
    val levels = listOf(TextLayoutSnapshot.Level(listOf(sheet), transform = ProbeTransform(translationY = 100f)))
    val cuts = TextLayoutSnapshot.cuts(ProbeRect(10, 2560, 200, 2600), levels, screen)
    assertNull(cuts.clip)
    assertFalse(cuts.offWindow)
    val reachable = TextLayoutSnapshot.cuts(ProbeRect(10, 2460, 200, 2500), levels, screen)
    assertNull(reachable.clip)
    assertTrue(reachable.offWindow)
  }

  /**
   * r45 P3-1 (mutant M11): the translation sits on an intermediate level, a sheet inside a holder
   * scaled by 2, so undoing it moves everything inside the sheet back by twice the translation.
   */
  @Test
  fun aTranslationOnAnIntermediateLevelIsUndoneAsTheScaledLevelOutsideItMapsIt() {
    val sheet = TextLayoutSnapshot.Level(
      listOf(ProbeRect(200, 2650, 1000, 2800)),
      transform = ProbeTransform(translationX = 100f, translationY = 300f)
    )
    val scaled = TextLayoutSnapshot.Level(emptyList(), transform = ProbeTransform(scaleX = 2f, scaleY = 2f))
    val text = ProbeRect(210, 2700, 310, 2740)
    val (back, moved) = TextLayoutSnapshot.untranslated(text, listOf(sheet, scaled))
    assertEquals(ProbeRect(10, 2100, 110, 2140), back)
    assertEquals(listOf(ProbeRect(0, 2050, 800, 2200)), moved[0].cuts)
    assertEquals(emptyList<ProbeRect>(), moved[1].cuts)
    val cuts = TextLayoutSnapshot.cuts(text, listOf(sheet, scaled), screen)
    assertNull(cuts.clip)
    assertTrue(cuts.offWindow)
  }

  // TEA ruling 2026-11-14 (r45 P2-3): the untranslated rect must lie wholly inside the window,
  // not merely overlap it.

  /** A 390 x 844 window, the size of the Antigravity r45 probes. */
  private val phone = ProbeRect(0, 0, 390, 844)

  /**
   * Antigravity r45 r45ProbeFocus2And3: laid out at 830..870 over an 844 px window (26 px of
   * layout overflow), then translated 30 px down to 860..900. The translation does not hide the
   * overflow, so it is cut to nothing, not offWindow.
   */
  @Test
  fun r45ALayoutOverflowPastTheWindowBottomIsNotOffWindowUnderATranslation() {
    val text = ProbeRect(10, 860, 210, 900)
    val cuts = TextLayoutSnapshot.cuts(text, emptyList(), phone, ProbeTransform(translationY = 30f))
    assertFalse(cuts.offWindow)
    assertNull(cuts.clip)
    assertNull(cuts.visible)
    assertFalse(cuts.scrolledAway)
    // Laid out at 760..800, wholly inside the window, the same text translated by 100 is.
    assertTrue(TextLayoutSnapshot.cuts(text, emptyList(), phone, ProbeTransform(translationY = 100f)).offWindow)
  }

  /** The same with real views: a 40 px label laid out across the window bottom, translated off it. */
  @Test
  fun r45ARealLabelAcrossTheWindowBottomTranslatedOffItIsNotOffWindow() {
    lateinit var text: View
    host { context ->
      text = label(context, "Across")
      FrameLayout(context).apply {
        clipChildren = false
        addView(text, FrameLayout.LayoutParams(200, 40))
      }
    }
    val window = TextLayoutSnapshot.screenRect((text.context as Activity).window.decorView)
    val top = window.bottom - 10 - TextLayoutSnapshot.screenRect(text).top
    (text.layoutParams as FrameLayout.LayoutParams).topMargin = top
    text.requestLayout()
    shadowOf(Looper.getMainLooper()).idle()
    assertEquals(window.bottom - 10, TextLayoutSnapshot.screenRect(text).top)
    text.translationY = 100f
    shadowOf(Looper.getMainLooper()).idle()
    val record = only(snapshot(), "Across")
    assertTrue(record.viewRect.top > window.bottom)
    assertFalse(record.offWindow)
    assertNull(record.clipRect)
    assertNull(record.visibleRect)
    assertFalse(record.scrolledAway)
  }

  /**
   * Whole within reach untranslated is what counts: a parked sheet's text below the fold of the
   * sheet's own scroll view is offWindow, since in place it is scrolledAway; one its own sheet cuts
   * in part untranslated is not.
   */
  @Test
  fun r45AParkedSheetsScrollContentIsOffWindowAndItsCutTextIsNot() {
    val rect = ProbeRect(0, 1400, 390, 1800)
    val sheet = TextLayoutSnapshot.Level(listOf(rect), transform = ProbeTransform(translationY = 1000f))
    val scroller = TextLayoutSnapshot.Level(listOf(rect), scrollY = ScrollTravel(0, 600))
    assertTrue(TextLayoutSnapshot.cuts(ProbeRect(10, 1900, 210, 1940), listOf(scroller, sheet), phone).offWindow)
    val cut = TextLayoutSnapshot.cuts(ProbeRect(10, 1780, 210, 1820), listOf(sheet), phone)
    assertFalse(cut.offWindow)
    assertNull(cut.clip)
  }

  // TEA ruling 2026-11-14 (r45 P2-5): content lines, padding clips and scroll travel are mapped
  // through the view's global transform, so scaled and flipped ancestors move them with the box.

  /** Antigravity r45 ANDROID_F3A_SCALED_TEXT: a label at its natural height under scaleY 0.5. */
  @Test
  fun r45AScaledParentScalesTheTextsLinesWithItsBox() {
    lateinit var text: ReactTextView
    host { context ->
      text = label(context, "Scaled")
      val holder = FrameLayout(context).apply {
        clipChildren = false
        pivotX = 0f
        pivotY = 0f
        scaleY = 0.5f
        addView(text, FrameLayout.LayoutParams(300, natural(text)))
      }
      FrameLayout(context).apply {
        clipChildren = false
        addView(holder, FrameLayout.LayoutParams(300, 400).apply { topMargin = 200 })
      }
    }
    val record = only(snapshot(), "Scaled")
    val lines = text.layout.getLineBottom(0)
    assertTrue("$record", kotlin.math.abs(record.viewRect.bottom - record.viewRect.top - lines / 2f) <= 1f)
    assertEquals(record.viewRect.top, record.contentRect.top)
    assertTrue("$record", kotlin.math.abs(record.contentRect.bottom - (record.viewRect.top + lines / 2f)) <= 1f)
    assertTrue("$record", record.contentRect.bottom <= record.visibleRect!!.bottom)
  }

  /** A flip puts the text view's own top padding at its bottom on screen, and its line above it. */
  @Test
  fun r45AFlippedParentPutsTheTextsTopPaddingBelowItsLine() {
    lateinit var text: ReactTextView
    host { context ->
      text = label(context, "Flipped").apply { setPadding(0, 30, 0, 0) }
      val height = natural(text)
      val holder = FrameLayout(context).apply {
        clipChildren = false
        scaleY = -1f
        addView(text, FrameLayout.LayoutParams(300, height))
      }
      FrameLayout(context).apply {
        clipChildren = false
        addView(holder, FrameLayout.LayoutParams(300, height).apply { topMargin = 200 })
      }
    }
    val record = only(snapshot(), "Flipped")
    val line = text.layout.getLineBottom(0)
    assertEquals(record.viewRect.top + line + 30, record.viewRect.bottom)
    assertEquals(record.viewRect.top, record.contentRect.top)
    assertEquals(record.viewRect.top + line, record.contentRect.bottom)
  }

  /**
   * Antigravity r45 ANDROID_F3C_PADDING_FLIP: a clipToPadding parent with 30 px of top padding,
   * flipped by scaleY -1, holds a 100 px label laid out at its local 30..130. On screen the padding
   * lies at the parent's bottom, so it cuts the label's bottom 30 px, not its top.
   */
  @Test
  fun r45AFlippedClipToPaddingParentCutsAtItsVisualPadding() {
    lateinit var clipper: FrameLayout
    host { context ->
      clipper = FrameLayout(context).apply {
        clipChildren = false
        clipToPadding = true
        setPadding(0, 30, 0, 0)
        scaleY = -1f
        addView(label(context, "Padded"), FrameLayout.LayoutParams(200, 100))
      }
      FrameLayout(context).apply {
        clipChildren = false
        addView(clipper, FrameLayout.LayoutParams(200, 100).apply { topMargin = 200 })
      }
    }
    val box = TextLayoutSnapshot.screenRect(clipper)
    val record = only(snapshot(), "Padded")
    assertEquals(ProbeRect(box.left, box.top - 30, box.left + 200, box.bottom - 30), record.viewRect)
    assertEquals(ProbeRect(box.left, box.top, box.left + 200, box.bottom - 30), record.visibleRect)
  }

  /** A parent's clip bounds are in its own pixels: under scaleY 0.5 a 40 px clip cuts 20 px. */
  @Test
  fun r45AScaledParentsClipBoundsScaleOnScreen() {
    lateinit var clipper: FrameLayout
    host { context ->
      clipper = FrameLayout(context).apply {
        clipChildren = false
        pivotX = 0f
        pivotY = 0f
        scaleY = 0.5f
        clipBounds = android.graphics.Rect(0, 0, 200, 40)
        addView(label(context, "Bounded"), FrameLayout.LayoutParams(200, 100))
      }
      FrameLayout(context).apply {
        clipChildren = false
        addView(clipper, FrameLayout.LayoutParams(200, 100).apply { topMargin = 200 })
      }
    }
    val box = TextLayoutSnapshot.screenRect(clipper)
    val record = only(snapshot(), "Bounded")
    assertEquals(ProbeRect(box.left, box.top, box.left + 200, box.top + 50), record.viewRect)
    assertEquals(ProbeRect(box.left, box.top, box.left + 200, box.top + 20), record.visibleRect)
  }

  /**
   * A 300..600 viewport with 200 px of travel at offset 0 under a holder scaled by 0.5 opens
   * 100 px below on screen, and by 2, 400 px; flipped and scaled by 0.5 the band mirrors and keeps
   * the scale.
   */
  @Test
  fun r45AScaledAncestorScalesTheScrollTravelOnScreen() {
    fun cuts(top: Int, scaleY: Float) = TextLayoutSnapshot.cuts(
      ProbeRect(10, top, 210, top + 20),
      listOf(
        TextLayoutSnapshot.Level(listOf(ProbeRect(0, 300, 1080, 600)), scrollY = ScrollTravel(0, 200)),
        TextLayoutSnapshot.Level(emptyList(), transform = ProbeTransform(scaleY = scaleY))
      ),
      screen
    )
    assertEquals(ProbeRect(10, 680, 210, 700), cuts(680, 0.5f).clip)
    assertEquals(ProbeRect(10, 690, 210, 700), cuts(690, 0.5f).clip)
    assertNull(cuts(720, 0.5f).clip)
    assertEquals(ProbeRect(10, 980, 210, 1000), cuts(980, 2f).clip)
    assertNull(cuts(1000, 2f).clip)
    assertEquals(ProbeRect(10, 200, 210, 210), cuts(190, -0.5f).clip)
    assertNull(cuts(600, -0.5f).clip)
  }

  // TEA ruling 2026-11-14 (r44 P2-2): an inverted scroll view (its content flipped on screen on
  // that axis) moves its content down as its offset grows, so its band mirrors.

  private fun invertedCuts(top: Int, offset: Int, vararg outer: ProbeTransform, own: ProbeTransform) =
    TextLayoutSnapshot.cuts(
      ProbeRect(10, top, 210, top + 40),
      listOf(TextLayoutSnapshot.Level(listOf(ProbeRect(0, 300, 1080, 600)), scrollY = ScrollTravel(offset, 100), transform = own)) +
        outer.map { TextLayoutSnapshot.Level(emptyList(), transform = it) },
      screen
    )

  @Test
  fun anInvertedBandOpensTheSideItsOffsetCanScrollInAndKeepsTheOtherClosed() {
    val flip = ProbeTransform(scaleY = -1f)
    // Offset 0 of 100: the band is 200..600.
    val above = invertedCuts(220, 0, own = flip)
    assertEquals(ProbeRect(10, 220, 210, 260), above.clip)
    assertTrue(above.scrolledAway)
    assertEquals(ProbeRect(10, 200, 210, 220), invertedCuts(180, 0, own = flip).clip)
    val below = invertedCuts(620, 0, own = flip)
    assertNull(below.clip)
    assertFalse(below.scrolledAway)
    assertFalse(below.offWindow)
    // Offset 30 of 100: 70 above, 30 below; the band is 230..630.
    assertEquals(ProbeRect(10, 230, 210, 240), invertedCuts(200, 30, own = flip).clip)
    assertEquals(ProbeRect(10, 600, 210, 630), invertedCuts(600, 30, own = flip).clip)
    // React Native Android's inverted list flips both axes (scale -1): the same band.
    assertEquals(above.clip, invertedCuts(220, 0, own = ProbeTransform(scaleX = -1f, scaleY = -1f)).clip)
  }

  @Test
  fun aFlipAboveTheScrollViewInvertsItAndAFlipInsideAFlipDoesNot() {
    val flip = ProbeTransform(scaleY = -1f)
    assertEquals(ProbeRect(10, 220, 210, 260), invertedCuts(220, 0, flip, own = ProbeTransform.NONE).clip)
    assertNull(invertedCuts(220, 0, flip, own = flip).clip)
    assertEquals(ProbeRect(10, 620, 210, 660), invertedCuts(620, 0, flip, own = flip).clip)
  }

  @Test
  fun aHorizontallyInvertedScrollViewReachesLeftOfItsViewport() {
    val levels = listOf(
      TextLayoutSnapshot.Level(
        listOf(ProbeRect(200, 100, 300, 140)),
        scrollX = ScrollTravel(0, 100),
        transform = ProbeTransform(scaleX = -1f)
      )
    )
    val left = TextLayoutSnapshot.cuts(ProbeRect(120, 100, 160, 140), levels, screen)
    assertEquals(ProbeRect(120, 100, 160, 140), left.clip)
    assertTrue(left.scrolledAway)
    assertNull(TextLayoutSnapshot.cuts(ProbeRect(310, 100, 350, 140), levels, screen).clip)
  }

  /**
   * A 100 px scroll view at [CONTAINER_TOP] with 300 px of content (travel 200) at [offset], the
   * scroll view and each 20 px row flipped as an inverted list's are, rows named by content top.
   */
  private fun invertedList(offset: Int, flipX: Boolean, vararg tops: Int): Pair<ScrollView, Map<Int, ProbeRecord>> {
    lateinit var scroll: ScrollView
    fun flipped(view: View) = view.apply {
      scaleY = -1f
      if (flipX) scaleX = -1f
    }
    host { context ->
      scroll = flipped(ScrollView(context)) as ScrollView
      scroll.addView(
        content(context, 300, *tops.map { flipped(label(context, "Row $it")) to at(it, 300, 20) }.toTypedArray())
      )
      FrameLayout(context).apply {
        addView(scroll, FrameLayout.LayoutParams(300, 100).apply { topMargin = CONTAINER_TOP })
      }
    }
    scroll.scrollTo(0, offset)
    shadowOf(Looper.getMainLooper()).idle()
    assertEquals(offset, scroll.scrollY)
    val records = snapshot().records
    return scroll to tops.associateWith { top -> records.single { it.text == "Row $top" } }
  }

  @Test
  fun aRealInvertedListReachesTheRowsAboveItsViewport() = assertInvertedList(flipX = false)

  /** React Native Android's inverted list: scale -1, both axes. */
  @Test
  fun aRealInvertedListFlippedOnBothAxesReachesTheRowsAboveItsViewport() = assertInvertedList(flipX = true)

  private fun assertInvertedList(flipX: Boolean) {
    val (scroll, rows) = invertedList(50, flipX, 0, 40, 230)
    val viewport = TextLayoutSnapshot.screenRect(scroll)
    val parent = TextLayoutSnapshot.screenRect(scroll.parent as View)
    // The flipped scroll view's box is where it is laid out, not shifted by its own height.
    assertEquals("flipX $flipX", parent.top + CONTAINER_TOP, viewport.top)
    assertEquals("flipX $flipX", viewport.top + 100, viewport.bottom)
    // Content top c shows at viewport top + 80 - c + offset on screen.
    val first = rows.getValue(0)
    assertEquals("flipX $flipX", viewport.top + 130, first.viewRect.top)
    assertEquals("flipX $flipX", first.viewRect, first.clipRect)
    // Visually 80..100 above the viewport: 150 of travel lies that way, so it is reachable.
    val above = rows.getValue(230)
    assertEquals("flipX $flipX", viewport.top - 100, above.viewRect.top)
    assertEquals("flipX $flipX", above.viewRect, above.clipRect)
    assertTrue("flipX $flipX", above.scrolledAway)
    assertNull("flipX $flipX", above.visibleRect)
    // Straddling the viewport bottom: visible in part, reachable whole.
    val straddle = rows.getValue(40)
    assertEquals("flipX $flipX", straddle.viewRect, straddle.clipRect)
    assertEquals("flipX $flipX", viewport.bottom, straddle.visibleRect!!.bottom)
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

  // TEA ruling 2026-11-14: accessibility elements are listed apart from the text records,
  // {identifier, label, rect, hasText, window}, never judged and never counted as text.

  /** testID as React Native's BaseViewManager.setTestId sets it: the keyed tag and the plain one. */
  private fun <T : View> T.testId(id: String): T = apply {
    setTag(com.facebook.react.R.id.react_test_id, id)
    tag = id
  }

  @Test
  fun anImageWithALabelAndNoTextHasNoText() {
    lateinit var image: View
    host { context ->
      image = ImageView(context).apply {
        contentDescription = "Outfit photo"
        layoutParams = LinearLayout.LayoutParams(80, 80)
      }.testId("outfit-photo")
      column(context, image)
    }
    val snapshot = snapshot()
    assertEquals(
      listOf(ProbeElement("outfit-photo", "Outfit photo", TextLayoutSnapshot.screenRect(image), false, 0)),
      snapshot.elements
    )
    assertTrue("an element is no record", snapshot.records.isEmpty())
  }

  @Test
  fun aButtonWhoseLabelEchoesItsChildTextHasText() {
    host { context ->
      column(
        context,
        OverflowViewGroup(context, "hidden").apply {
          contentDescription = "Save"
          isFocusable = true
          addView(label(context, "Save"))
        }.testId("save-button")
      )
    }
    val snapshot = snapshot()
    assertEquals(listOf("save-button" to true), snapshot.elements.map { it.identifier to it.hasText })
    assertEquals(listOf("Save"), snapshot.elements.map { it.label })
    // The text keeps its own record.
    assertEquals(listOf("Save"), snapshot.records.map { it.text })
  }

  @Test
  fun aContainerLabelHasTextAndTheElementsInsideItAreListedAfterIt() {
    host { context ->
      column(
        context,
        FrameLayout(context).apply {
          contentDescription = "Outfit card"
          addView(
            column(
              context,
              label(context, "Jacket"),
              ImageView(context).apply { contentDescription = "Heart" }
            )
          )
        }.testId("outfit-card")
      )
    }
    val elements = snapshot().elements
    assertEquals(listOf("Outfit card", "Heart"), elements.map { it.label })
    assertEquals(listOf(true, false), elements.map { it.hasText })
    assertEquals(listOf("outfit-card", null), elements.map { it.identifier })
  }

  /**
   * React Native joins accessibilityLabel, the busy or mixed state and accessibilityValue.text
   * into contentDescription (BaseViewManager.updateViewContentDescription); the placeholder stays
   * the hint, so the input's label is its contentDescription alone.
   */
  @Test
  fun anInputsLabelIsItsContentDescriptionWithoutTheHintAndItHasText() {
    host { context ->
      column(
        context,
        ReactEditText(context).apply {
          hint = "name@example.com"
          contentDescription = "Email, required"
          setTextSize(TypedValue.COMPLEX_UNIT_PX, 20f)
          layoutParams = LinearLayout.LayoutParams(300, WRAP_CONTENT)
        }.testId("email-input")
      )
    }
    val snapshot = snapshot()
    assertEquals(listOf("Email, required"), snapshot.elements.map { it.label })
    assertEquals(listOf(true), snapshot.elements.map { it.hasText })
    assertEquals(listOf("email-input"), snapshot.elements.map { it.identifier })
    assertEquals(snapshot.records.single().viewRect, snapshot.elements.single().rect)
  }

  @Test
  fun anEmptyOrMissingTestIdIsNullAndAnEmptyLabelIsNotAnElement() {
    host { context ->
      column(
        context,
        ImageView(context).apply { contentDescription = "Close" }.testId(""),
        ImageView(context).apply { contentDescription = "Back" },
        ImageView(context).apply { contentDescription = "" }.testId("blank"),
        ImageView(context).testId("unlabelled"),
        // A plain tag that is no testID is not read.
        ImageView(context).apply {
          contentDescription = "Plain tag"
          tag = "not-a-test-id"
        }
      )
    }
    val elements = snapshot().elements
    assertEquals(listOf("Close", "Back", "Plain tag"), elements.map { it.label })
    assertEquals(listOf(null, null, null), elements.map { it.identifier })
  }

  @Test
  fun hiddenAndAccessibilityHiddenElementsAreSkippedYetCountForText() {
    host { context ->
      column(
        context,
        ImageView(context).apply {
          contentDescription = "Invisible"
          visibility = View.INVISIBLE
        },
        ImageView(context).apply {
          contentDescription = "Gone"
          visibility = View.GONE
        },
        ImageView(context).apply {
          contentDescription = "Clear"
          alpha = 0f
        },
        FrameLayout(context).apply {
          alpha = 0f
          addView(ImageView(context).apply { contentDescription = "Under clear" })
        },
        FrameLayout(context).apply {
          visibility = View.INVISIBLE
          addView(ImageView(context).apply { contentDescription = "Under invisible" })
        },
        ImageView(context).apply {
          contentDescription = "Not important"
          importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
        },
        FrameLayout(context).apply {
          importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
          addView(ImageView(context).apply { contentDescription = "Under hide descendants" })
        },
        // A shown element whose only text is faded to 0 (itself, or a group around it) still
        // holds that text's record.
        FrameLayout(context).apply {
          contentDescription = "Holder"
          addView(label(context, "Faded").apply { alpha = 0f })
        },
        FrameLayout(context).apply {
          contentDescription = "Outer holder"
          addView(FrameLayout(context).apply {
            alpha = 0f
            addView(label(context, "Under a faded group"))
          })
        }
      )
    }
    val snapshot = snapshot()
    assertEquals(listOf("Holder", "Outer holder"), snapshot.elements.map { it.label })
    assertEquals(listOf(true, true), snapshot.elements.map { it.hasText })
    assertEquals(0.0, snapshot.records.single { it.text == "Faded" }.opacity, 0.0)
    assertEquals(0.0, snapshot.records.single { it.text == "Under a faded group" }.opacity, 0.0)
  }

  @Test
  fun elementsRunInWindowOrderThenTreeOrder() {
    val activity = host { context ->
      column(
        context,
        FrameLayout(context).apply {
          contentDescription = "A"
          addView(label(context, "A text"))
        },
        column(context, ImageView(context).apply { contentDescription = "B" }, label(context, "Loose")),
        ImageView(context).apply { contentDescription = "C" }
      )
    }
    val dialog = Dialog(activity)
    dialog.setContentView(
      column(activity, ImageView(activity).apply { contentDescription = "D" }.testId("dialog-d"))
    )
    dialog.show()
    shadowOf(Looper.getMainLooper()).idle()
    val snapshot = snapshot()
    val behind = snapshot.records.single { it.text == "A text" }.window
    assertEquals(listOf("A", "B", "C", "D"), snapshot.elements.map { it.label })
    assertEquals(listOf(true, false, false, false), snapshot.elements.map { it.hasText })
    assertEquals(listOf(behind, behind, behind, 1 - behind), snapshot.elements.map { it.window })
    assertEquals(snapshot.elements, snapshot().elements)
  }

  // TEA ruling: native flags a record hidden from accessibility. Android: importantForAccessibility
  // no-hide-descendants on the view or any ancestor, or no on the view itself with no ancestor
  // that is important for accessibility and focusable as a group.

  private fun hidden(snapshot: ProbeSnapshot, text: String) = only(snapshot, text).accessibilityHidden

  private fun hiddenText(context: Context, value: String, mode: Int) =
    label(context, value).apply { importantForAccessibility = mode }

  /**
   * apps/mobile/components/home/home-spotlight-teaser.tsx: the Partnered pill's Text carries
   * `accessible={false}` (not focusable), `importantForAccessibility="no-hide-descendants"` and
   * `aria-hidden`, beside the accessible link (a focusable group with the link label) and the Shop
   * control, whose texts they read.
   */
  @Test
  fun theSpotlightTeasersPartneredPillIsHiddenAndTheLinkAndShopTextsAreNot() {
    host { context ->
      val link = FrameLayout(context).apply {
        contentDescription = "Look of the week by Ada, 3 reactions, Partnered with Acme"
        isFocusable = true
        isClickable = true
        addView(column(context, label(context, "Look of the week"), label(context, "Ada")))
      }.testId("home-spotlight-teaser-link")
      val pill = FrameLayout(context).apply {
        addView(
          label(context, "Partnered").apply {
            isFocusable = false
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
          }
        )
      }.testId("home-spotlight-teaser-partnered")
      val shop = FrameLayout(context).apply {
        contentDescription = "Shop at Acme"
        isFocusable = true
        addView(label(context, "Shop at Acme"))
      }.testId("home-spotlight-teaser-shop")
      column(context, column(context, link, column(context, pill, shop))).testId("home-spotlight-teaser")
    }
    val snapshot = snapshot()
    assertTrue(hidden(snapshot, "Partnered"))
    assertFalse(hidden(snapshot, "Look of the week"))
    assertFalse(hidden(snapshot, "Ada"))
    assertFalse(hidden(snapshot, "Shop at Acme"))
    // The pill still draws: it keeps its record at full opacity.
    assertEquals(1.0, only(snapshot, "Partnered").opacity, 0.0)
  }

  @Test
  fun noHideDescendantsOnAnyAncestorHidesTheTextEvenInsideAFocusableGroup() {
    host { context ->
      column(
        context,
        FrameLayout(context).apply {
          importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
          addView(
            FrameLayout(context).apply {
              contentDescription = "Card"
              isFocusable = true
              addView(column(context, label(context, "Under hide descendants")))
            }
          )
        },
        label(context, "Beside it")
      )
    }
    val snapshot = snapshot()
    assertTrue(hidden(snapshot, "Under hide descendants"))
    assertFalse(hidden(snapshot, "Beside it"))
  }

  @Test
  fun aTextMarkedNoIsHiddenUnlessAnImportantFocusableAncestorGroupsIt() {
    host { context ->
      column(
        context,
        // No group above: hidden.
        hiddenText(context, "Loose no", View.IMPORTANT_FOR_ACCESSIBILITY_NO),
        // An accessible ancestor (React Native's accessible: focusable, important by AUTO) reads it.
        FrameLayout(context).apply {
          isFocusable = true
          addView(column(context, hiddenText(context, "Grouped no", View.IMPORTANT_FOR_ACCESSIBILITY_NO)))
        },
        // A screen reader group reads it too.
        FrameLayout(context).apply {
          importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_YES
          isScreenReaderFocusable = true
          addView(hiddenText(context, "Screen reader group no", View.IMPORTANT_FOR_ACCESSIBILITY_NO))
        },
        // Focusable but not important for accessibility: no group.
        FrameLayout(context).apply {
          isFocusable = true
          importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
          addView(hiddenText(context, "Unimportant focusable no", View.IMPORTANT_FOR_ACCESSIBILITY_NO))
        },
        // Important for accessibility but not focusable: no group.
        FrameLayout(context).apply {
          importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_YES
          addView(hiddenText(context, "Important unfocusable no", View.IMPORTANT_FOR_ACCESSIBILITY_NO))
        }
      )
    }
    val snapshot = snapshot()
    assertTrue(hidden(snapshot, "Loose no"))
    assertFalse(hidden(snapshot, "Grouped no"))
    assertFalse(hidden(snapshot, "Screen reader group no"))
    assertTrue(hidden(snapshot, "Unimportant focusable no"))
    assertTrue(hidden(snapshot, "Important unfocusable no"))
  }

  @Test
  fun anOrdinaryTextAndATextUnderAnAncestorMarkedNoAreNotHidden() {
    host { context ->
      column(
        context,
        label(context, "Plain"),
        hiddenText(context, "Marked yes", View.IMPORTANT_FOR_ACCESSIBILITY_YES),
        // NO on an ancestor leaves out that ancestor alone.
        FrameLayout(context).apply {
          importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
          addView(label(context, "Under an ancestor marked no"))
        }
      )
    }
    val snapshot = snapshot()
    assertFalse(hidden(snapshot, "Plain"))
    assertFalse(hidden(snapshot, "Marked yes"))
    assertFalse(hidden(snapshot, "Under an ancestor marked no"))
  }

  @Test
  fun theTestIdKeyIsReadFromReactNativesRClassOrElseByName() {
    val ownLoader = javaClass.classLoader
    assertEquals(
      com.facebook.react.R.id.react_test_id,
      ReactNativeTextClasses.testIdKey(ownLoader, null, null)
    )
    // A minified build without React Native's R class: the resource of that name.
    val withoutR = object : ClassLoader(ownLoader) {
      override fun loadClass(name: String, resolve: Boolean): Class<*> =
        if (name == ReactNativeTextClasses.REACT_ID_CLASS) throw ClassNotFoundException(name)
        else super.loadClass(name, resolve)
    }
    val base = androidx.test.core.app.ApplicationProvider.getApplicationContext<Context>().resources
    @Suppress("DEPRECATION")
    val named = object : Resources(base.assets, base.displayMetrics, base.configuration) {
      override fun getIdentifier(name: String, defType: String, defPackage: String): Int =
        if (name == "react_test_id" && defType == "id" && defPackage == "com.example.app") 0x7f0f0b02 else 0
    }
    assertEquals(0x7f0f0b02, ReactNativeTextClasses.testIdKey(withoutR, named, "com.example.app"))
    assertNull(ReactNativeTextClasses.testIdKey(withoutR, named, "com.other"))
    assertNull(ReactNativeTextClasses.testIdKey(withoutR, null, null))
    // Without the key there is no answer, so identifiers cannot silently read null.
    assertNull(ReactNativeTextClasses.load(withoutR))
    assertNotNull(ReactNativeTextClasses.load(withoutR, named, "com.example.app"))
  }

  private companion object {
    const val CONTAINER_TOP = 200
  }
}
