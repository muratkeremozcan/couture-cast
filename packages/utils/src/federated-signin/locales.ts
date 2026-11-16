export const SUPPORTED_SIGNIN_LOCALES = [
  'en-US',
  'en-CA',
  'es-419',
  'fr-CA',
  'fr-FR',
  'tr-TR',
  'de-DE',
  'it-IT',
  'pt-BR',
  'pt-PT',
] as const
export type SupportedSigninLocale = (typeof SUPPORTED_SIGNIN_LOCALES)[number]
