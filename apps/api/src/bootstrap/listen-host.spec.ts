import { describe, expect, it } from 'vitest'
import { resolveListenHost } from './listen-host'

describe('resolveListenHost', () => {
  it('keeps the default bind (every interface) when API_LISTEN_HOST is unset or blank', () => {
    expect(resolveListenHost({})).toBeUndefined()
    expect(resolveListenHost({ API_LISTEN_HOST: '' })).toBeUndefined()
    expect(resolveListenHost({ API_LISTEN_HOST: '   ' })).toBeUndefined()
  })

  it('binds the configured host, trimmed', () => {
    expect(resolveListenHost({ API_LISTEN_HOST: '127.0.0.1' })).toBe('127.0.0.1')
    expect(resolveListenHost({ API_LISTEN_HOST: ' ::1 ' })).toBe('::1')
  })
})
