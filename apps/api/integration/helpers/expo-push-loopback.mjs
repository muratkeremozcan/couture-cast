// Test-only preload for the SLA drill child process (moderation-sla-operations.spec.ts, I-W-DRILL-PUSH).
// The drill's push channel always posts to Expo. This sends Expo's two push routes to the loopback
// receiver named by TEA_EXPO_LOOPBACK_URL instead, so the real script's real request reaches a real
// socket. Every other destination is refused, so nothing in a test run leaves the machine.
const loopback = process.env.TEA_EXPO_LOOPBACK_URL
const realFetch = globalThis.fetch
const EXPO_ROUTES = new Set([
  'https://exp.host/--/api/v2/push/send',
  'https://exp.host/--/api/v2/push/getReceipts',
])

globalThis.fetch = (input, init) => {
  const url =
    typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (loopback && EXPO_ROUTES.has(url))
    return realFetch(`${loopback}${new URL(url).pathname}`, init)
  return Promise.reject(new TypeError(`tea: unexpected fetch ${url}`))
}
