// Learning path Step 81: Photo AI consent and processor approval.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-81-photo-ai-consent-and-processor-approval
import {
  photoAiConsentResponseSchema,
  type PhotoAiConsentGrant,
} from '@couture/api-client/contracts/http'
import { expect, test } from '../support/fixtures/merged-fixtures'
import { openFixtureShell } from '../support/helpers/app-shell'
import { fixtureOwner } from '../support/helpers/shell-fixtures'

const PATH = '/api/v1/privacy/photo-ai-consent'
const MEMBER = 'photo-ai-profile-member'
const GRANT_ID = 'cb6499c1-b8f1-4199-8891-ee5161829c21'
const RETAINED_GRANT_ID = 'cb6499c1-b8f1-4199-8891-ee5161829c22'
const GRANT: PhotoAiConsentGrant = {
  id: GRANT_ID,
  feature: 'garment-tags',
  inputClass: 'garment-photo',
  provider: 'fixture-processor',
  policyVersion: 'fixture-v1',
  expiresAt: '2090-12-01T00:00:00.000Z',
}

test.use({
  authSessionEnabled: false,
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  locale: 'en-US',
})

test.describe('CC-7.24 Profile photo AI consent @local-lane', () => {
  test('[P0] Profile Account revokes a grant while external processing stays off', async ({
    page,
    interceptNetworkCall,
  }) => {
    await openFixtureShell(page, interceptNetworkCall, {
      mode: 'populated',
      screen: 'profile',
      memberId: MEMBER,
    })
    const retained: PhotoAiConsentGrant = {
      ...GRANT,
      id: RETAINED_GRANT_ID,
      feature: 'garment-cutout',
    }
    let grants = [GRANT, retained]
    const response = () =>
      photoAiConsentResponseSchema.parse({
        data: { externalProcessingEnabled: false, grants },
      })
    const read = interceptNetworkCall({
      url: `**${PATH}`,
      method: 'GET',
      handler: (route) => route.fulfill({ json: response() }),
    })
    const revoke = interceptNetworkCall({
      url: `**${PATH}/revoke`,
      method: 'POST',
      handler: async (route) => {
        grants = [retained]
        await route.fulfill({ json: response() })
      },
    })

    await page.goto('/settings')
    await page.getByTestId('profile-account-row').click()
    await expect(page).toHaveURL(/\/settings\/account$/)
    expect(fixtureOwner((await read).request?.headers().authorization)).toBe(MEMBER)
    const panel = page.getByTestId('photo-ai-consent')
    const status = panel.getByTestId('photo-ai-consent-status')
    await expect(status).toHaveText('External photo AI is off.')
    await expect(
      panel.getByText(
        'You can still write descriptions and add clothes or choose tags yourself.'
      )
    ).toBeVisible()

    const button = panel.getByTestId(`photo-ai-revoke-${GRANT_ID}`)
    await expect(button).toBeEnabled()
    await button.click()

    const revocation = await revoke
    expect(fixtureOwner(revocation.request?.headers().authorization)).toBe(MEMBER)
    expect(revocation.requestJson).toEqual({ grantId: GRANT_ID })
    await expect(button).toHaveCount(0)
    await expect(panel.getByRole('status')).toHaveText('Permission revoked.')
    const retainedButton = panel.getByTestId(`photo-ai-revoke-${RETAINED_GRANT_ID}`)
    await expect(retainedButton).toBeEnabled()
    await expect(status).toHaveText('External photo AI is off.')
    await page.reload()
    await expect(retainedButton).toBeEnabled()
    await expect(button).toHaveCount(0)
  })
})
