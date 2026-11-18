// Tester report 2026-11-17, Android Chrome on the Wardrobe Hub: the camera preview showed only a
// wide strip of the garment, and "Use This Image" failed with "Failed to fetch".
//
// G-1: production handed the browser an upload address it cannot reach (the API's
// PUBLIC_API_URL was unset, so it named http://localhost:3001). The browser reaches the API
// only through the web app's own /api/v1 path, so the upload must go there whatever host the
// API names. The route below hands the browser the same unreachable address production did.
//
// G-2: a phone camera streams a portrait frame, and the preview cropped it to a 16:9 box with
// object-fit cover while Snap Photo kept the whole frame. The preview must show the whole frame
// the photo will hold. The stand-in camera streams a portrait frame, as a phone does.
//
// G-3: on the same screen the two crop actions wrapped to two lines each, and the background
// cleanup switch drew its track at the 44 px touch size, a disc instead of a switch. Stacked on
// a phone, the actions keep DOM order on screen so keyboard focus moves top to bottom.
import path from 'node:path'
import { signupResponseSchema } from '@couture/api-client/contracts/http'
import { expect, test } from '../support/fixtures/merged-fixtures'
import { resolveEnvironmentConfig } from '../config/environments'
import { waitForAccessibilityReady } from '../support/helpers/accessibility'
import { buildUniqueId, isNonLocalEnvironment } from '../support/helpers/api-test'
import { cleanupWardrobeUserTestData } from '../support/helpers/user-test-data'
import { localE2EAccessToken } from '../support/helpers/local-e2e-token'

const environment = resolveEnvironmentConfig('local')
const garmentFixturePath = path.resolve(
  __dirname,
  '../../apps/api/test/fixtures/garment-tagging/neutral-top.png'
)
// Nothing listens on the discard port: a request there fails as the localhost address did on
// the tester's phone.
const UNREACHABLE_API_ORIGIN = 'http://127.0.0.1:9'
// A portrait phone camera frame (the tester's phone streams 3:4 or 9:16).
const CAMERA_FRAME = { width: 720, height: 1280 }

type CleanupState = { userId?: string; accessToken?: string }

const phoneTest = test.extend<{ cleanupState: CleanupState }>({
  cleanupState: async ({ apiRequest }, use) => {
    const state: CleanupState = {}
    try {
      await use(state)
    } finally {
      await cleanupWardrobeUserTestData(
        apiRequest,
        state.accessToken,
        state.userId,
        environment.apiBaseUrl
      )
    }
  },
})

