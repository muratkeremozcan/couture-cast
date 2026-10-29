import type {
  HoldoutFreezeManifest,
  HoldoutSealIdentity,
} from './community-text-holdout-eligibility-core.mjs'

export function loadActiveHoldouts(corpusDir: string): {
  holdouts: Record<string, { version: string; seal: HoldoutSealIdentity }>
  manifests: Map<string, HoldoutFreezeManifest>
}

export function describeCleanGates(
  holdouts: Record<string, { version: string; seal: HoldoutSealIdentity }>
): {
  cleanGatedOn: Record<string, string>
  cleanSeals: Record<string, string>
}

export function assertVersionDirectorySealed(
  corpusDir: string,
  version: string,
  manifest: HoldoutFreezeManifest
): void
