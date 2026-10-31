// Learning path Step 49: Native platform sharing.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-49-native-platform-sharing
package expo.modules.sharecardnativeshare

import android.app.Application
import android.content.ComponentName
import android.content.pm.PackageManager
import android.database.Cursor
import android.net.Uri
import android.provider.OpenableColumns
import androidx.core.content.FileProvider
import androidx.test.core.app.ApplicationProvider
import java.io.File
import java.util.UUID
import javax.xml.parsers.DocumentBuilderFactory
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.w3c.dom.Element

/**
 * N-AND-PROVIDER: the module's own provider grants only `cache/share-cards/`, under its own
 * authority, unexported, with URI grants on.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class ShareCardFileProviderTest {
  private val application: Application = ApplicationProvider.getApplicationContext()
  private val android = "http://schemas.android.com/apk/res/android"

  /** Gradle runs these from the module's android/ folder or from unit-tests/. */
  private val moduleDir = File(System.getProperty("shareCardModuleDir") ?: System.getProperty("user.dir")!!)

  private fun xml(relative: String): Element =
    DocumentBuilderFactory.newInstance()
      .apply { isNamespaceAware = true }
      .newDocumentBuilder()
      .parse(File(moduleDir, relative))
      .documentElement

  private fun Element.children(): List<Element> =
    (0 until childNodes.length).mapNotNull { childNodes.item(it) as? Element }

  @Test
  fun pathsExposeOnlyTheShareCardsCacheFolder() {
    val paths = xml("src/main/res/xml/share_card_native_share_paths.xml")
    assertEquals("paths", paths.tagName)
    val entries = paths.children()
    assertEquals(1, entries.size)
    assertEquals("cache-path", entries[0].tagName)
    assertEquals("share-cards/", entries[0].getAttribute("path"))
  }

  @Test
  fun manifestDeclaresOneUnexportedGrantingProviderAndNothingElse() {
    val manifest = xml("src/main/AndroidManifest.xml")
    assertEquals(listOf("application"), manifest.children().map { it.tagName })
    val components = manifest.children().single().children()
    assertEquals(listOf("provider"), components.map { it.tagName })
    val provider = components.single()
    assertEquals(ShareCardFileProvider::class.java.name, provider.getAttributeNS(android, "name"))
    assertEquals(
      "\${applicationId}.sharecardnativeshare.fileprovider",
      provider.getAttributeNS(android, "authorities"),
    )
    assertEquals("false", provider.getAttributeNS(android, "exported"))
    assertEquals("true", provider.getAttributeNS(android, "grantUriPermissions"))
    val meta = provider.children().single()
    assertEquals("android.support.FILE_PROVIDER_PATHS", meta.getAttributeNS(android, "name"))
    assertEquals("@xml/share_card_native_share_paths", meta.getAttributeNS(android, "resource"))
  }

  @Test
  fun mergedProviderIsUnexportedGrantingAndModuleUnique() {
    val info =
      application.packageManager.getProviderInfo(
        ComponentName(application, ShareCardFileProvider::class.java),
        PackageManager.GET_META_DATA,
      )
    val authority = ShareCardShareFiles.authority(application)
    assertEquals(authority, info.authority)
    assertEquals("${application.packageName}.sharecardnativeshare.fileprovider", authority)
    assertFalse(info.exported)
    assertTrue(info.grantUriPermissions)
    // expo-file-system and expo-sharing keep their own authorities; this one never collides.
    assertNotEquals("${application.packageName}.FileSystemFileProvider", authority)
    assertNotEquals("${application.packageName}.fileprovider", authority)
  }

  @Test
  fun getUriForFileGrantsShareCardsAndThrowsOutsideIt() {
    resetFileProviderRoots()
    val authority = ShareCardShareFiles.authority(application)
    val name = "cc69-share-${UUID.randomUUID()}/couturecast-card.png"
    val inside = File(application.cacheDir, "share-cards/$name").apply { parentFile!!.mkdirs(); writeText("x") }
    val uri = FileProvider.getUriForFile(application, authority, inside)
    assertEquals("content", uri.scheme)
    assertEquals(authority, uri.authority)
    assertEquals("/share_cards/$name", uri.path)
    for (outside in
      listOf(
        File(application.cacheDir, name),
        File(application.cacheDir, "other/$name"),
        File(application.cacheDir, "share-cards-x/$name"),
        File(application.filesDir, "share-cards/$name"),
        File(application.cacheDir, "share-cards/../$name"),
      )) {
      outside.parentFile!!.mkdirs()
      outside.writeText("x")
      assertThrows(outside.path, IllegalArgumentException::class.java) {
        FileProvider.getUriForFile(application, authority, outside)
      }
    }
  }

  /** A granted share file plus its content URI, served by the registered module provider. */
  private fun sharedFile(bytes: ByteArray): Pair<File, Uri> {
    resetFileProviderRoots()
    val authority = ShareCardShareFiles.authority(application)
    // The merged manifest's own ProviderInfo, so the provider runs with its declared grant policy.
    val info =
      application.packageManager.getProviderInfo(
        ComponentName(application, ShareCardFileProvider::class.java),
        PackageManager.GET_META_DATA,
      )
    Robolectric.buildContentProvider(ShareCardFileProvider::class.java).create(info)
    val file =
      File(application.cacheDir, "share-cards/cc69-share-${UUID.randomUUID()}/couturecast-card.png").apply {
        parentFile!!.mkdirs()
        writeBytes(bytes)
      }
    return file to FileProvider.getUriForFile(application, authority, file)
  }

  private fun Cursor.row(): Map<String, Any?> {
    assertEquals(1, count)
    assertTrue(moveToFirst())
    return columnNames.indices.associate { at ->
      columnNames[at] to if (getType(at) == Cursor.FIELD_TYPE_INTEGER) getLong(at) else getString(at)
    }
  }

  @Test
  fun receiversSeeThePublicNameAndTheRealSize() {
    val bytes = byteArrayOf(-119, 80, 78, 71, 13, 10, 26, 10) + UUID.randomUUID().toString().toByteArray()
    val (file, uri) = sharedFile(bytes)
    val row = application.contentResolver.query(uri, null, null, null, null)!!.use { it.row() }
    assertEquals(
      mapOf(OpenableColumns.DISPLAY_NAME to "couturecast-card.png", OpenableColumns.SIZE to bytes.size.toLong()),
      row,
    )
    assertFalse(row.values.any { it.toString().contains("cc69-share") })
    // The file itself carries the public name inside its per-share directory; the bytes a receiver
    // reads are unchanged.
    assertEquals("couturecast-card.png", file.name)
    assertTrue(file.parentFile!!.name.startsWith("cc69-share-"))
    assertEquals("/share_cards/${file.parentFile!!.name}/couturecast-card.png", uri.path)
    assertTrue(bytes.contentEquals(application.contentResolver.openInputStream(uri)!!.use { it.readBytes() }))
  }

  @Test
  fun eachRequestedColumnKeepsItsOrderAndUnknownColumnsStayDropped() {
    val (_, uri) = sharedFile(ByteArray(42))
    val resolver = application.contentResolver
    assertEquals(
      mapOf(OpenableColumns.DISPLAY_NAME to "couturecast-card.png"),
      resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)!!.use { it.row() },
    )
    assertEquals(
      mapOf(OpenableColumns.SIZE to 42L),
      resolver.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)!!.use { it.row() },
    )
    resolver.query(uri, arrayOf(OpenableColumns.SIZE, "_data", OpenableColumns.DISPLAY_NAME), null, null, null)!!.use {
      assertEquals(listOf(OpenableColumns.SIZE, OpenableColumns.DISPLAY_NAME), it.columnNames.toList())
      assertEquals(mapOf(OpenableColumns.SIZE to 42L, OpenableColumns.DISPLAY_NAME to "couturecast-card.png"), it.row())
    }
  }

  @Test
  fun anOutOfScopeUriIsStillRefusedBeforeAnyNameIsPresented() {
    sharedFile(ByteArray(1))
    val authority = ShareCardShareFiles.authority(application)
    assertThrows(IllegalArgumentException::class.java) {
      application.contentResolver.query(Uri.parse("content://$authority/cache/x.png"), null, null, null, null)
    }
  }
}
