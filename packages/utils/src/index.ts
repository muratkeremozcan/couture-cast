export {
  AGE_GATE_MESSAGES,
  calculateAge,
  evaluateBirthdateInput,
  evaluateAgeGate,
  GUARDIAN_CONSENT_POLICY,
  guardianConsentRequiredFor,
  INVALID_BIRTHDATE_MESSAGE,
  parseBirthdateInput,
} from './age'
export type {
  AgeGateAccountStatus,
  GuardianConsentPolicy,
  AgeGateResult,
  BirthdateAgeGateEvaluation,
} from './age'

export {
  deepLinkSourceSchema,
  deepLinkSlotSchema,
  deepLinkWidgetSizeSchema,
  deepLinkNotificationTypeSchema,
  deepLinkSchema,
  DEEP_LINK_FAILURE_REASONS,
  hasDeepLinkIntent,
  parseDeepLink,
  resolveDeepLinkScenario,
} from './deep-link'
export type {
  DeepLinkSource,
  DeepLinkSlot,
  DeepLinkWidgetSize,
  DeepLinkNotificationType,
  DeepLinkPayload,
  DeepLinkResult,
  DeepLinkScenario,
  DeepLinkScenarioContext,
} from './deep-link'

export {
  formatWeatherAltText,
  formatGarmentAltText,
  formatLocalizedList,
  getAnnouncementUrgency,
} from './accessibility'
export type { WeatherAltTextInput, AccessibilityAnnouncementEvent } from './accessibility'

export {
  contrastRatio,
  linearizeSrgbChannel,
  meetsWcagAA,
  srgbChannels,
  WCAG_AA_LARGE_TEXT_RATIO,
  WCAG_AA_NORMAL_TEXT_RATIO,
} from './contrast'
export type { WcagContrastOptions } from './contrast'

export {
  buildCommunityObjectPath,
  buildGarmentObjectPath,
  buildPaletteSelfieObjectPath,
  buildSilhouetteObjectPath,
  buildWardrobeHeldObjectPath,
  buildWardrobeObjectPath,
  buildWardrobeStagingObjectPath,
  isWardrobePathSegment,
  isWardrobeUuid,
  parseCommunityObjectPath,
  parseWardrobeHeldObjectPath,
  parseWardrobeObjectPath,
  parseWardrobeStagingObjectPath,
  WARDROBE_HELD_FOLDER,
  WARDROBE_STAGING_FOLDER,
} from './wardrobe-object-path'
export type { GarmentObjectExtension, WardrobeObjectKind } from './wardrobe-object-path'

export {
  chroma,
  classifyDepth,
  classifyUndertone,
  COOL_HUE_MAX,
  hueAngleDegrees,
  hueAngleInterquartileSpread,
  individualTypologyAngle,
  ITA_FAIR_MIN,
  ITA_LIGHT_MIN,
  ITA_MEDIUM_MIN,
  ITA_TAN_MIN,
  linearRgbToLab,
  NEUTRAL_CHROMA_MAX,
  OLIVE_HUE_MAX,
  OLIVE_HUE_MIN,
  srgbToLab,
  WARM_HUE_MAX,
} from './skin-tone'
export type { Lab, SkinDepth, SkinUndertone } from './skin-tone'

export { CLIMATE_BANDS, ORDERED_CLIMATE_BANDS, classifyClimateBand } from './climate-band'
export type { ClimateBand, ClimateBandDay } from './climate-band'
export { communityFeedClimate, mergeCommunityLooks } from './community-feed'

export {
  canonicalCountryCode,
  canonicalSpotlightArea,
  foldAreaComponent,
  SPOTLIGHT_COUNTRY_LOCALES,
  spotlightCountryCodes,
} from './spotlight-area'
export type { CanonicalSpotlightArea, SpotlightAreaSource } from './spotlight-area'

