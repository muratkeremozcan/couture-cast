/**
 * Story 6.17 D5: which page started a Google round trip. Failures and Cancel return there.
 * Plain functions with no client-only imports, so server pages may call them.
 */
export type SignInDoor = 'signin' | 'signup'

export function parseSignInDoor(value: string | null | undefined): SignInDoor {
  return value === 'signup' ? 'signup' : 'signin'
}

/**
 * The finish step's URL, carrying only the door and the preview hint. The web route is
 * `/signup/finish`; the mobile route passes its own path (`/signup-finish`).
 */
export function finishStepHref(
  from: 'preview' | null,
  door: SignInDoor,
  path = '/signup/finish'
): string {
  const query = new URLSearchParams()
  if (door === 'signup') query.set('door', 'signup')
  if (from) query.set('from', 'preview')
  const text = query.toString()
  return text ? `${path}?${text}` : path
}

/**
 * The door's URL after a round trip: a fixed Google outcome name for its message, and the
 * preview hint. Both clients name the doors `/signin` and `/signup`.
 */
export function signInDoorHref(
  door: SignInDoor,
  options: {
    google?: 'cancelled' | 'unavailable' | 'refused'
    fromPreview?: boolean
  } = {}
): string {
  const query = new URLSearchParams()
  if (options.google) query.set('google', options.google)
  if (options.fromPreview) query.set('from', 'preview')
  const text = query.toString()
  return text ? `/${door}?${text}` : `/${door}`
}
