import { Injectable } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { createBaseLogger } from '../../logger/pino.config'
import { GuardianService } from './guardian.service'

@Injectable()
export class GuardianCron {
  private readonly logger = createBaseLogger().child({ feature: 'guardian-consent' })

  constructor(private readonly guardianService: GuardianService) {}

  private buildLogErrorPayload(error: unknown) {
    if (error instanceof Error) {
      return {
        name: error.name,
        message: error.message,
        stack: error.stack,
      }
    }

    return {
      message: String(error),
    }
  }

  @Cron('5 0 * * *', { timeZone: 'UTC' })
  async emancipateAdults() {
    try {
      const result = await this.guardianService.emancipateEligibleTeens()
      this.logger.info(result, 'guardian_consent_emancipation_completed')
    } catch (error) {
      this.logger.error(
        { err: this.buildLogErrorPayload(error) },
        'guardian_consent_emancipation_failed'
      )
    }
  }
}
