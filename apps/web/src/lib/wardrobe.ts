'use client'

import {
  createGarmentItemResponseSchema,
  createGarmentUploadUrlResponseSchema,
  garmentListResponseSchema,
  uploadGarmentBytes,
  type GarmentItemContract,
} from '@couture/api-client/contracts/http'
import { resolveWebApiBaseUrl } from './api-client'

export const WEB_ACCESS_TOKEN_STORAGE_KEY = 'couturecast.access-token'

export type GarmentUploadState =
  | 'preparing'
  | 'requesting_upload'
  | 'uploading'
  | 'verifying'
  | 'processing'

export interface UploadGarmentImageInput {
  imagePreview: string
  aspectRatio: '1:1' | '4:3'
  useBgCleanup: boolean
  signal?: AbortSignal
  onStateChange?: (state: GarmentUploadState) => void
  onProgress?: (percentage: number) => void
}

type PreparedImage = {
  blob: Blob
  heightPx: number
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp'
  sha256: string
  widthPx: number
}

function readAccessToken(): string {
  const token = window.sessionStorage.getItem(WEB_ACCESS_TOKEN_STORAGE_KEY)?.trim()
  if (!token) {
    throw new Error('Your session expired. Sign in again before adding a garment.')
  }
  return token
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('The selected image could not be decoded.'))
    image.src = source
  })
}

function toBlob(canvas: HTMLCanvasElement, mimeType: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob)
          return
        }
        reject(new Error('The selected image could not be prepared.'))
      },
      mimeType,
      0.92
    )
  })
}

function removeCornerMatchedBackground(context: CanvasRenderingContext2D): void {
  const { width, height } = context.canvas
  const pixels = context.getImageData(0, 0, width, height)
  const corners = [
    0,
    (width - 1) * 4,
    (height - 1) * width * 4,
    ((height - 1) * width + width - 1) * 4,
  ]
  const background = corners.reduce(
    (color, offset) => {
      color.red += pixels.data[offset] ?? 0
      color.green += pixels.data[offset + 1] ?? 0
      color.blue += pixels.data[offset + 2] ?? 0
      return color
    },
    { red: 0, green: 0, blue: 0 }
  )
  background.red /= corners.length
  background.green /= corners.length
  background.blue /= corners.length

  for (let offset = 0; offset < pixels.data.length; offset += 4) {
    const red = (pixels.data[offset] ?? 0) - background.red
    const green = (pixels.data[offset + 1] ?? 0) - background.green
    const blue = (pixels.data[offset + 2] ?? 0) - background.blue
    const distance = Math.sqrt(red * red + green * green + blue * blue)
    if (distance <= 28) {
      pixels.data[offset + 3] = 0
    } else if (distance < 72) {
      pixels.data[offset + 3] = Math.round(((distance - 28) / 44) * 255)
    }
  }
  context.putImageData(pixels, 0, 0)
}

async function prepareGarmentImage(
  imagePreview: string,
  aspectRatio: '1:1' | '4:3',
  useBgCleanup: boolean
): Promise<PreparedImage> {
  const [image, sourceBlob] = await Promise.all([
    loadImage(imagePreview),
    fetch(imagePreview).then((response) => response.blob()),
  ])
  const sourceWidth = image.naturalWidth
  const sourceHeight = image.naturalHeight
  const targetRatio = aspectRatio === '1:1' ? 1 : 3 / 4
  const sourceRatio = sourceWidth / sourceHeight
  const cropWidth = sourceRatio > targetRatio ? sourceHeight * targetRatio : sourceWidth
  const cropHeight = sourceRatio > targetRatio ? sourceHeight : sourceWidth / targetRatio
  const scale = Math.min(1, 2048 / Math.max(cropWidth, cropHeight))
  const outputWidth = Math.round(cropWidth * scale)
  const outputHeight = Math.round(cropHeight * scale)
  if (outputWidth < 256 || outputHeight < 256) {
    throw new Error('Choose an image at least 256 pixels wide and tall.')
  }

  const canvas = document.createElement('canvas')
  canvas.width = outputWidth
  canvas.height = outputHeight
  const context = canvas.getContext('2d', { willReadFrequently: useBgCleanup })
  if (!context) {
    throw new Error('Image preparation is unavailable in this browser.')
  }
  context.drawImage(
    image,
    (sourceWidth - cropWidth) / 2,
    (sourceHeight - cropHeight) / 2,
    cropWidth,
    cropHeight,
    0,
    0,
    outputWidth,
    outputHeight
  )
  if (useBgCleanup) {
    removeCornerMatchedBackground(context)
  }

  const requestedMimeType = useBgCleanup ? 'image/png' : sourceBlob.type
  const blob = await toBlob(canvas, requestedMimeType)
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(blob.type)) {
    throw new Error('The prepared image format is unsupported.')
  }
  if (blob.size > 10 * 1024 * 1024) {
    throw new Error('The prepared image exceeds the 10 MiB limit.')
  }
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  const sha256 = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('')

  return {
    blob,
    widthPx: outputWidth,
    heightPx: outputHeight,
    mimeType: blob.type as PreparedImage['mimeType'],
    sha256,
  }
}

