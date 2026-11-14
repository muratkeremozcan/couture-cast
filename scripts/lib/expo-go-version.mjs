// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// The one Expo Go release the Maestro lanes install and expect. Expo Go runs a single SDK, so its
// major must equal the app's `expo` major; scripts/lib/expo-go-version.test.mjs fails an SDK step
// that moves `expo` without moving this pin (story 6.15 TEA-05).
export const EXPO_GO_VERSION = '54.0.8'

export function expoGoApkUrl(version = EXPO_GO_VERSION) {
  return `https://github.com/expo/expo-go-releases/releases/download/Expo-Go-${version}/Expo-Go-${version}.apk`
}
