import { beforeEach } from 'vitest'
// Mobile consumers run with abort-controller3, without these newer statics.
function requirePortableAbort() {
  Reflect.deleteProperty(AbortSignal, 'any')
  Reflect.deleteProperty(AbortSignal, 'timeout')
}
requirePortableAbort()
beforeEach(requirePortableAbort)
