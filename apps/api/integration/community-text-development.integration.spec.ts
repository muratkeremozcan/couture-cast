import { describe, expect, it } from 'vitest'
import { communityCommentSubmissionResponseSchema } from '@couture/api-client/contracts/http'
import development from '../test/fixtures/community-text-corpus/development-v3.json'
import { commentsTestContext } from './helpers/community-comments-context.js'

const { fixture, bootApp, input, processor, prisma } = commentsTestContext()

describe('development fashion text through guarded HTTP and persisted screening', () => {
  it.each(development.entries)(
    '$id publishes its ordinary fashion context',
    async (row) => {
      const member = await fixture()
      const { app, authorized } = await bootApp({ userId: member.userId })
      try {
        const response = await authorized(
          'post',
          `/api/v1/community/posts/${member.postId}/comments`
        ).send({ ...input(row.text), locale: row.locale })
        expect(response.status).toBe(200)
        const { id } = communityCommentSubmissionResponseSchema.parse(response.body).data
        expect(id).toBeTruthy()
        await processor.process(id)
        const stored = await prisma.communityComment.findUniqueOrThrow({ where: { id } })
        expect(stored.status).toBe('published')
        const visible = await authorized(
          'get',
          `/api/v1/community/posts/${member.postId}/comments`
        )
        expect(visible.status).toBe(200)
        expect(JSON.stringify(visible.body)).toContain(id)
      } finally {
        await app.close()
      }
    }
  )
})
