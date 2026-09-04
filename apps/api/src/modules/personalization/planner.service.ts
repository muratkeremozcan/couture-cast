// Story 5.5: premium 7-day outfit planner. See Decisions 2, 3, 4, 6, 8, 9 in
// _bmad-output/implementation-artifacts/5-5-premium-7-day-outfit-planner.md.
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common'
import { createHash } from 'node:crypto'
import {
  PrismaClient,
  Prisma,
  type GarmentItem,
  type PlannerDayPlan,
} from '@prisma/client'
import { WeatherQueryService } from '../weather/weather-query.service.js'
import { parseDailySummaries } from '../weather/weather.repository.js'
import { formatLocalDateInTimezone } from '../weather/providers/weather-date.util.js'
import { LocationPreferencesService } from '../location-preferences/location-preferences.service.js'
import { FeatureFlagsService } from '../feature-flags/feature-flags.service.js'
import { TelemetryService } from '../telemetry/telemetry.service.js'
import { SupabaseWardrobeStorageAdapter } from '../wardrobe/wardrobe-storage.adapter.js'
import type { CapsuleWithJoins } from './capsule-recommendation.engine.js'
import {
  dailyProjectionToScenarioInputs,
  generateRitualScenarios,
  getHourInTimezone,
  hourlySegmentToScenarioInput,
  mapRawBadgeToCanonical,
  resolvePlannerDateWindow,
  resolveRitualAnchorDate,
  toDatabaseDate,
  type EngineWeatherInput,
  type HourlySegmentLike,
  type RitualGenerationScenarioResult,
  type ScenarioWeatherInput,
} from './ritual-generation.engine.js'
import {
  plannerPersistedPayloadSchema,
  type PlannerPersistedOutfit,
  type PlannerPersistedPayload,
} from './planner-payload.schema.js'
import {
  defaultSupportedLocale,
  resolveAcceptLanguage,
  resolveSupportedLocale,
  plannerResponseSchema,
  plannerReshuffleResponseSchema,
  plannerLocalDateSchema,
  PREMIUM_PLANNER_DISABLED_MESSAGE,
  PLANNER_DAY_CHANGED_MESSAGE,
  type PlannerPlatform,
  type PlannerResponse,
  type PlannerReshuffleResponse,
  type PlannerDayResult,
  type PlannerScenarioOutfit,
  type PlannerWeatherSummary,
  type SupportedLocale,
  type WeatherCondition,
} from '../../contracts/http.js'

const PLANNER_GARMENT_CANDIDATE_LIMIT = 1_000
const PLANNER_CAPSULE_CANDIDATE_LIMIT = 1_000
const READ_URL_EXPIRY_SECONDS = 900

/** `resolveRitualAnchorDate` returns ritual's own `MM/DD/YYYY` cache-key
 * format (Task 2 preserves that byte-for-byte for RitualService). Planner's
 * date-window arithmetic needs `YYYY-MM-DD`, so this converts once at the
 * call site rather than changing the shared helper's output and breaking
 * ritual.service.spec.ts's exact cache-key assertions. */
function toIsoDate(mmddyyyy: string): string {
  const [month, day, year] = mmddyyyy.split('/')
  return `${year}-${month}-${day}`
}

function findExactHourlySegments(
  segments: readonly HourlySegmentLike[],
  timezone: string,
  targetIsoDate: string
): {
  morning: HourlySegmentLike
  midday: HourlySegmentLike
  evening: HourlySegmentLike
} | null {
  const forDate = (hour: number) =>
    segments.find(
      (s) =>
        formatLocalDateInTimezone(s.forecast_at, timezone) === targetIsoDate &&
        getHourInTimezone(s.forecast_at, timezone) === hour
    )
  const morning = forDate(8)
  const midday = forDate(13)
  const evening = forDate(19)
  if (morning && midday && evening) {
    return { morning, midday, evening }
  }
  return null
}

interface ResolvedWeatherForDate {
  input: EngineWeatherInput
  summary: PlannerWeatherSummary
}

function summarizeHourly(
  scenarios: readonly [ScenarioWeatherInput, ScenarioWeatherInput, ScenarioWeatherInput],
  freshness: 'fresh' | 'cached' | 'stale',
  condition: WeatherCondition
): PlannerWeatherSummary {
  const temps = scenarios.map((s) => s.feelsLike)
  return {
    confidence: 'hourly',
    freshness,
    condition,
    temperatureLow: Math.min(...temps),
    temperatureHigh: Math.max(...temps),
  }
}

