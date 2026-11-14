package expo.modules.textlayoutprobe

import android.Manifest
import android.app.Application
import android.content.Intent
import android.os.Looper
import android.util.Base64
import android.view.View
import androidx.test.core.app.ApplicationProvider
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowLog

/** Story 6.15 F-00i: the version 1 JSON and its logcat chunk lines, and the receiver. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [32, 36])
class TextLayoutProbeWireTest {
  private val rect = ProbeRect(1, 2, 30, 40)

  private fun record(text: String) = ProbeRecord(
    kind = "ReactTextView",
    text = text,
    viewRect = rect,
    visibleRect = null,
    clipRect = rect,
    contentRect = ProbeRect(1, 2, 30, 60),
    lineCount = 2,
    maxLines = null,
    ellipsized = 0,
    unlimitedLineCount = 2,
    window = 0,
    scrolledAway = false,
    opacity = 0.25,
    accessibilityHidden = false
  )

  private val windows = listOf(ProbeWindow(0, ProbeRect(0, 0, 1080, 2400), 0, true))

  private fun reassemble(token: String, lines: List<String>): String {
    val begin = lines.first().split(' ')
    assertEquals(listOf("begin", token), begin.take(2))
    val count = begin[2].toInt()
    assertEquals(count + 2, lines.size)
    val bytes = (0 until count).flatMap { index ->
      val parts = lines[index + 1].split(' ')
      assertEquals(listOf("chunk", token, index.toString()), parts.take(3))
      assertEquals(4, parts.size)
      assertTrue("chunk of ${parts[3].length} chars", parts[3].length <= 3000)
      Base64.decode(parts[3], Base64.NO_WRAP).toList()
    }.toByteArray()
    assertEquals(TextLayoutProbeWire.sha256(bytes), begin[3])
    assertTrue(begin[3].matches(Regex("^[0-9a-f]{64}$")))
    assertEquals("done $token", lines.last())
    return String(bytes, Charsets.UTF_8)
  }

  @Test
  fun theJsonCarriesEveryContractField() {
    val json = TextLayoutProbeWire.json("t1", ProbeSnapshot(windows, listOf(record("Ünïcode \"q\"\n\\"))))
    val parsed = JSONObject(json)
    assertEquals(1, parsed.getInt("version"))
    assertEquals("t1", parsed.getString("token"))
    assertEquals("android", parsed.getString("platform"))
    val window = parsed.getJSONArray("windows").getJSONObject(0)
    assertEquals(setOf("id", "rect", "z", "focused"), window.keys().asSequence().toSet())
    assertTrue(window.getBoolean("focused"))
    val first = parsed.getJSONArray("records").getJSONObject(0)
    assertEquals(
      setOf(
        "kind", "text", "viewRect", "visibleRect", "clipRect", "contentRect", "lineCount",
        "maxLines", "ellipsized", "unlimitedLineCount", "window", "scrolledAway", "offWindow",
        "opacity", "accessibilityHidden"
      ),
      first.keys().asSequence().toSet()
    )
    assertEquals("Ünïcode \"q\"\n\\", first.getString("text"))
    assertTrue(first.isNull("visibleRect"))
    assertTrue(first.isNull("maxLines"))
    assertEquals(60, first.getJSONArray("contentRect").getInt(3))
    assertFalse(first.getBoolean("scrolledAway"))
    assertFalse(first.getBoolean("offWindow"))
    assertEquals(0.25, first.getDouble("opacity"), 0.0)
    assertTrue(json.contains("\"opacity\":0.25,\"accessibilityHidden\":false}"))
    assertFalse(first.getBoolean("accessibilityHidden"))
    assertEquals(
      setOf("version", "token", "platform", "windows", "records", "elements"),
      parsed.keys().asSequence().toSet()
    )
    assertEquals(0, parsed.getJSONArray("elements").length())
  }

  // TEA ruling 2026-11-14: accessibility elements travel in their own list beside the records.
  @Test
  fun eachElementIsWrittenWithItsIdentifierLabelRectHasTextAndWindow() {
    val elements = listOf(
      ProbeElement("save-button", "Save \"now\"", ProbeRect(10, 20, 110, 64), true, 0),
      ProbeElement(null, "Outfit photo", ProbeRect(0, 0, 80, 80), false, 1)
    )
    val json = TextLayoutProbeWire.json("e1", ProbeSnapshot(windows, emptyList(), elements))
    assertTrue(
      json,
      json.endsWith(
        "\"records\":[],\"elements\":[" +
          "{\"identifier\":\"save-button\",\"label\":\"Save \\\"now\\\"\",\"rect\":[10,20,110,64]," +
          "\"hasText\":true,\"window\":0}," +
          "{\"identifier\":null,\"label\":\"Outfit photo\",\"rect\":[0,0,80,80]," +
          "\"hasText\":false,\"window\":1}]}"
      )
    )
    val parsed = JSONObject(reassemble("e1", TextLayoutProbeWire.lines("e1", json)))
    val first = parsed.getJSONArray("elements").getJSONObject(0)
    assertEquals(setOf("identifier", "label", "rect", "hasText", "window"), first.keys().asSequence().toSet())
    assertEquals("Save \"now\"", first.getString("label"))
    assertTrue(parsed.getJSONArray("elements").getJSONObject(1).isNull("identifier"))
  }

  // TEA ruling 2026-11-14 (r43 P2): the raw opacity, so only an exact 0 reads as invisible.
  @Test
  fun opacityIsWrittenUnroundedInPlainNotation() {
    assertEquals("1", TextLayoutProbeWire.number(1.0))
    assertEquals("0", TextLayoutProbeWire.number(0.0))
    assertEquals("0.25", TextLayoutProbeWire.number(0.25))
    assertEquals("0.0001", TextLayoutProbeWire.number(0.0001))
    assertEquals("0.00001", TextLayoutProbeWire.number(0.00001))
    assertEquals("0.3333333333333333", TextLayoutProbeWire.number(1.0 / 3))
    // A view alpha is a float: its double reads back exactly.
    for (alpha in listOf(4e-5f, 0.01f, 0.999f)) {
      val written = TextLayoutProbeWire.number(alpha.toDouble())
      assertFalse(written, written.contains('E') || written.contains('e'))
      assertEquals(alpha.toDouble(), written.toDouble(), 0.0)
    }
  }

  // TEA ruling 2026-11-14 (r44 P3-1): a NaN opacity refuses the answer with its own code; it is
  // never coerced or dropped, and the refusal travels chunked and hashed like any answer.
  @Test
  fun aNaNOpacityRefusesTheAnswerWithItsOwnCode() {
    val records = listOf(record("Fine"), record("Broken").copy(opacity = Double.NaN))
    val json = TextLayoutProbeWire.json("t-nan", ProbeSnapshot(windows, records))
    assertEquals(
      "{\"version\":1,\"token\":\"t-nan\",\"platform\":\"android\"," +
        "\"error\":{\"code\":\"text_probe_opacity_invalid\",\"record\":1,\"kind\":\"ReactTextView\"}}",
      json
    )
    val parsed = JSONObject(reassemble("t-nan", TextLayoutProbeWire.lines("t-nan", json)))
    assertEquals(setOf("version", "token", "platform", "error"), parsed.keys().asSequence().toSet())
    assertEquals("text_probe_opacity_invalid", parsed.getJSONObject("error").getString("code"))
    for (bad in listOf(-0.5, 1.5, Double.POSITIVE_INFINITY)) {
      val refused = JSONObject(TextLayoutProbeWire.json("t", ProbeSnapshot(windows, listOf(record("Odd").copy(opacity = bad)))))
      assertTrue("$bad", refused.has("error"))
      assertFalse("$bad", refused.has("records"))
    }
    for (bad in listOf(Double.NaN, -0.5, 1.5)) {
      val thrown = runCatching { TextLayoutProbeWire.number(bad) }.exceptionOrNull()
      assertTrue("$bad: $thrown", thrown is IllegalArgumentException)
    }
  }

  @Test
  fun aNaNAlphaUpTheTreeGivesANaNOpacity() {
    val application = ApplicationProvider.getApplicationContext<Application>()
    val parent = android.widget.FrameLayout(application)
    val child = View(application)
    parent.addView(child)
    parent.alpha = Float.NaN
    assertTrue(TextLayoutSnapshot.effectiveOpacity(child).isNaN())
  }

  @Test
  fun aFaintAndAnOffWindowRecordKeepTheirFieldsOnTheWire() {
    val faint = record("Faint").copy(opacity = 4e-5f.toDouble(), clipRect = null, offWindow = true)
    val first = JSONObject(TextLayoutProbeWire.json("f", ProbeSnapshot(windows, listOf(faint))))
      .getJSONArray("records").getJSONObject(0)
    assertTrue(first.getDouble("opacity") > 0)
    assertEquals(4e-5f.toDouble(), first.getDouble("opacity"), 0.0)
    assertTrue(first.getBoolean("offWindow"))
    assertFalse(first.getBoolean("scrolledAway"))
    assertTrue(first.isNull("clipRect"))
  }

  // TEA ruling 2026-11-14: a scrolled-away record keeps its full viewRect, never clamped.
  @Test
  fun aScrolledAwayChipPastTheWindowRightKeepsItsFullViewRectOnTheWire() {
    // A chip at x 1315 on a 1080 px window, 80 px tall in a 40 px horizontal scroll viewport.
    val chip = record("Chip").copy(
      viewRect = ProbeRect(1315, 600, 1435, 680),
      visibleRect = null,
      clipRect = ProbeRect(1315, 600, 1435, 640),
      contentRect = ProbeRect(1315, 600, 1435, 680),
      scrolledAway = true
    )
    val json = TextLayoutProbeWire.json("w", ProbeSnapshot(windows, listOf(chip)))
    val first = JSONObject(reassemble("w", TextLayoutProbeWire.lines("w", json)))
      .getJSONArray("records").getJSONObject(0)
    assertEquals("[1315,600,1435,680]", first.getJSONArray("viewRect").toString())
    assertEquals("[1315,600,1435,640]", first.getJSONArray("clipRect").toString())
    assertTrue(first.isNull("visibleRect"))
    assertTrue(first.getBoolean("scrolledAway"))
    assertFalse(first.getBoolean("offWindow"))
  }

  // TEA ruling: native flags a record hidden from accessibility, a JSON boolean on every record.
  @Test
  fun accessibilityHiddenIsWrittenAsABooleanOnEveryRecord() {
    val records = listOf(record("Partnered").copy(accessibilityHidden = true), record("Look"))
    val json = TextLayoutProbeWire.json("h", ProbeSnapshot(windows, records))
    val parsed = JSONObject(reassemble("h", TextLayoutProbeWire.lines("h", json))).getJSONArray("records")
    assertTrue(parsed.getJSONObject(0).getBoolean("accessibilityHidden"))
    assertFalse(parsed.getJSONObject(1).getBoolean("accessibilityHidden"))
    assertTrue(json, json.contains("\"accessibilityHidden\":true}"))
    assertTrue(json, json.contains("\"accessibilityHidden\":false}"))
  }

  @Test
  fun aSmallAnswerIsOneChunkWithItsHash() {
    val json = TextLayoutProbeWire.json("7", ProbeSnapshot(windows, listOf(record("Language"))))
    val lines = TextLayoutProbeWire.lines("7", json)
    assertEquals(3, lines.size)
    assertTrue(lines[0].matches(Regex("^begin 7 1 [0-9a-f]{64}$")))
    assertEquals(json, reassemble("7", lines))
  }

  @Test
  fun aLargeAnswerSplitsIntoChunksOfAtMost3000Base64Characters() {
    val records = (0 until 200).map { record("Label number $it with a long accessible text ✓") }
    val json = TextLayoutProbeWire.json("big-1", ProbeSnapshot(windows, records))
    val lines = TextLayoutProbeWire.lines("big-1", json)
    assertTrue("${lines.size} lines", lines.size > 4)
    // Every full chunk is exactly 3000 characters: 2250 bytes each, so chunk boundaries fall on
    // base64 quanta and each chunk also decodes alone.
    lines.subList(1, lines.size - 2).forEach { assertEquals(3000, it.split(' ')[3].length) }
    assertEquals(json, reassemble("big-1", lines))
  }

  @Test
  fun tokensThatWouldBreakALogLineAreRejected() {
    assertTrue(TextLayoutProbeWire.acceptsToken("1731600000123-home-1.5"))
    for (token in listOf(null, "", "a b", "a\nb", "x".repeat(129), "../x")) {
      assertFalse(token.toString(), TextLayoutProbeWire.acceptsToken(token))
    }
  }

  @Test
  fun theRegisteredReceiverAnswersADumpHolderAndIgnoresOthers() {
    val application = ApplicationProvider.getApplicationContext<Application>()
    val written = mutableListOf<String>()
    ShadowLog.clear()
    val receiver = TextLayoutProbeReceiver({ emptyList<View>() }, { written.add(it) })
    application.registerReceiver(
      receiver,
      android.content.IntentFilter(TextLayoutProbeWire.ACTION),
      Manifest.permission.DUMP,
      null
    )
    // A sender without android.permission.DUMP does not reach it.
    application.sendBroadcast(Intent(TextLayoutProbeWire.ACTION).putExtra("token", "41"))
    shadowOf(Looper.getMainLooper()).idle()
    assertEquals(emptyList<String>(), written)

    shadowOf(application).grantPermissions(Manifest.permission.DUMP)
    application.sendBroadcast(Intent(TextLayoutProbeWire.ACTION).putExtra("token", "42"))
    shadowOf(Looper.getMainLooper()).idle()
    assertEquals(3, written.size)
    val json = JSONObject(reassemble("42", written))
    assertEquals(0, json.getJSONArray("records").length())

    written.clear()
    application.sendBroadcast(Intent(TextLayoutProbeWire.ACTION).putExtra("token", "bad token"))
    shadowOf(Looper.getMainLooper()).idle()
    assertEquals(emptyList<String>(), written)
  }

  @Test
  fun registerListensOnTheMainLooperForTheDumpAction() {
    val application = ApplicationProvider.getApplicationContext<Application>()
    val receiver = TextLayoutProbeReceiver.register(application)
    val registered = shadowOf(application).registeredReceivers.single { it.broadcastReceiver === receiver }
    assertTrue(registered.intentFilter.hasAction(TextLayoutProbeWire.ACTION))
    assertEquals(Manifest.permission.DUMP, registered.broadcastPermission)
    assertEquals(Looper.getMainLooper(), registered.scheduler.looper)
  }

  /**
   * r45 P2-5: below API 29 there is no transformMatrixToGlobal to map boxes, lines and clips
   * through scaled or flipped ancestors (nor WindowInspector), so nothing is registered and a
   * dump request gets no answer at all; the harness fails the leg on the missing answer.
   */
  @Test
  @Config(sdk = [28])
  fun belowApi29NothingIsRegisteredAndARequestGetsNoAnswer() {
    val application = ApplicationProvider.getApplicationContext<Application>()
    ShadowLog.clear()
    assertNull(TextLayoutProbeReceiver.register(application))
    assertTrue(shadowOf(application).registeredReceivers.none { it.broadcastReceiver is TextLayoutProbeReceiver })
    shadowOf(application).grantPermissions(Manifest.permission.DUMP)
    application.sendBroadcast(Intent(TextLayoutProbeWire.ACTION).putExtra("token", "28"))
    shadowOf(Looper.getMainLooper()).idle()
    assertEquals(emptyList<ShadowLog.LogItem>(), ShadowLog.getLogsForTag(TextLayoutProbeWire.TAG))
  }
}
