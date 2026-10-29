import { describe, expect, it } from 'vitest'
import { communityCommentSubmissionResponseSchema } from '@couture/api-client/contracts/http'
import data from '../test/fixtures/community-text-corpus/development-round4.json'
import { commentsTestContext } from './helpers/community-comments-context.js'
const { fixture, bootApp, input, processor, prisma } = commentsTestContext()
const rows = [
  ...data.reported,
  ...[
    'you retard, train',
    'shut up retard - vol',
    'mofo, roupa',
    'burro, camisa',
    'monta, borsa',
  ].map((text, index) => ({ id: `opus-h2-${index}`, text, locale: 'en-US' })),
]
describe('round4 disguised and cross-clause text through guarded HTTP', () => {
  it.each(rows)('$id never publishes', async (row) => {
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
      ).not.toBe('published')
      const visible = await authorized(
        'get',
        `/api/v1/community/posts/${member.postId}/comments`
      )
      expect(visible.status).toBe(200)
      expect(JSON.stringify(visible.body)).not.toContain(id)
    } finally {
      await app.close()
    }
  })
})
