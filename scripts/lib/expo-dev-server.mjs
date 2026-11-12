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
 * Resolves once the dev server at `base` reports Metro running; rejects at `timeoutMs`,
 * one deadline over every attempt. A request that errors, a response that is cut off and a
 * server that never answers all end their attempt, and the deadline ends the wait with
 * its timer, retry and request cleaned up.
 * @param {string} base
 * @param {number} [timeoutMs]
 * @param {number} [intervalMs]
 */
export function waitForExpoStatus(base, timeoutMs = 120_000, intervalMs = 2_000) {
  const url = new URL(expoStatusUrl(base))
  return new Promise((resolve, reject) => {
    let settled = false
    let retryTimer
    let request
    let lastReason = 'no answer'
    const finish = (error) => {
      if (settled) return
      settled = true
      clearTimeout(deadline)
      clearTimeout(retryTimer)
      request?.destroy()
      if (error) reject(error)
      else resolve()
    }
    const deadline = setTimeout(
      () =>
        finish(
          new Error(
            `Expo dev server at ${base} not running before ${timeoutMs} ms: ${lastReason}`
          )
        ),
      timeoutMs
    )
    const attempt = () => {
      if (settled) return
      let over = false
      // Each attempt ends once: on Metro's answer, or on the first failure, which retries.
      const failed = (reason) => {
        if (over || settled) return
        over = true
        lastReason = reason
        request?.destroy()
        retryTimer = setTimeout(attempt, intervalMs)
      }
      request = httpRequest(url, (res) => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => (body += chunk))
        res.on('aborted', () => failed('response cut off'))
        res.on('error', (error) => failed(error.message))
        res.on('end', () => {
          if (over) return
          if (body.trim() === METRO_RUNNING) {
            over = true
            finish()
          } else failed(`HTTP ${res.statusCode} ${body.slice(0, 80)}`)
        })
      })
      // A server that accepts and never answers is cut per attempt too.
      request.setTimeout(Math.min(5_000, timeoutMs), () =>
        failed('status request timed out')
      )
      request.on('error', (error) => failed(error.message))
      request.end()
    }
    attempt()
  })
}
