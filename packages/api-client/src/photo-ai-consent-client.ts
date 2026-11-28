import {
  photoAiConsentResponseSchema,
  type PhotoAiConsentResponse,
} from './contracts/http/photo-ai-consent'
import type { DefaultApi } from './generated'
import { withRequestDeadline } from './request-deadline'

export async function requestPhotoAiConsent(
  api: DefaultApi,
  signal: AbortSignal,
  grantId?: string
): Promise<PhotoAiConsentResponse['data']> {
  const response = await withRequestDeadline(8_000, [signal], (requestSignal) => {
    const options = { signal: requestSignal }
    return grantId === undefined
      ? api.apiV1PrivacyPhotoAiConsentGet(options)
      : api.apiV1PrivacyPhotoAiConsentRevokePost(
          { revokePhotoAiConsentInput: { grantId } },
          options
        )
  })
  return photoAiConsentResponseSchema.parse(response).data
}
