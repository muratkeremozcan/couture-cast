import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { CommunityTextScreener } from './community-text-screener'

/**
 * Pins the generated plural and inflected spellings of the high-severity single-word terms
 * (a shared rule for all seven locales) and the full result of the inflection-aware
 * collision sweep that was run over them.
 *
 * The sweep took every base word of /usr/share/dict (web2, words, propernames: 232,991
 * words) plus the vocabulary of the repository locale files, faker, lighthouse, trace
 * engine, yargs, dayjs and zod locales for de, es, fr, it, pt and tr (4,276 to 5,943 words
 * each), generated s, es, ies, ed, d and ing forms (and each language's own suffixes) for
 * every base word, and compared what the screener withholds with and without the generated
 * forms. 1,552,704 distinct forms were screened; the list below is every form that became
 * withheld, rerun for the round 7k rape-family spellings (17 new forms, all withheld) and
 * for round 7l (20 new forms from the typo index: nonsense joins such as marcaes, junk
 * suffixes on mari-/mongol- stems, and the Turkish plurals açıklar and açıkları, which
 * are ordinary words and pass through the allow list). Round 7t adds tecavüzcü (rapist) to the Turkish violence terms, which generates 14 forms; the Turkish sweep found no collision among them. Round 7q skips the typo spellings of Turkish
 * inflections whose suffix breaks vowel harmony with their stem (amcık plus ler, the stem of
 * çıfıt plus ler): one letter less is an ordinary front-vowel word (çiftler, sıkışan). That
 * releases the three nonsense forms açıkden, açıkler and açıkleri from the pins. Any new generated form changes the hash below and fails the first test: rerun
 * the sweep, rule on each new collision and update the pins together.
 */
const screener = new CommunityTextScreener()

const GENERATED_FORM_COUNT = 978
const GENERATED_FORMS_SHA256 =
  '4eaf089725ff089b0105fc372285696f00d6f626466937eb73492340046936b2'

// [form, languages whose sweep found it, expected disposition for the bare form, no locale]
// pass: ruled an ordinary word. withheld: a hate or violence plural, a generated spelling
// that repeat-collapses onto one, or an ordinary-looking word the coordinator ruled stays
// blocked (negroes, pedes, saloopes, subnormals, hures, whores, raped, rapes). tapetes, retards
// and chinks clear only inside their reviewed frames, covered in the round 7 spec.
const COLLISIONS: readonly (readonly [string, string, 'pass' | 'withheld'])[] = [
  ['chinkes', 'en', 'withheld'],
  ['chinks', 'en', 'withheld'],
  ['chinkss', 'en', 'withheld'],
  ['fagotes', 'en', 'withheld'],
  ['gookes', 'en', 'withheld'],
  ['gooks', 'en', 'withheld'],
  ['hurees', 'en', 'withheld'],
  ['hures', 'en', 'withheld'],
  ['hurres', 'en', 'withheld'],
  ['kikees', 'en', 'withheld'],
  ['kikes', 'en', 'withheld'],
  ['nazies', 'en', 'withheld'],
  ['neegers', 'en', 'withheld'],
  ['negers', 'en', 'withheld'],
  ['negresss', 'en', 'withheld'],
  ['negroes', 'en,es', 'withheld'],
  ['niggeres', 'en', 'withheld'],
  ['nutes', 'en', 'withheld'],
  ['pedeees', 'en', 'withheld'],
  ['pedees', 'en,pt', 'withheld'],
  ['pedes', 'en,pt', 'withheld'],
  ['pedess', 'en', 'withheld'],
  ['peedes', 'en', 'withheld'],
  ['rapped', 'en', 'withheld'],
  ['rapping', 'en', 'withheld'],
  ['raped', 'en', 'withheld'],
  ['rapeed', 'en', 'withheld'],
  ['rapees', 'en', 'withheld'],
  ['rapes', 'en', 'withheld'],
  ['rappeed', 'en', 'withheld'],
  ['rappees', 'en', 'withheld'],
  ['rappes', 'en', 'withheld'],
  ['retardees', 'fr', 'withheld'],
  ['retardes', 'en,fr', 'withheld'],
  ['retards', 'en,fr', 'withheld'],
  ['retardss', 'fr', 'withheld'],
  ['retardéess', 'fr', 'withheld'],
  ['saloopes', 'en', 'withheld'],
  ['slutes', 'en', 'withheld'],
  ['spicees', 'en', 'withheld'],
  ['spices', 'en', 'pass'],
  ['subnormales', 'en', 'withheld'],
  ['subnormals', 'en', 'withheld'],
  ['tapetees', 'en', 'withheld'],
  ['tapetes', 'en', 'withheld'],
  ['tappetes', 'en', 'withheld'],
  ['wetbackes', 'en', 'withheld'],
  ['wetbacks', 'en', 'withheld'],
  ['whorees', 'en', 'withheld'],
  ['whores', 'en', 'withheld'],
  ['rapd', 'en', 'withheld'],
  ['rapeing', 'en', 'withheld'],
  ['raper', 'en', 'withheld'],
  ['raperes', 'en', 'withheld'],
  ['rapers', 'en', 'withheld'],
  ['rapinees', 'en', 'withheld'],
  ['rapines', 'en', 'withheld'],
  ['rapinges', 'en', 'withheld'],
  ['rapings', 'en', 'withheld'],
  ['rapistes', 'en', 'withheld'],
  ['rapists', 'en', 'withheld'],
  ['rappeing', 'en', 'withheld'],
  ['rapperes', 'en', 'withheld'],
  ['rappinges', 'en', 'withheld'],
  ['rappings', 'en', 'withheld'],
  ['rappistes', 'en', 'withheld'],
  ['rappists', 'en', 'withheld'],
  ['saaed', 'en', 'withheld'],
  ['açıkdan', 'tr', 'withheld'],
  ['açıklar', 'tr', 'pass'],
  ['açıkları', 'tr', 'pass'],
  ['bolleres', 'en', 'withheld'],
  ['bollers', 'en', 'withheld'],
  ['marcaes', 'es,pt', 'withheld'],
  ['marcases', 'es,pt', 'withheld'],
  ['marcass', 'es,pt', 'withheld'],
  ['marciaes', 'en', 'withheld'],
  ['mariaes', 'en', 'withheld'],
  ['mariones', 'en', 'withheld'],
  ['marions', 'en', 'withheld'],
  ['mongolices', 'en', 'withheld'],
  ['mongolics', 'en', 'withheld'],
  ['rayedes', 'en', 'withheld'],
  ['retares', 'en', 'withheld'],
  ['retrades', 'en', 'withheld'],
]

describe('generated inflection forms and their collisions', () => {
  it('pins the generated forms', () => {
    const forms = screener.generatedInflectionForms().toSorted()
    expect(forms).toHaveLength(GENERATED_FORM_COUNT)
    expect(createHash('sha256').update(forms.join('\n')).digest('hex')).toBe(
      GENERATED_FORMS_SHA256
    )
  })

  it('pins the sweep result', () => {
    expect(COLLISIONS).toHaveLength(85)
  })

  it.each(COLLISIONS)('%s (%s) is %s', (form, _languages, expected) => {
    const { disposition } = screener.screen({
      text: form,
      field: 'caption',
      locale: null,
    })
    if (expected === 'pass') expect(disposition).toBe('pass')
    else expect(disposition).not.toBe('pass')
  })
})
