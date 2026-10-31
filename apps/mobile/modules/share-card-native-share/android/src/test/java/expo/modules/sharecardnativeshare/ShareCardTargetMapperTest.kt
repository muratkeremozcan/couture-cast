// Learning path Step 49: Native platform sharing.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-49-native-platform-sharing
package expo.modules.sharecardnativeshare

import org.junit.Assert.assertEquals
import org.junit.Test

/** N-AND-MAPPER: six exact packages name four apps; everything else is `other`. */
class ShareCardTargetMapperTest {
  @Test
  fun allowlistedPackagesMapToTheirTargets() {
    val expected =
      mapOf(
        "com.pinterest" to ShareCardShareTarget.PINTEREST,
        "com.instagram.android" to ShareCardShareTarget.INSTAGRAM,
        "com.facebook.katana" to ShareCardShareTarget.FACEBOOK,
        "com.facebook.lite" to ShareCardShareTarget.FACEBOOK,
        "com.zhiliaoapp.musically" to ShareCardShareTarget.TIKTOK,
        "com.ss.android.ugc.trill" to ShareCardShareTarget.TIKTOK,
      )
    assertEquals(expected, ShareCardTargetMapper.allowlist)
    expected.forEach { (packageName, target) ->
      assertEquals(packageName, target, ShareCardTargetMapper.target(packageName))
    }
  }

  @Test
  fun nearMissesAndUnknownPackagesMapToOther() {
    for (packageName in
      listOf(
        "com.instagram.android.fake",
        "com.instagram.barcelona",
        "com.facebook.orca",
        "com.pinterest.twa",
        "com.Pinterest",
        "COM.INSTAGRAM.ANDROID",
        " com.pinterest",
        "com.pinterest ",
        "pinterest",
        "com.zhiliaoapp",
        "com.ss.android.ugc",
        "com.google.android.apps.messaging",
        "",
      )) {
      assertEquals("'$packageName'", ShareCardShareTarget.OTHER, ShareCardTargetMapper.target(packageName))
    }
    assertEquals(ShareCardShareTarget.OTHER, ShareCardTargetMapper.target(null))
  }

  @Test
  fun mappedTargetsStayInTheAndroidClosedSet() {
    assertEquals(
      listOf("pinterest", "instagram", "facebook", "tiktok", "other", "none"),
      ShareCardShareTarget.entries.map { it.wire },
    )
  }
}
