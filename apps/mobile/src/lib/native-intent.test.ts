// Learning path Step 43: Realtime engagement and push notifications.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-43-realtime-engagement-and-push-notifications
// Story 6.5: the debug notification fixture URL never reaches a screen.
import { describe, expect, it } from 'vitest'
import { redirectSystemPath } from '@/app/+native-intent'

const fixture = `couturecast-story65://__story65__/notification?data=${encodeURIComponent('{}')}`

describe('system link redirection', () => {
  it('consumes the fixture URL while running and lands a cold launch on the root', () => {
    expect(redirectSystemPath({ path: fixture, initial: false })).toBe('')
    expect(redirectSystemPath({ path: fixture, initial: true })).toBe('/')
  })

  it.each([
    'couturecast://community?source=notification&type=community&cardId=post-1',
    '/(tabs)/community',
    'couturecast-story65://__story65__/other',
    'not a url',
  ])('passes %s through unchanged', (path) => {
    expect(redirectSystemPath({ path, initial: false })).toBe(path)
  })
})
