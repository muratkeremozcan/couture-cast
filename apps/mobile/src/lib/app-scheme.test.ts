// Learning path Step 57: Google sign-in.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-57-google-sign-in
// Story 6.17 TEA sign-off: D7. `couturecast` is the primary scheme, so `Linking.createURL` (which
// takes the first scheme) builds the OAuth redirect on it, and `mobile` stays so existing links
// keep opening. U-INTENT-CALLBACK routes both; the release config check lives in
// scripts/lib/resolved-app-config.test.mjs.
import { describe, expect, it } from 'vitest'
import appJson from '@/app.json'
import { redirectSystemPath } from '@/app/+native-intent'

describe('D7: the native schemes', () => {
  it('lists couturecast first and keeps the mobile alias', () => {
    expect(appJson.expo.scheme).toEqual(['couturecast', 'mobile'])
  })

  it.each(appJson.expo.scheme)(
    'routes a %s:// callback link to /auth/callback',
    (scheme) => {
      expect(
        redirectSystemPath({ path: `${scheme}://auth/callback?code=c-1`, initial: true })
      ).toBe('/auth/callback?code=c-1')
    }
  )
})
