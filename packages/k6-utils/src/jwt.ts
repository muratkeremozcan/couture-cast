// JWT (JSON Web Token) encode/decode/verify.
// Supports both symmetric (HS256/384/512) and asymmetric (RS256) algorithms.
//
// Why: most APIs require a JWT for authentication. In k6 tests, you need to generate
// valid tokens to send with your requests. This module handles the signing so you don't
// have to manually base64-encode headers, compute HMACs, and concatenate segments.
//
// A JWT has 3 parts separated by dots: header.payload.signature
//   header:    { "typ": "JWT", "alg": "HS256" }  (base64url encoded)
//   payload:   { "customer_id": 123, "exp": ... } (base64url encoded)
//   signature: HMAC(header.payload, secret) or RSA(header.payload, privateKey)
//
// HMAC (HS*): symmetric; same secret signs and verifies. Simple, fast.
// RSA (RS256): asymmetric; private key signs, public key verifies. Used when
//   the signer and verifier are different services (e.g. auth service signs,
//   API gateway verifies with the public key).

import crypto from 'k6/crypto'
import type { Algorithm } from 'k6/crypto'
import encoding from 'k6/encoding'

export type JwtAlgorithm = 'HS256' | 'HS384' | 'HS512' | 'RS256'

type JwtHeader = {
  typ: string
  alg: JwtAlgorithm
}

export type DecodedToken = {
  header: JwtHeader
  payload: Record<string, unknown>
}

/**
 * Signs a JWT with HMAC (Hash-based Message Authentication Code).
 * Returns the compact `header.payload.signature` string.
 * For RS256, use encodeRS256() instead.
 */
export function encode(
  payload: Record<string, unknown>,
  secret: string,
  algorithm: 'HS256' | 'HS384' | 'HS512' = 'HS256'
): string {
  const header: JwtHeader = { typ: 'JWT', alg: algorithm }

  // Base64url encode header and payload (rawurl = no padding, URL-safe chars)
  const segments = [
    encoding.b64encode(JSON.stringify(header), 'rawurl'),
    encoding.b64encode(JSON.stringify(payload), 'rawurl'),
  ]

  // Sign: HMAC the "header.payload" string with the secret
  // 'HS256' -> 'sha256', 'HS384' -> 'sha384', 'HS512' -> 'sha512'
  const sigInput = segments.join('.')
  const hmacAlg = algorithm.replace('HS', 'sha') as Algorithm
  const sig = crypto.hmac(hmacAlg, secret, sigInput, 'base64rawurl')

  segments.push(sig)
  return segments.join('.') // header.payload.signature
}

/**
 * Signs a JWT with RS256 (RSA + SHA-256). Async because WebCrypto is promise-based.
 * @param payload - JWT claims object
 * @param privateKeyPem - RSA private key in PEM format (-----BEGIN PRIVATE KEY-----)
 * @returns JWT string (header.payload.signature)
 */
export async function encodeRS256(
  payload: Record<string, unknown>,
  privateKeyPem: string
): Promise<string> {
  const header: JwtHeader = { typ: 'JWT', alg: 'RS256' }

  const segments = [
    encoding.b64encode(JSON.stringify(header), 'rawurl'),
    encoding.b64encode(JSON.stringify(payload), 'rawurl'),
  ]

  const sigInput = segments.join('.')

  // Parse PEM: strip headers/footers, decode base64 to raw bytes.
  // Only PKCS#8 format (BEGIN PRIVATE KEY) is supported.
  // PKCS#1 (BEGIN RSA PRIVATE KEY) requires a different import format; convert with:
  //   openssl pkcs8 -topk8 -inform PEM -outform PEM -nocrypt -in rsa.pem -out pkcs8.pem
  if (privateKeyPem.includes('BEGIN RSA PRIVATE KEY')) {
    throw new Error(
      'PKCS#1 (BEGIN RSA PRIVATE KEY) is not supported. Convert to PKCS#8: openssl pkcs8 -topk8 -inform PEM -outform PEM -nocrypt -in key.pem -out pkcs8.pem'
    )
  }
  const pemBody = privateKeyPem
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s/g, '')
  const keyBytes = base64ToBytes(pemBody)

  // Import the private key for signing via the global WebCrypto API (k6 v1.0+)
  // globalThis.crypto = WebCrypto global; crypto (imported above) = k6/crypto hash module
  const key = await globalThis.crypto.subtle.importKey(
    'pkcs8',
    keyBytes.buffer as ArrayBuffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  )

  // Sign the header.payload string
  const sigBytes = await globalThis.crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(sigInput)
  )

  // Convert signature to base64url (no padding, URL-safe chars)
  const sig = bytesToBase64url(new Uint8Array(sigBytes))
  segments.push(sig)
  return segments.join('.')
}

