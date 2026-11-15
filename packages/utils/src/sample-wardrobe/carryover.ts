// Story 6.16 D8: applying the preview's comfort settings to a verified account, the one
// piece of guest state that may cross into an account, and only on explicit consent.
// Both clients run this routine with their own authenticated read and write.
import type { SampleComfort } from './selector'

export type ComfortCarryoverOutcome =
  /** The account now holds the proposal, confirmed by a read. */
  | { status: 'saved'; values: SampleComfort }
  /** The write failed or could not be confirmed; the proposal is kept for a retry. */
  | { status: 'failed' }
  /** The server refused for age or consent; the proposal must be discarded. */
  | { status: 'rejected' }
  /** The member changed while this ran; the result belongs to nobody on screen. */
  | { status: 'stale' }

export function sameComfort(a: SampleComfort, b: SampleComfort): boolean {
  return (
    a.runsColdWarm === b.runsColdWarm &&
    a.windTolerance === b.windTolerance &&
    a.precipPreparedness === b.precipPreparedness
  )
}

/**
 * Reads first, so a retry after an uncertain (timed out) write never writes twice; writes
 * only when the account differs; reads back before reporting success. `isCurrent` is
 * checked after every await so a late answer cannot land on another member's screen.
 */
export async function applyComfortCarryover(options: {
  proposal: SampleComfort
  read: () => Promise<SampleComfort>
  write: (values: SampleComfort) => Promise<unknown>
  isCurrent: () => boolean
  isRejection: (error: unknown) => boolean
}): Promise<ComfortCarryoverOutcome> {
  const { proposal, read, write, isCurrent, isRejection } = options
  try {
    const before = await read()
    if (!isCurrent()) return { status: 'stale' }
    if (sameComfort(before, proposal)) return { status: 'saved', values: before }
    await write(proposal)
    if (!isCurrent()) return { status: 'stale' }
    const after = await read()
    if (!isCurrent()) return { status: 'stale' }
    return sameComfort(after, proposal)
      ? { status: 'saved', values: after }
      : { status: 'failed' }
  } catch (error) {
    if (!isCurrent()) return { status: 'stale' }
    return isRejection(error) ? { status: 'rejected' } : { status: 'failed' }
  }
}
