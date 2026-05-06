import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MobileAnalyticsRecordedEvent } from './mobile-analytics-diagnostics.js'

const originalDiagnosticsEnv = process.env.MOBILE_ANALYTICS_DIAGNOSTICS
const originalExpoDiagnosticsEnv = process.env.EXPO_PUBLIC_MOBILE_ANALYTICS_DIAGNOSTICS

afterEach(() => {
  vi.resetModules()
  process.env.MOBILE_ANALYTICS_DIAGNOSTICS = originalDiagnosticsEnv
  process.env.EXPO_PUBLIC_MOBILE_ANALYTICS_DIAGNOSTICS = originalExpoDiagnosticsEnv
})

describe('mobile analytics diagnostics recorder', () => {
  it('records and publishes events when diagnostics are enabled', async () => {
    process.env.MOBILE_ANALYTICS_DIAGNOSTICS = '1'
    const diagnostics = await import('./mobile-analytics-diagnostics.js')
    const snapshots: MobileAnalyticsRecordedEvent[][] = []
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => undefined)

    const unsubscribe = diagnostics.subscribeMobileAnalyticsEvents((records) => {
      snapshots.push(records.slice())
    })

    diagnostics.recordMobileAnalyticsEvent('ritual_created', { source: 'test' })

    expect(diagnostics.getMobileAnalyticsRecordedEvents()).toEqual([
      expect.objectContaining({
        event: 'ritual_created',
        properties: { source: 'test' },
      }),
    ])
    expect(snapshots[snapshots.length - 1]).toEqual([
      expect.objectContaining({
        event: 'ritual_created',
      }),
    ])
    expect(consoleInfo).toHaveBeenCalledWith(
      expect.stringContaining('"event":"ritual_created"')
    )

    unsubscribe()
    consoleInfo.mockRestore()
  })

  it('does not record events when diagnostics are disabled', async () => {
    delete process.env.MOBILE_ANALYTICS_DIAGNOSTICS
    delete process.env.EXPO_PUBLIC_MOBILE_ANALYTICS_DIAGNOSTICS
    const diagnostics = await import('./mobile-analytics-diagnostics.js')

    diagnostics.recordMobileAnalyticsEvent('alert_received')

    expect(diagnostics.getMobileAnalyticsRecordedEvents()).toEqual([])
  })
})
