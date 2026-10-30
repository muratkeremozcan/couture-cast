package expo.modules.sharecardnativeshare

import java.io.File
import java.nio.file.Files
import java.util.UUID
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/** File policy before any FileProvider grant: `cache/share-cards/cc69-share-<uuid>.png` only. */
class ShareCardShareFilesTest {
  @get:Rule val folder = TemporaryFolder()

  private fun cache() = folder.newFolder().also { File(it, "share-cards").mkdirs() }

  private fun write(root: File, relative: String, bytes: ByteArray = byteArrayOf(1, 2, 3)) =
    File(root, relative).apply {
      parentFile!!.mkdirs()
      writeBytes(bytes)
    }

  private fun name() = "cc69-share-${UUID.randomUUID()}.png"

  private fun digest(file: File) = ShareCardShareFiles.sha256(file)

  @Test
  fun acceptsAMatchingShareFileByEitherFileUriForm() {
    val cache = cache()
    val file = write(cache, "share-cards/${name()}")
    assertEquals(file.canonicalFile, ShareCardShareFiles.validate(cache, "file://${file.path}", digest(file)))
    assertEquals(file.canonicalFile, ShareCardShareFiles.validate(cache, file.toURI().toString(), digest(file)))
    val upper = write(cache, "share-cards/cc69-share-${UUID.randomUUID().toString().uppercase()}.png")
    assertEquals(upper.canonicalFile, ShareCardShareFiles.validate(cache, upper.toURI().toString(), digest(upper)))
  }

  @Test
  fun rejectsPhotoSaveAndOtherNames() {
    val cache = cache()
    val id = UUID.randomUUID()
    for (name in
      listOf(
        "cc68-$id.png",
        "cc69-$id.png",
        "cc69-share-.png",
        "cc69-share-not-a-uuid.png",
        "cc69-share-$id.PNG",
        "cc69-share-$id.jpg",
        "cc69-share-${id}x.png",
        "xcc69-share-$id.png",
        "cc69-share-$id.png.png",
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
    val inside = write(cache, "share-cards/${name()}")
    assertNull(
      ShareCardShareFiles.validate(cache, "file://${cache.path}/share-cards/../share-cards/${inside.name}", digest(inside)),
    )
    val outside = write(folder.newFolder(), "share-cards/${name()}")
    val link = File(cache, "share-cards/${name()}")
    Files.createSymbolicLink(link.toPath(), outside.toPath())
    assertNull(ShareCardShareFiles.validate(cache, link.toURI().toString(), digest(outside)))
    val linkedCache = folder.newFolder()
    Files.createSymbolicLink(File(linkedCache, "share-cards").toPath(), outside.parentFile!!.toPath())
    assertNull(
      ShareCardShareFiles.validate(linkedCache, "file://${linkedCache.path}/share-cards/${outside.name}", digest(outside)),
    )
    assertNull(ShareCardShareFiles.validate(cache, "content://x/share-cards/${inside.name}", digest(inside)))
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
