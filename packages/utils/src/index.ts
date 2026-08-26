export {
  AGE_GATE_MESSAGES,
  calculateAge,
  evaluateBirthdateInput,
  evaluateAgeGate,
  INVALID_BIRTHDATE_MESSAGE,
  parseBirthdateInput,
} from './age'
export type {
  AgeGateAccountStatus,
  AgeGateResult,
  BirthdateAgeGateEvaluation,
} from './age'

export {
  deepLinkSourceSchema,
  deepLinkSlotSchema,
  deepLinkWidgetSizeSchema,
  deepLinkNotificationTypeSchema,
  deepLinkSchema,
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
  buildGarmentObjectPath,
  buildPaletteSelfieObjectPath,
  buildSilhouetteObjectPath,
} from './wardrobe-object-path'
export type { GarmentObjectExtension } from './wardrobe-object-path'

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
