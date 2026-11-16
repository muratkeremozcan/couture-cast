// Learning path Step 48: Safe branded share-card export.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-48-safe-branded-share-card-export
//
// The status bar the iOS accessibility audit (scripts/run-story68-native.mjs a11y) runs under.
// Apple's audit reads the screen's pixels, the system status bar included. With no cellular
// service the simulator draws four grey dots there, which Vision reads as text ("0o00" in shard
// 3's preparing screen of run 43773613293) and no app element carries, so the audit refused a
// "Potentially inaccessible text" issue with no element, in some runs and not others (Vision
// read the same dots as nothing on the run's other composer screens). The status bar belongs to
// the system, so the audit pins one with full bars and no dots, and clears it after.

/** What the pinned status bar shows. Active cellular with bars draws no searching dots. */
export const AUDIT_STATUS_BAR = Object.freeze({
  time: '9:41',
  dataNetwork: 'wifi',
  wifiMode: 'active',
  wifiBars: 3,
  cellularMode: 'active',
  cellularBars: 4,
  batteryState: 'charged',
  batteryLevel: 100,
})

function requireDevice(device) {
  // `booted` would pin whichever simulator happens to be booted, not the audit's own.
  if (typeof device !== 'string' || device === '' || device === 'booted')
    throw new Error(`story68_audit_status_bar_device_required:${String(device)}`)
  return device
}

/** `xcrun` arguments that pin AUDIT_STATUS_BAR on `device`. */
export function auditStatusBarOverrideArgs(device) {
  return [
    'simctl',
    'status_bar',
    requireDevice(device),
    'override',
    ...Object.entries(AUDIT_STATUS_BAR).flatMap(([name, value]) => [
      `--${name}`,
      String(value),
    ]),
  ]
}

/** `xcrun` arguments that put `device`'s own status bar back. */
export function auditStatusBarClearArgs(device) {
  return ['simctl', 'status_bar', requireDevice(device), 'clear']
}
