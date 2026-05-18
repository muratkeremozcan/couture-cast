// Statistical distribution helpers for realistic load shaping.
// Models real-world traffic patterns where some accounts/endpoints are "hotter" than others.

import crypto from 'k6/crypto'

/**
 * Returns an index from 0..n-1 following a Zipfian (power-law) distribution.
 * Lower indices are selected more frequently, modeling "hot" accounts or popular endpoints.
 * Uses the O(1) power-transform formula.
 * @param n - Size of the population (must be positive)
 * @param skew - Zipfian exponent (default 1.07; higher = more skewed toward index 0)
 * @throws {Error} if n is not a positive integer
 * @returns integer from 0 to n-1, biased toward 0
 */
export function zipfianIndex(n: number, skew = 1.07): number {
  if (n <= 0) throw new Error('zipfianIndex: n must be a positive integer')
  if (skew <= 0) throw new Error('zipfianIndex: skew must be positive (e.g. 1.07)')
  return Math.floor(n * Math.random() ** skew)
}

/**
 * Picks a random item from an array using the corresponding weight.
 * @throws {Error} if items array is empty
 * @returns one item from the array, selected by weighted probability
 * @example weightedPick(['us', 'eu', 'apac'], [70, 20, 10]) // 'us' ~70% of the time
 */
export function weightedPick<T>(items: T[], weights: number[]): T {
  if (items.length === 0) throw new Error('weightedPick: items array must not be empty')
  if (items.length !== weights.length)
    throw new Error('weightedPick: items and weights must have the same length')
  if (weights.some((w) => w < 0 || !Number.isFinite(w)))
    throw new Error('weightedPick: all weights must be non-negative finite numbers')
  const total = weights.reduce((a, b) => a + b, 0)
  if (total <= 0) throw new Error('weightedPick: weights must sum to a positive number')
  let random = Math.random() * total
  for (let i = 0; i < items.length; i++) {
    random -= weights[i]!
    if (random <= 0) return items[i]!
  }
  return items[items.length - 1]!
}

/**
 * Fast integer mixer returning an 8-char hex string. Deterministic for a given index.
 * Uses the MurmurHash3 finalizer for fast, deterministic output.
 * For cryptographic hashing, use `hashToHexSha256` instead.
 * @returns 8-character hex string (e.g. `'0de5c6a9'`)
 */
export function hashToHex(index: number): string {
  let h = index ^ 0xdeadbeef
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  h = h ^ (h >>> 16)
  return (h >>> 0).toString(16).padStart(8, '0')
}

/** SHA-256 hash of a string.
 * @returns 64-character lowercase hex string */
export function hashToHexSha256(input: string): string {
  return crypto.sha256(input, 'hex')
}
