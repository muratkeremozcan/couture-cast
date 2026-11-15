import { parsePreviewFrom } from '@couture/utils'

/**
 * Story 6.17 D5: the OAuth callback URL carries a one-time `code`, and on failure Auth puts
 * `error`, `error_code` and `error_description` in the query and repeats them in the fragment
 * (TEA-12). The callback page takes them out of the address bar before its own effects run,
 * so no code stays in the URL, the browser history or a referrer. Only `door=signup` and
 * `from=preview` survive; they are the state the round trip keeps.
 */
export function takeOAuthCallbackParams(win: Window = window): URLSearchParams {
  const url = new URL(win.location.href)
  const taken = new URLSearchParams(url.search)
  new URLSearchParams(url.hash.replace(/^#/, '')).forEach((value, key) => {
    if (!taken.has(key)) taken.set(key, value)
  })
  const kept = new URLSearchParams()
  if (taken.get('door') === 'signup') kept.set('door', 'signup')
  if (parsePreviewFrom(taken.get('from')) !== null) kept.set('from', 'preview')
  const query = kept.toString()
  win.history.replaceState(
    win.history.state,
    '',
    `${url.pathname}${query ? `?${query}` : ''}`
  )
  return taken
}
