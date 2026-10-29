#!/usr/bin/env node
/**
 * Builds the dev client's JavaScript bundle on the owned Metro before the first
 * native flow opens the app.
 *
 * Metro answers as soon as it listens, long before it can serve a bundle. On
 * the iOS lane the first flow taps "Open" and then waits for the dev client to
 * load the app, so a cold bundle build lands inside that flow's 120 s Maestro
 * budget (CI run 40640663514: the flow waited on the dev menu while Metro had
 * served no bundle). Asking for the exact bundle the dev client asks for moves
 * the build ahead of the flow: the response arrives only once it is built, and
 * Metro then serves the app's own request from its warm graph.
 *
 *   node scripts/e2e-share-card/warm-metro.mjs --platform ios [--url http://127.0.0.1:8089]
 */
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const PLATFORMS = ['android', 'ios']

/**
 * The bundle URL in a dev-client manifest response, else the default entry
 * bundle, which is the app's `main` (expo-router/entry).
 *
 * @param {string} body
 * @param {string} baseUrl
 * @param {'android' | 'ios'} platform
 */
export function bundleUrlFromManifest(body, baseUrl, platform) {
  const fallback = new URL('/node_modules/expo-router/entry.bundle', baseUrl)
  fallback.search = new URLSearchParams({
    platform,
    dev: 'true',
    hot: 'false',
  }).toString()
  // A multipart answer carries the manifest as one JSON part.
  const json = body.slice(body.indexOf('{'), body.lastIndexOf('}') + 1)
  try {
    const url = JSON.parse(json)?.launchAsset?.url
    if (typeof url === 'string' && new URL(url).origin === new URL(baseUrl).origin)
      return { url, source: 'manifest' }
  } catch {
    // Not a manifest: the fallback entry bundle is requested instead.
  }
  return { url: fallback.toString(), source: 'entry' }
}

/**
 * @param {{ baseUrl: string, platform: 'android' | 'ios', timeoutMs?: number, fetch?: typeof fetch }} options
 */
export async function warmMetro({
  baseUrl,
  platform,
  timeoutMs = 600_000,
  fetch: get = fetch,
}) {
  if (!PLATFORMS.includes(platform)) throw new Error('warm_metro_platform_required')
  const started = Date.now()
  const manifest = await get(baseUrl, {
    headers: {
      'expo-platform': platform,
      accept: 'application/expo+json, application/json',
    },
    signal: AbortSignal.timeout(60_000),
  })
  const { url, source } = bundleUrlFromManifest(await manifest.text(), baseUrl, platform)
  // Lazy bundling would leave dynamic imports to build during a flow (see story68-metro-env).
  const lazy = new URL(url).searchParams.get('lazy')
  if (lazy === 'true') throw new Error('metro_bundle_still_lazy')
  const bundle = await get(url, { signal: AbortSignal.timeout(timeoutMs) })
  // Metro counts the build as served only once the body is drained.
  const bytes = (await bundle.arrayBuffer()).byteLength
  if (!bundle.ok || bytes === 0)
    throw new Error(`metro_bundle_unavailable:${bundle.status}`)
  return { source, lazy, bytes, seconds: Math.round((Date.now() - started) / 100) / 10 }
}

if (
  process.argv[1] &&
  fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2)
  const option = (name, fallback) => {
    const at = args.indexOf(`--${name}`)
    return at === -1 ? fallback : args[at + 1]
  }
  const result = await warmMetro({
    baseUrl: option('url', 'http://127.0.0.1:8089'),
    platform: /** @type {'android' | 'ios'} */ (option('platform', '')),
  })
  console.log(JSON.stringify({ metroWarm: result }))
}
