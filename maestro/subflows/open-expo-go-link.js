// Story 1.2b R24 owner: ask the runner to open LINK in Expo Go over adb with
// the developer-menu onboarding off. See scripts/lib/expo-go-link-endpoint.mjs.
const response = http.post(MAESTRO_EXPO_GO_OPEN_URL, {
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ device: MAESTRO_DEVICE_UDID, url: LINK }),
})
if (response.status !== 200)
  throw new Error(`Expo Go link endpoint answered ${response.status}: ${response.body}`)
