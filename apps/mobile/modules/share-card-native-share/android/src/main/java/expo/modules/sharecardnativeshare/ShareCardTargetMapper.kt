package expo.modules.sharecardnativeshare

/**
 * Exact-match allowlist from the spec Design Notes. Every other package, including near misses,
 * is `other`. Package names stop here: they are never logged or returned.
 */
object ShareCardTargetMapper {
  val allowlist: Map<String, ShareCardShareTarget> =
    mapOf(
      "com.pinterest" to ShareCardShareTarget.PINTEREST,
      "com.instagram.android" to ShareCardShareTarget.INSTAGRAM,
      "com.facebook.katana" to ShareCardShareTarget.FACEBOOK,
      "com.facebook.lite" to ShareCardShareTarget.FACEBOOK,
      "com.zhiliaoapp.musically" to ShareCardShareTarget.TIKTOK,
      "com.ss.android.ugc.trill" to ShareCardShareTarget.TIKTOK,
    )

  /** A chooser callback always means a target was chosen, so a missing package is `other`. */
  fun target(packageName: String?): ShareCardShareTarget =
    packageName?.let { allowlist[it] } ?: ShareCardShareTarget.OTHER
}