interface EligibleWardrobe {
  garments: GarmentItem[]
  capsules: CapsuleWithJoins[]
  capsuleRevision: number
}

@Injectable()
export class PlannerService {
  private readonly logger = new Logger(PlannerService.name)

  constructor(
    @Inject(PrismaClient) private readonly prisma: PrismaClient,
    @Inject(WeatherQueryService)
    private readonly weatherQueryService: WeatherQueryService,
    @Inject(LocationPreferencesService)
    private readonly locationPreferencesService: LocationPreferencesService,
    @Inject(FeatureFlagsService) private readonly featureFlags: FeatureFlagsService,
    @Inject(TelemetryService) private readonly telemetry: TelemetryService,
    @Inject(SupabaseWardrobeStorageAdapter)
    private readonly storage: SupabaseWardrobeStorageAdapter
  ) {}

  private async assertPlannerEnabled(userId: string): Promise<void> {
    const enabled = await this.featureFlags.getFeatureFlag(
      'premium_planner_enabled',
      userId
    )
    if (!enabled) {
      throw new ServiceUnavailableException(PREMIUM_PLANNER_DISABLED_MESSAGE)
    }
  }

  private async resolveLocation(userId: string, locationId?: string) {
    const locations = await this.locationPreferencesService.listLocations(userId)
    let selected = locations.find((l) => l.id === locationId)

    if (locationId && !selected) {
      throw new ForbiddenException('Location not found or not owned by user')
    }
    if (!selected) {
      selected = locations.find((l) => l.isPrimary) ?? locations[0]
    }
    if (!selected) {
      throw new BadRequestException('No location preferences found for user')
    }
    return selected
  }

  private async resolveLocale(
    userId: string,
    acceptLanguage: string | undefined,
    localeOverride: SupportedLocale | undefined
  ): Promise<SupportedLocale> {
    const userProfile = await this.prisma.userProfile.findUnique({
      where: { user_id: userId },
    })
    const savedLocaleCandidate =
      userProfile?.preferences &&
      typeof userProfile.preferences === 'object' &&
      !Array.isArray(userProfile.preferences) &&
      'locale' in userProfile.preferences &&
      typeof userProfile.preferences.locale === 'string'
        ? userProfile.preferences.locale
        : undefined
    const savedLocale = resolveSupportedLocale(savedLocaleCandidate)
    return (
      localeOverride ??
      savedLocale ??
      resolveAcceptLanguage(acceptLanguage) ??
      defaultSupportedLocale
    )
  }

  private async loadEligibleWardrobe(userId: string): Promise<EligibleWardrobe> {
    const [garments, capsules, userProfile] = await Promise.all([
      this.prisma.garmentItem.findMany({
        where: {
          user_id: userId,
          retention_status: 'active',
          upload_status: 'ready',
          category: { not: null },
          comfort_range: { not: null },
        },
        orderBy: [{ updated_at: 'desc' }, { id: 'asc' }],
        take: PLANNER_GARMENT_CANDIDATE_LIMIT,
      }),
      this.prisma.outfitCapsule?.findMany
        ? this.prisma.outfitCapsule.findMany({
            where: { user_id: userId },
            include: { garment_joins: { include: { garment: true } } },
            orderBy: [{ is_favorite: 'desc' }, { updated_at: 'desc' }, { id: 'asc' }],
            take: PLANNER_CAPSULE_CANDIDATE_LIMIT,
          })
        : Promise.resolve([]),
      this.prisma.userProfile.findUnique({ where: { user_id: userId } }),
    ])
    return {
      garments,
      capsules: capsules as unknown as CapsuleWithJoins[],
      capsuleRevision: userProfile?.capsule_revision ?? 0,
    }
  }