/**
 * Decodes a JWT without verifying the signature.
 * Use for inspecting claims (e.g. logging, debugging).
 * WARNING: does NOT check if the token was tampered with. Use verify() or verifyRS256() for that.
 * @returns `{ header: { typ, alg }, payload: { sub, iat, exp, ... } }`
 */
export function decode(token: string): DecodedToken {
  const parts = token.split('.')
  return {
    header: JSON.parse(encoding.b64decode(parts[0]!, 'rawurl', 's')) as JwtHeader,
    payload: JSON.parse(encoding.b64decode(parts[1]!, 'rawurl', 's')) as Record<
      string,
      unknown
    >,
  }
}

/**
 * Decodes a JWT and verifies the HMAC signature. Throws if verification fails.
 * Use this when you need to confirm the token hasn't been tampered with.
 * @returns `{ header: { typ, alg }, payload: { sub, iat, exp, ... } }`
 */
export function verify(
  token: string,
  secret: string,
  algorithm: 'HS256' | 'HS384' | 'HS512' = 'HS256'
): DecodedToken {
  const parts = token.split('.')
  if (parts.length !== 3) throw new Error('JWT must have 3 segments')

  // Recompute the signature from header.payload using the same secret
  const sigInput = `${parts[0]}.${parts[1]}`
  const hmacAlg = algorithm.replace('HS', 'sha') as Algorithm
  const expectedSig = crypto.hmac(hmacAlg, secret, sigInput, 'base64rawurl')

  // If the recomputed signature doesn't match, the token was forged or corrupted.
  // Note: uses standard !== (not constant-time comparison). This is a test toolkit;
  // timing side-channels are not a concern for perf test token generation.
  if (expectedSig !== parts[2]) {
    throw new Error('JWT signature verification failed')
  }

  return {
    header: JSON.parse(encoding.b64decode(parts[0]!, 'rawurl', 's')) as JwtHeader,
    payload: JSON.parse(encoding.b64decode(parts[1]!, 'rawurl', 's')) as Record<
      string,
      unknown
    >,
  }
}

/**
 * Verifies an RS256 JWT using a public key. Async because WebCrypto is promise-based.
 * Throws if verification fails.
 * @param token - The JWT string to verify
 * @param publicKeyPem - RSA public key in PEM format (-----BEGIN PUBLIC KEY-----)
 * @returns `{ header: { typ, alg }, payload: { sub, iat, exp, ... } }`
 */
export async function verifyRS256(
  token: string,
  publicKeyPem: string
): Promise<DecodedToken> {
  const parts = token.split('.')
  if (parts.length !== 3) throw new Error('JWT must have 3 segments')

  const sigInput = `${parts[0]}.${parts[1]}`

  // Parse PEM: strip headers/footers, decode base64 to raw bytes
  const pemBody = publicKeyPem
    .replace(/-----BEGIN PUBLIC KEY-----/g, '')
    .replace(/-----END PUBLIC KEY-----/g, '')
    .replace(/\s/g, '')
  const keyBytes = base64ToBytes(pemBody)

  // Import the public key for verification
  const key = await globalThis.crypto.subtle.importKey(
    'spki',
    keyBytes.buffer as ArrayBuffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  )

  // Decode the signature from base64url back to bytes
  const sigBytes = base64urlToBytes(parts[2]!)

  // Verify: does the signature match the header.payload signed with the corresponding private key?
  const valid = await globalThis.crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    sigBytes.buffer as ArrayBuffer,
    new TextEncoder().encode(sigInput)
  )

  if (!valid) {
    throw new Error('JWT RS256 signature verification failed')
  }

  return {
    header: JSON.parse(encoding.b64decode(parts[0]!, 'rawurl', 's')) as JwtHeader,
    payload: JSON.parse(encoding.b64decode(parts[1]!, 'rawurl', 's')) as Record<
      string,
      unknown
    >,
  }
}

// --- Internal helpers for RS256 key/signature encoding ---

function base64ToBytes(base64: string): Uint8Array {
  const binStr = atob(base64)
  const bytes = new Uint8Array(binStr.length)
  for (let i = 0; i < binStr.length; i++) {
    bytes[i] = binStr.charCodeAt(i)
  }
  return bytes
}

function base64urlToBytes(base64url: string): Uint8Array {
  // base64url -> base64: replace URL-safe chars, add padding
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  return base64ToBytes(padded)
}

function bytesToBase64url(bytes: Uint8Array): string {
  let binStr = ''
  for (const b of bytes) {
    binStr += String.fromCharCode(b)
  }
  // btoa -> base64, then make URL-safe and strip padding
  return btoa(binStr).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
