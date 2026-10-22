import { describe, expect, it } from 'vitest'
import { hasDeepLinkIntent, parseDeepLink } from './deep-link'

const card = { source: 'notification', type: 'community', cardId: 'look-1' }
const now = new Date('2026-10-20T12:00:00.000Z')

describe('community notification target boundaries', () => {
  it.each([
    { source: 'widget', slot: 'am', cardId: 'look-1', commentId: 'root-1' },
    { source: 'app', cardId: 'look-1', commentId: 'root-1' },
    {
      source: 'notification',
      type: 'weather_alert',
      cardId: 'look-1',
      commentId: 'root-1',
    },
    { source: 'notification', type: 'community', commentId: 'root-1' },
    { ...card, parentId: 'root-1' },
  ])('rejects a comment target outside its required community context: %o', (params) => {
    const result = parseDeepLink(params, now)
    expect(result).toEqual({
      valid: false,
      errorReason: 'commentId: Comment targets require a community card.',
    })
    expect(result.payload).toBeUndefined()
  })

  it('preserves a root target and its exact reply context while trimming identifiers', () => {
    expect(parseDeepLink({ ...card, commentId: ' root-1 ' }, now)).toEqual({
      valid: true,
      payload: { ...card, commentId: 'root-1' },
    })
    expect(
      parseDeepLink({ ...card, commentId: ' reply-2 ', parentId: ' root-1 ' }, now)
    ).toEqual({
      valid: true,
      payload: { ...card, commentId: 'reply-2', parentId: 'root-1' },
    })
  })

  it.each(['cardId', 'commentId', 'parentId'])(
    'rejects whitespace-only %s without manufacturing a destination',
    (field) => {
      const result = parseDeepLink(
        { ...card, commentId: 'reply-2', parentId: 'root-1', [field]: ' \t ' },
        now
      )
      expect(result.valid).toBe(false)
      expect(result.errorReason).toContain(field)
      expect(result.payload).toBeUndefined()
    }
  )

  it.each([42, {}, ['nested']])('rejects malformed identifier input %o', (commentId) => {
    // A router array is unwrapped once. Nested arrays and non-string values remain invalid.
    const result = parseDeepLink({ ...card, commentId: [commentId] }, now)
    expect(result.valid).toBe(false)
    expect(result.errorReason).toContain('commentId')
    expect(result.payload).toBeUndefined()
  })

  it('keeps a parent-only router intent invalid when its first comment value is empty', () => {
    const params = { ...card, commentId: ['', 'reply-2'], parentId: ['root-1'] }
    expect(hasDeepLinkIntent(params)).toBe(true)
    expect(parseDeepLink(params, now).valid).toBe(false)
  })

  it('normalizes router arrays without allowing later values to replace the selected target', () => {
    expect(
      parseDeepLink(
        {
          source: ['notification'],
          type: ['community'],
          cardId: ['look-1', 'other-look'],
          commentId: ['reply-2'],
          parentId: ['root-1'],
        },
        now
      )
    ).toEqual({
      valid: true,
      payload: { ...card, commentId: 'reply-2', parentId: 'root-1' },
    })
  })

  it('rejects expiry at the exact instant, including an equivalent offset, and accepts one millisecond of remaining lifetime', () => {
    for (const expiresAt of ['2026-10-20T12:00:00.000Z', '2026-10-20T14:00:00.000+02:00'])
      expect(parseDeepLink({ ...card, commentId: 'root-1', expiresAt }, now)).toEqual({
        valid: false,
        errorReason: 'Deep link expired',
      })
    const expiresAt = '2026-10-20T12:00:00.001Z'
    expect(parseDeepLink({ ...card, commentId: 'root-1', expiresAt }, now)).toEqual({
      valid: true,
      payload: { ...card, commentId: 'root-1', expiresAt },
    })
  })

  it.each(['tomorrow', '2026-13-20T12:00:00Z', '2026-10-20T12:00:00'])(
    'rejects malformed expiry %s',
    (expiresAt) => {
      const result = parseDeepLink({ ...card, expiresAt }, now)
      expect(result.valid).toBe(false)
      expect(result.errorReason).toContain('expiresAt')
      expect(result.payload).toBeUndefined()
    }
  )

  it('recognizes new comment intent keys while treating empty router values as absent', () => {
    expect(hasDeepLinkIntent({ commentId: [undefined, null, '', 'reply-2'] })).toBe(true)
    expect(hasDeepLinkIntent({ parentId: 'root-1' })).toBe(true)
    expect(hasDeepLinkIntent({ commentId: [undefined, null, ''], parentId: [] })).toBe(
      false
    )
    expect(
      parseDeepLink({ source: [], type: 'community', cardId: 'look-1' }, now).valid
    ).toBe(false)
    expect(parseDeepLink({ ...card, commentId: [], parentId: [null] }, now)).toEqual({
      valid: true,
      payload: card,
    })
  })
})
