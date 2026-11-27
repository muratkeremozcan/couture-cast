import type { StyleProfileRequest } from '@couture/utils'
import { styleProfileResponseSchema } from './contracts/http/style-profile'
import type { DefaultApi } from './generated'
import { withRequestDeadline } from './request-deadline'

export async function requestStyleProfile(
  api: DefaultApi,
  operation: StyleProfileRequest
) {
  const response = await withRequestDeadline(8_000, [], (signal) => {
    const options = { signal }
    switch (operation.method) {
      case 'GET':
        return api.apiV1PersonalizationStyleProfileGet(options)
      case 'PATCH':
        return api.apiV1PersonalizationStyleProfilePatch(
          { updateStyleProfileInput: operation.input },
          options
        )
      case 'DELETE':
        return api.apiV1PersonalizationStyleProfileDelete(options)
    }
  })
  return styleProfileResponseSchema.parse(response).data
}
