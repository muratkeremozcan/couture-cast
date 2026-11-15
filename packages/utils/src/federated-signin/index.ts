// Story 6.17: shared Google sign-in copy for web and mobile.
export { SUPPORTED_SIGNIN_LOCALES, type SupportedSigninLocale } from './locales'
export {
  FEDERATED_SIGNIN_STRINGS,
  getFederatedSignInStrings,
  resolveFederatedSignInLocale,
  type FederatedSignInStrings,
} from './strings'
export {
  GOOGLE_BUTTON_THEME,
  GOOGLE_G_MARK_PATHS,
  GOOGLE_G_MARK_VIEWBOX,
} from './google-mark'
export { finishStepHref, parseSignInDoor, signInDoorHref, type SignInDoor } from './door'
export {
  stripProviderTokens,
  withoutProviderTokens,
  type AuthSessionStorage,
} from './session-storage'
