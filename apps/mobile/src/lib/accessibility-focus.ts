// `safeFindNodeHandle` lives here, in a module whose only import is
// react-native, rather than in expo-native-helpers.ts alongside `sha256Hex`.
//
// That file also imports expo-crypto, and its own header warns that those
// native imports "must never reach" modules loaded by tests that do not mock
// them. Importing it from the hero screen and the wardrobe modals proved the
// point immediately: nine screen and component suites failed at import time
// with "Cannot read properties of undefined (reading 'EventEmitter')" out of
// expo-crypto, before a single assertion ran. expo-native-helpers re-exports
// this symbol, so existing callers and their tests are unaffected.
import { Platform, findNodeHandle } from 'react-native'

/**
 * react-native-web's `findNodeHandle` always throws ("not supported on web"),
 * including when called synchronously during render or from inside an event
 * handler regardless of ref nullity, so every call site must skip it on web.
 */
export function safeFindNodeHandle(node: unknown): number | null {
  if (Platform.OS === 'web' || !node) return null

  /**
   * `findNodeHandle` is typed `number | null`, but under the New Architecture
   * (`newArchEnabled: true` in app.json) it can hand back a host object instead
   * of the numeric reactTag. The only consumer of this value is
   * `AccessibilityInfo.setAccessibilityFocus`, which passes it straight across
   * the JSI bridge, and a non-numeric argument there crashes the whole app with
   * `Exception in HostFunction: Unsupported jsi::Value kind` — no red box, no
   * recoverable error, the process simply goes away. A host object is also
   * truthy, so the usual `if (node)` guard at the call sites does not catch it.
   * Anything that is not a real tag is discarded, which costs only the
   * accessibility-focus restore.
   */
  const handle = findNodeHandle(node as never)
  return typeof handle === 'number' && Number.isFinite(handle) ? handle : null
}
