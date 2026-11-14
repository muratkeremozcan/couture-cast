package expo.modules.textlayoutprobe

import android.util.Base64
import java.security.MessageDigest

/**
 * The version 1 wire format the harness (scripts/lib/live-font-text-probe.mjs) reads: the JSON
 * answer, then logcat lines under [TAG] that carry it in base64 chunks with its SHA-256.
 */
object TextLayoutProbeWire {
  const val TAG = "TextLayoutProbe"
  const val ACTION = "com.couturecast.textlayoutprobe.DUMP"
  const val TOKEN_EXTRA = "token"

  /** 2250 bytes encode to exactly 3000 base64 characters, the most one chunk line carries. */
  const val CHUNK_BYTES = 2250

  /** Tokens are echoed into log lines, so they carry no whitespace or control characters. */
  private val TOKEN = Regex("^[A-Za-z0-9._:-]{1,128}$")

  fun acceptsToken(token: String?): Boolean = token != null && TOKEN.matches(token)

  /**
   * The error code of an answer refused because a record's opacity is not a number from 0 to 1
   * (NaN from a NaN alpha anywhere up the chain). Such a record is never coerced or dropped.
   */
  const val OPACITY_INVALID = "text_probe_opacity_invalid"

  private fun validOpacity(value: Double) = value >= 0.0 && value <= 1.0

  /**
   * The refusal the harness reads in place of the records, chunked and hashed like any answer:
   * `{version, token, platform, error: {code, record, kind}}`, `record` the index the first
   * refused record has in the records.
   */
  fun refusal(token: String, code: String, record: Int, kind: String): String =
    "{\"version\":1,\"token\":${quote(token)},\"platform\":\"android\"," +
      "\"error\":{\"code\":${quote(code)},\"record\":$record,\"kind\":${quote(kind)}}}"

  /** The answer; a record whose opacity is not in 0..1 (NaN included) refuses the whole capture. */
  fun json(token: String, snapshot: ProbeSnapshot): String {
    val refused = snapshot.records.indexOfFirst { !validOpacity(it.opacity) }
    if (refused >= 0) return refusal(token, OPACITY_INVALID, refused, snapshot.records[refused].kind)
    val out = StringBuilder()
    out.append("{\"version\":1,\"token\":").append(quote(token))
    out.append(",\"platform\":\"android\",\"windows\":[")
    snapshot.windows.forEachIndexed { index, window ->
      if (index > 0) out.append(',')
      out.append("{\"id\":").append(window.id)
      out.append(",\"rect\":").append(rect(window.rect))
      out.append(",\"z\":").append(window.z)
      out.append(",\"focused\":").append(window.focused)
      out.append('}')
    }
    out.append("],\"records\":[")
    snapshot.records.forEachIndexed { index, record ->
      if (index > 0) out.append(',')
      out.append("{\"kind\":").append(quote(record.kind))
      out.append(",\"text\":").append(quote(record.text))
      out.append(",\"viewRect\":").append(rect(record.viewRect))
      out.append(",\"visibleRect\":").append(rect(record.visibleRect))
      out.append(",\"clipRect\":").append(rect(record.clipRect))
      out.append(",\"contentRect\":").append(rect(record.contentRect))
      out.append(",\"lineCount\":").append(record.lineCount)
      out.append(",\"maxLines\":").append(record.maxLines?.toString() ?: "null")
      out.append(",\"ellipsized\":").append(record.ellipsized)
      out.append(",\"unlimitedLineCount\":").append(record.unlimitedLineCount?.toString() ?: "null")
      out.append(",\"window\":").append(record.window)
      out.append(",\"scrolledAway\":").append(record.scrolledAway)
      out.append(",\"offWindow\":").append(record.offWindow)
      out.append(",\"opacity\":").append(number(record.opacity))
      out.append('}')
    }
    out.append("]}")
    return out.toString()
  }

  /** `begin <token> <chunkCount> <sha256>`, one `chunk <token> <index> <base64>` per chunk, `done <token>`. */
  fun lines(token: String, json: String): List<String> {
    val bytes = json.toByteArray(Charsets.UTF_8)
    val chunks = (bytes.indices step CHUNK_BYTES).map { start ->
      Base64.encodeToString(bytes, start, minOf(CHUNK_BYTES, bytes.size - start), Base64.NO_WRAP)
    }
    val lines = mutableListOf("begin $token ${chunks.size} ${sha256(bytes)}")
    chunks.forEachIndexed { index, chunk -> lines.add("chunk $token $index $chunk") }
    lines.add("done $token")
    return lines
  }

  fun sha256(bytes: ByteArray): String =
    MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

  /**
   * 0..1 unrounded (the shortest decimal that reads back as the same double), in plain notation
   * (no exponent), trailing zeros dropped, so only an exact 0 reads as invisible. Anything else,
   * NaN included, is refused, never coerced: [json] answers such a record with [OPACITY_INVALID].
   */
  fun number(value: Double): String {
    require(validOpacity(value)) { "opacity $value is not in 0..1" }
    return java.math.BigDecimal(value.toString()).stripTrailingZeros().toPlainString()
  }

  private fun rect(rect: ProbeRect?): String =
    if (rect == null) "null" else "[${rect.left},${rect.top},${rect.right},${rect.bottom}]"

  fun quote(value: String): String {
    val out = StringBuilder(value.length + 2).append('"')
    for (char in value) {
      when (char) {
        '"' -> out.append("\\\"")
        '\\' -> out.append("\\\\")
        '\n' -> out.append("\\n")
        '\r' -> out.append("\\r")
        '\t' -> out.append("\\t")
        '\b' -> out.append("\\b")
        '\u000C' -> out.append("\\f")
        else ->
          if (char < ' ' || char == ' ' || char == ' ') {
            out.append("\\u%04x".format(char.code))
          } else {
            out.append(char)
          }
      }
    }
    return out.append('"').toString()
  }
}
