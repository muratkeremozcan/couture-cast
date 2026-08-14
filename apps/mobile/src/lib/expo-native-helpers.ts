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
import * as Crypto from 'expo-crypto'

// One implementation, defined in a module free of expo-crypto so that screen
// and component code can import it without dragging a native module into every
// suite that renders them. Re-exported here for existing callers.
export { safeFindNodeHandle } from './accessibility-focus'

export async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes)
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('')
}
