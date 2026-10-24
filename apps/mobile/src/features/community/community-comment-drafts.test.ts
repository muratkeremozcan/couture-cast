// Story 6.5 R46: the in-memory copy of a member's unsent comment belongs to that member
// and that post only, and leaves on forget, forgetAll or a fresh member.
import { describe, expect, it } from 'vitest'
import { CommunityCommentDrafts } from './community-comment-drafts'

describe('CommunityCommentDrafts (R46)', () => {
  it('holds a draft for its own member and post only', () => {
    const drafts = new CommunityCommentDrafts()
    drafts.remember('member-a', 'post-a', { body: 'Half a thought' })
    drafts.remember('member-a', 'post-a', { parentId: 'root-1' })

    expect(drafts.restore('member-a', 'post-a')).toEqual({
      body: 'Half a thought',
      parentId: 'root-1',
      focused: false,
    })
    expect(drafts.restore('member-b', 'post-a')).toBeNull()
    expect(drafts.restore('member-a', 'post-b')).toBeNull()
  })

  it('hands back a copy, so a caller cannot edit the held draft', () => {
    const drafts = new CommunityCommentDrafts()
    drafts.remember('member-a', 'post-a', { body: 'Kept' })
    const restored = drafts.restore('member-a', 'post-a')!
    restored.body = 'Changed by the caller'
    expect(drafts.restore('member-a', 'post-a')?.body).toBe('Kept')
  })

  it('records composer focus only for a draft it already holds', () => {
    const drafts = new CommunityCommentDrafts()
    drafts.retainFocus('member-a', 'post-a', true)
    expect(drafts.restore('member-a', 'post-a')).toBeNull()

    drafts.remember('member-a', 'post-a', {})
    drafts.retainFocus('member-a', 'post-a', true)
    expect(drafts.restore('member-a', 'post-a')).toEqual({
      body: '',
      parentId: null,
      focused: true,
    })
    drafts.retainFocus('member-a', 'post-a', false)
    expect(drafts.restore('member-a', 'post-a')?.focused).toBe(false)
  })

  it('forgets one post and keeps the other drafts of that member', () => {
    const drafts = new CommunityCommentDrafts()
    drafts.remember('member-a', 'post-a', { body: 'First' })
    drafts.remember('member-a', 'post-b', { body: 'Second' })
    drafts.forget('member-a', 'post-a')

    expect(drafts.restore('member-a', 'post-a')).toBeNull()
    expect(drafts.restore('member-a', 'post-b')?.body).toBe('Second')
    // Forgetting what was never held is harmless.
    drafts.forget('member-b', 'post-a')
  })

  it('forgets every member on forgetAll', () => {
    const drafts = new CommunityCommentDrafts()
    drafts.remember('member-a', 'post-a', { body: 'Mine' })
    drafts.remember('member-b', 'post-b', { body: 'Theirs' })
    drafts.forgetAll()

    expect(drafts.restore('member-a', 'post-a')).toBeNull()
    expect(drafts.restore('member-b', 'post-b')).toBeNull()
  })
})
