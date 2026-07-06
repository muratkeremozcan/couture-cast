import { describe, expect, it } from 'vitest'

describe('Global test network blocker', () => {
  it('blocks outgoing network requests to external URLs', async () => {
    await expect(
      fetch('https://api.openweathermap.org/data/3.0/onecall')
    ).rejects.toThrow('Forbidden outgoing network request')
  })

  it('allows requests to localhost, 127.0.0.1, and [::1]', async () => {
    // If it attempts to connect (and fails because nothing is running), it is allowed past the blocker.
    // If it is blocked, it throws our custom forbidden error.
    await expect(fetch('http://localhost:9999')).rejects.not.toThrow(
      'Forbidden outgoing network request'
    )
    await expect(fetch('http://127.0.0.1:9999')).rejects.not.toThrow(
      'Forbidden outgoing network request'
    )
    await expect(fetch('http://[::1]:9999')).rejects.not.toThrow(
      'Forbidden outgoing network request'
    )
  })
})
