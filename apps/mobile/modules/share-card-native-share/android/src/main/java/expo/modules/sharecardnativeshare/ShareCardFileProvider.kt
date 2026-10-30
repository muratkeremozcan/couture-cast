package expo.modules.sharecardnativeshare

import androidx.core.content.FileProvider

/**
 * Module-owned provider with its own authority, so its paths never merge with another library's
 * FileProvider. `res/xml/share_card_native_share_paths.xml` exposes only `cache/share-cards/`.
 */
class ShareCardFileProvider : FileProvider()
