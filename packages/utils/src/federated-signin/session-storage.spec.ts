// Learning path Step 57: Google sign-in.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-57-google-sign-in
// Story 6.17 TEA privacy review: the stored session carries no Google token on either client.
import { describe, expect, it } from 'vitest'
import { stripProviderTokens, withoutProviderTokens } from './session-storage'

const SESSION_KEY = 'couturecast.auth-session'
const googleSession = {
  access_token: 'supabase-access',
  refresh_token: 'supabase-refresh',
  provider_token: 'google-access',
  provider_refresh_token: 'google-refresh',
  user: { id: 'auth-user', email: 'member@synthetic.test' },
}

function memoryStorage() {
  const items = new Map<string, string>()
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  }
}

describe('stripProviderTokens', () => {
  it('drops both Google tokens and keeps the Supabase session', () => {
    expect(JSON.parse(stripProviderTokens(JSON.stringify(googleSession)))).toEqual({
      access_token: 'supabase-access',
      refresh_token: 'supabase-refresh',
      user: { id: 'auth-user', email: 'member@synthetic.test' },
    })
  })

  it.each([
    ['a session without Google tokens', JSON.stringify({ access_token: 'a' })],
    ['a plain string', 'pkce-verifier-value'],
    ['a JSON array', '["provider_token"]'],
    ['JSON null', 'null'],
  ])('leaves %s byte for byte', (_name, value) => {
    expect(stripProviderTokens(value)).toBe(value)
  })
})

describe('withoutProviderTokens', () => {
  it('stores the session without Google tokens', async () => {
    const inner = memoryStorage()
    const storage = withoutProviderTokens(inner, SESSION_KEY)
    await storage.setItem(SESSION_KEY, JSON.stringify(googleSession))
    const stored = inner.items.get(SESSION_KEY) ?? ''
    expect(stored).not.toContain('google-access')
    expect(stored).not.toContain('google-refresh')
    expect(JSON.parse(stored)).toMatchObject({ access_token: 'supabase-access' })
  })

  it('strips a session stored before the adapter on its next read', async () => {
    const inner = memoryStorage()
    inner.items.set(SESSION_KEY, JSON.stringify(googleSession))
    const read = await withoutProviderTokens(inner, SESSION_KEY).getItem(SESSION_KEY)
    expect(read).not.toContain('google-access')
  })

  it('passes other keys and removals through unchanged', async () => {
    const inner = memoryStorage()
    const storage = withoutProviderTokens(inner, SESSION_KEY)
    const verifierKey = `${SESSION_KEY}-code-verifier`
    const lookalike = JSON.stringify({ provider_token: 'kept-elsewhere' })
    await storage.setItem(verifierKey, lookalike)
    expect(inner.items.get(verifierKey)).toBe(lookalike)
    expect(await storage.getItem(verifierKey)).toBe(lookalike)
    expect(await storage.getItem('missing')).toBeNull()
    await storage.removeItem(verifierKey)
    expect(inner.items.has(verifierKey)).toBe(false)
  })
})
