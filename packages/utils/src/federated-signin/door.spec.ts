// Learning path Step 57: Google sign-in.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-57-google-sign-in
// Story 6.17 D5: the door a Google round trip returns to, on web and mobile alike.
import { describe, expect, it } from 'vitest'
import { finishStepHref, parseSignInDoor, signInDoorHref } from './door'

describe('sign-in door', () => {
  it('reads only signup as the signup door', () => {
    expect(parseSignInDoor('signup')).toBe('signup')
    expect(parseSignInDoor('signin')).toBe('signin')
    expect(parseSignInDoor('admin')).toBe('signin')
    expect(parseSignInDoor(null)).toBe('signin')
  })

  it('builds the finish step on the web and the mobile route', () => {
    expect(finishStepHref(null, 'signin')).toBe('/signup/finish')
    expect(finishStepHref('preview', 'signup')).toBe(
      '/signup/finish?door=signup&from=preview'
    )
    expect(finishStepHref(null, 'signup', '/signup-finish')).toBe(
      '/signup-finish?door=signup'
    )
    expect(finishStepHref('preview', 'signin', '/signup-finish')).toBe(
      '/signup-finish?from=preview'
    )
  })

  it('returns to the door with a fixed outcome and the preview hint', () => {
    expect(signInDoorHref('signin')).toBe('/signin')
    expect(signInDoorHref('signup', { fromPreview: true })).toBe('/signup?from=preview')
    expect(signInDoorHref('signup', { google: 'cancelled', fromPreview: true })).toBe(
      '/signup?google=cancelled&from=preview'
    )
    expect(signInDoorHref('signin', { google: 'refused' })).toBe('/signin?google=refused')
  })
})
