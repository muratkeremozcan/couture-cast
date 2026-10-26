import { setTimeout as delay } from 'node:timers/promises'
import { Prisma } from '@prisma/client'

/** Mirror the production 250 ms sweep cadence while preparing a durable fixture. */
export async function prepareNotificationPass(pass: () => Promise<unknown>) {
  for (let attempt = 1; ; attempt++) {
    const started = performance.now()
    try {
      await pass()
      return
    } catch (error) {
      const expired =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2028' &&
        performance.now() - started >= 1000 &&
        /expired transaction|Transaction not found|Transaction already closed/.test(
          error.message
        )
      // The product retries from its durable queue. Fixture setup converges within
      // three passes, and preserves every unexpected or persistent failure.
      if (!expired || attempt === 3) throw error
      await delay(250)
    }
  }
}
