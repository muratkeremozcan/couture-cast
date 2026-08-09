// Story 4.4 Task 6 owner: platform-independent helpers shared across mobile
// wardrobe screens/components and src/lib/wardrobe.ts. Deliberately has no
// react-native or expo-* imports (see expo-native-helpers.ts for those) so
// that pulling this file in never drags native-only modules into consumers
// that only need HTTP/timing logic — that coupling is exactly what broke
// wardrobe.test.ts and garment-tagging-modal.test.tsx the first time
// sha256Hex/safeFindNodeHandle briefly lived in this same file.

/** A cancellable delay: resolves after `delayMs`, rejects if `signal` aborts first. */
export function waitForPoll(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, delayMs)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(new Error('POLL_ABORTED'))
      },
      { once: true }
    )
  })
}
