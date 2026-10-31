package expo.modules.sharecardnativeshare

import android.content.Context
import java.io.File
import java.net.URI
import java.security.MessageDigest

/**
 * Native gate before any handoff: only `cache/share-cards/cc69-share-<uuid>.png`, reached without
 * `..` or a symlink, at most 3 MiB, whose SHA256 matches the previewed digest.
 */
object ShareCardShareFiles {
  const val DIRECTORY = "share-cards"
  const val MAXIMUM_BYTES = 3L * 1024 * 1024
  /** The name receivers see, as Story 6.8's iOS save and the web download name the card. */
  const val PUBLIC_NAME = "couturecast-card.png"
  private val name =
    Regex("^cc69-share-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\\.png$")

  fun authority(context: Context) = "${context.packageName}.sharecardnativeshare.fileprovider"

  fun isShareFileName(fileName: String) = name.matches(fileName)

  /** Returns the canonical file, or null when anything about it is out of policy. */
  fun validate(cacheDir: File, fileUri: String, expectedSha256: String): File? =
    runCatching {
        val uri = URI(fileUri)
        if (uri.scheme != "file" || uri.rawQuery != null || uri.rawFragment != null) return null
        val path = uri.path ?: return null
        if (path.split('/').contains("..")) return null
        val file = File(path)
        if (!isShareFileName(file.name)) return null
        // The cache root may sit behind a system symlink (/data/user/0); share-cards and the file
        // may not. Either one being a link canonicalizes away from this path.
        val expected = File(File(cacheDir.canonicalFile, DIRECTORY), file.name)
        val canonical = file.canonicalFile
        if (canonical != expected || !canonical.isFile) return null
        if (canonical.length() > MAXIMUM_BYTES) return null
        if (sha256(canonical) != expectedSha256) return null
        canonical
      }
      .getOrNull()

  fun sha256(file: File): String {
    val digest = MessageDigest.getInstance("SHA-256")
    file.inputStream().use { input ->
      val buffer = ByteArray(64 * 1024)
      while (true) {
        val read = input.read(buffer)
        if (read < 0) break
        digest.update(buffer, 0, read)
      }
    }
    return digest.digest().joinToString("") { "%02x".format(it) }
  }
}
