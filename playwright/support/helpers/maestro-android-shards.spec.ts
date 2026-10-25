/**
 * Story 6.7b R21: an Android run across several devices gives every device its
 * own queue of single-flow Maestro invocations, each with the flow cap and the
 * R18 launch watchdog, on the device's own pinned driver port. A stalled launch
 * fails that flow, named and without the cap retry, while every other flow on
 * both devices still runs. See scripts/lib/maestro-android-shards.mjs.
 */
import { describe, expect, it } from 'vitest'
import {
  assignFlowsToDevices,
  runAndroidDeviceShards,
} from '../../../scripts/lib/maestro-android-shards.mjs'
import {
  createLaunchStallCheck,
  launchStallError,
} from '../../../scripts/lib/maestro-launch-watchdog.mjs'

const RUNNER = 'maestro.cli.runner.CliConsoleListener'
const START = `00:21:44.310 [ INFO] ${RUNNER}.onCommandStart: Launch app "\${MAESTRO_APP_ID}" with clear state without stopping app RUNNING`
const CLEARING =
  '00:21:44.314 [ INFO] maestro.Maestro.clearAppState$lambda$8: Clearing app state host.exp.exponent'
const DONE = `00:21:46.486 [ INFO] ${RUNNER}.onCommandFinished: Launch app "\${MAESTRO_APP_ID}" with clear state without stopping app COMPLETED`
const FLOW_CAP_MS = 360_000

type StallCheck = { intervalMs: number; check: () => Promise<string | undefined> }

describe('flows spread over devices', () => {
  it('6.7b-R21-01 packs the longest recorded flows first and keeps each queue in order', () => {
    const durations = {
      _comment: 99,
      'a.yaml': 100,
      'b.yaml': 90,
      'c.yaml': 50,
      'd.yaml': 40,
    } as unknown as Record<string, number>
    // e.yaml has no record and counts as the mean, 70.
    const flows = [
      'maestro/a.yaml',
      'maestro/b.yaml',
      'maestro/c.yaml',
      'maestro/d.yaml',
      'maestro/e.yaml',
    ]
    expect(
      assignFlowsToDevices(flows, ['emulator-5554', 'emulator-5556'], durations)
    ).toEqual(
      new Map([
        ['emulator-5554', ['maestro/a.yaml', 'maestro/c.yaml', 'maestro/d.yaml']],
        ['emulator-5556', ['maestro/b.yaml', 'maestro/e.yaml']],
      ])
    )
    expect(() => assignFlowsToDevices(flows, [])).toThrow('No device to run the flows on')
  })
})

