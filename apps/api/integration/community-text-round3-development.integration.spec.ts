import { describe, expect, it } from 'vitest'
import { communityCommentSubmissionResponseSchema } from '@couture/api-client/contracts/http'
import de from '../test/fixtures/community-text-corpus/holdout-v4/de.json'
import itCorpus from '../test/fixtures/community-text-corpus/holdout-v4/it.json'
import pt from '../test/fixtures/community-text-corpus/holdout-v4/pt.json'
import { commentsTestContext } from './helpers/community-comments-context.js'

const { fixture, bootApp, input, processor, prisma } = commentsTestContext()
// V4 was explicitly released as development data after its valid failed gate.
// These are regression inputs; the independent release evaluator owns v5.
const failures = new Set([
  'de-holdout-v4-041',
  'de-holdout-v4-170',
  'de-holdout-v4-713',
  'de-holdout-v4-808',
  'de-holdout-v4-907',
  'de-holdout-v4-953',
  'it-holdout-v4-241',
  'it-holdout-v4-453',
  'it-holdout-v4-549',
  'it-holdout-v4-865',
  'pt-holdout-v4-272',
  'pt-holdout-v4-306',
  'pt-holdout-v4-307',
  'pt-holdout-v4-413',
  'pt-holdout-v4-877',
])
const rows = [
  { corpus: de, locale: 'de-DE' },
  { corpus: itCorpus, locale: 'it-IT' },
  { corpus: pt, locale: 'pt-BR' },
].flatMap(({ corpus, locale }) =>
  corpus.entries.filter((row) => failures.has(row.id)).map((row) => ({ ...row, locale }))
)

describe('released v4 development copy through actual guarded HTTP and screening', () => {
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
