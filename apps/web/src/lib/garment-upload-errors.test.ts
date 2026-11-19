// Learning path Step 58: Image uploads straight to storage.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#image-uploads-straight-to-storage
//
// Round 5 follow-up: the web garment capture modal shows catalog copy for every upload failure.
// `garmentUploadErrorKey` picks the `wardrobe.capture.errors` key from the failure's code or the
// API answer `throwUploadStepError` recorded, so raw error text never reaches the member.
import { describe, expect, it } from 'vitest'
import { ResponseError } from '@couture/api-client'
import { UploadSessionChangedError } from '@couture/api-client/contracts/http'
import { garmentUploadErrorKey } from './garment-upload-errors'
import { WardrobeRequestError } from './wardrobe'
import { throwUploadStepError } from './upload-attempts'
import deDE from '../i18n/locales/de-DE.json'
import enCA from '../i18n/locales/en-CA.json'
import enUS from '../i18n/locales/en-US.json'
import es419 from '../i18n/locales/es-419.json'
import frCA from '../i18n/locales/fr-CA.json'
import frFR from '../i18n/locales/fr-FR.json'
import itIT from '../i18n/locales/it-IT.json'
import ptBR from '../i18n/locales/pt-BR.json'
import ptPT from '../i18n/locales/pt-PT.json'
import trTR from '../i18n/locales/tr-TR.json'

/** A failed allocate or commit as the garment flow surfaces it, with its answer recorded. */
async function surfacedFailure(status: number, message: string): Promise<Error> {
  const response = new Response(JSON.stringify({ statusCode: status, message }), {
    status,
    headers: { 'content-type': 'application/json' },
  })
  return throwUploadStepError(new ResponseError(response, 'failed'), () =>
    Promise.resolve(new WardrobeRequestError(`raw: ${message}`))
  ).then(
    () => expect.unreachable('throwUploadStepError always throws'),
    (error: unknown) => error as Error
  )
}

describe('garmentUploadErrorKey', () => {
  it('maps an upload fenced by an account change', () => {
    expect(garmentUploadErrorKey(new UploadSessionChangedError())).toBe('sessionChanged')
  })

  it.each([
    ['SIGNED_OUT', 'signedOut'],
    ['IMAGE_UNREADABLE', 'imageUnreadable'],
    ['IMAGE_TOO_SMALL', 'imageTooSmall'],
    ['IMAGE_PREPARATION_UNAVAILABLE', 'preparationUnavailable'],
    ['IMAGE_TOO_LARGE', 'imageTooLarge'],
    ['REQUEST_TIMEOUT', 'timeout'],
  ] as const)('maps the client-side code %s to %s', (code, key) => {
    expect(garmentUploadErrorKey(new WardrobeRequestError('raw text', code))).toBe(key)
  })

  it.each([
    [409, 'UPLOAD_IN_PROGRESS', 'inProgress'],
    [401, 'Unauthorized', 'signedOut'],
    [403, 'GUARDIAN_CONSENT_REQUIRED', 'consentRequired'],
    [409, 'UPLOAD_SESSION_EXPIRED', 'sessionExpired'],
    [409, 'IDEMPOTENCY_KEY_REUSED', 'sessionExpired'],
    [422, 'IMAGE_CHECKSUM_MISMATCH', 'imageRejected'],
    [415, 'UNSUPPORTED_IMAGE_TYPE', 'imageRejected'],
    [400, 'INVALID_UPLOAD_DECLARATION', 'imageRejected'],
    [503, 'STORAGE_UNAVAILABLE', 'serviceUnavailable'],
    [409, 'UPLOAD_BYTES_MISSING', 'failed'],
    [429, 'Too Many Requests', 'failed'],
  ] as const)('maps an API answer %i %s to %s', async (status, code, key) => {
    expect(garmentUploadErrorKey(await surfacedFailure(status, code))).toBe(key)
  })

  // Production follow-up 2026-11-19 (review round 6, Codex C5-9): guardian copy is reserved for
  // the explicit consent denial. `WARDROBE_UPLOAD_FORBIDDEN` (a garment under legal hold or
  // pending deletion, for an adult as much as a teen) and any other 403 read as a neutral
  // restriction that names no guardian.
  it.each([
    [403, 'WARDROBE_UPLOAD_FORBIDDEN'],
    [403, 'Forbidden'],
    [403, 'GUARDIAN_READ_ONLY'],
  ] as const)(
    'maps a %i %s that is no consent denial to the neutral restriction',
    async (status, code) => {
      expect(garmentUploadErrorKey(await surfacedFailure(status, code))).toBe(
        'uploadRestricted'
      )
    }
  )

  it('names the neutral restriction for a forbidden upload the error names itself', () => {
    expect(garmentUploadErrorKey(new Error('WARDROBE_UPLOAD_FORBIDDEN'))).toBe(
      'uploadRestricted'
    )
  })

  it('maps a code the error names itself when no API answer was recorded', () => {
    expect(garmentUploadErrorKey(new Error('GUARDIAN_CONSENT_REQUIRED'))).toBe(
      'consentRequired'
    )
    expect(
      garmentUploadErrorKey(new WardrobeRequestError('raw', 'UPLOAD_SESSION_EXPIRED'))
    ).toBe('sessionExpired')
  })

  it('reads anything else as the generic retry copy', () => {
    expect(garmentUploadErrorKey(new Error('Upload failed with HTTP 400'))).toBe('failed')
    expect(garmentUploadErrorKey('socket hang up')).toBe('failed')
    expect(garmentUploadErrorKey(new WardrobeRequestError('raw', 'SOMETHING_ELSE'))).toBe(
      'failed'
    )
  })
})

describe('the neutral restriction copy', () => {
  const catalogs = {
    'en-US': enUS,
    'en-CA': enCA,
    'de-DE': deDE,
    'es-419': es419,
    'fr-CA': frCA,
    'fr-FR': frFR,
    'it-IT': itIT,
    'pt-BR': ptBR,
    'pt-PT': ptPT,
    'tr-TR': trTR,
  }

  it.each(Object.entries(catalogs))(
    '%s ships its own copy, distinct from the guardian-consent copy',
    (_locale, catalog) => {
      const errors = catalog.wardrobe.capture.errors
      expect(errors.uploadRestricted.trim()).not.toBe('')
      expect(errors.uploadRestricted).not.toBe(errors.consentRequired)
    }
  )

  it('is translated in every non-English catalog', () => {
    const english = enUS.wardrobe.capture.errors.uploadRestricted
    for (const catalog of [deDE, es419, frCA, frFR, itIT, ptBR, ptPT, trTR]) {
      expect(catalog.wardrobe.capture.errors.uploadRestricted).not.toBe(english)
    }
  })
})
