// Learning path Step 50: Moderator queue and case detail.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-50-moderator-queue-and-case-detail
// Story 6.10 test owner: P-Q-DEEPLINK at the page boundary. A case id reaches the page as an
// encoded URL segment; a malformed escape must become a not-found case, never a crash.
import { isValidElement, type ReactElement } from 'react'
import { describe, expect, it } from 'vitest'
import ModerationCasePage from './page'

const caseIdOf = async (segment: string) => {
  const page = (await ModerationCasePage({
    params: Promise.resolve({ caseId: segment }),
  })) as ReactElement<{ children: ReactElement<{ caseId: string }> }>
  expect(isValidElement(page)).toBe(true)
  return page.props.children.props.caseId
}

describe('ModerationCasePage case id decoding', () => {
  it.each([
    ['post.abc_DEF-1', 'post.abc_DEF-1'],
    ['orphan-post.r9', 'orphan-post.r9'],
    ['post%2Eabc', 'post.abc'],
  ])('decodes %s to %s', async (segment, expected) => {
    expect(await caseIdOf(segment)).toBe(expected)
  })

  it.each(['%E0%A4%A', '%', '%zz', 'post.%E0%A4'])(
    'passes the malformed segment %s through so the API answers 404',
    async (segment) => {
      expect(await caseIdOf(segment)).toBe(segment)
    }
  )
})
