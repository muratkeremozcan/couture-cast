// Story 6.16 I-CONV-UNCERTAIN, L-APPLY-THEN-SWITCH and L-READBACK-THEN-SWITCH at the unit level.
import { describe, expect, it, vi } from 'vitest'
import { applyComfortCarryover, sameComfort } from './carryover'
import type { SampleComfort } from './selector'

const proposal: SampleComfort = {
  runsColdWarm: 'cold',
  windTolerance: 'low',
  precipPreparedness: 'high',
}
const account: SampleComfort = {
  runsColdWarm: 'neutral',
  windTolerance: 'medium',
  precipPreparedness: 'medium',
}

function server(initial: SampleComfort) {
  let stored = initial
  return {
    read: vi.fn(() => Promise.resolve({ ...stored })),
    write: vi.fn((values: SampleComfort) => {
      stored = values
      return Promise.resolve({ data: values })
    }),
    stored: () => stored,
  }
}

const base = { isCurrent: () => true, isRejection: () => false }

describe('comfort carryover (D8)', () => {
  it('reads, writes the proposal, reads back and reports saved', async () => {
    const api = server(account)
    const outcome = await applyComfortCarryover({ ...base, proposal, ...api })
    expect(outcome).toEqual({ status: 'saved', values: proposal })
    expect(api.write).toHaveBeenCalledTimes(1)
    expect(api.read).toHaveBeenCalledTimes(2)
  })

  it('does not write when the account already holds the proposal (retry after a timeout)', async () => {
    const api = server(proposal)
    expect(await applyComfortCarryover({ ...base, proposal, ...api })).toEqual({
      status: 'saved',
      values: proposal,
    })
    expect(api.write).not.toHaveBeenCalled()
  })

  it('reports failed when the read back disagrees', async () => {
    const api = server(account)
    // The server answers 200 but the stored values never change.
    api.write.mockImplementationOnce(() => Promise.resolve({ data: proposal }))
    expect(await applyComfortCarryover({ ...base, proposal, ...api })).toEqual({
      status: 'failed',
    })
  })

  it('reports failed on a timeout, then a retry reads first and saves once', async () => {
    const api = server(account)
    api.write.mockImplementationOnce(() => Promise.reject(new Error('timeout')))
    expect(await applyComfortCarryover({ ...base, proposal, ...api })).toEqual({
      status: 'failed',
    })
    const retry = await applyComfortCarryover({ ...base, proposal, ...api })
    expect(retry).toEqual({ status: 'saved', values: proposal })
    expect(api.write).toHaveBeenCalledTimes(2)
  })

  it('does not write again when a timed-out write had landed (I-CONV-UNCERTAIN)', async () => {
    const api = server(account)
    api.write.mockImplementationOnce(async (values) => {
      await api.write(values)
      throw new Error('timeout after commit')
    })
    expect(await applyComfortCarryover({ ...base, proposal, ...api })).toEqual({
      status: 'failed',
    })
    expect(api.stored()).toEqual(proposal)
    const writesBeforeRetry = api.write.mock.calls.length
    expect(await applyComfortCarryover({ ...base, proposal, ...api })).toEqual({
      status: 'saved',
      values: proposal,
    })
    expect(api.write.mock.calls.length).toBe(writesBeforeRetry)
  })

  it('reports rejected for an age or consent refusal', async () => {
    const api = server(account)
    api.write.mockImplementationOnce(() => Promise.reject(new Error('403')))
    expect(
      await applyComfortCarryover({ ...base, isRejection: () => true, proposal, ...api })
    ).toEqual({ status: 'rejected' })
  })

  it.each([
    ['after the first read', 1],
    ['after the write', 2],
    ['after the read back', 3],
  ])('reports stale when the member changes %s', async (_label, changeAt) => {
    const api = server(account)
    let checks = 0
    const outcome = await applyComfortCarryover({
      ...base,
      proposal,
      ...api,
      isCurrent: () => {
        checks += 1
        return checks < changeAt
      },
    })
    expect(outcome).toEqual({ status: 'stale' })
  })

  it('reports stale, not failed, when an error lands after the member changed', async () => {
    const api = server(account)
    api.write.mockImplementationOnce(() => Promise.reject(new Error('late')))
    let current = true
    api.write.mockImplementationOnce(() => {
      current = false
      return Promise.reject(new Error('late'))
    })
    await applyComfortCarryover({ ...base, proposal, ...api })
    const outcome = await applyComfortCarryover({
      ...base,
      proposal,
      ...api,
      isCurrent: () => current,
    })
    expect(outcome).toEqual({ status: 'stale' })
  })

  it('compares all three values', () => {
    expect(sameComfort(proposal, { ...proposal })).toBe(true)
    expect(sameComfort(proposal, { ...proposal, precipPreparedness: 'low' })).toBe(false)
  })
})
