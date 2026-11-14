// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// expo-task-manager's own plugin, which Expo applies whenever the package is installed, adds the
// iOS `fetch` background mode for expo-background-fetch. The ritual task now runs through
// expo-background-task as `processing`, so `fetch` would declare a capability the app never uses.
const { withInfoPlist } = require('@expo/config-plugins')

function withoutFetchBackgroundMode(config) {
  return withInfoPlist(config, (next) => {
    const modes = next.modResults.UIBackgroundModes
    if (Array.isArray(modes)) {
      next.modResults.UIBackgroundModes = modes.filter((mode) => mode !== 'fetch')
    }
    return next
  })
}

module.exports = withoutFetchBackgroundMode
