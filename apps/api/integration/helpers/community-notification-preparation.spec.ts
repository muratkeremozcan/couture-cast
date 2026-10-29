import { Prisma } from '@prisma/client'
import { afterEach, expect, it, vi } from 'vitest'
import { prepareNotificationPass } from './community-notification-preparation.js'

afterEach(() => vi.restoreAllMocks())
const expiry = () =>
  new Prisma.PrismaClientKnownRequestError(
    'Transaction already closed: expired transaction',
    { code: 'P2028', clientVersion: 'fixture' }
  )
function elapsedPasses() {
  let tick = 0
  vi.spyOn(performance, 'now').mockImplementation(() => (tick += 1001))
}

it('limits persistent observed transaction expiry to three preparation passes', async () => {
  elapsedPasses()
  const error = expiry()
  const pass = vi.fn(() => Promise.reject(error))
  await expect(prepareNotificationPass(pass)).rejects.toBe(error)
  expect(pass).toHaveBeenCalledTimes(3)
})

it('retries only observed expiry and then accepts the durable completed pass', async () => {
  elapsedPasses()
  const pass = vi.fn().mockRejectedValueOnce(expiry()).mockResolvedValue(undefined)
  await prepareNotificationPass(pass)
  expect(pass).toHaveBeenCalledTimes(2)
})

it('preserves a fast transaction-not-found defect without retrying', async () => {
  vi.spyOn(performance, 'now').mockReturnValue(0)
  const error = expiry()
  const pass = vi.fn(() => Promise.reject(error))
  await expect(prepareNotificationPass(pass)).rejects.toBe(error)
  expect(pass).toHaveBeenCalledTimes(1)
})

it('preserves unrelated database and application failures without retrying', async () => {
  for (const error of [
    new Error('programming defect'),
    new Prisma.PrismaClientKnownRequestError('dependency unavailable', {
      code: 'P2010',
      clientVersion: 'fixture',
    }),
  ]) {
    elapsedPasses()
    const pass = vi.fn(() => Promise.reject(error))
    await expect(prepareNotificationPass(pass)).rejects.toBe(error)
    expect(pass).toHaveBeenCalledTimes(1)
    vi.restoreAllMocks()
  }
})
