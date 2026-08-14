/**
 * The one place the Maestro version is pinned.
 *
 * `scripts/maestro-install.mjs` installs this version and `scripts/run-maestro.mjs`
 * falls back to it when no installed binary can be found. Holding the number in
 * both is how a pin drifts: one gets bumped in a reviewable commit and the other
 * quietly keeps running whatever it ran before.
 */
import os from 'node:os'
import path from 'node:path'

// Bump deliberately, in a reviewable commit. Never let this float.
export const MAESTRO_PINNED_VERSION = process.env.MAESTRO_VERSION ?? '2.8.0'

/** Where the official installer puts the binary on macOS and Linux. */
export const MAESTRO_BIN = path.join(os.homedir(), '.maestro', 'bin', 'maestro')
