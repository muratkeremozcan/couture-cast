import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'
import { runAbortableSharp } from './abortable-sharp.js'
describe('actual Sharp cancellation ownership', () => {
  it('destroys active pipeline, rejects late actual native completion and removes listener', async () => {
    const pipeline = sharp({
      create: { width: 2048, height: 2048, channels: 3, background: '#123456' },
    }).png()
    const destroy = vi.spyOn(pipeline, 'destroy')
    const controller = new AbortController()
    const remove = vi.spyOn(controller.signal, 'removeEventListener')
    let settled = false
    const operation = runAbortableSharp(pipeline, controller.signal, async () => {
      const bytes = await pipeline.toBuffer()
      settled = true
      return bytes
    })
    const refused = expect(operation).rejects.toThrow()
    controller.abort()
    expect(destroy).toHaveBeenCalledOnce()
    await refused
    expect(settled || pipeline.destroyed).toBe(true)
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
  })
  it('an already cancelled stage never starts work', async () => {
    const controller = new AbortController()
    controller.abort()
    const work = vi.fn(() => Promise.resolve(Buffer.alloc(0)))
    await expect(runAbortableSharp(sharp(), controller.signal, work)).rejects.toThrow(
      'image_cancelled'
    )
    expect(work).not.toHaveBeenCalled()
  })
})
