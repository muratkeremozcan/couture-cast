package expo.modules.accessibilityfocus

/**
 * Moves TalkBack focus into a window that just appeared, after TalkBack has placed its own.
 *
 * TalkBack focuses the first focusable view of a new window 10 to 630+ ms after the window
 * appears and overwrites any focus moved there before (TreeSettling.initialFocusSettled, run
 * 41208356725). When the app's target is that first view the race is invisible; when it is
 * another view, a single early move loses about once in 55 runs (main run 44076358778: the
 * reopened share-card composer's Cancel). This waits, in order, for the view to exist, for its
 * window to have focus and for TalkBack's first focus in that window (an event the caller
 * reports through [initialFocusObserved], or a focused view the target reads), then moves focus
 * and resolves [Outcome.FOCUSED] only once a later read finds the view still holding it; a hold
 * first gained at the bound has no later read and resolves [Outcome.NOT_HELD].
 *
 * Pure timing with no Android types, so JVM tests drive it on a virtual clock; the module
 * supplies the main-looper scheduler and the view reads. Every call runs on one thread.
 */
class InitialFocusPlacement(
  private val target: Target,
  private val scheduler: Scheduler,
  private val boundMs: Long = BOUND_MS,
  private val pollMs: Long = POLL_MS,
  private val done: (Outcome) -> Unit,
) {
  interface Scheduler {
    fun now(): Long

    fun post(delayMs: Long, task: () -> Unit)
  }

  /** The view to focus and the window it is in, read fresh on every check. */
  interface Target {
    /** A screen reader with touch exploration is on; without one no move can land. */
    fun screenReaderOn(): Boolean

    /** The view exists and is attached to a window. */
    fun present(): Boolean

    /** The view's window has window focus, so TalkBack treats it as the active window. */
    fun windowFocused(): Boolean

    /** Some view in the target's window already holds TalkBack focus. */
    fun initialFocusPlaced(): Boolean

    /** The target holds TalkBack focus. */
    fun focused(): Boolean

    /** Asks TalkBack to move its focus to the target (ACTION_ACCESSIBILITY_FOCUS). */
    fun move(): Boolean
  }

  enum class Outcome(val wire: String) {
    FOCUSED("focused"),
    SUPERSEDED("superseded"),
    NO_SCREEN_READER("no_screen_reader"),
    NO_TARGET("no_target"),
    NO_WINDOW_FOCUS("no_window_focus"),
    NO_INITIAL_PLACEMENT("no_initial_placement"),
    NOT_HELD("not_held"),
  }

  private var deadline = 0L
  private var finished = false
  private var placed = false
  private var holding = false

  /** Only the newest scheduled check runs, so an event never starts a second polling chain. */
  private var token = 0

  fun start() {
    deadline = scheduler.now() + boundMs
    check()
  }

  /**
   * TalkBack reported an accessibility-focus event in the target's window. The first one is its
   * initial placement, so the move can go now; later ones (the move's own event among them) are
   * left to the next hold check.
   */
  fun initialFocusObserved() {
    if (finished || placed) return
    placed = true
    schedule(0)
  }

  /** A newer focus request replaces this one; it resolves and never moves again. */
  fun cancel() = finish(Outcome.SUPERSEDED)

  private fun schedule(delayMs: Long) {
    val mine = ++token
    scheduler.post(delayMs) { if (mine == token) check() }
  }

  private fun check() {
    if (finished) return
    if (!target.screenReaderOn()) return finish(Outcome.NO_SCREEN_READER)
    val waiting = when {
      !target.present() -> Outcome.NO_TARGET
      !target.windowFocused() -> Outcome.NO_WINDOW_FOCUS
      !placed && !target.initialFocusPlaced() -> Outcome.NO_INITIAL_PLACEMENT
      else -> null
    }
    if (waiting == null) {
      placed = true
      if (target.focused()) {
        if (holding) return finish(Outcome.FOCUSED)
        holding = true
      } else {
        // TalkBack still holds its own view, or moved again after an earlier move.
        holding = target.move() && target.focused()
      }
    } else {
      holding = false
    }
    val now = scheduler.now()
    if (now >= deadline) {
      // A hold confirmed by a later read already resolved above, so a hold reaching this line
      // was first gained in this check. TalkBack can still take it a moment later and no read
      // is left to see that, so it is not reported held.
      return finish(waiting ?: Outcome.NOT_HELD)
    }
    schedule(minOf(pollMs, deadline - now))
  }

  private fun finish(outcome: Outcome) {
    if (finished) return
    finished = true
    token++
    done(outcome)
  }

  companion object {
    /**
     * Inside the 5 s the device tests allow a focus move (TreeSettling.FOCUS_BOUND_MS), with room
     * for TalkBack's slowest observed initial placement on a CI emulator.
     */
    const val BOUND_MS = 4_000L

    /** How often the view and window are read between events, and the hold check's spacing. */
    const val POLL_MS = 50L
  }
}
