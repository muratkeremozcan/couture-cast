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
    opacity = 0.25
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
        "maxLines", "ellipsized", "unlimitedLineCount", "window", "scrolledAway", "opacity"
      ),
      first.keys().asSequence().toSet()
    )
    assertEquals("Ünïcode \"q\"\n\\", first.getString("text"))
    assertTrue(first.isNull("visibleRect"))
    assertTrue(first.isNull("maxLines"))
    assertEquals(60, first.getJSONArray("contentRect").getInt(3))
    assertFalse(first.getBoolean("scrolledAway"))
    assertEquals(0.25, first.getDouble("opacity"), 0.0)
    assertTrue(json.contains("\"opacity\":0.25}"))
  }

  @Test
  fun opacityIsWrittenInPlainNotationToFourDecimals() {
    assertEquals("1", TextLayoutProbeWire.number(1.0))
    assertEquals("0", TextLayoutProbeWire.number(0.0))
    assertEquals("0.25", TextLayoutProbeWire.number(0.25))
    assertEquals("0.0001", TextLayoutProbeWire.number(0.0001))
    assertEquals("0", TextLayoutProbeWire.number(0.00001))
    assertEquals("0.3333", TextLayoutProbeWire.number(1.0 / 3))
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
}
