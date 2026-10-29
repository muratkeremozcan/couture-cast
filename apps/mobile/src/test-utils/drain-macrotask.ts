/**
 * Resolves after one zero-delay macrotask. The microtask queue drains before any
 * macrotask runs, so every promise chain already in flight has settled by then, however
 * many hops it has. Uses the real setTimeout; call it only while fake timers are off.
 */
export function drainMacrotask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}
