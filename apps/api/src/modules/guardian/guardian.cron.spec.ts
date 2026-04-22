import { describe, expect, it, vi } from 'vitest'
import type { GuardianService } from './guardian.service'
import { GuardianCron } from './guardian.cron'

describe('GuardianCron', () => {
  it('runs the adulthood emancipation sweep on the daily schedule hook', async () => {
    const emancipateEligibleTeens = vi.fn().mockResolvedValue({
      processed: 1,
      teenIds: ['teen-18'],
      revokedConsentCount: 1,
      notificationsQueued: 1,
    })
    const service = { emancipateEligibleTeens } as unknown as GuardianService
    const cron = new GuardianCron(service)

    await cron.emancipateAdults()

    expect(emancipateEligibleTeens).toHaveBeenCalledTimes(1)
  })
})
