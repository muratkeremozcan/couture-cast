// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// Story 6.15 (Antigravity r22, r24): the one check for a spawn bound, shared by the Test Store
// driver and the evidence manifest. A bound is a positive safe integer of milliseconds, given as
// a number or the text of one; 0 would turn the bound off and text such as `abc` would reach
// spawnSync as NaN. Anything else throws an error whose code the caller names.

export function boundOf(value, code = 'spawn_timeout_invalid') {
  const ms = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  if (typeof ms !== 'number' || !Number.isSafeInteger(ms) || ms <= 0)
    throw Object.assign(new Error(`${code}: ${String(value)}`), { code })
  return ms
}
