// AES-CBC (Advanced Encryption Standard, Cipher Block Chaining) encryption
// via k6's global WebCrypto API (crypto.subtle, crypto.getRandomValues).
// Available as a global in k6 v1.0+ — no import needed.
// Used by services that accept encrypted payloads.
// The IV (Initialization Vector) seeds the first block; using a different IV each time
// ensures identical plaintext produces different ciphertext.

/**
 * Encrypts plaintext with AES-CBC. Auto-generates a random 16-byte IV if none provided.
 * Returns `{ ciphertext, iv }` both as hex strings, so the caller can transmit the IV alongside.
 * @param plaintext - The string to encrypt
 * @param keyHex - AES key as a hex string (32 hex chars = 128-bit, 64 = 256-bit)
 * @param ivHex - Optional IV as hex (32 hex chars / 16 bytes). Auto-generated if omitted.
 * @returns `{ ciphertext: string, iv: string }` both as hex
 */
export async function aesEncrypt(
  plaintext: string,
  keyHex: string,
  ivHex?: string
): Promise<{ ciphertext: string; iv: string }> {
  // Convert hex-encoded key to raw bytes for WebCrypto
  const keyBytes = hexToBytes(keyHex)

  // If caller provides an IV, use it. Otherwise generate a random 16-byte IV.
  // Random IV is preferred — reusing IVs with AES-CBC leaks information about the plaintext.
  // crypto.getRandomValues is a global in k6 v1.0+ (same as browser Web Crypto API).
  const ivBytes = ivHex ? hexToBytes(ivHex) : crypto.getRandomValues(new Uint8Array(16))

  // Import the raw key bytes into a CryptoKey object that WebCrypto can use.
  // 'raw' = key is raw bytes (not JWK or PKCS8).
  // false = key is not extractable (can't read it back out — security best practice).
  // ['encrypt'] = this key can only be used for encryption, not decryption.
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes.buffer as ArrayBuffer,
    { name: 'AES-CBC' },
    false,
    ['encrypt']
  )

  // Encrypt the plaintext. Convert string to UTF-8 bytes via the manual stringToBytes helper
  // rather than TextEncoder so this function works across all k6 versions (TextEncoder arrived
  // in k6 v0.50; we keep this helper to avoid a hard version floor for this low-level utility).
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-CBC', iv: ivBytes.buffer as ArrayBuffer },
    key,
    stringToBytes(plaintext).buffer as ArrayBuffer
  )

  // Return both ciphertext and IV as hex strings.
  // The caller needs the IV to decrypt — it's not secret, just unique.
  return {
    ciphertext: bytesToHex(new Uint8Array(encrypted)),
    iv: bytesToHex(ivBytes),
  }
}

/** Converts a string to UTF-8 bytes. Used instead of TextEncoder for k6 version portability (TextEncoder is available from k6 v0.50+). */
function stringToBytes(str: string): Uint8Array {
  // UTF-8 encodes each codepoint as 1-4 bytes depending on range.
  // charCodeAt() returns UTF-16 code units (0-65535); we convert to proper UTF-8.
  const utf8: number[] = []
  for (let i = 0; i < str.length; i++) {
    let code = str.charCodeAt(i)

    // Handle surrogate pairs (emoji, rare CJK) — two UTF-16 units = one codepoint
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < str.length) {
      const next = str.charCodeAt(i + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = (code - 0xd800) * 0x400 + (next - 0xdc00) + 0x10000
        i++
      }
    }

    if (code < 0x80) {
      utf8.push(code)
    } else if (code < 0x800) {
      utf8.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f))
    } else if (code < 0x10000) {
      utf8.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
    } else {
      utf8.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f)
      )
    }
  }
  return new Uint8Array(utf8)
}

/** Converts a hex string to a Uint8Array. Validates input format. */
function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error('Hex string must have even length')
  if (!/^[0-9a-fA-F]*$/.test(hex)) throw new Error('Invalid hex string')
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16)
  }
  return bytes
}

/** Converts a Uint8Array to a lowercase hex string. */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
