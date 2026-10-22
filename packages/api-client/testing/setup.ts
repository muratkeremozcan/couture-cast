import { beforeEach } from 'vitest'
// Mobile consumers run with abort-controller3, without these newer statics, on Hermes,
// which has no DOMException global at all.
function requirePortableAbort() {
  Reflect.deleteProperty(AbortSignal, 'any')
  Reflect.deleteProperty(AbortSignal, 'timeout')
  Reflect.deleteProperty(globalThis, 'DOMException')
}
requirePortableAbort()
beforeEach(requirePortableAbort)
