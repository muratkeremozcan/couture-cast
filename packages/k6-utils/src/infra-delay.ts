// Measures baseline network latency via a healthcheck endpoint.
// Subtract the result from SLA calculations to isolate application processing time
// from infrastructure overhead (DNS, TLS, proxy hops).

import http from 'k6/http'

/**
 * Pings a healthcheck URL multiple times and returns the median response duration in ms.
 * Returns -1 if all requests fail (indicates infrastructure is unreachable).
 * @param healthUrl - A fast, lightweight endpoint (e.g. `/health`, `/ping`)
 * @param samples - Number of requests to send (default 5)
 * @returns median response time in ms, or -1 if all requests failed
 */
export function measureInfraDelay(healthUrl: string, samples = 5): number {
  const durations: number[] = []
  for (let i = 0; i < samples; i++) {
    const res = http.get(healthUrl, { tags: { name: 'infra_delay' } })
    if (res.status === 200) {
      durations.push(res.timings.duration)
    }
  }
  if (durations.length === 0) {
    console.warn(`measureInfraDelay: all ${samples} requests to ${healthUrl} failed`)
    return -1
  }
  durations.sort((a, b) => a - b)
  const mid = Math.floor(durations.length / 2)
  return durations.length % 2 === 1
    ? durations[mid]!
    : (durations[mid - 1]! + durations[mid]!) / 2
}
