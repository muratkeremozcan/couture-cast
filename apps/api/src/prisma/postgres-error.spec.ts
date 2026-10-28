import { describe, expect, it } from 'vitest'
import { Prisma } from '@prisma/client'
import { postgresError } from './postgres-error.js'

// Both forms as Prisma 6.19 raised them against real failures (2026-10-27 probe).
const raw = (code: string, message: string) =>
  new Prisma.PrismaClientKnownRequestError(
    `Raw query failed. Code: \`${code}\`. Message: \`${message}\``,
    { code: 'P2010', clientVersion: 'test', meta: { code, message } }
  )
const model = (code: string, message: string, severity = 'ERROR', rest = '') =>
  new Prisma.PrismaClientUnknownRequestError(
    `Invalid \`tx.user.update()\` invocation:\nError occurred during query execution:\nConnectorError(ConnectorError { user_facing_error: None, kind: QueryError(PostgresError { code: "${code}", message: "${message}", severity: "${severity}", detail: None, column: None, hint: None${rest} }), transient: false })`,
    { clientVersion: 'test' }
  )

describe('postgres error in either Prisma form', () => {
  it.each([
    ['55P03', 'canceling statement due to lock timeout', 'ERROR'],
    ['57014', 'canceling statement due to statement timeout', 'ERROR'],
    ['25P04', 'terminating connection due to transaction timeout', 'FATAL'],
    ['40P01', 'deadlock detected', 'ERROR'],
  ])('reads %s with its message from both forms', (code, message, severity) => {
    expect(postgresError(raw(code, `${severity}: ${message}`))).toEqual({ code, message })
    expect(postgresError(model(code, message, severity))).toEqual({ code, message })
  })
  it('compares a raw message on its first line, as the rendering keeps DETAIL apart', () => {
    expect(
      postgresError(
        raw('40P01', 'ERROR: deadlock detected\nDETAIL: Process 1 waits for ShareLock')
      )
    ).toEqual({ code: '40P01', message: 'deadlock detected' })
  })
  it('keeps a raw message that carries no severity prefix', () => {
    expect(
      postgresError(raw('40001', 'could not serialize access due to concurrent update'))
    ).toEqual({
      code: '40001',
      message: 'could not serialize access due to concurrent update',
    })
  })
  it('unescapes quotes inside a rendered message', () => {
    expect(
      postgresError(model('55P03', 'could not obtain lock on row in relation \\"User\\"'))
    ).toEqual({
      code: '55P03',
      message: 'could not obtain lock on row in relation "User"',
    })
  })
  it.each([
    [
      'a closed connection (P1017)',
      new Prisma.PrismaClientKnownRequestError('Server has closed the connection.', {
        code: 'P1017',
        clientVersion: 'test',
      }),
    ],
    [
      'a mapped write conflict (P2034)',
      new Prisma.PrismaClientKnownRequestError('Transaction failed', {
        code: 'P2034',
        clientVersion: 'test',
        meta: { modelName: 'User' },
      }),
    ],
    [
      'an unknown error without a rendering',
      new Prisma.PrismaClientUnknownRequestError('code: "55P03"', {
        clientVersion: 'test',
      }),
    ],
    ['a plain error naming a state', new Error('PostgresError { code: "57014"')],
    ['an object shaped like the raw form', { meta: { code: '55P03', message: 'x' } }],
  ])('reads nothing from %s', (_, error) => {
    expect(postgresError(error)).toBeNull()
  })
})
