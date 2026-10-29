import { describe, expect, it, vi } from 'vitest'
import { Prisma, type PrismaClient } from '@prisma/client'
import {
  PLDBGAPI2_MAX_ATTEMPTS,
  interactiveTransaction,
  isPldbgapi2StackError,
  retryTopLevelOperation,
  singleRunTransaction,
} from './prisma-client.js'

const MESSAGE = 'cannot find parent statement on pldbgapi2 call stack'
// A raw query reports the SQLSTATE in meta, as Prisma did for the local Supabase abort.
const raw = (code = 'XX000', message = `ERROR: ${MESSAGE}`) =>
  new Prisma.PrismaClientKnownRequestError(
    `Raw query failed. Code: \`${code}\`. Message: \`${message}\``,
    { code: 'P2010', clientVersion: 'test', meta: { code, message } }
  )
// A model operation reports it as an unknown request error carrying the engine's
// PostgresError rendering (captured from Prisma 6.19 against an injected trigger).
const model = (code = 'XX000', message = MESSAGE) =>
  new Prisma.PrismaClientUnknownRequestError(
    `Invalid \`prisma.auditLog.create()\` invocation:\nError occurred during query execution:\nConnectorError(ConnectorError { user_facing_error: None, kind: QueryError(PostgresError { code: "${code}", message: "${message}", severity: "ERROR", detail: None, column: None, hint: None }), transient: false })`,
    { clientVersion: 'test' }
  )
const others = [
  ['a raw XX000 with another message', raw('XX000', 'ERROR: some other internal error')],
  ['a raw query with another SQLSTATE', raw('P0001')],
  ['a model XX000 with another message', model('XX000', 'some other internal error')],
  ['a model error with another SQLSTATE', model('P0001')],
  ['a serialization failure', raw('40001', 'ERROR: could not serialize access')],
  ['a plain Error with the message', new Error(MESSAGE)],
] as const

describe('pldbgapi2 stack error predicate', () => {
  it('matches SQLSTATE XX000 with the message in both Prisma forms', () => {
    expect(isPldbgapi2StackError(raw())).toBe(true)
    expect(isPldbgapi2StackError(model())).toBe(true)
  })
  it('reads the raw message from the error when meta carries only the SQLSTATE', () => {
    const bare = (text: string) =>
      new Prisma.PrismaClientKnownRequestError(text, {
        code: 'P2010',
        clientVersion: 'test',
        meta: { code: 'XX000' },
      })
    expect(
      isPldbgapi2StackError(bare(`Raw query failed. Message: \`ERROR: ${MESSAGE}\``))
    ).toBe(true)
    expect(isPldbgapi2StackError(bare('Raw query failed. Message: `ERROR: other`'))).toBe(
      false
    )
  })
  it.each(others)('does not match %s', (_, error) => {
    expect(isPldbgapi2StackError(error)).toBe(false)
  })
  it('does not match a bare object shaped like the raw error', () => {
    expect(isPldbgapi2StackError({ meta: { code: 'XX000', message: MESSAGE } })).toBe(
      false
    )
  })
})

const client = (transaction: ReturnType<typeof vi.fn>) =>
  ({ $transaction: transaction }) as unknown as PrismaClient

