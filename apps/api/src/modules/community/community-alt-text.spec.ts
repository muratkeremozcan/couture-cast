// Learning path Step 38: Community feed by climate band.
import { describe, expect, it } from 'vitest'
import { buildAltTextSuggestion } from './community-alt-text'

describe('buildAltTextSuggestion', () => {
  it('describes orientation and the resolved climate band in English', () => {
    expect(
      buildAltTextSuggestion({
        climateBand: 'cold_wet',
        widthPx: 1080,
        heightPx: 1350,
        locale: 'en-US',
      })
    ).toBe('Portrait photo of an outfit styled for cold, wet weather.')
  })

  it('reports landscape and square orientations', () => {
    expect(
      buildAltTextSuggestion({
        climateBand: null,
        widthPx: 1600,
        heightPx: 900,
        locale: 'en-US',
      })
    ).toBe('Landscape photo of an outfit.')

    expect(
      buildAltTextSuggestion({
        climateBand: null,
        widthPx: 1024,
        heightPx: 1024,
        locale: 'en-US',
      })
    ).toBe('Square photo of an outfit.')
  })

  it('localizes into Spanish and French', () => {
    expect(
      buildAltTextSuggestion({
        climateBand: 'warm_dry',
        widthPx: 1080,
        heightPx: 1350,
        locale: 'es-419',
      })
    ).toContain('clima cálido y seco')

    expect(
      buildAltTextSuggestion({
        climateBand: 'warm_dry',
        widthPx: 1080,
        heightPx: 1350,
        locale: 'fr-FR',
      })
    ).toContain('temps chaud et sec')
  })

  it('falls back to the default locale for a locale it has no copy for', () => {
    // `de-DE` is a shipped locale with no suggestion copy; the suggestion is
    // editable, so English is a usable starting point rather than a blocker.
    expect(
      buildAltTextSuggestion({
        climateBand: 'cold_dry',
        widthPx: 1080,
        heightPx: 1350,
        locale: 'de-DE',
      })
    ).toBe('Portrait photo of an outfit styled for cold, dry weather.')
  })

  it('matches a regional variant to its language copy', () => {
    expect(
      buildAltTextSuggestion({
        climateBand: null,
        widthPx: 1080,
        heightPx: 1350,
        locale: 'fr-CA',
      })
    ).toBe("Photo verticale d'une tenue.")
  })

  it('omits the band phrase entirely when the band is unresolved', () => {
    const suggestion = buildAltTextSuggestion({
      climateBand: null,
      widthPx: 1080,
      heightPx: 1350,
      locale: 'en-US',
    })

    expect(suggestion).toBe('Portrait photo of an outfit.')
    expect(suggestion).not.toContain('styled for')
  })

  it('never leaks the raw band identifier into text read aloud', () => {
    const suggestion = buildAltTextSuggestion({
      climateBand: 'temperate_wet',
      widthPx: 1080,
      heightPx: 1350,
      locale: 'en-US',
    })

    expect(suggestion).not.toContain('temperate_wet')
  })
})