describe('Android per-device shard run', () => {
  it('6.7b-R21-02 hands every device invocation the flow cap and the launch watchdog, and a stall fails only its own flow', async () => {
    const devices = ['emulator-5554', 'emulator-5556']
    // a.yaml lands on emulator-5554 first and sticks in its launch.
    const stalledFlow = 'maestro/a.yaml'
    const durations = { 'a.yaml': 100, 'b.yaml': 90, 'c.yaml': 50, 'd.yaml': 40 }
    const flows = ['maestro/a.yaml', 'maestro/b.yaml', 'maestro/c.yaml', 'maestro/d.yaml']

    const invocations: {
      args: string[]
      options: { timeoutMs: number; stallCheck?: StallCheck; env?: unknown }
    }[] = []
    const finished: { flowPath: string; device: string; error?: Error }[] = []
    const retries: string[] = []
    const cleared: string[] = []

    await runAndroidDeviceShards({
      flows,
      devices,
      durations,
      timeoutMs: FLOW_CAP_MS,
      prepareDriver: (_device, driverPort) =>
        Promise.resolve([
          '--no-reinstall-driver',
          '--driver-host-port',
          String(driverPort),
        ]),
      buildArgs: (flowPath, device) => [
        '--platform',
        'android',
        '--udid',
        device,
        'test',
        flowPath,
      ],
      spawnOptionsFor: (flowPath, device) => ({
        env: { FLOW: flowPath, DEVICE: device },
      }),
      stallCheckFor: (flowPath, device) => () => {
        // Each poll is one 2 s tick of this attempt's own clock.
        let clock = 0
        const stallCheck = createLaunchStallCheck({
          device,
          now: () => clock,
          readDebugLog: () =>
            flowPath === stalledFlow ? `${START}\n${CLEARING}\n` : `${START}\n${DONE}\n`,
          readDeviceProcesses: () => Promise.resolve('PID S ARGS\n1 S init\n'),
        })
        return {
          intervalMs: stallCheck.intervalMs,
          check: async () => {
            const answer = await stallCheck.check()
            clock += stallCheck.intervalMs
            return answer
          },
        }
      },
      // Stands in for one Maestro process: polls its stall check like `spawnProcess`
      // and is killed with the named stall when the check answers.
      runMaestro: async (args, options) => {
        invocations.push({ args, options })
        const flowPath = args[args.length - 1]
        if (flowPath !== stalledFlow) return
        if (!options.stallCheck) {
          throw Object.assign(
            new Error(`maestro timed out after ${options.timeoutMs}ms`),
            {
              timedOut: true,
            }
          )
        }
        for (;;) {
          // eslint-disable-next-line no-await-in-loop -- one poll at a time, as spawnProcess does
          const message = await options.stallCheck.check()
          if (message) throw launchStallError(message)
        }
      },
      beforeAttempt: (args) => cleared.push(args[args.length - 1] ?? ''),
      onRetry: (flowPath) => retries.push(flowPath),
      recordInvocation: () => undefined,
      onRefused: (flowPath) => {
        throw new Error(`unexpected refusal of ${flowPath}`)
      },
      onFinished: (flowPath, device, error) => finished.push({ flowPath, device, error }),
      log: () => undefined,
    })

    // Every flow on both devices ran once, as its own invocation on its own device.
    const ran = invocations
      .map(({ args }) => `${args[3]} ${args[args.length - 1]}`)
      .sort()
    expect(ran).toEqual([
      'emulator-5554 maestro/a.yaml',
      'emulator-5554 maestro/d.yaml',
      'emulator-5556 maestro/b.yaml',
      'emulator-5556 maestro/c.yaml',
    ])
    expect(cleared.sort()).toEqual([...flows].sort())
    for (const { args, options } of invocations) {
      const device = args[3]
      // Both options reach the Maestro invocation, next to the device's own spawn options.
      expect(options.timeoutMs).toBe(FLOW_CAP_MS)
      expect(options.stallCheck?.intervalMs).toBe(2_000)
      expect(options.env).toEqual({ FLOW: args[args.length - 1], DEVICE: device })
      // The device's udid and its own pinned driver port reach Maestro.
      expect(args.slice(0, 8)).toEqual([
        '--platform',
        'android',
        '--udid',
        device,
        'test',
        '--no-reinstall-driver',
        '--driver-host-port',
        device === 'emulator-5554' ? '17001' : '17002',
      ])
    }

    // The stall failed its flow on the first attempt, named, with no cap retry.
    expect(retries).toEqual([])
    const stalled = finished.find(({ flowPath }) => flowPath === stalledFlow)
    expect(stalled?.device).toBe('emulator-5554')
    expect(stalled?.error?.message).toMatch(
      /^Maestro's "Launch app .*" stalled for 90 s while clearing app state .* on emulator-5554 no package or activity manager command is running/
    )
    // Every other flow finished cleanly, the stalled device's next flow included.
    expect(
      finished
        .filter(({ flowPath }) => flowPath !== stalledFlow)
        .map(({ flowPath, error }) => `${flowPath} ${String(error)}`)
        .sort()
    ).toEqual([
      'maestro/b.yaml undefined',
      'maestro/c.yaml undefined',
      'maestro/d.yaml undefined',
    ])
  })

  it('6.7b-R21-03 gives a flow killed at the flow cap its single retry, and refuses a flow whose driver cannot be prepared', async () => {
    const refused: string[] = []
    const attempts: string[] = []
    const retries: string[] = []
    let prepared = 0
    await runAndroidDeviceShards({
      flows: ['maestro/a.yaml', 'maestro/b.yaml', 'maestro/c.yaml'],
      devices: ['emulator-5554'],
      timeoutMs: FLOW_CAP_MS,
      prepareDriver: (device) =>
        (prepared += 1) === 1
          ? Promise.reject(new Error(`Maestro driver not ready on ${device}: port busy`))
          : Promise.resolve(['--no-reinstall-driver']),
      buildArgs: (flowPath) => ['test', flowPath],
      spawnOptionsFor: () => ({}),
      stallCheckFor: () => undefined,
      runMaestro: (args) => {
        const flowPath = args[args.length - 1] ?? ''
        attempts.push(flowPath)
        return flowPath === 'maestro/b.yaml' && attempts.length === 1
          ? Promise.reject(
              Object.assign(new Error('maestro timed out'), { timedOut: true })
            )
          : Promise.resolve()
      },
      onRetry: (flowPath) => retries.push(flowPath),
      recordInvocation: () => undefined,
      onRefused: (flowPath, device, cause) =>
        refused.push(`${flowPath} ${device} ${cause}`),
      onFinished: () => undefined,
      log: () => undefined,
    })
    expect(refused).toEqual([
      'maestro/a.yaml emulator-5554 Maestro driver not ready on emulator-5554: port busy',
    ])
    expect(attempts).toEqual(['maestro/b.yaml', 'maestro/b.yaml', 'maestro/c.yaml'])
    expect(retries).toEqual(['maestro/b.yaml'])
  })
})
