import fs from 'node:fs'
export const TEST_MINIMUM_FREE_BYTES = 20 * 1024 ** 3
export const STORY68_NATIVE_MINIMUM_FREE_BYTES = 15 * 1024 ** 3
/** Fail before creating expensive story-owned build, emulator or flow-copy output. */
export function assertTestDiskSpace(
  directory,
  availableBytes,
  minimumBytes = TEST_MINIMUM_FREE_BYTES
) {
  const available =
    availableBytes ??
    (() => {
      const stats = fs.statfsSync(directory)
      return stats.bavail * stats.bsize
    })()
  if (available < minimumBytes)
    throw new Error(
      `test_disk_space_below_${minimumBytes / 1024 ** 3}_gib: prune_only_recorded_story_owned_outputs`
    )
  return available
}

export function assertStory68DiskSpace(directory, availableBytes) {
  return assertTestDiskSpace(directory, availableBytes, STORY68_NATIVE_MINIMUM_FREE_BYTES)
}
