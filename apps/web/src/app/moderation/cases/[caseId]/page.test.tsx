// Learning path Step 50: Moderator queue and case detail.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-50-moderator-queue-and-case-detail
// Story 6.10 test owner: P-Q-DEEPLINK at the page boundary. A case id reaches the page as an
// encoded URL segment; a malformed escape must become a not-found case, never a crash.
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { ModerationCaseDetailView } from '../../../components/moderation-case-detail'
import ModerationCasePage from './page'

type Props = { children?: ReactNode; caseId?: string }

/** Story CC-7.9 D6: the view sits inside the page surface and its main, under the top bar. */
function findView(node: ReactNode): ReactElement<Props> | null {
  if (!isValidElement<Props>(node)) return null
  if (node.type === ModerationCaseDetailView) return node
  for (const child of Children.toArray(node.props.children)) {
    const found = findView(child)
    if (found) return found
  }
  return null
}

const caseIdOf = async (segment: string) => {
  const page = await ModerationCasePage({ params: Promise.resolve({ caseId: segment }) })
  expect(isValidElement(page)).toBe(true)
  const view = findView(page)
  expect(view).not.toBeNull()
  return view?.props.caseId
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
