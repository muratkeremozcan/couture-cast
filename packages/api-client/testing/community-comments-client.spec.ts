// Learning path Step 42: Screened threaded comments.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-42-screened-threaded-comments
// Story 6.4 owner: both platforms use authenticated generated transport and strict thread projections.
import { describe, expect, it, vi } from 'vitest'
import { ZodError } from 'zod'
import { CommunityCommentsState } from '../src/community-comments-state'
import { communityCommentsClient, createApiClient } from '../src/client'
import { abortError } from '../src/request-deadline'
import { item, own } from './community-comments-state-fixtures'

const createdAt = '2026-10-19T12:00:00.000Z'
const submission = { ...own('comment'), body: 'Hello' }
const page = { items: [], nextCursor: null, snapshot: 0, hasNewer: false }

describe('Story 6.4 community comments client', () => {
  it.each(['web', 'mobile'] as const)(
    'sends all %s thread operations through the generated authenticated HTTP boundary',
    async (platform) => {
      const requests: Request[] = []
      const responses = [
        page,
        page,
        { items: [submission], nextCursor: null },
        submission,
        { ...submission, status: 'author_deleted', body: null },
        {
          reported: true,
          acceptedAt: createdAt,
          routedAt: createdAt,
          reviewDueAt: '2026-10-20T12:00:00.000Z',
        },
      ]
      const api = createApiClient('https://api.couturecast.test', {
        accessToken: 'member-token',
        fetchApi: (url, init) => {
          requests.push(new Request(url, init))
          return Promise.resolve(
            new Response(JSON.stringify({ data: responses.shift() }), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            })
          )
        },
      })
      const cancellation = new AbortController()
      const client = communityCommentsClient(api, platform, {
        signal: cancellation.signal,
      })
      expect(await client.roots('post', 'root-cursor')).toEqual(page)
      expect(await client.replies('post', 'root', 'reply-cursor')).toEqual(page)
      expect((await client.submissions('post', 'own-cursor')).items).toEqual([submission])
      const input = {
        mutationId: '00000000-0000-4000-8000-000000000001',
        parentId: null,
        body: 'Hello',
        locale: 'en-US' as const,
      }
      expect(await client.create('post', input)).toEqual(submission)
      expect((await client.delete('post', 'comment')).body).toBeNull()
      expect((await client.report('post', 'comment', 'spam')).reported).toBe(true)
      expect(requests.map(({ url, method }) => [new URL(url).pathname, method])).toEqual([
        ['/api/v1/community/posts/post/comments', 'GET'],
        ['/api/v1/community/posts/post/comments/root/replies', 'GET'],
        ['/api/v1/community/posts/post/comment-submissions', 'GET'],
        ['/api/v1/community/posts/post/comments', 'POST'],
        ['/api/v1/community/posts/post/comments/comment', 'DELETE'],
        ['/api/v1/community/posts/post/comments/comment/report', 'POST'],
      ])
      requests.forEach(({ headers }) => {
        expect(headers.get('authorization')).toBe('Bearer member-token')
        expect(headers.get('x-couture-platform')).toBe(platform)
      })
      expect(new URL(requests[0]!.url).searchParams.get('cursor')).toBe('root-cursor')
      expect(await requests[3]!.json()).toEqual(input)
      expect(await requests[5]!.json()).toEqual({ reason: 'spam' })
      cancellation.abort()
      expect(requests.every((request) => request.signal.aborted)).toBe(true)
    }
  )

  const comment = { ...item('comment'), body: 'Hello' }

  function serving(data: unknown) {
    return createApiClient('https://api.couturecast.test', {
      fetchApi: () =>
        Promise.resolve(
          new Response(JSON.stringify({ data }), {
            headers: { 'content-type': 'application/json' },
          })
        ),
    })
  }

  it.each([
    ['roots', 'a page', { ...page, userId: 'secret' }, ['data']],
    [
      'roots',
      'a comment',
      { ...page, items: [{ ...comment, userId: 'secret' }] },
      ['data', 'items', 0],
    ],
    [
      'submissions',
      'a private submission',
      { items: [{ ...submission, userId: 'secret' }], nextCursor: null },
      ['data', 'items', 0],
    ],
  ] as const)(
    'refuses an unexpected userId on %s %s returned by a thread server',
    async (operation, _shape, data, path) => {
      const refused: unknown = await communityCommentsClient(serving(data), 'web')
        [operation]('post')
        .catch((error: unknown) => error)
      expect(refused).toBeInstanceOf(ZodError)
      expect(refused).toMatchObject({
        issues: [{ code: 'unrecognized_keys', keys: ['userId'], path }],
      })
    }
  )

  it('accepts the same strict projections without private fields', async () => {
    const client = communityCommentsClient(serving({ ...page, items: [comment] }), 'web')
    expect(await client.roots('post')).toEqual({ ...page, items: [comment] })
  })

  it('releases a timed-out generated fetch and preserves the draft and immutable create retry', async () => {
    let cancellation = new AbortController()
    let rejectFetch: (reason: unknown) => void = () => undefined
    const bodies: unknown[] = []
    const api = createApiClient('https://api.couturecast.test', {
      fetchApi: (url, init) => {
        const request = new Request(url, init)
        return request.json().then((body: unknown) => {
          bodies.push(body)
          if (bodies.length > 1)
            return new Response(JSON.stringify({ data: submission }), {
              headers: { 'content-type': 'application/json' },
            })
          return new Promise<Response>((_resolve, reject) => {
            rejectFetch = reject
            const abort = () => reject(new Error('Request deadline reached'))
            if (init?.signal?.aborted) abort()
            else init?.signal?.addEventListener('abort', abort, { once: true })
          })
        })
      },
    })
    const transport = communityCommentsClient(api, 'mobile')
    const state = new CommunityCommentsState(
      {
        ...transport,
        create: (postId, input) =>
          communityCommentsClient(api, 'mobile', { signal: cancellation.signal }).create(
            postId,
            input
          ),
      },
      () => '00000000-0000-4000-8000-000000000001',
      () => 'unknown'
    )
    state.draft('post', { body: 'Hello' })
    const pending = state.submit('post', 'en-US')
    try {
      await vi.waitFor(() => expect(bodies).toHaveLength(1))
      cancellation.abort(abortError('Request deadline reached', 'TimeoutError'))
      await vi.waitFor(() => expect(state.current('post').pending).toBe(false))
      await pending
      expect(state.current('post').draft.body).toBe('Hello')
      expect(state.current('post').unresolved?.body).toBe('Hello')
      cancellation = new AbortController()
      state.draft('post', { body: 'Edited after timeout' })
      await state.submit('post', 'fr-FR')
      expect(bodies[1]).toEqual(bodies[0])
      expect(state.current('post').draft.body).toBe('Edited after timeout')
      expect(state.current('post').unresolved).toBeNull()
    } finally {
      rejectFetch(new Error('test cleanup'))
      await pending
    }
  })
})
