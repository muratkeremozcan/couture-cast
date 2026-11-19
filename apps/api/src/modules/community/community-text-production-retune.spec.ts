// Production follow-up 2026-11-19 test owner: the caption retune that cut false holds.
//
// The owner asked for fewer safe captions held for review with no drop in unsafe catch. The allow
// list gained locale-bound rules for words that are ordinary in one language and abusive in another
// or in another frame (madera maciza, pull bourré de laine, toppa sul gomito, hell bleiben). An
// adversarial pass against the first draft found abusive sentences that the new rules let through
// (du Pedale, mulher maciça, eat my pussy bow, ride my strap on my bag); the rules were reworked and
// every one of those is pinned here as held. The cleared controls pin that each rule still does
// its job. Every sentence is written for this spec; none comes from a holdout or corpus fixture.
import { describe, expect, it, vi } from 'vitest'
import { CommunityTextScreener } from './community-text-screener'

vi.setConfig({ testTimeout: 180_000 })
const screener = new CommunityTextScreener()
const disposition = (text: string, locale: string) =>
  screener.screen({ text, locale, field: 'caption' }).disposition

describe('retune 2026-11-19: abusive frames around the new rules stay held', () => {
  it.each([
    ['de-DE', 'du pedale'],
    ['de-DE', 'zeig mir deinen muff'],
    ['de-DE', 'muff'],
    ['de-DE', 'fahr zur hell bleiben'],
    ['en-US', 'go to hell bleiben'],
    ['en-US', 'hell bleiben'],
    ['pt-BR', 'mulher maciça'],
    ['pt-BR', 'que gostosa maciça'],
    ['pt-BR', 'ela é maciça'],
    ['pt-BR', 'madeira maciça, gostosa'],
    ['de-DE', 'leck deinen pelz muff'],
    // The rule's context is present and only a veto word holds these.
    ['en-US', 'her fur muff'],
    ['en-US', 'little fur muff'],
    ['fr-FR', 'elle est bourrée de laine'],
    ['es-419', 'qué maciza estás'],
    ['es-419', 'madera maciza como tu tía'],
    ['es-419', 'eres un capullo de rosa'],
    ['en-US', 'eat my pussy bow'],
    ['en-US', 'wet pussy bow'],
    ['en-US', 'show me your pussy bows'],
    ['en-US', 'lick her fur muff'],
    ['en-US', 'eat her hand muff'],
    ['en-US', 'ride my strap on my bag'],
    ['en-US', 'bend over for the strap on my backpack'],
    ['en-US', 'her shoulder strap on'],
    ['en-US', 'her strap on'],
    ['en-US', 'strap-on'],
    ['en-US', 'strapon'],
    ['fr-FR', 'je suis bourré'],
    ['fr-FR', 'bourré comme un coing'],
    ['it-IT', 'che bella toppa'],
    ['es-419', 'o pinto'],
    ['en-US', 'suck my balls'],
  ])('%s holds %j for review', (locale, text) => {
    expect(disposition(text, locale)).not.toBe('pass')
  })
})

describe('retune 2026-11-19: a clearing frame counts only when joined by plain spaces', () => {
  // Codex review 22: a clearing frame read across a quote, a full stop or a line break let a
  // slur through ("in die" ... "Pedale"). Each neighbour must now be joined by plain spaces.
  it.each([
    'Er sagte "tritt in die". \nPedale',
    'Ich trete in die.\nPedale!',
    'in die\npedale',
    '"in die" pedale',
  ])('holds %j', (text) => {
    expect(disposition(text, 'de-DE')).not.toBe('pass')
  })

  it('still clears the cycling caption the frame was written for', () => {
    expect(disposition('Mit der Regenjacke kräftig in die Pedale treten', 'de-DE')).toBe(
      'pass'
    )
  })
})

describe('retune 2026-11-19: the ordinary use each new rule clears', () => {
  it.each([
    ['de-DE', 'die Farben hell bleiben'],
    ['es-419', 'madera maciza'],
    ['es-419', 'tintes'],
    ['pt-BR', 'madeira maciça'],
    ['pt-BR', 'mesa de madeira maciça'],
    ['fr-FR', 'pull bourré de laine'],
    ['fr-FR', 'lapins'],
    ['fr-FR', 'rayées'],
    ['it-IT', 'toppa sul gomito'],
    ['tr-TR', 'boşta'],
    ['tr-TR', 'tüten'],
  ])('%s clears %j', (locale, text) => {
    expect(disposition(text, locale)).toBe('pass')
  })

  it('binds each cleared use to its own language', () => {
    expect(disposition('madera maciza', 'pt-BR')).not.toBe('pass')
    expect(disposition('pull bourré de laine', 'en-US')).not.toBe('pass')
    expect(disposition('toppa sul gomito', 'es-419')).not.toBe('pass')
  })
})