async function readError(response: Response): Promise<Error> {
  try {
    const payload = (await response.json()) as {
      error?: { message?: string }
      message?: string
    }
    return new Error(
      payload.error?.message ??
        payload.message ??
        `Wardrobe request failed with status ${response.status}`
    )
  } catch {
    return new Error(`Wardrobe request failed with status ${response.status}`)
  }
}

function authHeaders(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` }
}

export async function uploadGarmentImageFromWeb({
  imagePreview,
  aspectRatio,
  useBgCleanup,
  signal,
  onStateChange,
  onProgress,
}: UploadGarmentImageInput): Promise<GarmentItemContract> {
  const accessToken = readAccessToken()
  onStateChange?.('preparing')
  onProgress?.(10)
  const image = await prepareGarmentImage(imagePreview, aspectRatio, useBgCleanup)

  onStateChange?.('requesting_upload')
  onProgress?.(25)
  const allocationResponse = await fetch(
    `${resolveWebApiBaseUrl()}/api/v1/wardrobe/upload-url`,
    {
      method: 'POST',
      credentials: 'include',
      headers: {
        ...authHeaders(accessToken),
        'Content-Type': 'application/json',
        'Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify({
        fileSizeBytes: image.blob.size,
        mimeType: image.mimeType,
        sha256: image.sha256,
        widthPx: image.widthPx,
        heightPx: image.heightPx,
      }),
      signal,
    }
  )
  if (!allocationResponse.ok) {
    throw await readError(allocationResponse)
  }
  const allocation = createGarmentUploadUrlResponseSchema.parse(
    await allocationResponse.json()
  ).data

  onStateChange?.('uploading')
  onProgress?.(35)
  await uploadGarmentBytes({
    uploadUrl: allocation.uploadUrl,
    uploadToken: allocation.uploadToken,
    bearerToken: accessToken,
    mimeType: image.mimeType,
    body: image.blob,
    signal,
    timeoutMs: 30_000,
    onProgress: () => onProgress?.(80),
  })

  onStateChange?.('verifying')
  onProgress?.(90)
  const commitResponse = await fetch(
    `${resolveWebApiBaseUrl()}/api/v1/wardrobe/garments`,
    {
      method: 'POST',
      credentials: 'include',
      headers: {
        ...authHeaders(accessToken),
        'Content-Type': 'application/json',
        'Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify({
        garmentId: allocation.garmentId,
        uploadSessionId: allocation.uploadSessionId,
        hasCropping: true,
        hasBgCleanup: useBgCleanup,
      }),
      signal,
    }
  )
  if (!commitResponse.ok) {
    throw await readError(commitResponse)
  }
  const garment = createGarmentItemResponseSchema.parse(await commitResponse.json()).data
  onStateChange?.('processing')
  onProgress?.(100)
  return garment
}

export async function listGarmentsFromWeb(
  signal?: AbortSignal
): Promise<GarmentItemContract[]> {
  const accessToken = readAccessToken()
  const response = await fetch(`${resolveWebApiBaseUrl()}/api/v1/wardrobe/garments`, {
    credentials: 'include',
    headers: authHeaders(accessToken),
    signal,
  })
  if (!response.ok) {
    throw await readError(response)
  }
  return garmentListResponseSchema.parse(await response.json()).data
}
