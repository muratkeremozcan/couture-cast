// Story 6.5 owner: revision-guarded community opt-in and shared account quiet hours.
import { createHmac } from 'node:crypto'
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
} from '@nestjs/common'
import { PrismaClient, type Prisma } from '@prisma/client'
import {
  alertPreferencesSchema,
  type PatchCommunityNotificationPreferences,
} from '@couture/api-client/contracts/http'
import { requireAnalyticsIdSecret } from '../telemetry/telemetry.service.js'
import { CommunityAccessService } from './community-access.service.js'

@Injectable()
export class CommunityPreferencesService {
  constructor(
    @Inject(PrismaClient) private readonly prisma: PrismaClient,
    @Inject(CommunityAccessService) private readonly access: CommunityAccessService
  ) {}

  private async snapshot(user: string, tx: Prisma.TransactionClient) {
    const preference = await tx.communityNotificationPreference.findUnique({
      where: { user_id: user },
    })
    const account = await tx.notificationPreference.findUnique({
      where: { user_id: user },
    })
    const revision = createHmac('sha256', requireAnalyticsIdSecret())
      .update(
        JSON.stringify([
          user,
          preference?.revision ?? 0,
          preference?.generation ?? 0,
          account ? [account.policy_revision] : null,
        ])
      )
      .digest('base64url')
    return {
      enabled: preference?.enabled ?? false,
      pushEnabled: account?.push_enabled ?? true,
      quietHoursEnabled: account?.quiet_hours_enabled ?? false,
      quietHoursStart: account?.quiet_hours_start ?? '22:00',
      quietHoursEnd: account?.quiet_hours_end ?? '07:00',
      timezone: account?.timezone ?? 'UTC',
      timezoneConfigured: account?.timezone_configured ?? false,
      revision,
    }
  }

  private async updateOptIn(
    tx: Prisma.TransactionClient,
    user: string,
    input: PatchCommunityNotificationPreferences,
    enabled: boolean
  ) {
    await tx.communityNotificationPreference.upsert({
      where: { user_id: user },
      create: {
        user_id: user,
        enabled: input.enabled ?? false,
        revision: 1,
        generation: 1,
      },
      update: {
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        revision: { increment: 1 },
        ...(input.enabled !== undefined && input.enabled !== enabled
          ? { generation: { increment: 1 } }
          : {}),
      },
    })
  }

  async get(user: string) {
    await this.access.assert(user)
    return this.prisma.$transaction((tx) => this.snapshot(user, tx), {
      isolationLevel: 'RepeatableRead',
    })
  }

  async patch(user: string, input: PatchCommunityNotificationPreferences) {
    await this.access.assert(user)
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT community_privacy_guards(ARRAY[${user}]::text[],ARRAY[]::text[],true)`
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('community_member:' || ${user}))`
      await this.access.assertDatabase(user, tx)
      const current = await this.snapshot(user, tx)
      if (current.revision !== input.baseRevision)
        throw new ConflictException({
          statusCode: 409,
          code: 'revision_conflict',
          current,
        })
      const changes = {
        ...(input.quietHoursEnabled !== undefined
          ? { quietHoursEnabled: input.quietHoursEnabled }
          : {}),
        ...(input.quietHoursStart !== undefined
          ? { quietHoursStart: input.quietHoursStart }
          : {}),
        ...(input.quietHoursEnd !== undefined
          ? { quietHoursEnd: input.quietHoursEnd }
          : {}),
        ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
      }
      const merged = alertPreferencesSchema.safeParse({
        pushEnabled: current.pushEnabled,
        quietHoursEnabled: current.quietHoursEnabled,
        quietHoursStart: current.quietHoursStart,
        quietHoursEnd: current.quietHoursEnd,
        timezone: current.timezone,
        ...changes,
      })
      if (!merged.success)
        throw new BadRequestException({
          statusCode: 400,
          code: 'invalid_request',
          message: 'Invalid quiet-hours policy.',
        })
      await this.updateOptIn(tx, user, input, current.enabled)
      if (input.enabled === true && !Object.keys(changes).length) {
        await tx.notificationPreference.upsert({
          where: { user_id: user },
          create: { user_id: user, timezone_configured: false },
          update: {},
        })
      }
      if (Object.keys(changes).length) {
        const { quietHoursEnabled, quietHoursStart, quietHoursEnd, timezone } =
          merged.data
        await tx.notificationPreference.upsert({
          where: { user_id: user },
          create: {
            user_id: user,
            quiet_hours_enabled: quietHoursEnabled,
            quiet_hours_start: quietHoursStart,
            quiet_hours_end: quietHoursEnd,
            timezone,
            timezone_configured:
              input.timezone !== undefined || current.timezoneConfigured,
          },
          update: {
            quiet_hours_enabled: quietHoursEnabled,
            quiet_hours_start: quietHoursStart,
            quiet_hours_end: quietHoursEnd,
            timezone,
            ...(input.timezone !== undefined ? { timezone_configured: true } : {}),
          },
        })
      }
      if (input.enabled === false) {
        await tx.communityNotificationIntent.updateMany({
          where: { recipient_id: user, deliverable: true },
          data: { deliverable: false },
        })
        await tx.communityNotificationGroup.updateMany({
          where: { recipient_id: user, status: { in: ['pending', 'deferred'] } },
          data: { status: 'suppressed' },
        })
      }
      return this.snapshot(user, tx)
    })
  }
}
