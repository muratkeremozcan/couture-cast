// Learning path Step 58: Image uploads straight to storage.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#image-uploads-straight-to-storage
// Tester report 2026-11-17, Android Chrome on the Wardrobe Hub: the camera preview showed only a
// wide strip of the garment, and "Use This Image" failed with "Failed to fetch".
//
// G-1: production handed the browser an upload address it cannot reach (the API's
// PUBLIC_API_URL was unset, so it named http://localhost:3001). Since 2026-11-19 (G-4) the bytes
// no longer pass through the API at all: the API hands out a signed storage upload URL for one
// object, and the browser must put the bytes at exactly that URL, on the storage host, never
// on the API or web host.
//
// G-2: a phone camera streams a portrait frame, and the preview cropped it to a 16:9 box with
// object-fit cover while Snap Photo kept the whole frame. The preview must show the whole frame
// the photo will hold. The stand-in camera streams a portrait frame, as a phone does.
//
// G-3: on the same screen the two crop actions wrapped to two lines each, and the background
// cleanup switch drew its track at the 44 px touch size, a disc instead of a switch. Stacked on
// a phone, the actions keep DOM order on screen so keyboard focus moves top to bottom.
//
// Tester report 2026-11-19, Android Chrome at 448 px, a new account on the Wardrobe Hub:
// "Upload fail". G-4 reproduces one cause with a generated 12 MP phone photo: prepared with the
// default settings (1:1 crop, background cleanup on, so PNG) it is over 5 MB, and the upload sent
// those bytes through a Vercel Function, which refuses a body over about 4.5 MB with
// 413 FUNCTION_PAYLOAD_TOO_LARGE before the API sees it (production probes, 2026-11-19). No trace
// ties the tester's own attempt to this response. The local API has no such cap, so a route
// answers every /api/v1 PUT the way production does.
//
// G-5, a separate camera-path case: Snap Photo drew the camera frame into a PNG, so even with
// cleanup off the camera path uploaded lossless bytes. The fix stores a JPEG straight in
// storage, and G-5 holds it there.
import path from 'node:path'
import {
  garmentListResponseSchema,
  signupResponseSchema,
} from '@couture/api-client/contracts/http'
import { expect, test } from '../support/fixtures/merged-fixtures'
import { resolveEnvironmentConfig } from '../config/environments'
import { waitForAccessibilityReady } from '../support/helpers/accessibility'
import { buildUniqueId, isNonLocalEnvironment } from '../support/helpers/api-test'
import { cleanupWardrobeUserTestData } from '../support/helpers/user-test-data'
import { localE2EAccessToken } from '../support/helpers/local-e2e-token'
import { writePhoneCameraPhoto } from '../support/helpers/phone-camera-photo'
import {
  vercelFunctionBodyLimit,
  watchPuts,
} from '../support/helpers/vercel-function-body-limit'
import { expectSignedStorageUpload } from '../support/helpers/storage-upload-url'

