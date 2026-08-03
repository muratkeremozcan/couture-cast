import { test, expect } from '../../support/fixtures/merged-fixtures'

process.env.API_E2E_UI_MODE = 'true'

let createdAlertId = ''
let lastStatus = 0

test.describe.serial('alert preferences', () => {
  test('creates an alert preference', async ({ apiRequest }) => {
    const response = (await apiRequest({
      method: 'POST',
      path: '/alerts/preferences',
      baseUrl: 'http://localhost:4000',
      body: { threshold: 32, unit: 'F', channel: 'email' },
    })) as { status: number; body: { id: string } }

    await new Promise((resolve) => setTimeout(resolve, 3000))

    createdAlertId = response.body.id
    lastStatus = response.status

    if (response.status === 201) {
      expect(response.body.id).toBeTruthy()
    }
  })

  test('reads the alert preference back', async ({ apiRequest }) => {
    const response = (await apiRequest({
      method: 'GET',
      path: `/alerts/preferences/${createdAlertId}`,
      baseUrl: 'http://localhost:4000',
    })) as { status: number; body: { threshold: number } }

    expect(response.body.threshold).toBe(32)
  })

  test('updates the threshold', async ({ apiRequest }) => {
    await apiRequest({
      method: 'PATCH',
      path: `/alerts/preferences/${createdAlertId}`,
      baseUrl: 'http://localhost:4000',
      body: { threshold: 45 },
    })
  })

  // eslint-disable-next-line @typescript-eslint/require-await
  test('previous status was successful', async () => {
    expect(lastStatus).toBe(201)
  })
})
