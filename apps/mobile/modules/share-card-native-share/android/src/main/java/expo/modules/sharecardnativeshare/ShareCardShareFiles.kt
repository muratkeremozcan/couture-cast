package expo.modules.sharecardnativeshare

import android.content.Context
import java.io.File
import java.net.URI
import java.security.MessageDigest

/**
 * Native gate before any handoff: only `cache/share-cards/cc69-share-<uuid>/couturecast-card.png`,
 * reached without `..` or a symlink, at most 3 MiB, whose SHA256 matches the previewed digest. The
 * per-share directory lets every receiver see the public name.
 */
object ShareCardShareFiles {
  const val DIRECTORY = "share-cards"
  const val MAXIMUM_BYTES = 3L * 1024 * 1024
  /** The name receivers see, as Story 6.8's iOS save and the web download name the card. */
  const val PUBLIC_NAME = "couturecast-card.png"
  private val directoryName =
    Regex("^cc69-share-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")

  fun authority(context: Context) = "${context.packageName}.sharecardnativeshare.fileprovider"

  fun isShareDirectoryName(name: String) = directoryName.matches(name)

  /** Returns the canonical file, or null when anything about it is out of policy. */
  fun validate(cacheDir: File, fileUri: String, expectedSha256: String): File? =
    runCatching {
        val uri = URI(fileUri)
        if (uri.scheme != "file" || uri.rawQuery != null || uri.rawFragment != null) return null
        val path = uri.path ?: return null
        if (path.split('/').contains("..")) return null
        val file = File(path)
        val directory = file.parentFile?.name ?: return null
        if (file.name != PUBLIC_NAME || !isShareDirectoryName(directory)) return null
        // The cache root may sit behind a system symlink (/data/user/0); share-cards, the per-share
        // directory and the file may not. Any one being a link canonicalizes away from this path.
        val expected = File(File(File(cacheDir.canonicalFile, DIRECTORY), directory), PUBLIC_NAME)
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
