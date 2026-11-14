// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// Antigravity r30 item 3: the live font-scale proof changes the device (its timezone, its font
// scale, the simulator status bar) and must put each one back however the run ends. Each restore
// step runs on its own: one that throws is recorded and the next still runs, and the report is
// written after them with the errors in it. SIGINT and SIGTERM run the same steps once, then exit
// with 130 or 143; a second signal while they run is ignored (the model is installEvidenceGuard in
// scripts/lib/test-store-output.mjs).

/**
 * Installs the guard on `proc` (process by default) and returns:
 *   step(name, run)     adds a restore step; steps run in the order added, each at most once
 *   restore()           runs every step not yet run and returns every error so far
 *   finish(writeReport) restores, calls writeReport(errors) and removes the signal handlers
 *   uninstall()         removes the signal handlers
 * An error is { step, error } with the thrown message.
 */
export function installRestoreGuard({ proc = process } = {}) {
  const steps = []
  const errors = []
  let exiting = false
  const restore = () => {
    for (const step of steps) {
      if (step.done) continue
      step.done = true
      try {
        step.run()
      } catch (error) {
        errors.push({ step: step.name, error: error?.message ?? String(error) })
      }
    }
    return [...errors]
  }
  const onSignal = (code) => () => {
    // A repeat signal while the restores run is ignored; the first one decided the code.
    if (exiting) return
    exiting = true
    for (const { step, error } of restore())
      proc.stderr.write(`live_font_restore_failed: ${step}: ${error}\n`)
    proc.exit(code)
  }
  const onSigint = onSignal(130)
  const onSigterm = onSignal(143)
  proc.on('SIGINT', onSigint)
  proc.on('SIGTERM', onSigterm)
  const uninstall = () => {
    proc.removeListener('SIGINT', onSigint)
    proc.removeListener('SIGTERM', onSigterm)
  }
  return {
    step: (name, run) => {
      steps.push({ name, run, done: false })
    },
    restore,
    finish: (writeReport) => {
      try {
        const restoreErrors = restore()
        writeReport(restoreErrors)
        return restoreErrors
      } finally {
        uninstall()
      }
    },
    uninstall,
  }
}
