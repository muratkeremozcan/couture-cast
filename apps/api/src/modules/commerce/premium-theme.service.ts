import {
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common'
import { Prisma, PrismaClient } from '@prisma/client'
import {
  PREMIUM_THEME_OWNER_NOT_FOUND_MESSAGE,
  PREMIUM_THEMES_DISABLED_MESSAGE,
  premiumThemeKeySchema,
  type PremiumTheme,
  type PremiumThemeKey,
} from '../../contracts/http.js'
import { createBaseLogger } from '../../logger/pino.config.js'
import { FeatureFlagsService } from '../feature-flags/feature-flags.service.js'
import { TelemetryService } from '../telemetry/telemetry.service.js'
import { PremiumEntitlementService } from './premium-entitlement.service.js'

/**
 * `P2023` is Prisma's "inconsistent column data", which is what a Postgres enum
 * member missing from the generated client surfaces as. It is deliberately the
 * only code treated as a stale palette: every other Prisma failure is an
 * infrastructure fault and has to keep propagating.
 */
function isEnumConversionError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2023'
}

/**
 * `P2003` is Prisma's foreign-key constraint violation. On this table it has
 * exactly one cause: the `User` row the preference points at was deleted while
 * the write was in flight. Narrow on the code for the same reason
 * {@link isEnumConversionError} is narrow — every other Prisma failure is an
 * infrastructure fault and has to keep propagating as one.
 */
function isForeignKeyViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003'
}

/**
 * Story 5.3: the single owner of PremiumThemePreference reads and writes.
 *
 * THE EFFECTIVE THEME IS RESOLVED HERE, NOT BY CLIENTS (Decision 7). A user can
 * select a palette and then let Premium lapse, so "what is stored" and "what
 * should render" are two different questions. Every client would otherwise have
 * to join this response with `/api/v1/commerce/subscription` and pick a winner,
 * which is three copies of one rule plus two moments in time that can disagree.
 * `hasPremiumAccess` is asked here, inline, and the answer rides back on the
 * same response as `isEntitled`.
 *
 * THE ROW IS NEVER DELETED (Decision 8). Reset is `upsert(theme: null)`. An
 * absent row and a stored NULL both mean Default and nothing below branches on
 * which of the two it is, but they are not interchangeable to write: deleting on
 * reset passes a single-user unit test and then diverges the moment `updated_at`
 * or a selection count matters. Entitlement loss changes nothing about the row
 * either — it is resolved away at read time instead.
 *
 * AN UNRECOGNISED STORED KEY RESOLVES TO DEFAULT, NEVER THROWS (AC 6). A palette
 * retired by a later story leaves rows behind, and a settings page that 500s
 * because of a stale enum value is exactly the blank screen AC 6 forbids.
 * {@link normalizeStoredTheme} is the one place that decides this — but it only
 * sees a value the Prisma client managed to hand back, and there is a real
 * failure mode where it never does. `theme` is a Postgres enum, so a database
 * holding a member the running build's generated client does not know (migration
 * deployed ahead of the app, an app rollback, a palette dropped from
 * `schema.prisma` while rows keep the old value) makes the query engine reject
 * the row during conversion rather than return a string. {@link readStoredTheme}
 * therefore catches that one Prisma code and funnels it into the same Default,
 * which is what makes the paragraph above true against a real database instead of
 * only against the in-memory doubles the unit tier uses.
 *
 * FLAG VS. ENTITLEMENT PRECEDENCE (Decision 9). `PremiumEntitlementGuard` is a
 * Nest guard and runs pre-handler; the `premium_themes_enabled` check lives in
 * this service body. So a non-entitled caller always gets 403 and can never
 * observe the 503 kill switch. That ordering is deliberate: a payer is the only
 * one who needs to know the feature is provisionally switched off.
 *
 * No `AuditLog` row is written for a theme change. 5.2's audit convention covers
 * entitlement and billing facts, which are privilege-bearing; a cosmetic
 * preference is not.
 */
@Injectable()
export class PremiumThemeService {
  private readonly logger = createBaseLogger().child({ feature: 'premium-theme' })

  constructor(
    @Inject(PrismaClient) private readonly prisma: PrismaClient,
    @Inject(PremiumEntitlementService)
    private readonly entitlements: PremiumEntitlementService,
    @Inject(FeatureFlagsService)
    private readonly featureFlags: FeatureFlagsService,
    @Inject(TelemetryService)
    private readonly telemetry: TelemetryService
  ) {}

  /**
   * Deliberately NOT entitlement-gated and NOT flag-gated. Every signed-in
   * caller needs an answer: a non-entitled one reads `theme: null` plus the
   * `isEntitled: false` that tells its UI to render the locked upsell, and a
   * caller whose flag is off still needs to know that rather than be refused.
   */
  async getTheme(userId: string): Promise<PremiumTheme> {
    const [stored, isEntitled, themesEnabled] = await Promise.all([
      this.readStoredTheme(userId),
      this.entitlements.hasPremiumAccess(userId),
      this.resolveThemesEnabled(userId),
    ])

    // Entitlement wins over the stored row, always. A lapsed subscriber keeps
    // their preference in the database and renders Default until they return.
    return { theme: isEntitled ? stored : null, isEntitled, themesEnabled }
  }

