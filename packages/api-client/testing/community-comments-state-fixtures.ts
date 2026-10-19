// Story 6.4 owner: shared builders for the comments state specs. Each setup() call returns a
// fresh state, transport and id generator, so no state is shared across tests or files.
import { vi } from 'vitest'
import { CommunityCommentsState } from '../src/community-comments-state'
import type {
  CommunityComment,
  CommunityCommentsPage,
  CommunityCommentSubmission,
} from '../src/contracts/http/community'

export const item = (id = 'root', sequence = 1): CommunityComment => ({
  id,
  postId: 'post',
  parentId: null,
  body: 'Beautiful layers.',
  author: 'Style Explorer 12345678',
  isOwn: false,
  unavailable: false,
  publicationSequence: sequence,
  publishedAt: '2026-10-19T12:00:00.000Z',
  replyCount: 0,
})
export const own = (id = 'own'): CommunityCommentSubmission => ({
  id,
  postId: 'post',
  parentId: null,
  status: 'pending_screening',
  body: 'Beautiful layers.',
  createdAt: '2026-10-19T12:00:00.000Z',
  publicationSequence: null,
})
export const page = (
  items = [item()],
  nextCursor: string | null = null,
  snapshot = 5
): CommunityCommentsPage => ({ items, nextCursor, snapshot, hasNewer: false })
export type SubmissionsPage = {
  items: CommunityCommentSubmission[]
  nextCursor: string | null
}
export const ownPage = (
  items = [own()],
  nextCursor: string | null = null
): SubmissionsPage => ({
  items,
  nextCursor,
})
export function setup() {
  const transport = {
    roots: vi.fn().mockResolvedValue(page()),
    replies: vi.fn().mockResolvedValue(page()),
    submissions: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    create: vi.fn().mockResolvedValue(own()),
    delete: vi.fn().mockResolvedValue({ ...own(), status: 'author_deleted', body: null }),
    report: vi.fn().mockResolvedValue({}),
  }
  const id = vi.fn().mockReturnValue('00000000-0000-4000-8000-000000000001')
  const state = new CommunityCommentsState(transport, id, (error) =>
    typeof error === 'string' ? error : 'unknown'
  )
  return { transport, state, id }
}
export function deferred<T>() {
  let resolve: (value: T) => void = () => undefined
  let reject: (error: unknown) => void = () => undefined
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
