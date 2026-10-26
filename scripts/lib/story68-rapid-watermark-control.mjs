import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export function closedRapidWatermarkFailure(error) {
  const codes = [
    'rapid_watermark_hold_deadline',
    'native_rapid_watermark_flow_timeout',
    'native_rapid_watermark_flow_failed',
    'rapid_watermark_acquire_required',
    'rapid_watermark_release_required',
    'blocked_outfit_source_required',
    'rapid_watermark_prepare_503',
    'three_fresh_prepare_requests_required',
    'effective_owned_database_mismatch',
    'owned_uuid_loopback_database_required',
    'pinned_owned_native_runtime_required',
    'effective_owned_api_database_proof_required',
  ]
  return error instanceof Error && codes.includes(error.message)
    ? error.message
    : 'native_rapid_watermark_failed'
}

/** Remove the one-shot capability after the child has finished writing its owned artifacts. */
export function redactRapidWatermarkControl(directory, url) {
  const token = new URL(url).pathname.slice(1)
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) redactRapidWatermarkControl(file, url)
    else if (entry.isFile() && /\.(log|json|txt|html)$/.test(entry.name)) {
      const text = fs.readFileSync(file, 'utf8')
      const redacted = text
        .split(url)
        .join('[EPHEMERAL_CONTROL]')
        .split(token)
        .join('[EPHEMERAL_CONTROL]')
      if (text !== redacted) fs.writeFileSync(file, redacted)
    }
  }
}

/** A warmed host-side Maestro script owns exactly one acquisition and release. */
export async function withRapidWatermarkControl({ withLock, runFlow }) {
  const prefix = `/${randomUUID()}`
  const abort = new AbortController()
  let acquired = false
  let requested = false
  let released = false
  let lockRun
  let releaseHeld
  let failHeld
  let failure
  let result
  const fail = (error) => {
    failure ??= error
    abort.abort(failure)
    failHeld?.(failure)
  }
  const respond = (response, status) => {
    if (!response.headersSent) response.writeHead(status, { Connection: 'close' }).end()
  }
  const acquire = (response) => {
    requested = true
    lockRun = Promise.resolve().then(() =>
      withLock(async (signal) => {
        let stop
        const pending = new Promise((resolve, reject) => {
          releaseHeld = resolve
          failHeld = reject
          stop = () => reject(signal.reason)
          signal.addEventListener('abort', stop, { once: true })
          if (signal.aborted) stop()
        })
        acquired = true
        respond(response, 200)
        try {
          await pending
        } finally {
          signal.removeEventListener('abort', stop)
        }
      })
    )
    void lockRun.catch((error) => {
      fail(error)
      respond(response, 503)
    })
  }
  const handle = async (request, response) => {
    if (
      request.method !== 'POST' ||
      ![`${prefix}/acquire`, `${prefix}/release`].includes(request.url)
    )
      return respond(response, 404)
    if (request.url === `${prefix}/acquire`) {
      if (requested || failure) return respond(response, 409)
      acquire(response)
      return
    }
    if (!acquired || released || failure) return respond(response, 409)
    released = true
    releaseHeld()
    try {
      await lockRun
      respond(response, 200)
    } catch (error) {
      fail(error)
      respond(response, 503)
    }
  }
  const server = createServer((request, response) => {
    void handle(request, response).catch((error) => {
      fail(error)
      respond(response, 500)
    })
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  // This is the existing general Maestro flow timeout. The SQL hold has its own 12s clock.
  const timer = setTimeout(
    () => fail(new Error('native_rapid_watermark_flow_timeout')),
    120_000
  )
  try {
    await runFlow(
      { url: `http://127.0.0.1:${server.address().port}${prefix}` },
      abort.signal
    )
    if (failure) throw failure
    if (!acquired) throw new Error('rapid_watermark_acquire_required')
    if (!released) throw new Error('rapid_watermark_release_required')
    result = await lockRun
  } catch (error) {
    fail(error)
  } finally {
    clearTimeout(timer)
    if (failure) failHeld?.(failure)
    await Promise.allSettled([lockRun])
    await new Promise((resolve) => {
      server.close(resolve)
      server.closeAllConnections()
    })
  }
  if (failure) throw failure
  return result
}
