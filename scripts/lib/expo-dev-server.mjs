// Whether an Expo dev server is up, asked the way that costs it nothing. With
// apps/mobile/app.json's web.output "static", a request for `/` makes the server render the
// web page first: it bundles expo-router's render.js and the web entry (about 25 s in a
// cold mobile e2e shard) before it answers, and the Android suite needs neither. Metro's
// `/status` answers `packager-status:running` at once.
import { request as httpRequest } from 'node:http'

export const METRO_RUNNING = 'packager-status:running'

/** The status endpoint of the dev server at `base` (an origin like http://127.0.0.1:8081). */
export const expoStatusUrl = (base) => new URL('/status', base).href

/**
 * Resolves once the dev server at `base` reports Metro running; rejects after `timeoutMs`.
 * @param {string} base
 * @param {number} [timeoutMs]
 * @param {number} [intervalMs]
 */
export function waitForExpoStatus(base, timeoutMs = 120_000, intervalMs = 2_000) {
  const url = new URL(expoStatusUrl(base))
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve, reject) => {
    const retry = (reason) => {
      if (Date.now() > deadline)
        reject(
          new Error(
            `Expo dev server at ${base} not running before ${timeoutMs} ms: ${reason}`
          )
        )
      else setTimeout(attempt, intervalMs)
    }
    const attempt = () => {
      const req = httpRequest(url, { timeout: 5_000 }, (res) => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => (body += chunk))
        res.on('end', () =>
          body.trim() === METRO_RUNNING
            ? resolve()
            : retry(`HTTP ${res.statusCode} ${body.slice(0, 80)}`)
        )
      })
      req.on('timeout', () => req.destroy(new Error('status request timed out')))
      req.on('error', (error) => retry(error.message))
      req.end()
    }
    attempt()
  })
}
