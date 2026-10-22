// Story 6.5 (D10/O1): an opaque diagnostic value naming this realtime process.
import { randomBytes } from 'node:crypto'

/**
 * Random per process, generated once at load: no hostname, region, user or request data.
 * Every connection is acknowledged with it, so a probe can tell two realtime instances
 * apart. It carries no meaning and clients must not depend on it.
 */
export const communityRealtimeInstance = randomBytes(12).toString('base64url')
