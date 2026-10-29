import { describe, expect, it } from 'vitest'
import { communityCommentSubmissionResponseSchema } from '@couture/api-client/contracts/http'
import data from '../test/fixtures/community-text-corpus/development-round5.json'
import { commentsTestContext } from './helpers/community-comments-context.js'
const { fixture, bootApp, input, processor, prisma } = commentsTestContext()
const rows = data.entries

describe('retired v5 development copy through actual guarded HTTP and screening', () => {
  it.each(rows)('$id remains visible after screening', async (row) => {
    const member = await fixture()
    const { app, authorized } = await bootApp({ userId: member.userId })
    try {
      const response = await authorized(
        'post',
        `/api/v1/community/posts/${member.postId}/comments`
      ).send({ ...input(row.text), locale: row.locale })
      expect(response.status).toBe(200)
      const { id } = communityCommentSubmissionResponseSchema.parse(response.body).data
      await processor.process(id)
      expect(
        (await prisma.communityComment.findUniqueOrThrow({ where: { id } })).status
      ).toBe('published')
      const visible = await authorized(
        'get',
        `/api/v1/community/posts/${member.postId}/comments`
      )
      expect(visible.status).toBe(200)
      expect(JSON.stringify(visible.body)).toContain(id)
    } finally {
      await app.close()
    }
  })
})
