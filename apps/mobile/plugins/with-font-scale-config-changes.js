// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// Android recreates MainActivity on a system font change unless the Activity declares it
// handles `fontScale` (TEA-15). A recreated Activity remounts the React root, so the text it
// shows was measured afresh and cannot show whether live layout follows the new scale. With
// `fontScale` declared, the Activity stays and React Native relayouts the surviving tree.
// List it first in app.json: Expo runs manifest mods in reverse order, so it then runs after
// expo-localization's and the token is appended after `locale|layoutDirection`.
const { withAndroidManifest } = require('@expo/config-plugins')

function withFontScaleConfigChanges(config) {
  return withAndroidManifest(config, (next) => {
    const application = next.modResults.manifest.application?.[0]
    const activity = application?.activity?.find(
      (entry) => entry.$['android:name'] === '.MainActivity'
    )
    if (!activity)
      throw new Error('with-font-scale-config-changes: MainActivity not found')
    const values = (activity.$['android:configChanges'] ?? '').split('|').filter(Boolean)
    if (!values.includes('fontScale')) values.push('fontScale')
    activity.$['android:configChanges'] = values.join('|')
    return next
  })
}

module.exports = withFontScaleConfigChanges
