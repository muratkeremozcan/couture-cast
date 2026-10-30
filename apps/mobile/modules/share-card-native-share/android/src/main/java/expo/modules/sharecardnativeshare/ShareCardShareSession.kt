package expo.modules.sharecardnativeshare

/**
 * One share attempt at a time, settled by the first of these events:
 * - the chooser callback, as `target_chosen` with the mapped app, or as `not_confirmed` when an
 *   Android 15+ result selects no app;
 * - the host resuming after the chooser plus [graceMs] with no callback, as `not_confirmed`;
 * - host recreation or destruction mid-attempt, as `not_confirmed`;
 * - a start error, as `failed` or `unavailable`.
 * Settlement tears the attempt down once; later, duplicate or old-attempt events are ignored.
 * Main thread only.
 */
class ShareCardShareSession(
  /** Runs `action` after `delayMs` and returns a canceller. */
  private val schedule: (delayMs: Long, action: () -> Unit) -> () -> Unit,
  private val graceMs: Long = GRACE_MS,
) {
  private class Attempt(
    val id: String,
    val teardown: () -> Unit,
    val settle: (ShareCardShareResult) -> Unit,
  ) {
    var hostLeft = false
    var cancelGrace: (() -> Unit)? = null
  }

  private var active: Attempt? = null

  val isActive: Boolean
    get() = active != null

  val activeAttemptId: String?
    get() = active?.id

  /** Returns false, leaving the active attempt alone, while another attempt is open. */
  fun begin(
    attemptId: String,
    teardown: () -> Unit,
    settle: (ShareCardShareResult) -> Unit,
  ): Boolean {
    if (active != null) return false
    active = Attempt(attemptId, teardown, settle)
    return true
  }

  fun chooserCallback(attemptId: String, selection: ShareCardChooserSelection) {
    if (active?.id != attemptId) return
    settle(
      when (selection) {
        is ShareCardChooserSelection.App ->
          ShareCardShareResult.chosen(ShareCardTargetMapper.target(selection.packageName))
        ShareCardChooserSelection.NoTarget -> ShareCardShareResult.notConfirmed
      }
    )
  }

  /** The chooser covering the host pauses it; only a resume after that can close the attempt. */
  fun hostPaused() {
    active?.hostLeft = true
  }

  fun hostResumed() {
    val attempt = active ?: return
    if (!attempt.hostLeft || attempt.cancelGrace != null) return
    attempt.cancelGrace =
      schedule(graceMs) { if (active === attempt) settle(ShareCardShareResult.notConfirmed) }
  }

  fun hostDestroyed() {
    if (active != null) settle(ShareCardShareResult.notConfirmed)
  }

  fun startFailed(result: ShareCardShareResult) {
    if (active != null) settle(result)
  }

  private fun settle(result: ShareCardShareResult) {
    val attempt = active ?: return
    active = null
    attempt.cancelGrace?.invoke()
    attempt.teardown()
    attempt.settle(result)
  }

  companion object {
    const val GRACE_MS = 750L
  }
}
