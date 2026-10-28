package expo.modules.accessibilityfocus

/**
 * The waiting logic of the TalkBack composer test, free of Android types so JVM unit tests can
 * prove it against a fake accessibility tree. The instrumented test and the unit tests both
 * compile this file (see build.gradle sourceSets).
 */
object TreeSettling {
  /** Injected time, so a fake tree can attach nodes on a virtual timeline. */
  class Clock(val now: () -> Long, val sleep: (Long) -> Unit)

  /**
   * How long TalkBack focus may take to return or jump after the app asks for it. A person using
   * TalkBack feels a slow return, so these waits are bounded tightly (the default wait is for
   * states that depend on the network or on storage, such as Saved).
   */
  const val FOCUS_BOUND_MS = 5_000L

  /** Polls [condition] until it holds; fails with [message] and the [diagnostic] snapshot. */
  fun waitFor(
    message: String,
    clock: Clock,
    timeoutMs: Long = 20_000,
    pollMs: Long = 100,
    diagnostic: () -> String = { "" },
    condition: () -> Boolean,
  ) {
    val until = clock.now() + timeoutMs
    while (clock.now() < until) {
      if (condition()) return
      clock.sleep(pollMs)
    }
    throw AssertionError(message + ": " + diagnostic())
  }

  /** How long one named focus wait took, and whether it ran out of its bound. */
  class FocusLatency(val wait: String, val elapsedMs: Long, val timedOut: Boolean) {
    /** One closed line the host harness parses out of the instrumentation output. */
    fun line() = "CC68_FOCUS_LATENCY|$wait|$elapsedMs|${if (timedOut) "timeout" else "ok"}"
  }

  /**
   * A focus wait: [FOCUS_BOUND_MS] long, and the failure names that bound. Its elapsed time is
   * handed to [record] whether it passes or times out, so CI shows the real focus latency.
   */
  fun waitForFocus(
    message: String,
    clock: Clock,
    pollMs: Long = 100,
    diagnostic: () -> String = { "" },
    record: (FocusLatency) -> Unit = {},
    condition: () -> Boolean,
  ) {
    val began = clock.now()
    try {
      waitFor(
        "$message within ${FOCUS_BOUND_MS} ms",
        clock,
        timeoutMs = FOCUS_BOUND_MS,
        pollMs = pollMs,
        diagnostic = diagnostic,
        condition = condition,
      )
    } catch (error: AssertionError) {
      record(FocusLatency(message, clock.now() - began, true))
      throw error
    }
    record(FocusLatency(message, clock.now() - began, false))
  }

  /**
   * Returns once [signature] has been identical for [samples] consecutive samples [intervalMs]
   * apart: the accessibility tree stops changing after TalkBack takes focus. A tree that never
   * settles fails with [message].
   */
  fun settled(
    message: String,
    clock: Clock,
    samples: Int = 3,
    intervalMs: Long = 200,
    timeoutMs: Long = 20_000,
    signature: () -> String,
  ): String {
    require(samples >= 2) { "A settled tree needs at least 2 samples" }
    val until = clock.now() + timeoutMs
    var last = signature()
    var equal = 1
    while (equal < samples) {
      if (clock.now() >= until) throw AssertionError("$message: tree kept changing")
      clock.sleep(intervalMs)
      val next = signature()
      if (next == last) equal++ else {
        last = next
        equal = 1
      }
    }
    return last
  }

  /** True when every [expected] id is present and they appear in this order. */
  fun orderHolds(ids: List<String>, expected: List<String>): Boolean {
    val positions = expected.map { ids.indexOf(it) }
    return positions.all { it >= 0 } && positions.zipWithNext().all { (a, b) -> a < b }
  }
}
