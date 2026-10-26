import type { Sharp } from 'sharp'

export function checkImageSignal(signal?: AbortSignal) {
  if (signal?.aborted) throw new Error('image_cancelled')
}
/** Sharp inherits stream.destroy(). Native work may still settle after destruction. */
export async function runAbortableSharp<T>(
  pipeline: Sharp,
  signal: AbortSignal | undefined,
  work: () => Promise<T>
): Promise<T> {
  const abort = () => pipeline.destroy()
  if (signal?.aborted) {
    abort()
    checkImageSignal(signal)
  }
  signal?.addEventListener('abort', abort, { once: true })
  try {
    const result = await work()
    checkImageSignal(signal)
    return result
  } finally {
    signal?.removeEventListener('abort', abort)
  }
}
