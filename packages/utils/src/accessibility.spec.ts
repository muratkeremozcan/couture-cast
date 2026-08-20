// Learning path Step 28: Accessibility hardening.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-28-accessibility-hardening
import { describe, expect, it } from 'vitest'
import {
  formatLocalizedList,
  formatGarmentAltText,
  formatWeatherAltText,
  getAnnouncementUrgency,
} from './accessibility'

describe('accessibility utilities', () => {
  const supportedLocales = [
    'en-US',
    'en-CA',
    'es-419',
    'fr-CA',
    'fr-FR',
    'tr-TR',
    'de-DE',
    'it-IT',
    'pt-BR',
    'pt-PT',
  ] as const

  describe('formatWeatherAltText', () => {
    it.each([
      ['en-US', 'Sunny, 22 degrees Celsius, and light breeze'],
      ['fr-FR', 'Sunny, 22\u00a0degrés Celsius et light breeze'],
      ['de-DE', 'Sunny, 22 Grad Celsius und light breeze'],
      ['tr-TR', 'Sunny, 22 santigrat derece ve light breeze'],
    ])('uses %s list and unit formatting', (locale, expected) => {
      expect(
        formatWeatherAltText({
          conditionLabel: 'Sunny',
          temperature: 22.4,
          unit: 'C',
          locale,
          descriptor: 'light breeze',
        })
      ).toBe(expected)
    })

    it('formats Fahrenheit as a spoken unit', () => {
      expect(
        formatWeatherAltText({
          conditionLabel: 'Heavy snow',
          temperature: 28.7,
          unit: 'F',
          locale: 'en-US',
        })
      ).toBe('Heavy snow and 29 degrees Fahrenheit')
    })

    it.each(supportedLocales)('supports the configured %s locale', (locale) => {
      const temperature = new Intl.NumberFormat(locale, {
        style: 'unit',
        unit: 'celsius',
        unitDisplay: 'long',
        maximumFractionDigits: 0,
      }).format(0)
      const expected = new Intl.ListFormat(locale, {
        style: 'long',
        type: 'conjunction',
      }).format(['Clear', temperature])

      expect(
        formatWeatherAltText({
          conditionLabel: 'Clear',
          temperature: 0,
          unit: 'C',
          locale,
        })
      ).toBe(expected)
    })

    it('preserves zero and negative finite temperatures', () => {
      expect(
        formatWeatherAltText({
          conditionLabel: 'Freezing rain',
          temperature: 0,
          unit: 'C',
          locale: 'en-US',
        })
      ).toBe('Freezing rain and 0 degrees Celsius')
      expect(
        formatWeatherAltText({
          conditionLabel: 'Deep freeze',
          temperature: -12,
          unit: 'F',
          locale: 'en-US',
        })
      ).toBe('Deep freeze and -12 degrees Fahrenheit')
    })

    it('omits non-finite temperatures and duplicate descriptors', () => {
      expect(
        formatWeatherAltText({
          conditionLabel: 'Rain',
          temperature: Number.NaN,
          unit: 'C',
          locale: 'en-US',
          descriptor: ' rain ',
        })
      ).toBe('Rain')
    })

    it('falls back safely for invalid locale and empty content', () => {
      expect(
        formatWeatherAltText({
          conditionLabel: '',
          temperature: Number.POSITIVE_INFINITY,
          unit: 'C',
          locale: 'not_a_locale',
        })
      ).toBe('')
    })

    it('falls back to en-US when the locale is blank', () => {
      // Some callers pass a stored preference that has not been set yet; a
      // blank locale must not reach Intl and throw.
      expect(
        formatWeatherAltText({
          conditionLabel: 'Sunny',
          temperature: 22,
          unit: 'C',
          locale: '   ',
        })
      ).toBe('Sunny and 22 degrees Celsius')
    })

    it('uses a locale-aware fallback when Intl.ListFormat is unavailable', () => {
      const listFormat = Intl.ListFormat
      Object.defineProperty(Intl, 'ListFormat', {
        configurable: true,
        value: undefined,
      })

      try {
        expect(
          formatWeatherAltText({
            conditionLabel: 'Sunny',
            temperature: 22,
            unit: 'C',
            locale: 'de-DE',
            descriptor: 'light breeze',
          })
        ).toBe('Sunny, 22 Grad Celsius, und light breeze')
      } finally {
        Object.defineProperty(Intl, 'ListFormat', {
          configurable: true,
          value: listFormat,
        })
      }
    })
  })

  describe('formatGarmentAltText', () => {
    it('formats deduplicated descriptors using the requested locale', () => {
      expect(
        formatGarmentAltText(
          'Pleated maxi skirt',
          ['charcoal', 'wool', 'Charcoal'],
          'en-US'
        )
      ).toBe('Pleated maxi skirt: charcoal and wool')

      expect(formatGarmentAltText('Jupe plissée', ['anthracite', 'laine'], 'fr-FR')).toBe(
        'Jupe plissée: anthracite et laine'
      )
    })

    it('returns a clean title when descriptors are empty', () => {
      expect(formatGarmentAltText('  Silk blouse  ', ['', '  '])).toBe('Silk blouse')
    })

    it('does not repeat a descriptor that equals the title', () => {
      expect(formatGarmentAltText('Coat', ['coat', 'wool'])).toBe('Coat: wool')
    })

    it('joins two and three descriptors with the default English conjunction', () => {
      // Hermes and other builds without full ICU ship no Intl.ListFormat, and
      // an unmapped language falls through to "and".
      const listFormat = Intl.ListFormat
      Object.defineProperty(Intl, 'ListFormat', {
        configurable: true,
        value: undefined,
      })

      try {
        expect(formatGarmentAltText('Wool coat', ['charcoal', 'lined'], 'en-US')).toBe(
          'Wool coat: charcoal and lined'
        )
        expect(
          formatGarmentAltText('Wool coat', ['charcoal', 'lined', 'knee length'], 'en-US')
        ).toBe('Wool coat: charcoal, lined, and knee length')
      } finally {
        Object.defineProperty(Intl, 'ListFormat', {
          configurable: true,
          value: listFormat,
        })
      }
    })
  })

  describe('getAnnouncementUrgency', () => {
    it('uses assertive urgency only for alerts', () => {
      expect(getAnnouncementUrgency('alert')).toBe('assertive')
      expect(getAnnouncementUrgency('refresh')).toBe('polite')
      expect(getAnnouncementUrgency('swap')).toBe('polite')
      expect(getAnnouncementUrgency('chip_change')).toBe('polite')
      expect(getAnnouncementUrgency('feedback')).toBe('polite')
      expect(getAnnouncementUrgency('error')).toBe('assertive')
    })
  })

  describe('formatLocalizedList', () => {
    it('returns the single part unchanged, and an empty string for nothing', () => {
      expect(formatLocalizedList(['Jewel Radiance'])).toBe('Jewel Radiance')
      expect(formatLocalizedList([])).toBe('')
    })

    it('joins with the reader language rather than a comma', () => {
      expect(formatLocalizedList(['A', 'B', 'C'], 'en-US')).toBe('A, B, and C')
      expect(formatLocalizedList(['A', 'B'], 'de-DE')).toBe('A und B')
    })

    it('falls back to en-US for an unusable locale rather than throwing', () => {
      expect(formatLocalizedList(['A', 'B'], '   ')).toBe('A and B')
      expect(formatLocalizedList(['A', 'B'], 'not a locale')).toBe('A and B')
    })

    /**
     * The reason this helper is public. Hermes ships no `Intl.ListFormat`, so callers
     * that construct one directly throw on device. The fallback has to produce the same
     * string the real thing does, or moving a caller onto the helper changes copy.
     */
    it('produces the same string as Intl.ListFormat when Intl.ListFormat is absent', () => {
      const listFormat = Intl.ListFormat
      const expected = formatLocalizedList(['A', 'B', 'C'], 'en-US')
      Object.defineProperty(Intl, 'ListFormat', { configurable: true, value: undefined })

      try {
        expect(formatLocalizedList(['A', 'B', 'C'], 'en-US')).toBe(expected)
        expect(formatLocalizedList(['A', 'B'], 'tr-TR')).toBe('A ve B')
        expect(formatLocalizedList(['A', 'B'], 'fr-FR')).toBe('A et B')
      } finally {
        Object.defineProperty(Intl, 'ListFormat', {
          configurable: true,
          value: listFormat,
        })
      }
    })

    it('keeps a genuine repeat rather than de-duplicating it', () => {
      expect(formatLocalizedList(['A', 'A'], 'en-US')).toBe('A and A')
    })
  })
})