  /**
   * Story 5.5 Decision 2/9: one SHA-256 hash over canonical, sorted inputs.
   * Shared by every date in a single request -- location, weather snapshot
   * revision, comfort preferences, locale, wardrobe, and capsule revision are
   * all request-scoped, not per-date -- so identical fingerprints across a
   * user's seven rows is expected, not a bug.
   */
  private computeDependencyFingerprint(input: {
    locationId: string
    weatherRevision: string
    comfortPreferences: {
      runsColdWarm: string
      windTolerance: string
      precipPreparedness: string
    }
    locale: string
    garments: readonly GarmentItem[]
    capsules: readonly CapsuleWithJoins[]
    capsuleRevision: number
  }): string {
    const canonical = JSON.stringify({
      locationId: input.locationId,
      weatherRevision: input.weatherRevision,
      comfortPreferences: input.comfortPreferences,
      locale: input.locale,
      garments: [...input.garments]
        .map((g) => `${g.id}:${g.updated_at.toISOString()}`)
        .sort(),
      capsules: [...input.capsules]
        .map((c) => `${c.id}:${c.updated_at.toISOString()}`)
        .sort(),
      capsuleRevision: input.capsuleRevision,
    })
    return createHash('sha256').update(canonical).digest('hex')
  }

  /** Story 5.5 Decision 3: hourly-exact, then daily-projected, then unavailable. */
  private resolveWeatherForDate(
    isoDate: string,
    timezone: string,
    snapshotStatus: 'fresh' | 'cached' | 'stale' | 'unavailable',
    segments: readonly HourlySegmentLike[],
    dailySummariesRaw: Prisma.JsonValue | null | undefined
  ): ResolvedWeatherForDate {
    if (snapshotStatus === 'unavailable') {
      return { input: { status: 'unavailable' }, summary: unavailableSummary() }
    }

    const exact = findExactHourlySegments(segments, timezone, isoDate)
    if (exact) {
      const scenarios = [
        hourlySegmentToScenarioInput('morning', exact.morning),
        hourlySegmentToScenarioInput('midday', exact.midday),
        hourlySegmentToScenarioInput('evening', exact.evening),
      ] as const
      return {
        input: { status: 'available', scenarios },
        summary: summarizeHourly(
          scenarios,
          snapshotStatus,
          exact.midday.condition as WeatherCondition
        ),
      }
    }

    const daily = parseDailySummaries(dailySummariesRaw, this.logger).find(
      (entry) => entry.localDate === isoDate
    )
    if (daily) {
      const scenarios = dailyProjectionToScenarioInputs(daily)
      return {
        input: { status: 'available', scenarios },
        summary: {
          confidence: 'daily',
          freshness: snapshotStatus,
          condition: daily.condition,
          temperatureLow: daily.temperatureMin,
          temperatureHigh: daily.temperatureMax,
        },
      }
    }

    return { input: { status: 'unavailable' }, summary: unavailableSummary() }
  }

  private toPersistedPayload(
    generated: readonly [
      RitualGenerationScenarioResult,
      RitualGenerationScenarioResult,
      RitualGenerationScenarioResult,
    ],
    weather: PlannerWeatherSummary,
    locale: SupportedLocale
  ): PlannerPersistedPayload {
    return {
      outfits: generated.map(
        (scenario): PlannerPersistedOutfit => ({
          scenario: scenario.scenario,
          garmentIds: scenario.garmentIds,
          capsuleId: scenario.capsuleId,
          capsuleName: scenario.capsuleName,
          autoFilledGarmentIds: scenario.autoFilledGarmentIds,
          reasoningBadges: scenario.reasoningBadges.map((badge) =>
            mapRawBadgeToCanonical(badge, locale)
          ),
          comfortNotes: scenario.comfortNotes,
        })
      ),
      isStarterWardrobe: generated.some((scenario) => scenario.isStarterWardrobe),
      weather,
    }
  }

  /** Every real (non-placeholder) garment/capsule id referenced by a stored payload
   * must still be eligible, independent of the fingerprint comparison
   * (Decision 4/9's explicit ownership re-check). */
  private payloadReferencesOnlyEligibleIds(
    payload: PlannerPersistedPayload,
    eligibleGarmentIds: ReadonlySet<string>,
    eligibleCapsuleIds: ReadonlySet<string>
  ): boolean {
    for (const outfit of payload.outfits) {
      for (const garmentId of outfit.garmentIds) {
        if (garmentId.startsWith('default-')) continue
        if (!eligibleGarmentIds.has(garmentId)) return false
      }
      if (outfit.capsuleId && !eligibleCapsuleIds.has(outfit.capsuleId)) return false
    }
    return true
  }

