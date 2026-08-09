// Story 4.4 Task 6 owner: small native-only helpers shared across the mobile
// wardrobe screens/components. Extracted after a code review found
// `safeFindNodeHandle` duplicated in two screens and `sha256Hex` duplicated
// in both upload components. One implementation each, per
// project-context.md's "avoid duplicate utility implementations."
//
// Kept separate from native-utils.ts (which src/lib/wardrobe.ts also
// imports): this file's react-native/expo-crypto imports must never reach
// wardrobe.ts, or every test that imports wardrobe.ts without mocking those
// native modules breaks — screen/component test files already mock them.
import { Platform, findNodeHandle } from 'react-native'
import * as Crypto from 'expo-crypto'

/**
 * react-native-web's `findNodeHandle` always throws ("not supported on web"),
 * including when called synchronously during render or from inside an event
 * handler regardless of ref nullity. Every call site must skip it on web,
 * matching the guard already proven in garment-tagging-modal.tsx and
 * capsule-builder-modal.tsx.
 */
export function safeFindNodeHandle(node: unknown): number | null {
  if (Platform.OS === 'web' || !node) return null
  return findNodeHandle(node as never)
}

export async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes)
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('')
}