const environment = resolveEnvironmentConfig('local')
const garmentFixturePath = path.resolve(
  __dirname,
  '../../apps/api/test/fixtures/garment-tagging/neutral-top.png'
)
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
    'G-1: Use This Image puts the bytes at the signed storage URL the API hands out',
    async ({ cleanupState, interceptNetworkCall, page }) => {
      const allocation = interceptNetworkCall({
        method: 'POST',
        url: '**/api/v1/wardrobe/upload-url',
      })
      const uploads = watchPuts(page)

      await page.goto('/wardrobe')
      await waitForAccessibilityReady(page)
      await page.getByRole('button', { name: '+ Add Garment' }).click()
      await page.getByLabel('Garment image file').setInputFiles(garmentFixturePath)
      await page.getByRole('button', { name: 'Use This Image' }).click()

      const { status, responseJson } = await allocation
      expect(status).toBe(201)
      const { uploadUrl, uploadSessionId } = (
        responseJson as { data: { uploadUrl: string; uploadSessionId: string } }
      ).data
      await expect(page.getByText('Garment Upload Complete!')).toBeVisible()
      await expect(page.getByText('Failed to fetch')).toHaveCount(0)

      // The one PUT is the signed URL exactly as given: this member's garment staging key in
      // the wardrobe bucket (commit publishes the verified bytes to the member's folder).
      expect(uploads).toEqual([uploadUrl])
      expect(new URL(uploadUrl).pathname).toMatch(
        new RegExp(
          `^/storage/v1/object/upload/sign/wardrobe-images/staging/${cleanupState.userId}/garment/${uploadSessionId}\\.(jpg|jpeg|png|webp)$`
        )
      )
      // On the configured storage host, not merely somewhere other than the API or web.
      expectSignedStorageUpload(uploadUrl)
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

  phoneTest(
    'G-4: a full-size phone camera photo uploads with the default crop and cleanup',
    async ({ apiRequest, cleanupState, interceptNetworkCall, page }, testInfo) => {
      const photoPath = testInfo.outputPath('phone-camera-photo.jpg')
      const photoBytes = await writePhoneCameraPhoto(photoPath)
      // A file the picker accepts: under the 10 MiB cap, and the size class of a real phone photo.
      expect(photoBytes).toBeGreaterThan(1_500_000)
      expect(photoBytes).toBeLessThan(10 * 1024 * 1024)

      void interceptNetworkCall({
        method: 'PUT',
        url: '**/api/v1/**',
        handler: vercelFunctionBodyLimit(),
      })
      const allocation = interceptNetworkCall({
        method: 'POST',
        url: '**/api/v1/wardrobe/upload-url',
      })
      const uploads = watchPuts(page)

      await page.goto('/wardrobe')
      await waitForAccessibilityReady(page)
      await page.getByRole('button', { name: '+ Add Garment' }).click()
      await page.getByLabel('Garment image file').setInputFiles(photoPath)
      // The tester kept the defaults.
      await expect(
        page.getByRole('switch', { name: 'Auto Background Cleanup' })
      ).toBeChecked()
      await page.getByRole('button', { name: 'Use This Image' }).click()

      await expect(page.getByText('Garment Upload Complete!')).toBeVisible({
        timeout: 30_000,
      })
      await expect(
        page.getByText(/Upload failed|FUNCTION_PAYLOAD_TOO_LARGE/)
      ).toHaveCount(0)
      // The large photo went to the signed storage URL and nowhere else.
      const { responseJson } = await allocation
      const { uploadUrl } = (responseJson as { data: { uploadUrl: string } }).data
      expectSignedStorageUpload(uploadUrl)
      expect(uploads).toEqual([uploadUrl])

      const garments = await apiRequest({
        method: 'GET',
        path: '/api/v1/wardrobe/garments',
        baseUrl: environment.apiBaseUrl,
        headers: { Authorization: `Bearer ${cleanupState.accessToken}` },
      })
      expect(garments.status).toBe(200)
      const listed = garmentListResponseSchema.parse(garments.body).data
      expect(listed).toHaveLength(1)

      // The tester's Wardrobe Hub card printed the raw garment id; a member sees no ids.
      await page.getByRole('button', { name: 'Close capture modal' }).click()
      await expect(page.getByRole('dialog')).toHaveCount(0)
      const card = page.getByTestId(`garment-card-${listed[0]!.id}`)
      await expect(card).toBeVisible()
      // For review: the card as the phone shows it.
      await card.screenshot({ path: testInfo.outputPath('garment-card.png') })
      await testInfo.attach('garment card', {
        path: testInfo.outputPath('garment-card.png'),
        contentType: 'image/png',
      })
      await expect(card).not.toContainText(listed[0]!.id)
      await expect(card).not.toContainText(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
      )
    }
  )

  phoneTest(
    'G-5: Snap Photo with cleanup off stores a JPEG straight in storage',
    async ({ interceptNetworkCall, page }) => {
      // A grainy 1080x1920 portrait stream, the size a phone camera streams when asked for HD.
      await page.addInitScript(() => {
        const width = 1080
        const height = 1920
        const still = document.createElement('canvas')
        still.width = width
        still.height = height
        const stillContext = still.getContext('2d')!
        const pixels = stillContext.createImageData(width, height)
        let seed = 7
        for (let offset = 0; offset < pixels.data.length; offset += 4) {
          const inGarment =
            (offset / 4) % width > width * 0.25 && (offset / 4) % width < width * 0.75
          const base = inGarment ? [70, 90, 140] : [225, 215, 195]
          for (let channel = 0; channel < 3; channel++) {
            seed = (seed * 1103515245 + 12345) & 0x7fffffff
            pixels.data[offset + channel] = base[channel]! + ((seed >> 16) % 17) - 8
          }
          pixels.data[offset + 3] = 255
        }
        stillContext.putImageData(pixels, 0, 0)
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const context = canvas.getContext('2d')!
        const paint = () => context.drawImage(still, 0, 0)
        paint()
        const stream = canvas.captureStream(15)
        setInterval(paint, 66)
        Object.defineProperty(navigator, 'mediaDevices', {
          configurable: true,
          value: { getUserMedia: () => Promise.resolve(stream) },
        })
      })
      const allocation = interceptNetworkCall({
        method: 'POST',
        url: '**/api/v1/wardrobe/upload-url',
      })
      const uploads: { url: string; contentType: string; bytes: number }[] = []
      page.on('request', (request) => {
        if (request.method() !== 'PUT') return
        uploads.push({
          url: request.url(),
          contentType: request.headers()['content-type'] ?? '',
          bytes: request.postDataBuffer()?.byteLength ?? 0,
        })
      })

      await page.goto('/wardrobe')
      await waitForAccessibilityReady(page)
      await page.getByRole('button', { name: '+ Add Garment' }).click()
      await page.getByRole('button', { name: 'Take Photo' }).click()
      const video = page.getByRole('dialog').locator('video')
      await expect
        .poll(() => video.evaluate((element: HTMLVideoElement) => element.videoHeight))
        .toBe(1920)
      await page.getByRole('button', { name: 'Snap Photo' }).click()
      const cleanup = page.getByRole('switch', { name: 'Auto Background Cleanup' })
      await cleanup.click()
      await expect(cleanup).not.toBeChecked()
      await page.getByRole('button', { name: 'Use This Image' }).click()

      await expect(page.getByText('Garment Upload Complete!')).toBeVisible({
        timeout: 30_000,
      })
      // One PUT, to the signed storage URL, carrying a JPEG.
      const { responseJson } = await allocation
      const { uploadUrl } = (responseJson as { data: { uploadUrl: string } }).data
      expectSignedStorageUpload(uploadUrl)
      expect(uploads.map(({ url }) => url)).toEqual([uploadUrl])
      expect(uploads[0]!.contentType).toBe('image/jpeg')
      expect(uploads[0]!.bytes).toBeGreaterThan(0)
      expect(uploads[0]!.bytes).toBeLessThan(1_500_000)
    }
  )
})
