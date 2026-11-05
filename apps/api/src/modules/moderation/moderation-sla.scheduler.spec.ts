// Story 6.12 test owner: U-W-SCHEDULER. The cadence is an operational promise, so it is written out here.
import { describe, expect, it, vi } from 'vitest'
import {
  MODERATION_SLA_SWEEP_CRON_PATTERN,
  MODERATION_SLA_SWEEP_INTERVAL_MS,
  MODERATION_SLA_SWEEP_JOB_NAME,
  registerModerationSlaScheduler,
} from './moderation-sla.scheduler.js'

describe('U-W-SCHEDULER', () => {
  it('upserts one scheduler id at a one-minute cadence, and a second start changes nothing', async () => {
    const upsertJobScheduler = vi.fn().mockResolvedValue(undefined)
    await registerModerationSlaScheduler({ upsertJobScheduler })
    await registerModerationSlaScheduler({ upsertJobScheduler })
    expect(upsertJobScheduler.mock.calls).toEqual([
      [
        'moderation-sla-sweep',
        { pattern: '* * * * *' },
        { name: 'moderation-sla-sweep', data: {} },
      ],
      [
        'moderation-sla-sweep',
        { pattern: '* * * * *' },
        { name: 'moderation-sla-sweep', data: {} },
      ],
    ])
    expect(MODERATION_SLA_SWEEP_JOB_NAME).toBe('moderation-sla-sweep')
    expect(MODERATION_SLA_SWEEP_CRON_PATTERN).toBe('* * * * *')
    expect(MODERATION_SLA_SWEEP_INTERVAL_MS).toBe(60_000)
  })
})
