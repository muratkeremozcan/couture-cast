// Learning path Step 49: Native platform sharing.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-49-native-platform-sharing
package expo.modules.sharecardnativeshare

import java.io.File
import java.nio.file.Files
import java.util.UUID
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/**
 * File policy before any FileProvider grant: `cache/share-cards/cc69-share-<uuid>/couturecast-card.png`
 * only.
 */
class ShareCardShareFilesTest {
  @get:Rule val folder = TemporaryFolder()

  private fun cache() = folder.newFolder().also { File(it, "share-cards").mkdirs() }

  private fun write(root: File, relative: String, bytes: ByteArray = byteArrayOf(1, 2, 3)) =
    File(root, relative).apply {
      parentFile!!.mkdirs()
      writeBytes(bytes)
    }

  /** The share-cards-relative handoff path: a per-share directory holding the public name. */
  private fun name() = "cc69-share-${UUID.randomUUID()}/couturecast-card.png"

  private fun digest(file: File) = ShareCardShareFiles.sha256(file)

  @Test
  fun acceptsAMatchingShareFileByEitherFileUriForm() {
    val cache = cache()
    val file = write(cache, "share-cards/${name()}")
    assertEquals(file.canonicalFile, ShareCardShareFiles.validate(cache, "file://${file.path}", digest(file)))
    assertEquals(file.canonicalFile, ShareCardShareFiles.validate(cache, file.toURI().toString(), digest(file)))
    assertEquals("couturecast-card.png", file.name)
    val upper = write(cache, "share-cards/cc69-share-${UUID.randomUUID().toString().uppercase()}/couturecast-card.png")
    assertEquals(upper.canonicalFile, ShareCardShareFiles.validate(cache, upper.toURI().toString(), digest(upper)))
  }

  @Test
  fun rejectsPhotoSaveAndOtherNames() {
    val cache = cache()
    val id = UUID.randomUUID()
    val card = "couturecast-card.png"
    for (name in
      listOf(
        "cc69-share-$id.png",
        "cc68-$id.png",
        "cc68-$id/$card",
        "cc69-$id/$card",
        "cc69-share-/$card",
        "cc69-share-not-a-uuid/$card",
        "cc69-share-${id}x/$card",
        "xcc69-share-$id/$card",
        "cc69-share-$id/couturecast-card.PNG",
        "cc69-share-$id/couturecast-card.png.png",
        "cc69-share-$id/cc69-share-$id.png",
        card,
      )) {
      val file = write(cache, "share-cards/$name")
      assertNull(name, ShareCardShareFiles.validate(cache, file.toURI().toString(), digest(file)))
    }
  }

  @Test
  fun rejectsOutsideFolderTraversalSymlinksAndOtherSchemes() {
    val cache = cache()
    val name = name()
    for (relative in listOf(name, "share-cards/nested/$name", "other/$name", "share-cards-x/$name")) {
      val file = write(cache, relative)
      assertNull(relative, ShareCardShareFiles.validate(cache, file.toURI().toString(), digest(file)))
    }
    val above = File(cache, name)
    assertNull(ShareCardShareFiles.validate(cache, "file://${cache.path}/share-cards/../$name", digest(above)))
    val insideName = name()
    val inside = write(cache, "share-cards/$insideName")
    assertNull(
      ShareCardShareFiles.validate(cache, "file://${cache.path}/share-cards/../share-cards/$insideName", digest(inside)),
    )
    val directory = inside.parentFile!!.name
    assertNull(
      ShareCardShareFiles.validate(cache, "file://${cache.path}/share-cards/$directory/../$insideName", digest(inside)),
    )
    val outside = write(folder.newFolder(), "share-cards/${name()}")
    val link = File(cache, "share-cards/${name()}").apply { parentFile!!.mkdirs() }
    Files.createSymbolicLink(link.toPath(), outside.toPath())
    assertNull(ShareCardShareFiles.validate(cache, link.toURI().toString(), digest(outside)))
    // A per-share directory that is a link out of the cache.
    val linkedDirectory = File(cache, "share-cards/cc69-share-${UUID.randomUUID()}")
    Files.createSymbolicLink(linkedDirectory.toPath(), outside.parentFile!!.toPath())
    assertNull(
      ShareCardShareFiles.validate(cache, File(linkedDirectory, outside.name).toURI().toString(), digest(outside)),
    )
    val linkedCache = folder.newFolder()
    Files.createSymbolicLink(File(linkedCache, "share-cards").toPath(), outside.parentFile!!.parentFile!!.toPath())
    val escaped = "share-cards/${outside.parentFile!!.name}/${outside.name}"
    assertNull(ShareCardShareFiles.validate(linkedCache, "file://${linkedCache.path}/$escaped", digest(outside)))
    assertNull(ShareCardShareFiles.validate(cache, "content://x/share-cards/$insideName", digest(inside)))
    assertNull(ShareCardShareFiles.validate(cache, "${inside.toURI()}?x=1", digest(inside)))
    assertNull(ShareCardShareFiles.validate(cache, "not a uri", digest(inside)))
  }

  @Test
  fun rejectsDigestMismatchAndOversize() {
    val cache = cache()
    val file = write(cache, "share-cards/${name()}")
    assertNull(ShareCardShareFiles.validate(cache, file.toURI().toString(), "0".repeat(64)))
    assertNull(ShareCardShareFiles.validate(cache, file.toURI().toString(), digest(file).uppercase()))
    val limit = ShareCardShareFiles.MAXIMUM_BYTES.toInt()
    val atLimit = write(cache, "share-cards/${name()}", ByteArray(limit))
    assertEquals(atLimit.canonicalFile, ShareCardShareFiles.validate(cache, atLimit.toURI().toString(), digest(atLimit)))
    val oversize = write(cache, "share-cards/${name()}", ByteArray(limit + 1))
    assertNull(ShareCardShareFiles.validate(cache, oversize.toURI().toString(), digest(oversize)))
  }
}