  /**
   * The kill switch, exposed so the controller can assert it BEFORE parsing the
   * body — a disabled feature answers 503 to every write attempt, well-formed
   * or not, the same ordering `SubscriptionController.parseCheckoutRequest`
   * uses for the purchasing switch.
   */
  async assertThemesEnabled(userId: string): Promise<void> {
    if (!(await this.resolveThemesEnabled(userId))) {
      throw new ServiceUnavailableException(PREMIUM_THEMES_DISABLED_MESSAGE)
    }
  }

  /**
   * Stores the choice and returns the freshly resolved state, the same shape
   * {@link getTheme} returns.
   *
   * `isEntitled` is true by construction rather than by a second query: this
   * method is only reachable through a route carrying `PremiumEntitlementGuard`,
   * which resolved that exact question against `hasPremiumAccess` moments
   * earlier. `premium-theme.controller.spec.ts` pins the guard to the PUT route
   * so removing it turns that claim red instead of silent.
   */
  async setTheme(userId: string, theme: PremiumThemeKey | null): Promise<PremiumTheme> {
    // Re-asserted here (the controller already did) so the service is safe on
    // its own: no future caller can write a theme with the kill switch off.
    await this.assertThemesEnabled(userId)

    const row = await this.writePreference(userId, theme)

    await this.emitSelection(userId, theme)

    // Resolved from the persisted row rather than the request body: the stored
    // value is the only thing a subsequent GET can see.
    return {
      theme: this.normalizeStoredTheme(row?.theme),
      isEntitled: true,
      themesEnabled: true,
    }
  }

  /**
   * The upsert plus the one failure that is a client fact rather than a server
   * fault. An account erased mid-request leaves the write with no `User` row to
   * reference, and 500 is the wrong answer to "this account is gone".
   */
  private async writePreference(
    userId: string,
    theme: PremiumThemeKey | null
  ): Promise<{ theme: unknown } | null> {
    try {
      return await this.prisma.premiumThemePreference.upsert({
        where: { user_id: userId },
        // NEVER a delete on reset, not even for `theme: null` (Decision 8).
        create: { user_id: userId, theme },
        update: { theme },
        select: { theme: true },
      })
    } catch (error) {
      if (!isForeignKeyViolation(error)) {
        throw error
      }

      this.logger.warn(
        { error, userId },
        'Premium theme write raced account erasure; the owning user no longer exists'
      )
      throw new NotFoundException(PREMIUM_THEME_OWNER_NOT_FOUND_MESSAGE)
    }
  }

  private async readStoredTheme(userId: string): Promise<PremiumThemeKey | null> {
    try {
      const row = await this.prisma.premiumThemePreference.findUnique({
        where: { user_id: userId },
        select: { theme: true },
      })
      return this.normalizeStoredTheme(row?.theme)
    } catch (error) {
      if (!isEnumConversionError(error)) {
        // A connection failure, a timeout, a missing table: real infrastructure
        // faults that must stay loud. Swallowing them here would render Default
        // and report success while the database is down.
        throw error
      }

      this.logger.warn(
        { error, userId },
        'Stored premium theme could not be decoded by this build; resolving to Default'
      )
      return null
    }
  }

  /**
   * The AC 6 fallback in one place. An absent row, a stored NULL, and a key no
   * longer in the shipped palette set all resolve to Default. Parsing through
   * the published contract enum rather than trusting Prisma's generated type is
   * the point: the database can hold a value the current build no longer knows.
   */
  private normalizeStoredTheme(stored: unknown): PremiumThemeKey | null {
    if (stored === null || stored === undefined) {
      return null
    }

    const parsed = premiumThemeKeySchema.safeParse(stored)
    if (parsed.success) {
      return parsed.data
    }

    this.logger.warn(
      { stored },
      'Stored premium theme is not a shipped palette; resolving to Default'
    )
    return null
  }

  private async resolveThemesEnabled(userId: string): Promise<boolean> {
    const flagEnabled = await this.featureFlags.getFeatureFlag(
      'premium_themes_enabled',
      userId
    )
    // Truthiness rather than `!== true`: `FeatureFlagValue` narrows this key to
    // its literal default `false`, so an equality comparison has no overlap.
    return Boolean(flagEnabled)
  }

  /**
   * Telemetry AFTER the write, fail-open (5.1 Decision 12 verbatim): a degraded
   * PostHog must never fail a settings write the user already sees applied. The
   * pseudonymous HMAC subject and the `{ theme }`-only property allowlist are
   * enforced by `TelemetryService`, not restated here.
   */
  private async emitSelection(
    userId: string,
    theme: PremiumThemeKey | null
  ): Promise<void> {
    try {
      await this.telemetry.captureEvent(userId, 'premium_theme_selected', { theme })
    } catch (error) {
      this.logger.warn(
        { error, userId },
        'Premium theme telemetry emission failed (fail-open)'
      )
    }
  }
}
