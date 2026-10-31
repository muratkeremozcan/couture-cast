package expo.modules.sharecardnativeshare

import androidx.core.content.FileProvider

/**
 * FileProvider caches each authority's roots in a static map, while Robolectric gives every test
 * a fresh cache directory. Clearing it keeps a later test from resolving against an earlier root.
 */
fun resetFileProviderRoots() {
  FileProvider::class.java.getDeclaredField("sCache").apply { isAccessible = true }.let {
    (it.get(null) as MutableMap<*, *>).clear()
  }
}
