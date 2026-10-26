import { describe, expect, it } from 'vitest'
import { communityCommentSubmissionResponseSchema } from '@couture/api-client/contracts/http'
import data from '../test/fixtures/community-text-corpus/development-round6.json'
import { commentsTestContext } from './helpers/community-comments-context.js'
const { fixture, bootApp, input, processor, prisma } = commentsTestContext()
const denied = [
  ...data.reported.map((row) => ({ text: row.text, locale: 'en-US' })),
  { text: 'you are en retard', locale: 'fr-FR' },
  { text: 'such a en retard', locale: 'fr-FR' },
  { text: 'what a en retard', locale: 'fr-FR' },
  { text: 'tu es um tapete', locale: 'pt-BR' },
  { text: 'espèce de um tapete', locale: 'es-419' },
  { text: 'c’est un um tapete', locale: 'pt-PT' },
  { text: 'en retard', locale: 'en-US' },
  { text: 'um tapete', locale: 'fr-FR' },
]
const clean = [
  {
    text: 'Tram en retard, averse soudaine, heureusement le parapluie pliant vit dans mon sac.',
    locale: 'fr-FR',
  },
  { text: 'Sapatos azuis sobre um tapete.', locale: 'pt-BR' },
]

describe('round6 high-severity occurrence boundaries through actual guarded HTTP', () => {
  it.each([
    ...denied.map((row) => ({ ...row, expected: 'blocked' })),
    ...clean.map((row) => ({ ...row, expected: 'published' })),
  ])('$locale $text becomes $expected', async (row) => {
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
      const result = await prisma.communityComment.findUniqueOrThrow({ where: { id } })
      expect(result.status).toBe(row.expected)
      const visible = await authorized(
        'get',
        `/api/v1/community/posts/${member.postId}/comments`
      )
      expect(visible.status).toBe(200)
      expect(JSON.stringify(visible.body).includes(id)).toBe(row.expected === 'published')
    } finally {
      await app.close()
    }
  })
})
