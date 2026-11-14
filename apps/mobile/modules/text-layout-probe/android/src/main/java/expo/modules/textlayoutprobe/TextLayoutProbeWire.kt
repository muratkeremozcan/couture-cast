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

  fun json(token: String, snapshot: ProbeSnapshot): String {
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
