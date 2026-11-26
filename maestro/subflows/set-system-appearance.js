// Story CC-7.9 (TEA, 7.9-NVIS): asks the runner to change the Android system appearance while
// the app stays open. See scripts/lib/device-appearance-endpoint.mjs.
// APPEARANCE_ROUTE is 'night' (APPEARANCE_VALUE 'yes' or 'no') or 'status-bar' ('true' or 'false').
if (!MAESTRO_APPEARANCE_URL)
  throw new Error(
    'MAESTRO_APPEARANCE_URL is empty: the appearance endpoint runs on Android only'
  )
const route = APPEARANCE_ROUTE
const body =
  route === 'night'
    ? { device: MAESTRO_DEVICE_UDID, mode: APPEARANCE_VALUE }
    : { device: MAESTRO_DEVICE_UDID, demo: APPEARANCE_VALUE === 'true' }
const response = http.post(MAESTRO_APPEARANCE_URL + '/' + route, {
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})
if (response.status !== 200)
  throw new Error(
    'Appearance endpoint answered ' + response.status + ': ' + response.body
  )
