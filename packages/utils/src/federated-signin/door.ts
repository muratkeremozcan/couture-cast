/**
 * Story 6.17 D5: which page started a Google round trip. Failures and Cancel return there.
 * Plain functions with no client-only imports, so server pages may call them.
 */
export type SignInDoor = 'signin' | 'signup'

export function parseSignInDoor(value: string | null | undefined): SignInDoor {
  return value === 'signup' ? 'signup' : 'signin'
}

/** The finish step's URL, carrying only the door and the preview hint. */
export function finishStepHref(from: 'preview' | null, door: SignInDoor): string {
  const query = new URLSearchParams()
  if (door === 'signup') query.set('door', 'signup')
  if (from) query.set('from', 'preview')
  const text = query.toString()
  return text ? `/signup/finish?${text}` : '/signup/finish'
}