export {
  adjustFeelsLike,
  CLOSE_COMFORT_MATCHES,
  COMFORT_RANGES,
  COMFORT_RUN_OFFSET_CELSIUS,
  getRainAmountThreshold,
  getRainProbThreshold,
  getWindThreshold,
  needsOuterwear,
  OUTERWEAR_THRESHOLD_CELSIUS,
  rainAmountExceeds,
  rainProbabilityExceeds,
  resolveComfortRangeFromTemperature,
  windExceeds,
} from './comfort-rules'
export type { ComfortRange, ComfortRun, ComfortTolerance } from './comfort-rules'

export {
  classifyRgbColorFamily,
  colorFamilyFromHex,
  GARMENT_COLOR_FAMILIES,
} from './garment-color'
export type { GarmentColorFamily } from './garment-color'
export { findFlatLayComponents, maskGarmentBackground } from './garment-background'

export * from './sample-wardrobe'
export * from './federated-signin'
export * from './save-feedback'
export * from './looks-feed'
export * from './wardrobe/deferred-garment-deletion'
export * from './wardrobe/garment-photo-batch'
export { garmentPhotoBatchStrings } from './wardrobe/garment-photo-batch-strings'
export { flatLayStrings } from './wardrobe/flat-lay-strings'

export {
  boxShadowFor,
  buildDesignTokenCssRules,
  COLOR_ROLE_NAMES,
  colorRoles,
  elevation,
  FILL_TEXT_PAIRS,
  fontWeight,
  GOLD_COLOR_ROLES,
  hexToChannels,
  kebabTokenName,
  MEANING_LINE_COLOR_ROLES,
  PREMIUM_PALETTE_FIELDS,
  PREMIUM_PALETTE_KEYS,
  premiumPalettes,
  radius,
  SCRIM_OPACITY,
  SHADOW_COLOR,
  shell,
  space,
  SPACE_SCALE_PX,
  TEXT_COLOR_ROLES,
  typeScale,
  withAlpha,
} from './design-tokens'
export type {
  ColorRole,
  ColorRoles,
  ColorScheme,
  DesignTokenCssRules,
  ElevationKey,
  ElevationLevel,
  PremiumPaletteColors,
  PremiumPaletteKey,
  RadiusKey,
  SpaceKey,
  TypeScaleKey,
} from './design-tokens'

export { measureScreenBudget } from './screen-budget-measure'
export type {
  ScreenBudgetElement,
  ScreenBudgetMeasureConfig,
  ScreenBudgetMeasurement,
  ScreenBudgetParagraph,
} from './screen-budget-measure'

export {
  evaluateScreenBudget,
  formatScreenBudgetFailures,
  isAnalyticsRequest,
  SCREEN_BUDGET_OWNING_STORIES,
  SCREEN_BUDGET_PER_ELEMENT_RULES,
  SCREEN_BUDGET_RULES,
  screenBudget,
  screenBudgetKnownKeys,
  screenBudgetMeasureConfig,
} from './screen-budget'
export type {
  ScreenBudgetAnalyticsRequest,
  ScreenBudgetAudit,
  ScreenBudgetAuditMeasurement,
  ScreenBudgetEvaluation,
  ScreenBudgetFailure,
  ScreenBudgetFailureKind,
  ScreenBudgetFile,
  ScreenBudgetFixture,
  ScreenBudgetKnownParagraph,
  ScreenBudgetKnownViolation,
  ScreenBudgetLimitDecision,
  ScreenBudgetLimits,
  ScreenBudgetMeasure,
  ScreenBudgetPlatform,
  ScreenBudgetPlatformSelectors,
  ScreenBudgetRule,
  ScreenBudgetScreen,
} from './screen-budget'

export { APP_TABS, appTab } from './app-tabs'
export type { AppTab, AppTabId, AppTabLabelKey } from './app-tabs'

export {
  TAB_ICON_PATHS,
  TAB_ICON_SIZE,
  TAB_ICON_STROKE_WIDTH,
  TAB_ICON_VIEWBOX,
} from './tab-icons'
