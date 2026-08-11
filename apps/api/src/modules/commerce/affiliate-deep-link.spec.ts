import { describe, expect, it } from 'vitest'
import { buildAffiliateRedirectUrl } from './affiliate-deep-link.js'

const ALLOWED_HOST = 'partner.couturecast.test'
const TOKEN = 'AbC-123_xyz'

describe('buildAffiliateRedirectUrl', () => {
  it('substitutes the token and returns an absolute https URL', () => {
    const result = buildAffiliateRedirectUrl(
      `https://${ALLOWED_HOST}/shop?cc={clickToken}`,
      ALLOWED_HOST,
      TOKEN
    )

    expect(result).toEqual({
      ok: true,
      url: `https://${ALLOWED_HOST}/shop?cc=${TOKEN}`,
    })
  })

  it('substitutes every occurrence of the placeholder', () => {
    const result = buildAffiliateRedirectUrl(
      `https://${ALLOWED_HOST}/{clickToken}/shop?cc={clickToken}`,
      ALLOWED_HOST,
      TOKEN
    )

    expect(result).toEqual({
      ok: true,
      url: `https://${ALLOWED_HOST}/${TOKEN}/shop?cc=${TOKEN}`,
    })
  })

  describe('host matching', () => {
    it.each([
      { name: 'an exact host', host: ALLOWED_HOST },
      { name: 'a dot-suffix subdomain', host: `shop.${ALLOWED_HOST}` },
      { name: 'a deeper dot-suffix subdomain', host: `eu.shop.${ALLOWED_HOST}` },
      {
        name: 'an uppercased host, which URL parsing normalizes',
        host: ALLOWED_HOST.toUpperCase(),
      },
    ])('accepts $name', ({ host }) => {
      const result = buildAffiliateRedirectUrl(
        `https://${host}/shop?cc={clickToken}`,
        ALLOWED_HOST,
        TOKEN
      )

      expect(result.ok).toBe(true)
    })

    it.each([
      {
        name: 'a host that merely ends with the allowed string',
        host: `not${ALLOWED_HOST}`,
      },
      { name: 'an unrelated host', host: 'evil.test' },
      {
        name: 'the allowed host as a subdomain of an attacker host',
        host: `${ALLOWED_HOST}.evil.test`,
      },
      { name: 'a bare prefix of the allowed host', host: 'couturecast.test' },
    ])('rejects $name', ({ host }) => {
      const result = buildAffiliateRedirectUrl(
        `https://${host}/shop?cc={clickToken}`,
        ALLOWED_HOST,
        TOKEN
      )

      expect(result).toEqual({ ok: false, reason: 'host_not_allowed' })
    })

    it('rejects everything when the partner has a blank allowed host', () => {
      const result = buildAffiliateRedirectUrl(
        `https://${ALLOWED_HOST}/shop?cc={clickToken}`,
        '   ',
        TOKEN
      )

      expect(result).toEqual({ ok: false, reason: 'host_not_allowed' })
    })
  })

  describe('rejections', () => {
    it.each([
      {
        name: 'a template with no {clickToken} placeholder',
        template: `https://${ALLOWED_HOST}/shop`,
        reason: 'missing_placeholder',
      },
      {
        name: 'a template that is not a URL at all',
        template: 'not a url {clickToken}',
        reason: 'unparseable',
      },
      {
        name: 'a relative template',
        template: '/shop?cc={clickToken}',
        reason: 'unparseable',
      },
      {
        name: 'plain http',
        template: `http://${ALLOWED_HOST}/shop?cc={clickToken}`,
        reason: 'not_https',
      },
      {
        name: 'a non-web scheme',
        template: 'javascript:void(0)#{clickToken}',
        reason: 'not_https',
      },
      {
        name: 'a username in the authority',
        template: `https://someone@${ALLOWED_HOST}/shop?cc={clickToken}`,
        reason: 'has_userinfo',
      },
      {
        name: 'a username and password that move the real authority right of an @',
        template: `https://${ALLOWED_HOST}:x@evil.test/shop?cc={clickToken}`,
        reason: 'has_userinfo',
      },
    ])('rejects $name', ({ template, reason }) => {
      expect(buildAffiliateRedirectUrl(template, ALLOWED_HOST, TOKEN)).toEqual({
        ok: false,
        reason,
      })
    })
  })

  it('compares after IDN normalization rather than on the raw string', () => {
    // `xn--` punycode is what `new URL(...)` produces for a unicode label, so a
    // homograph host cannot pass a naive string compare against the ASCII form.
    const result = buildAffiliateRedirectUrl(
      'https://pärtner.couturecast.test/shop?cc={clickToken}',
      ALLOWED_HOST,
      TOKEN
    )

    expect(result).toEqual({ ok: false, reason: 'host_not_allowed' })
  })
})
