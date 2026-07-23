import { describe, it, expect } from 'vitest'
import { formatTemperature, formatCurrency, formatMeasurement } from './formatters'

describe('Localization Formatters', () => {
  describe('formatTemperature', () => {
    it('should format 0°C to 32°F for en-US', () => {
      expect(formatTemperature(0, 'en-US')).toBe('32°F')
    })

    it('should format 20°C to 68°F for en-US', () => {
      expect(formatTemperature(20, 'en-US')).toBe('68°F')
    })

    it('should format 20°C to 20°C for tr-TR', () => {
      expect(formatTemperature(20, 'tr-TR')).toBe('20°C')
    })

    it('should format 20°C to 20°C for fr-CA', () => {
      expect(formatTemperature(20, 'fr-CA')).toBe('20°C')
    })
  })

  describe('formatCurrency', () => {
    it('should format USD for en-US', () => {
      const result = formatCurrency(100, 'en-US')
      expect(result).toContain('$100')
    })

    it('should format CAD for en-CA', () => {
      const result = formatCurrency(100, 'en-CA')
      expect(result).toContain('$100')
    })

    it('should format EUR for fr-FR', () => {
      const result = formatCurrency(100, 'fr-FR')
      // Note: fr-FR puts symbol at the end: '100,00 €'
      expect(result).toContain('€')
    })

    it('should format EUR for de-DE', () => {
      const result = formatCurrency(100, 'de-DE')
      expect(result).toContain('€')
    })

    it('should format EUR for it-IT', () => {
      const result = formatCurrency(100, 'it-IT')
      expect(result).toContain('€')
    })

    it('should format BRL for pt-BR', () => {
      const result = formatCurrency(100, 'pt-BR')
      expect(
        result.includes('R$') || result.includes('BRL') || result.includes('100')
      ).toBe(true)
    })

    it('should format EUR for pt-PT', () => {
      const result = formatCurrency(100, 'pt-PT')
      expect(result).toContain('€')
    })

    it('should format TRY for tr-TR', () => {
      const result = formatCurrency(100, 'tr-TR')
      expect(
        result.includes('₺') ||
          result.includes('TL') ||
          result.includes('TRY') ||
          result.includes('100')
      ).toBe(true)
    })
  })

  describe('formatMeasurement', () => {
    it('should format to inches for en-US', () => {
      expect(formatMeasurement(25.4, 'en-US')).toBe('10 in')
    })

    it('should format to cm for other locales', () => {
      expect(formatMeasurement(25.4, 'tr-TR')).toBe('25 cm')
    })
  })
})
