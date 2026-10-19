/**
 * Restore the flow's fixture before each attempt. A watchdog timeout may follow
 * a committed write, so its single retry needs the same initial state.
 * Reset failures stop execution before the device can run against stale state.
 *
 * @param {{run: () => Promise<void>, reset: () => Promise<void>, onRetry: (error: Error) => void}} options
 */
export async function runMobileE2EFlow({ run, reset, onRetry }) {
  if (typeof reset !== 'function') {
    throw new Error('Mobile E2E flow requires a fixture reset')
  }
  await reset()
  try {
    await run()
  } catch (error) {
    if (!error.timedOut) throw error
    onRetry(error)
    await reset()
    await run()
  }
}
