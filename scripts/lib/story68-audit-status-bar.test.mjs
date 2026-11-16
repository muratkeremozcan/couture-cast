// Learning path Step 48: Safe branded share-card export.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-48-safe-branded-share-card-export
//
// Shard 3, preparing (runs 43740466527, 43746880534, 43773613293): Apple's audit read the
// simulator's no-service cellular dots in the status bar as text ("0o00"), which no element of
// the app carries, and refused it as "Potentially inaccessible text" with no element. The audit
// runs under a pinned status bar: full cellular bars, no searching dots.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  AUDIT_STATUS_BAR,
  auditStatusBarClearArgs,
  auditStatusBarOverrideArgs,
} from './story68-audit-status-bar.mjs'

const DEVICE = '740B6B97-BE68-467C-B24C-13F660F3C9B8'

describe('the accessibility audit status bar', () => {
  test('pins active cellular bars, wifi, a charged battery and the clock', () => {
    assert.deepEqual(auditStatusBarOverrideArgs(DEVICE), [
      'simctl',
      'status_bar',
      DEVICE,
      'override',
      '--time',
      '9:41',
      '--dataNetwork',
      'wifi',
      '--wifiMode',
      'active',
      '--wifiBars',
      '3',
      '--cellularMode',
      'active',
      '--cellularBars',
      '4',
      '--batteryState',
      'charged',
      '--batteryLevel',
      '100',
    ])
  })

  test('never pins a cellular mode that draws the searching or no-service dots', () => {
    assert.equal(AUDIT_STATUS_BAR.cellularMode, 'active')
    assert.ok(AUDIT_STATUS_BAR.cellularBars > 0)
    assert.ok(Object.isFrozen(AUDIT_STATUS_BAR))
  })

  test('clears the override on the same device', () => {
    assert.deepEqual(auditStatusBarClearArgs(DEVICE), [
      'simctl',
      'status_bar',
      DEVICE,
      'clear',
    ])
  })

  test('refuses a missing device', () => {
    for (const device of ['', undefined, null, 'booted'])
      assert.throws(() => auditStatusBarOverrideArgs(device), {
        message: /^story68_audit_status_bar_device_required/,
      })
  })
})