describe('interactiveTransaction', () => {
  it('states its bound', () => {
    expect(PLDBGAPI2_MAX_ATTEMPTS).toBe(3)
  })
  it.each([
    ['raw', raw()],
    ['model', model()],
  ])('re-runs the whole transaction after a %s pldbgapi2 abort', async (_, error) => {
    const work = vi.fn(() => Promise.resolve('committed'))
    const transaction = vi
      .fn()
      .mockRejectedValueOnce(error)
      .mockImplementation(() => work())
    const options = { isolationLevel: 'ReadCommitted', timeout: 7000 } as const
    await expect(
      interactiveTransaction(client(transaction), work, options)
    ).resolves.toBe('committed')
    expect(transaction).toHaveBeenCalledTimes(2)
    expect(transaction).toHaveBeenNthCalledWith(1, work, options)
    expect(transaction).toHaveBeenNthCalledWith(2, work, options)
  })
  it('passes no options argument when the caller gives none', async () => {
    const work = vi.fn(() => Promise.resolve(1))
    const transaction = vi.fn(() => work())
    await interactiveTransaction(client(transaction), work)
    expect(transaction.mock.calls).toEqual([[work]])
  })
  it.each(others)('does not retry %s', async (_, error) => {
    const transaction = vi.fn().mockRejectedValue(error)
    await expect(
      interactiveTransaction(client(transaction), () => Promise.resolve())
    ).rejects.toBe(error)
    expect(transaction).toHaveBeenCalledTimes(1)
  })
  it('stops after three attempts and surfaces the last error unchanged', async () => {
    const errors = [raw(), model(), raw()]
    const transaction = vi
      .fn()
      .mockRejectedValueOnce(errors[0])
      .mockRejectedValueOnce(errors[1])
      .mockRejectedValueOnce(errors[2])
      .mockResolvedValue('never reached')
    await expect(
      interactiveTransaction(client(transaction), () => Promise.resolve())
    ).rejects.toBe(errors[2])
    expect(transaction).toHaveBeenCalledTimes(3)
  })
})

describe('per-attempt options and single-run transactions', () => {
  it('computes options given as a function again for each attempt', async () => {
    const work = vi.fn(() => Promise.resolve('committed'))
    const transaction = vi
      .fn()
      .mockRejectedValueOnce(model())
      .mockImplementation(() => work())
    const remaining = [900, 400]
    const options = vi.fn(() => ({ timeout: remaining.shift()! }))
    await interactiveTransaction(client(transaction), work, options)
    expect(options).toHaveBeenCalledTimes(2)
    expect(transaction.mock.calls).toEqual([
      [work, { timeout: 900 }],
      [work, { timeout: 400 }],
    ])
  })
  it('stops retrying when computing the options throws', async () => {
    const expired = new Error('deadline passed')
    const transaction = vi.fn().mockRejectedValue(model())
    const options = vi
      .fn()
      .mockReturnValueOnce({ timeout: 10 })
      .mockImplementation(() => {
        throw expired
      })
    await expect(
      interactiveTransaction(client(transaction), () => Promise.resolve(), options)
    ).rejects.toBe(expired)
    expect(transaction).toHaveBeenCalledTimes(1)
  })
  it('runs a single-run transaction once, even on the pldbgapi2 abort', async () => {
    const error = model()
    const transaction = vi.fn().mockRejectedValue(error)
    const work = () => Promise.resolve()
    await expect(
      singleRunTransaction(client(transaction), work, { timeout: 3000 })
    ).rejects.toBe(error)
    expect(transaction.mock.calls).toEqual([[work, { timeout: 3000 }]])
  })
})

describe('top-level operation retry', () => {
  it('retries a top-level operation and returns its result', async () => {
    const query = vi.fn().mockRejectedValueOnce(model()).mockResolvedValue({ count: 1 })
    const args = { where: { id: 'post' } }
    await expect(retryTopLevelOperation({ args, query })).resolves.toEqual({ count: 1 })
    expect(query.mock.calls).toEqual([[args], [args]])
  })
  it('stops after three attempts and surfaces the last error unchanged', async () => {
    const errors = [model(), raw(), model()]
    const query = vi
      .fn()
      .mockRejectedValueOnce(errors[0])
      .mockRejectedValueOnce(errors[1])
      .mockRejectedValueOnce(errors[2])
    await expect(retryTopLevelOperation({ args: {}, query })).rejects.toBe(errors[2])
    expect(query).toHaveBeenCalledTimes(3)
  })
  it.each(others)('does not retry %s', async (_, error) => {
    const query = vi.fn().mockRejectedValue(error)
    await expect(retryTopLevelOperation({ args: {}, query })).rejects.toBe(error)
    expect(query).toHaveBeenCalledTimes(1)
  })
  it.each(['itx', 'batch'])(
    'passes an operation inside a %s transaction through once',
    async (kind) => {
      const error = model()
      const query = vi.fn().mockRejectedValue(error)
      const params = { args: {}, query, __internalParams: { transaction: { kind } } }
      await expect(retryTopLevelOperation(params)).rejects.toBe(error)
      expect(query).toHaveBeenCalledTimes(1)
    }
  )
})
