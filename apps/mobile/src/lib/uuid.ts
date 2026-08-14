/**
 * A RFC 4122 version 4 UUID, on every runtime this app targets.
 *
 * This exists because the API rejects anything that is not a UUID v4 --
 * `400 Idempotency-Key must be a UUID v4` -- and the obvious inline fallback
 * gets it wrong. `capsule-builder-modal.tsx` used to mint its key as
 * `globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}``. In
 * jsdom and in a browser `globalThis.crypto.randomUUID` exists, so every unit
 * test passed. Hermes ships no `globalThis.crypto.randomUUID`, so on a real
 * device the fallback always fired and produced a string that is not a UUID at
 * all: saving an outfit capsule failed outright, in production, for every user.
 *
 * It deliberately does NOT import `expo-crypto`, even though
 * `garment-capture-modal.tsx` and `silhouette-editor.tsx` do. `vitest.config.ts`
 * records that native-only Expo modules "wedge the optimizer entirely" because
 * they pull in `expo-modules-core`, which cannot be evaluated in a browser
 * bundle -- importing it here breaks this component's suites at import time,
 * which is the same trap that moved `safeFindNodeHandle` into its own module.
 *
 * Randomness is sourced from the strongest API the runtime offers, and the
 * version and variant bits are set explicitly in every branch, so the result is
 * a well-formed v4 regardless of which one runs.
 */
const HEX = '0123456789abcdef'

function randomBytes(count: number): Uint8Array {
  const bytes = new Uint8Array(count)
  const webCrypto = globalThis.crypto
  if (typeof webCrypto?.getRandomValues === 'function') {
    try {
      webCrypto.getRandomValues(bytes)
      return bytes
    } catch {
      /**
       * A partially shimmed or proxied `crypto` can expose `getRandomValues`
       * while throwing `Illegal invocation` when it is called with the wrong
       * receiver. Minting an idempotency key must never be the thing that takes
       * a save down, so fall through to the arithmetic path.
       */
    }
  }
  for (let index = 0; index < count; index += 1) {
    bytes[index] = Math.floor(Math.random() * 256)
  }
  return bytes
}

export function randomUuidV4(): string {
  // Checked inline rather than hoisted into a local: extracting the method
  // detaches it from its receiver, which `@typescript-eslint/unbound-method`
  // rejects and which is exactly the `Illegal invocation` failure guarded
  // against below.
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    try {
      return globalThis.crypto.randomUUID()
    } catch {
      // Fall through to the arithmetic path on a shimmed `crypto`.
    }
  }

  const bytes = randomBytes(16)
  // Version 4 in the high nibble of byte 6, variant 10xx in byte 8.
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80

  let out = ''
  for (let index = 0; index < 16; index += 1) {
    if (index === 4 || index === 6 || index === 8 || index === 10) out += '-'
    const byte = bytes[index] ?? 0
    out += HEX[(byte >> 4) & 0x0f]
    out += HEX[byte & 0x0f]
  }
  return out
}
