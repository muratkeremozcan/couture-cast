/** The web build has no background tasks; work runs as is. */
export function withHeadlessJsTimers<T>(work: () => Promise<T>): Promise<T> {
  return work()
}
