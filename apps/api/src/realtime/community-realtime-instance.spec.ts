// Story 6.5 (D10/O1): each realtime process carries one opaque random instance value.
import { execFile } from 'node:child_process'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { communityRealtimeConnectedSchema } from '@couture/api-client/contracts/http'
import { communityRealtimeInstance } from './community-realtime-instance.js'

const run = promisify(execFile)
const root = resolve(__dirname, '../../../..')
const module = resolve(__dirname, 'community-realtime-instance.ts')

async function instanceInNewProcess() {
  const { stdout } = await run(
    resolve(root, 'node_modules/.bin/tsx'),
    ['-e', `console.log(require(${JSON.stringify(module)}).communityRealtimeInstance)`],
    { cwd: root }
  )
  return stdout.trim()
}

describe('realtime instance value', () => {
  it('is an opaque random value that the connection acknowledgement contract accepts', () => {
    expect(
      communityRealtimeConnectedSchema.parse({
        version: 1,
        instance: communityRealtimeInstance,
      })
    ).toEqual({ version: 1, instance: communityRealtimeInstance })
  })

  it('is stable within a process and differs across processes', async () => {
    const { communityRealtimeInstance: again } = await import(
      './community-realtime-instance.js'
    )
    expect(again).toBe(communityRealtimeInstance)
    const [first, second] = await Promise.all([
      instanceInNewProcess(),
      instanceInNewProcess(),
    ])
    for (const value of [first, second])
      communityRealtimeConnectedSchema.parse({ version: 1, instance: value })
    expect(new Set([first, second, communityRealtimeInstance]).size).toBe(3)
  }, 30_000)
})
