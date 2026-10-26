import fs from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  assertTestDiskSpace,
  TEST_MINIMUM_FREE_BYTES,
  assertStory68DiskSpace,
  STORY68_NATIVE_MINIMUM_FREE_BYTES,
} from '../../../scripts/lib/test-disk-space.mjs'
afterEach(() => vi.restoreAllMocks())
describe('story-owned heavy test disk preflight', () => {
  it('fails one byte below20GiB before the heavyweight operation can run', () => {
    let entered = false
    expect(() => {
      assertTestDiskSpace('.', TEST_MINIMUM_FREE_BYTES - 1)
      entered = true
    }).toThrow('test_disk_space_below_20_gib')
    expect(entered).toBe(false)
  })
  it('accepts exactly20GiB and one byte above the boundary', () => {
    expect(assertTestDiskSpace('.', TEST_MINIMUM_FREE_BYTES)).toBe(20 * 1024 ** 3)
    expect(assertTestDiskSpace('.', TEST_MINIMUM_FREE_BYTES + 1)).toBe(
      TEST_MINIMUM_FREE_BYTES + 1
    )
  })
  it('uses the explicit Story68 native15GiB policy while retaining the generic20GiB floor', () => {
    expect(STORY68_NATIVE_MINIMUM_FREE_BYTES).toBe(15 * 1024 ** 3)
    expect(() =>
      assertStory68DiskSpace('.', STORY68_NATIVE_MINIMUM_FREE_BYTES - 1)
    ).toThrow('test_disk_space_below_15_gib')
    expect(assertStory68DiskSpace('.', STORY68_NATIVE_MINIMUM_FREE_BYTES)).toBe(
      STORY68_NATIVE_MINIMUM_FREE_BYTES
    )
    expect(() => assertTestDiskSpace('.', STORY68_NATIVE_MINIMUM_FREE_BYTES)).toThrow(
      'test_disk_space_below_20_gib'
    )
  })
  it('uses available blocks for the requested filesystem, excluding reserved free blocks', () => {
    const blockSize = 4096
    const availableBlocks = TEST_MINIMUM_FREE_BYTES / blockSize
    const stat = {
      type: 0,
      bsize: blockSize,
      blocks: availableBlocks * 4,
      bfree: availableBlocks * 2,
      bavail: availableBlocks - 1,
      files: 100,
      ffree: 50,
    }
    const filesystem = vi.spyOn(fs, 'statfsSync').mockReturnValue(stat)
    expect(() => assertTestDiskSpace('/owned-story-runtime')).toThrow(
      'test_disk_space_below_20_gib'
    )
    expect(filesystem).toHaveBeenCalledExactlyOnceWith('/owned-story-runtime')
    filesystem.mockReturnValue({ ...stat, bavail: availableBlocks })
    expect(assertTestDiskSpace('/owned-story-runtime')).toBe(availableBlocks * blockSize)
  })
})
