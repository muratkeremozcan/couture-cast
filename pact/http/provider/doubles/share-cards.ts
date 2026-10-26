import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { preparedShareCardFixture } from '@couture/api-client/testing/share-card-fixture'
import type { PrepareShareCardInput } from '@couture/api-client/contracts/http'
export const shareCardServiceDouble = {
  prepare: (_member: string, input: PrepareShareCardInput) => {
    const id =
      input.source.kind === 'outfit' ? input.source.recommendationId : input.source.postId
    if (id === 'denied')
      throw new ForbiddenException({ statusCode: 403, code: 'denied', message: 'denied' })
    if (id === 'missing')
      throw new NotFoundException({
        statusCode: 404,
        code: 'source_unavailable',
        message: 'source_unavailable',
      })
    if (id === 'changed')
      throw new ConflictException({
        statusCode: 409,
        code: 'preview_changed',
        message: 'preview_changed',
      })
    return Promise.resolve(preparedShareCardFixture)
  },
}
