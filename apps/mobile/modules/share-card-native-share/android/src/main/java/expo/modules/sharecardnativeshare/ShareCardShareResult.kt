package expo.modules.sharecardnativeshare

/**
 * The closed Android share result. Android never learns whether a post happened, so its outcomes
 * stop at the chooser: there is no completed, handed_off or dismissed member, and no unknown target.
 */
enum class ShareCardShareTarget(val wire: String) {
  PINTEREST("pinterest"),
  INSTAGRAM("instagram"),
  FACEBOOK("facebook"),
  TIKTOK("tiktok"),
  OTHER("other"),
  NONE("none"),
}

enum class ShareCardShareOutcome(val wire: String) {
  TARGET_CHOSEN("target_chosen"),
  NOT_CONFIRMED("not_confirmed"),
  FAILED("failed"),
  UNAVAILABLE("unavailable"),
}

enum class ShareCardShareCode(val wire: String) {
  FILE_INVALID("file_invalid"),
  CHOOSER_UNAVAILABLE("chooser_unavailable"),
  START_FAILED("start_failed"),
  BUSY("busy"),
}

data class ShareCardShareResult(
  val target: ShareCardShareTarget,
  val outcome: ShareCardShareOutcome,
  val code: ShareCardShareCode? = null,
) {
  /** The only shape that crosses the bridge. */
  fun toBridge(): Map<String, String> =
    buildMap {
      put("target", target.wire)
      put("outcome", outcome.wire)
      code?.let { put("code", it.wire) }
    }

  companion object {
    fun chosen(target: ShareCardShareTarget) =
      ShareCardShareResult(target, ShareCardShareOutcome.TARGET_CHOSEN)

    val notConfirmed = ShareCardShareResult(ShareCardShareTarget.NONE, ShareCardShareOutcome.NOT_CONFIRMED)

    fun failed(code: ShareCardShareCode) =
      ShareCardShareResult(ShareCardShareTarget.NONE, ShareCardShareOutcome.FAILED, code)

    val chooserUnavailable =
      ShareCardShareResult(
        ShareCardShareTarget.NONE,
        ShareCardShareOutcome.UNAVAILABLE,
        ShareCardShareCode.CHOOSER_UNAVAILABLE,
      )
  }
}
