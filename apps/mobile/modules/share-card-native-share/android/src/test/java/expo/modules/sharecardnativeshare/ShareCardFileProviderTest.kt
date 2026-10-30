package expo.modules.sharecardnativeshare

import android.app.Application
import android.content.ComponentName
import android.content.pm.PackageManager
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
    val name = "cc69-share-${UUID.randomUUID()}.png"
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
}
