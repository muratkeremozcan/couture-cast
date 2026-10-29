import { once } from 'node:events'
import { afterEach, describe, expect, it } from 'vitest'
import { OwnedProcess } from './community-engagement-harness.js'

const children: OwnedProcess[] = []
const spawn = (mode: string) => {
  const child = new OwnedProcess('community-owned-process-lifecycle.mjs', {
    OWNED_PROCESS_LIFECYCLE: mode,
  })
  children.push(child)
  return child
}
afterEach(async () => {
  await Promise.all(children.splice(0).map((child) => child.close()))
})

describe('owned process lifecycle barriers', () => {
  it('reports an actual missing-module startup exit before its ready barrier', async () => {
    const child = spawn('missing-module')
    await once(child.child, 'exit')
    await expect(child.event('ready', 100)).rejects.toThrow(
      'Owned child exited before event ready: {"script":"community-owned-process-lifecycle.mjs","code":1,"signal":null}'
    )
  })

  it('observes startup death while already waiting for readiness', async () => {
    const child = spawn('missing-module')
    await expect(child.event('ready')).rejects.toThrow(
      'Owned child exited before event ready: {"script":"community-owned-process-lifecycle.mjs","code":1,"signal":null}'
    )
  })

  it('preserves a buffered real event after the child has exited', async () => {
    const child = spawn('ready-then-exit')
    await once(child.child, 'exit')
    await expect(child.event('ready')).resolves.toEqual({ ready: true })
    await expect(child.event('unseen', 100)).rejects.toThrow(
      'Owned child exited before event unseen: {"script":"community-owned-process-lifecycle.mjs","code":17,"signal":null}'
    )
  })

  it('preserves normal calls and the genuine live-child barrier deadline', async () => {
    const child = spawn('live')
    await expect(child.event('ready')).resolves.toEqual({ ready: true })
    await expect(child.call('acknowledge')).resolves.toEqual({ acknowledged: true })
    await expect(child.event('unseen', 25)).rejects.toThrow(
      'Owned acceptance barrier deadline exceeded'
    )
  })
})
