import { Inject, Injectable } from '@nestjs/common'
import type { CommercePreference } from '../../contracts/http.js'
import { CommerceRepository } from './commerce.repository.js'

/**
 * Story 5.1: the user-level affiliate opt-out.
 *
 * NOT GATED BY `commerce_affiliate_enabled`. A user must always be able to read
 * and set their own preference, including while affiliate commerce is switched
 * off entirely, so the settings section renders and works unconditionally. The
 * flag gates the CTA and the click endpoint, nothing here.
 */
@Injectable()
export class CommercePreferencesService {
  constructor(
    @Inject(CommerceRepository)
    private readonly repository: CommerceRepository
  ) {}

  /**
   * A user with no stored row reads as enabled. That is the column default, and
   * treating "no row" as anything else would opt every existing account out of a
   * feature they never touched.
   */
  async getPreference(userId: string): Promise<CommercePreference> {
    const stored = await this.repository.findAffiliateCtasEnabled(userId)
    return { affiliateCtasEnabled: stored ?? true }
  }

  /**
   * Returns the resulting state, which for an unchanged value is the current
   * one. The response is uniform either way so a client never has to branch on
   * whether its write actually moved anything.
   */
  async setPreference(
    userId: string,
    affiliateCtasEnabled: boolean,
    ipAddress: string | undefined
  ): Promise<CommercePreference> {
    const result = await this.repository.setAffiliateCtasEnabled(
      userId,
      affiliateCtasEnabled,
      ipAddress
    )
    return { affiliateCtasEnabled: result.affiliateCtasEnabled }
  }
}
