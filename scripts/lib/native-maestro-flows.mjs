import fs from 'node:fs'
import path from 'node:path'

// These flows require rebuilt native modules, genuine Auth, and original OS resource proof.
export const NATIVE_MAESTRO_FLOWS = new Set(['share-card-export.yaml'])

/**
 * Root flows the generic Maestro runner may run, sorted. `subflows/` and the story
 * folders are fragments reached through `runFlow`, and native-only flows belong to
 * their own harness.
 */
export const discoverRunnableMaestroFlows = (projectRoot) =>
  fs
    .readdirSync(path.join(projectRoot, 'maestro'), { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.ya?ml$/.test(entry.name))
    .filter((entry) => !NATIVE_MAESTRO_FLOWS.has(entry.name))
    .map((entry) => `maestro/${entry.name}`)
    .sort()

/** An explicit request for a native-only flow is a misroute, never a silent skip. */
export const assertGenericMaestroFlows = (flows) => {
  if (flows.some((flow) => NATIVE_MAESTRO_FLOWS.has(path.basename(flow))))
    throw new Error(
      'Use scripts/run-story68-native.mjs for share-card-export.yaml. It requires a rebuilt client and actual OS resource inspection.'
    )
}
