import { drainMacrotask } from './drain-macrotask'

/**
 * Runs `run`, then returns the reason of every `unhandledrejection` the browser dispatched
 * while it ran and for a few task turns after. Chrome fires the event from a task it queues
 * once a microtask checkpoint finds the rejection unhandled, so a single zero-delay timer
 * can run first and see nothing; five turns outlast that queue.
 *
 * Hand the code under test a plain function, never a `vi.fn`, for the rejecting promise: a
 * `vi.fn` subscribes to every promise it returns (`settledResults`), which handles the
 * rejection itself and hides a missing catch.
 */
export async function unhandledRejectionsDuring(run: () => unknown): Promise<unknown[]> {
  const reasons: unknown[] = []
  const record = (event: PromiseRejectionEvent) => {
    reasons.push(event.reason)
  }
  window.addEventListener('unhandledrejection', record)
  try {
    await run()
    for (let turn = 0; turn < 5; turn += 1) await drainMacrotask()
  } finally {
    window.removeEventListener('unhandledrejection', record)
  }
  return reasons
}
