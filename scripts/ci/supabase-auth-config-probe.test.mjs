// Learning path Step 57: Google sign-in.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-57-google-sign-in
// Story 6.17 H-SETTINGS and H-AUTHORIZE: the rules the hosted probe applies.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { authorizeProblems, settingsProblems } from './supabase-auth-config-probe.mjs'

const good = {
  external: { google: true, email: true, keycloak: false },
  mailer_autoconfirm: false,
}
const PROJECT = 'https://abcd.supabase.co'
const googleLocation = (overrides = {}) => {
  const query = new URLSearchParams({
    client_id: '718369739037-abc123.apps.googleusercontent.com',
    redirect_uri: `${PROJECT}/auth/v1/callback`,
    scope: 'email profile',
    response_type: 'code',
    ...overrides,
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${query}`
}

describe('settingsProblems', () => {
  it('accepts the configuration Google sign-in needs', () => {
    assert.deepEqual(settingsProblems(good), [])
  })

  it('names every broken invariant', () => {
    assert.deepEqual(
      settingsProblems({
        external: { google: false, email: false, keycloak: true },
        mailer_autoconfirm: true,
      }),
      [
        'external.google is not true',
        'external.email is not true',
        'external.keycloak is not false',
        'mailer_autoconfirm is not false',
      ]
    )
  })

  it('treats missing fields as broken', () => {
    assert.equal(settingsProblems({}).length, 4)
    assert.equal(settingsProblems(null).length, 4)
  })
})

describe('authorizeProblems', () => {
  it('accepts a Google redirect back to this project', () => {
    assert.deepEqual(
      authorizeProblems({ status: 302, location: googleLocation() }, PROJECT),
      []
    )
    assert.deepEqual(
      authorizeProblems({ status: 302, location: googleLocation() }, `${PROJECT}/`),
      []
    )
  })

  it('refuses no redirect, another host, a foreign callback or a wider scope', () => {
    assert.deepEqual(authorizeProblems({ status: 400, location: null }, PROJECT), [
      'authorize answered 400 without a redirect',
    ])
    assert.deepEqual(
      authorizeProblems({ status: 302, location: 'https://evil.example/auth' }, PROJECT),
      [
        'authorize redirects to https://evil.example',
        'client_id is not a Google OAuth client id',
        'redirect_uri is not this project callback',
      ]
    )
    assert.deepEqual(
      authorizeProblems(
        {
          status: 302,
          location: googleLocation({
            redirect_uri: 'https://other.supabase.co/auth/v1/callback',
            scope: 'email profile https://www.googleapis.com/auth/user.birthday.read',
          }),
        },
        PROJECT
      ),
      [
        'redirect_uri is not this project callback',
        'unexpected scope https://www.googleapis.com/auth/user.birthday.read',
      ]
    )
  })
})
