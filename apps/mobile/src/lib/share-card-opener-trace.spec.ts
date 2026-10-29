import { describe, expect, it } from 'vitest'
import {
  installShareCardOpenerTrace,
  traceShareCardOpener,
} from './share-card-presentation-trace'

describe('opener trace', () => {
  it('records nothing without a sink and forwards events to an installed sink', () => {
    expect(() => traceShareCardOpener('press')).not.toThrow()
    const seen: string[] = []
    installShareCardOpenerTrace((event) => seen.push(event))
    traceShareCardOpener('press')
    traceShareCardOpener('composer-prepare')
    installShareCardOpenerTrace(null)
    traceShareCardOpener('state-open')
    expect(seen).toEqual(['press', 'composer-prepare'])
  })
})