phoneTest.describe('Garment capture on a phone', () => {
  phoneTest.use({
    authSessionEnabled: false,
    // The tester's Android phone.
    viewport: { width: 412, height: 915 },
    deviceScaleFactor: 2.625,
    isMobile: true,
    hasTouch: true,
  })

  phoneTest.beforeEach(async ({ apiRequest, cleanupState, page }, testInfo) => {
    test.skip(
      isNonLocalEnvironment(testInfo),
      'The garment upload needs the supervised local API and wardrobe worker.'
    )
    const signup = await apiRequest({
      method: 'POST',
      path: '/api/v1/auth/signup',
      baseUrl: environment.apiBaseUrl,
      body: {
        email: `${buildUniqueId('garment-capture-phone', testInfo)}@example.test`,
        birthdate: '1990-06-15',
      },
    })
    expect(signup.status).toBe(201)
    const { userId } = signupResponseSchema.parse(signup.body)
    const accessToken = localE2EAccessToken(userId)
    cleanupState.userId = userId
    cleanupState.accessToken = accessToken
    await page.addInitScript((token) => {
      window.sessionStorage.setItem('couturecast.access-token', token)
    }, accessToken)
    await page.setExtraHTTPHeaders({ Authorization: `Bearer ${accessToken}` })
  })

  phoneTest(
    'G-1: Use This Image uploads through the web app when the API names a host the browser cannot reach',
    async ({ page }) => {
      await page.route('**/api/v1/wardrobe/upload-url', async (route) => {
        const response = await route.fetch()
        const body = (await response.json()) as { data: { uploadUrl: string } }
        const named = new URL(body.data.uploadUrl)
        body.data.uploadUrl = `${UNREACHABLE_API_ORIGIN}${named.pathname}${named.search}`
        await route.fulfill({ response, json: body })
      })
      const uploads: string[] = []
      page.on('request', (request) => {
        if (request.method() === 'PUT') uploads.push(request.url())
      })

      await page.goto('/wardrobe')
      await waitForAccessibilityReady(page)
      await page.getByRole('button', { name: '+ Add Garment' }).click()
      await page.getByLabel('Garment image file').setInputFiles(garmentFixturePath)
      await page.getByRole('button', { name: 'Use This Image' }).click()

      await expect(page.getByText('Garment Upload Complete!')).toBeVisible()
      await expect(page.getByText('Failed to fetch')).toHaveCount(0)
      // The web app's own /api/v1 path, or the API base the web build was given.
      const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL?.trim()
      const origin = apiBase ? new URL(apiBase).origin : new URL(page.url()).origin
      expect(uploads).toHaveLength(1)
      expect(new URL(uploads[0]!).origin).toBe(origin)
      expect(new URL(uploads[0]!).pathname).toMatch(/^\/api\/v1\/wardrobe\/uploads\//)
    }
  )

  phoneTest(
    'G-2: the camera preview shows the whole portrait frame that Snap Photo keeps',
    async ({ page }, testInfo) => {
      await page.addInitScript((frame) => {
        const canvas = document.createElement('canvas')
        canvas.width = frame.width
        canvas.height = frame.height
        const context = canvas.getContext('2d')!
        const paint = () => {
          // A garment-like shape from the top edge to the bottom edge, so a crop removes it.
          context.fillStyle = '#ffffff'
          context.fillRect(0, 0, frame.width, frame.height)
          context.fillStyle = '#b08850'
          context.fillRect(frame.width * 0.3, 0, frame.width * 0.4, frame.height)
        }
        paint()
        const stream = canvas.captureStream(15)
        setInterval(paint, 66)
        Object.defineProperty(navigator, 'mediaDevices', {
          configurable: true,
          value: { getUserMedia: () => Promise.resolve(stream) },
        })
      }, CAMERA_FRAME)

      await page.goto('/wardrobe')
      await waitForAccessibilityReady(page)
      await page.getByRole('button', { name: '+ Add Garment' }).click()
      await page.getByRole('button', { name: 'Take Photo' }).click()

      const video = page.getByRole('dialog').locator('video')
      await expect
        .poll(() => video.evaluate((element: HTMLVideoElement) => element.videoHeight))
        .toBe(CAMERA_FRAME.height)
      const preview = await video.evaluate((element: HTMLVideoElement) => {
        const box = element.getBoundingClientRect()
        const style = getComputedStyle(element)
        const frameRatio = element.videoWidth / element.videoHeight
        const boxRatio = box.width / box.height
        // The share of the frame on screen: object-fit cover crops the axis that overflows the
        // box; contain and a box with the frame's own ratio show all of it.
        const shown =
          style.objectFit === 'cover'
            ? Math.min(boxRatio / frameRatio, frameRatio / boxRatio)
            : 1
        return {
          shown,
          top: box.top,
          bottom: box.bottom,
          left: box.left,
          right: box.right,
          viewportHeight: window.innerHeight,
          viewportWidth: window.innerWidth,
        }
      })
      expect(preview.shown).toBeGreaterThan(0.99)
      // The whole preview and the Snap Photo button sit on the phone screen.
      expect(preview.top).toBeGreaterThanOrEqual(0)
      expect(preview.left).toBeGreaterThanOrEqual(0)
      expect(preview.right).toBeLessThanOrEqual(preview.viewportWidth)
      expect(preview.bottom).toBeLessThanOrEqual(preview.viewportHeight)
      await expect(page.getByRole('button', { name: 'Snap Photo' })).toBeInViewport({
        ratio: 1,
      })

      // For review: the preview as the phone shows it.
      await page.screenshot({ path: testInfo.outputPath('camera-preview.png') })
      await testInfo.attach('camera preview', {
        path: testInfo.outputPath('camera-preview.png'),
        contentType: 'image/png',
      })

      await page.getByRole('button', { name: 'Snap Photo' }).click()
      const snapped = page.getByRole('dialog').getByRole('img').first()
      await expect(snapped).toBeVisible()
      // The box is sized by CSS, so it shows before the data URL decodes.
      await expect
        .poll(() =>
          snapped.evaluate((element: HTMLImageElement) => ({
            width: element.naturalWidth,
            height: element.naturalHeight,
          }))
        )
        .toEqual(CAMERA_FRAME)
    }
  )

  phoneTest(
    'G-3: the crop actions each sit on one line and the cleanup switch keeps its track shape',
    async ({ page }, testInfo) => {
      await page.goto('/wardrobe')
      await waitForAccessibilityReady(page)
      await page.getByRole('button', { name: '+ Add Garment' }).click()
      await page.getByLabel('Garment image file').setInputFiles(garmentFixturePath)

      // Keyboard focus follows the DOM, so the actions must sit on screen in DOM order.
      const actionTops = await page
        .getByRole('dialog')
        .getByRole('button', { name: /^(Retake \/ Choose Another|Use This Image)$/ })
        .evaluateAll((elements) =>
          elements.map((element) => element.getBoundingClientRect().top)
        )
      expect(actionTops).toHaveLength(2)
      expect(actionTops[0]!).toBeLessThan(actionTops[1]!)

      for (const name of ['Retake / Choose Another', 'Use This Image']) {
        const button = page.getByRole('button', { name })
        await expect(button).toBeInViewport({ ratio: 1 })
        const lines = await button.evaluate((element) => {
          const range = document.createRange()
          range.selectNodeContents(element)
          return new Set(
            Array.from(range.getClientRects(), (rect) => Math.round(rect.top))
          ).size
        })
        expect(lines, name).toBe(1)
      }

      const toggle = page.getByRole('switch', { name: 'Auto Background Cleanup' })
      const shape = await toggle.evaluate((element) => {
        const target = element.getBoundingClientRect()
        const track = (element.firstElementChild ?? element).getBoundingClientRect()
        return {
          targetHeight: target.height,
          trackWidth: track.width,
          trackHeight: track.height,
        }
      })
      expect(shape.targetHeight).toBeGreaterThanOrEqual(44)
      expect(shape.trackWidth / shape.trackHeight).toBeGreaterThan(1.6)
      await page.screenshot({ path: testInfo.outputPath('crop-step.png') })
      await testInfo.attach('crop step', {
        path: testInfo.outputPath('crop-step.png'),
        contentType: 'image/png',
      })
    }
  )
})