  private async persistGeneratedDay(
    userId: string,
    locationId: string,
    planDateIso: string,
    locale: string,
    fingerprint: string,
    payload: PlannerPersistedPayload,
    existingId?: string
  ): Promise<PlannerDayPlan> {
    const data = {
      plan_payload: payload as unknown as Prisma.InputJsonValue,
      dependency_fingerprint: fingerprint,
      locale,
      source: 'generated' as const,
      version: 1,
      reshuffle_count: 0,
      generated_at: new Date(),
    }

    if (existingId) {
      return this.prisma.plannerDayPlan.update({ where: { id: existingId }, data })
    }

    try {
      return await this.prisma.plannerDayPlan.create({
        data: {
          user_id: userId,
          location_id: locationId,
          plan_date: toDatabaseDate(planDateIso),
          ...data,
        },
      })
    } catch (error) {
      // Story 5.5 Decision 9: concurrent cold reads may compute twice; the
      // unique key permits one persisted winner and every caller returns it.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const winner = await this.prisma.plannerDayPlan.findUnique({
          where: {
            user_id_location_id_plan_date: {
              user_id: userId,
              location_id: locationId,
              plan_date: toDatabaseDate(planDateIso),
            },
          },
        })
        if (winner) return winner
      }
      throw error
    }
  }

  private buildErrorDay(planDate: string): PlannerDayResult {
    return { status: 'error', planDate, errorCode: 'generation_failed', retryable: true }
  }

  private async resolveOneDay(params: {
    userId: string
    locationId: string
    isoDate: string
    timezone: string
    locale: SupportedLocale
    comfortPreferences: {
      runsColdWarm: 'cold' | 'warm' | 'neutral'
      windTolerance: 'low' | 'medium' | 'high'
      precipPreparedness: 'low' | 'medium' | 'high'
    }
    wardrobe: EligibleWardrobe
    snapshotStatus: 'fresh' | 'cached' | 'stale' | 'unavailable'
    segments: readonly HourlySegmentLike[]
    dailySummariesRaw: Prisma.JsonValue | null | undefined
    weatherRevision: string
    existingRow: PlannerDayPlan | undefined
    eligibleGarmentIds: ReadonlySet<string>
    eligibleCapsuleIds: ReadonlySet<string>
  }): Promise<{ result: PlannerDayResult; garmentIds: string[] }> {
    const {
      userId,
      locationId,
      isoDate,
      timezone,
      locale,
      comfortPreferences,
      wardrobe,
      snapshotStatus,
      segments,
      dailySummariesRaw,
      weatherRevision,
      existingRow,
      eligibleGarmentIds,
      eligibleCapsuleIds,
    } = params

    // Story 5.5 AC 3: the whole per-date pipeline -- fingerprinting, the
    // stored-row validity check, and generation -- is wrapped so any failure
    // for one date degrades to that date's own 'error' result rather than
    // failing the entire seven-day request.
    try {
      const fingerprint = this.computeDependencyFingerprint({
        locationId,
        weatherRevision,
        comfortPreferences,
        locale,
        garments: wardrobe.garments,
        capsules: wardrobe.capsules,
        capsuleRevision: wardrobe.capsuleRevision,
      })

      if (existingRow && existingRow.dependency_fingerprint === fingerprint) {
        const parsed = plannerPersistedPayloadSchema.safeParse(existingRow.plan_payload)
        if (
          parsed.success &&
          this.payloadReferencesOnlyEligibleIds(
            parsed.data,
            eligibleGarmentIds,
            eligibleCapsuleIds
          )
        ) {
          return {
            result: this.toReadyDay(isoDate, existingRow.version, parsed.data),
            garmentIds: this.collectRealGarmentIds(parsed.data),
          }
        }
      }

      // Invalid, stale, or missing: regenerate. An existing row is updated in
      // place (a plain update-by-id, no unique-constraint race possible);
      // only a genuinely missing row goes through create-with-P2002-recovery.
      const { input: weatherInput, summary } = this.resolveWeatherForDate(
        isoDate,
        timezone,
        snapshotStatus,
        segments,
        dailySummariesRaw
      )
      const generated = generateRitualScenarios({
        userId,
        targetLocalDate: isoDate,
        locale,
        comfortPreferences,
        eligibleGarments: wardrobe.garments,
        eligibleCapsules: wardrobe.capsules,
        weather: weatherInput,
      })
      const payload = this.toPersistedPayload(generated.scenarios, summary, locale)
      const row = await this.persistGeneratedDay(
        userId,
        locationId,
        isoDate,
        locale,
        fingerprint,
        payload,
        existingRow?.id
      )
      const persistedPayload = plannerPersistedPayloadSchema.parse(row.plan_payload)
      return {
        result: this.toReadyDay(isoDate, row.version, persistedPayload),
        garmentIds: this.collectRealGarmentIds(persistedPayload),
      }
    } catch (error) {
      this.logger.warn(
        `Planner day generation failed for ${isoDate}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`
      )
      return { result: this.buildErrorDay(isoDate), garmentIds: [] }
    }
  }

  private collectRealGarmentIds(payload: PlannerPersistedPayload): string[] {
    const ids = new Set<string>()
    for (const outfit of payload.outfits) {
      for (const id of outfit.garmentIds) {
        if (!id.startsWith('default-')) ids.add(id)
      }
    }
    return [...ids]
  }

  private toReadyDay(
    planDate: string,
    version: number,
    payload: PlannerPersistedPayload
  ): PlannerDayResult {
    return {
      status: 'ready',
      planDate,
      version,
      weather: payload.weather,
      isStarterWardrobe: payload.isStarterWardrobe,
      outfits: payload.outfits.map(
        (outfit): PlannerScenarioOutfit => ({
          id: `${planDate}-${outfit.scenario}`,
          scenario: outfit.scenario,
          garmentIds: outfit.garmentIds,
          reasoningBadges: outfit.reasoningBadges,
          comfortNotes: outfit.comfortNotes,
          capsuleId: outfit.capsuleId,
          capsuleName: outfit.capsuleName,
          autoFilledGarmentIds: outfit.autoFilledGarmentIds,
          displayGarments: [],
          shopThisLook: null,
        })
      ),
    }
  }

  /** Story 5.5 Decision 4: one batched lookup for every real garment id
   * referenced across the response, adding category and a fresh signed image
   * access URL to each. Signing failures degrade to `imageAccess: null`
   * per garment rather than failing the whole response. */
  private async enrichDisplayGarments(
    userId: string,
    days: PlannerDayResult[]
  ): Promise<void> {
    const ids = new Set<string>()
    for (const day of days) {
      if (day.status !== 'ready') continue
      for (const outfit of day.outfits) {
        for (const id of outfit.garmentIds) {
          if (!id.startsWith('default-')) ids.add(id)
        }
      }
    }
    if (ids.size === 0) return

    const garments = await this.prisma.garmentItem.findMany({
      where: { id: { in: [...ids] }, user_id: userId },
    })
    const byId = new Map(garments.map((g) => [g.id, g]))

    const signed = new Map<string, { url: string; expiresAt: string } | null>()
    await Promise.all(
      garments.map(async (garment) => {
        if (!garment.object_path) {
          signed.set(garment.id, null)
          return
        }
        try {
          const url = await this.storage.signReadUrl(
            garment.object_path,
            READ_URL_EXPIRY_SECONDS
          )
          signed.set(garment.id, {
            url,
            expiresAt: new Date(
              Date.now() + READ_URL_EXPIRY_SECONDS * 1000
            ).toISOString(),
          })
        } catch (error) {
          this.logger.warn(
            `Planner garment image signing failed for ${garment.id}: ${
              error instanceof Error ? error.message : 'unknown error'
            }`
          )
          signed.set(garment.id, null)
        }
      })
    )

    for (const day of days) {
      if (day.status !== 'ready') continue
      for (const outfit of day.outfits) {
        outfit.displayGarments = outfit.garmentIds
          .filter((id) => !id.startsWith('default-'))
          .map((id) => {
            const garment = byId.get(id)
            return {
              id,
              category:
                (garment?.category as PlannerScenarioOutfit['displayGarments'][number]['category']) ??
                null,
              imageAccess: signed.get(id) ?? null,
            }
          })
      }
    }
  }

  async getPlannerWindow(
    userId: string,
    locationId: string | undefined,
    acceptLanguage: string | undefined,
    localeOverride: SupportedLocale | undefined,
    platform: PlannerPlatform
  ): Promise<PlannerResponse> {
    await this.assertPlannerEnabled(userId)

    const location = await this.resolveLocation(userId, locationId)
    const locale = await this.resolveLocale(userId, acceptLanguage, localeOverride)
    const [comfortPrefs, weatherResult, wardrobe] = await Promise.all([
      this.prisma.comfortPreferences.findUnique({ where: { user_id: userId } }),
      this.weatherQueryService.getLatestWeather(location.locationKey),
      this.loadEligibleWardrobe(userId),
    ])
    const comfortPreferences = {
      runsColdWarm: comfortPrefs?.runs_cold_warm ?? 'neutral',
      windTolerance: comfortPrefs?.wind_tolerance ?? 'medium',
      precipPreparedness: comfortPrefs?.precip_preparedness ?? 'medium',
    }

    const anchorDate = toIsoDate(resolveRitualAnchorDate(new Date(), location.timezone))
    const window = resolvePlannerDateWindow(anchorDate)

    // Story 5.5 Decision 8: prune the acting user's rows before the anchor date.
    await this.prisma.plannerDayPlan
      .deleteMany({
        where: { user_id: userId, plan_date: { lt: toDatabaseDate(anchorDate) } },
      })
      .catch(() => undefined)

    const existingRows = await this.prisma.plannerDayPlan.findMany({
      where: {
        user_id: userId,
        location_id: location.id,
        plan_date: { in: window.map((d) => toDatabaseDate(d)) },
      },
    })
    const existingByDate = new Map(
      existingRows.map((row) => [formatLocalDateInTimezone(row.plan_date, 'UTC'), row])
    )

    const snapshotStatus = weatherResult.status
    const segments = weatherResult.data?.segments ?? []
    const dailySummariesRaw = weatherResult.data?.daily_summaries
    const weatherRevision =
      snapshotStatus === 'unavailable'
        ? 'unavailable'
        : weatherResult.data.fetched_at.toISOString()

    const eligibleGarmentIds = new Set(wardrobe.garments.map((g) => g.id))
    const eligibleCapsuleIds = new Set(wardrobe.capsules.map((c) => c.id))

    const resolved = await Promise.all(
      window.map((isoDate) =>
        this.resolveOneDay({
          userId,
          locationId: location.id,
          isoDate,
          timezone: location.timezone,
          locale,
          comfortPreferences,
          wardrobe,
          snapshotStatus,
          segments,
          dailySummariesRaw,
          weatherRevision,
          existingRow: existingByDate.get(isoDate),
          eligibleGarmentIds,
          eligibleCapsuleIds,
        })
      )
    )

    const days = resolved.map((r) => r.result)
    await this.enrichDisplayGarments(userId, days)

    const daysReady = days.filter((d) => d.status === 'ready').length

    this.telemetry
      .captureEvent(userId, 'premium_planner_viewed', { platform, daysReady })
      .catch((error: unknown) => {
        this.logger.warn(
          `Planner viewed telemetry failed: ${
            error instanceof Error ? error.message : 'unknown error'
          }`
        )
      })

    return plannerResponseSchema.parse({
      data: {
        locationId: location.id,
        timezone: location.timezone,
        anchorDate,
        daysReady,
        days,
      },
    })
  }

  async reshuffleDay(
    userId: string,
    planDate: string,
    locationId: string | undefined,
    acceptLanguage: string | undefined,
    localeOverride: SupportedLocale | undefined,
    expectedVersion: number,
    platform: PlannerPlatform
  ): Promise<PlannerReshuffleResponse> {
    await this.assertPlannerEnabled(userId)

    const parsedDate = plannerLocalDateSchema.safeParse(planDate)
    if (!parsedDate.success) {
      throw new BadRequestException('Invalid planDate')
    }

    const location = await this.resolveLocation(userId, locationId)
    const locale = await this.resolveLocale(userId, acceptLanguage, localeOverride)

    const anchorDate = toIsoDate(resolveRitualAnchorDate(new Date(), location.timezone))
    const window = resolvePlannerDateWindow(anchorDate)
    const dayOffset = window.indexOf(planDate)
    if (dayOffset === -1) {
      throw new BadRequestException('planDate is outside the current planner window')
    }

    const existingRow = await this.prisma.plannerDayPlan.findUnique({
      where: {
        user_id_location_id_plan_date: {
          user_id: userId,
          location_id: location.id,
          plan_date: toDatabaseDate(planDate),
        },
      },
    })
    if (!existingRow) {
      throw new ConflictException(PLANNER_DAY_CHANGED_MESSAGE)
    }
    const currentPayload = plannerPersistedPayloadSchema.safeParse(
      existingRow.plan_payload
    )

    const [comfortPrefs, weatherResult, wardrobe] = await Promise.all([
      this.prisma.comfortPreferences.findUnique({ where: { user_id: userId } }),
      this.weatherQueryService.getLatestWeather(location.locationKey),
      this.loadEligibleWardrobe(userId),
    ])
    const comfortPreferences = {
      runsColdWarm: comfortPrefs?.runs_cold_warm ?? 'neutral',
      windTolerance: comfortPrefs?.wind_tolerance ?? 'medium',
      precipPreparedness: comfortPrefs?.precip_preparedness ?? 'medium',
    }

    const snapshotStatus = weatherResult.status
    const segments = weatherResult.data?.segments ?? []
    const dailySummariesRaw = weatherResult.data?.daily_summaries
    const { input: weatherInput, summary } = this.resolveWeatherForDate(
      planDate,
      location.timezone,
      snapshotStatus,
      segments,
      dailySummariesRaw
    )

    // Story 5.5 AC 4: prefer capsules and garments absent from the current result.
    const excludedGarmentIds = currentPayload.success
      ? this.collectRealGarmentIds(currentPayload.data)
      : []
    const excludedCapsuleIds = currentPayload.success
      ? [
          ...new Set(
            currentPayload.data.outfits
              .map((o) => o.capsuleId)
              .filter((id): id is string => id !== null)
          ),
        ]
      : []

    const generated = generateRitualScenarios({
      userId,
      targetLocalDate: planDate,
      locale,
      comfortPreferences,
      eligibleGarments: wardrobe.garments,
      eligibleCapsules: wardrobe.capsules,
      weather: weatherInput,
      exclusions: { garmentIds: excludedGarmentIds, capsuleIds: excludedCapsuleIds },
    })
    const newPayload = this.toPersistedPayload(generated.scenarios, summary, locale)

    const fingerprint = this.computeDependencyFingerprint({
      locationId: location.id,
      weatherRevision:
        snapshotStatus === 'unavailable'
          ? 'unavailable'
          : weatherResult.data.fetched_at.toISOString(),
      comfortPreferences,
      locale,
      garments: wardrobe.garments,
      capsules: wardrobe.capsules,
      capsuleRevision: wardrobe.capsuleRevision,
    })

    const updateResult = await this.prisma.plannerDayPlan.updateMany({
      where: { id: existingRow.id, version: expectedVersion },
      data: {
        plan_payload: newPayload as unknown as Prisma.InputJsonValue,
        dependency_fingerprint: fingerprint,
        locale,
        source: 'reshuffled',
        version: { increment: 1 },
        reshuffle_count: { increment: 1 },
        generated_at: new Date(),
      },
    })

    if (updateResult.count === 0) {
      throw new ConflictException(PLANNER_DAY_CHANGED_MESSAGE)
    }

    const updatedRow = await this.prisma.plannerDayPlan.findUniqueOrThrow({
      where: { id: existingRow.id },
    })
    const persistedPayload = plannerPersistedPayloadSchema.parse(updatedRow.plan_payload)

    // Story 5.5 AC 4: unchanged only when all three scenario garment sets and
    // capsule choices are identical to the displayed (pre-reshuffle) result.
    const unchanged =
      currentPayload.success && payloadsEquivalent(currentPayload.data, persistedPayload)

    const day = this.toReadyDay(planDate, updatedRow.version, persistedPayload)
    const days = [day]
    await this.enrichDisplayGarments(userId, days)

    this.telemetry
      .captureEvent(userId, 'premium_planner_day_reshuffled', {
        platform,
        dayOffset,
        unchanged,
      })
      .catch((error: unknown) => {
        this.logger.warn(
          `Planner reshuffle telemetry failed: ${
            error instanceof Error ? error.message : 'unknown error'
          }`
        )
      })

    return plannerReshuffleResponseSchema.parse({ data: { day, unchanged } })
  }
}

function unavailableSummary(): PlannerWeatherSummary {
  return {
    confidence: 'unavailable',
    freshness: null,
    condition: null,
    temperatureLow: null,
    temperatureHigh: null,
  }
}

function payloadsEquivalent(
  previous: PlannerPersistedPayload,
  current: PlannerPersistedPayload
): boolean {
  const key = (p: PlannerPersistedPayload) =>
    [...p.outfits]
      .sort((a, b) => a.scenario.localeCompare(b.scenario))
      .map(
        (o) => `${o.scenario}:${[...o.garmentIds].sort().join(',')}:${o.capsuleId ?? ''}`
      )
      .join('|')
  return key(previous) === key(current)
}
