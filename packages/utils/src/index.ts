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
  getAnnouncementUrgency,
} from './accessibility'
export type { WeatherAltTextInput, AccessibilityAnnouncementEvent } from './accessibility'

export { buildGarmentObjectPath, buildSilhouetteObjectPath } from './wardrobe-object-path'
export type { GarmentObjectExtension } from './wardrobe-object-path'
