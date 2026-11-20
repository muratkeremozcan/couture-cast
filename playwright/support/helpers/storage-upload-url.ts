import { expect } from '@playwright/test'

/**
 * The storage origin this stack is configured with. Locally it is http://localhost:54321
 * (.env.local), so an upload URL that names a hard-coded loopback address such as 127.0.0.1
 * fails the checks below even though it reaches the same server. A phone resolves loopback to
 * itself.
 */
export function configuredStorageOrigin(): string {
  const configured = process.env.SUPABASE_URL?.trim()
  if (!configured) throw new Error('SUPABASE_URL is required to check upload URLs.')
  return new URL(configured).origin
}

/**
 * Asserts, independently of what the API allocated, that an upload URL is a signed upload on
 * the configured storage host, in the wardrobe images bucket, carrying its token. Garment, My
 * Form and palette selfie uploads all land in that bucket.
 */
export function expectSignedStorageUpload(uploadUrl: string): URL {
  const signed = new URL(uploadUrl)
  expect(signed.origin, 'storage origin').toBe(configuredStorageOrigin())
  expect(signed.pathname).toMatch(
    /^\/storage\/v1\/object\/upload\/sign\/wardrobe-images\//
  )
  expect(signed.searchParams.get('token')).toBeTruthy()
  return signed
}
