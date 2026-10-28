import { Injectable } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'
import type {
  FeatureFlagKey,
  FeatureFlagRecord,
  FeatureFlagStoredValue,
} from '@couture/config'
import { interactiveTransaction } from '../../prisma/prisma-client.js'

/** Story 0.7 Task 8 support file: persistent cache for the fallback flag flow.
 * Why this repository exists:
 * - PostHog is the source of truth, but it is still a network dependency.
 * - We keep a durable local copy so requests and tests can keep working when PostHog is down.
 * Alternatives:
 * - In-memory cache only, which disappears on restart.
 * - No cache, which forces every request to depend on PostHog availability.
 * Flow refs:
 * - S0.7/T8/3: request-time fallback reads use this repository when the remote provider has no answer.
 * - S0.7/T8/4: background sync writes the latest known values back into this repository.
 */
@Injectable()
export class FeatureFlagsRepository {
  private readonly reads = new Map<
    FeatureFlagKey,
    Promise<FeatureFlagStoredValue | null>
  >()
  constructor(private readonly prisma: PrismaClient) {}

  findValue(key: FeatureFlagKey): Promise<FeatureFlagStoredValue | null> {
    // Flow ref S0.7/T8/3: request-time fallback reads are intentionally tiny:
    // one key, one cached value, null when the cache has never been populated.
    const existing = this.reads.get(key)
    if (existing) return existing
    // Share concurrent reads only. Each caller retains its own deadline, and a
    // settled read never becomes a process-local authorization cache.
    const read = Promise.resolve().then(async () => {
      const flag = await this.prisma.featureFlag.findUnique({ where: { key } })
      return (flag?.value as FeatureFlagStoredValue | undefined) ?? null
    })
    this.reads.set(key, read)
    void read
      .finally(() => {
        if (this.reads.get(key) === read) this.reads.delete(key)
      })
      .catch(() => undefined)
    return read
  }

  async upsertMany(flags: FeatureFlagRecord[]): Promise<void> {
    // Flow ref S0.7/T8/4: sync writes the full known set in one transaction so
    // cache updates are consistent across all flags.
    await interactiveTransaction(this.prisma, async (tx) => {
      for (const flag of flags)
        await tx.featureFlag.upsert({
          where: { key: flag.key },
          create: {
            key: flag.key,
            value: flag.value,
          },
          update: {
            value: flag.value,
          },
        })
    })
  }
}
