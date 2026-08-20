// Story 5.3 Task 5 owner: the "Interface palettes" section of Web settings.
//
// The third child section on `/settings`, after `SubscriptionSection`, following its
// `SectionState`/`resolveSectionView` shape deliberately. Three things about this
// section are load-bearing rather than stylistic:
//
// - The gallery is the story's one demonstration surface (Decision 4). Each card
//   carries its own `data-theme`, so `globals.css` re-colors that card from the
//   palette's own custom properties while a different palette may be active on
//   `<html>`. No hex value appears in this file; the CSS layer is the single web copy.
// - `LivePreview` is the counterpart to that, and it is why the `data-theme` written to
//   `<html>` is a visible change rather than a DOM attribute nothing reads. It is the
//   one element here that pins no palette of its own, so it inherits whatever is active
//   on the document and re-colors on save. Every self-pinned card would keep looking
//   identical if the attribute never landed; the preview would not.
// - Contrast is the reason the cards look the way they do. Two of the three `primary`
//   fills miss the 4.5:1 small-text floor with white text (Decision 2), so `primary`
//   never carries text here: it is a swatch dot ringed in the card's own text color,
//   and every string in a card renders in `--theme-card-text` on `--theme-card-bg`,
//   the pairing that measures 8.01-11.58:1 across all three palettes.
// - Selection is never signalled by color alone. The active card states "Selected" in
//   text and carries `aria-pressed`, so the palette is decoration on top of a state
//   that is already readable and announced.
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { PremiumTheme, PremiumThemeKey } from '@couture/api-client/contracts/http'
import {
  applyWebThemeAttribute,
  DEFAULT_THEME_ATTRIBUTE,
  getThemeFromWeb,
  hasWebSession,
  premiumThemeFailureReason,
  PREMIUM_THEME_KEYS,
  setThemeFromWeb,
} from '../../lib/premium-theme'

const UNAVAILABLE_HINT_ID = 'premium-theme-unavailable-hint'

/**
 * `checking` is the server render and the first client tick, before `sessionStorage`
 * can be read, so hydration never reconciles two trees. It renders the heading and the
 * disclosure and nothing else, which is also what `loading` renders — the section
 * announces itself busy rather than showing a placeholder that would flash into either
 * the gallery or the locked panel a moment later.
 */
type SectionState = 'checking' | 'signed_out' | 'loading' | 'ready' | 'load_failed'

/**
 * Exhaustive over the contract enum on purpose: a palette added to
 * `premiumThemeKeySchema` fails to typecheck here until it has a name to render, so
 * the gallery cannot silently fall behind the contract.
 */
const PALETTE_LABEL_KEYS: Record<PremiumThemeKey, string> = {
  jewel_radiance: 'commerce.premium.theme.names.jewelRadiance',
  autumn_umber: 'commerce.premium.theme.names.autumnUmber',
  winter_metallic: 'commerce.premium.theme.names.winterMetallic',
}

interface ThemeOption {
  /** `null` is the implicit Default palette, which is also the reset control. */
  key: PremiumThemeKey | null
  /** The `globals.css` selector this card renders itself with. */
  dataTheme: string
  labelKey: string
}

/**
 * The gallery, in render order: the three named palettes then Default.
 *
 * Default is a real fourth card rather than a separate "reset" button, so a subscriber
 * who likes none of the three is not stuck with the last one they tried. It is never
 * gated — it is the state a non-entitled user already has.
 */
const THEME_OPTIONS: readonly ThemeOption[] = [
  ...PREMIUM_THEME_KEYS.map((key) => ({
    key,
    dataTheme: key,
    labelKey: PALETTE_LABEL_KEYS[key],
  })),
  {
    key: null,
    dataTheme: DEFAULT_THEME_ATTRIBUTE,
    labelKey: 'commerce.premium.theme.reset',
  },
]

interface SectionView {
  showGallery: boolean
  showLocked: boolean
  /** Cards are pressable only while the server-evaluated kill switch is on. */
  isSelectable: boolean
  showUnavailableNote: boolean
}

/**
 * What the body renders, in one place.
 *
 * Entitlement reaches this section only as the server-resolved `isEntitled` on the
 * theme response (Decision 7), so the client never combines two endpoints and never has
 * two moments in time to disagree about. Three states deliberately render no gallery
 * and no locked panel: `checking`, `loading`, and `load_failed`. The first two are
 * transient; the third is the honest one — a read that failed tells us nothing about
 * entitlement, and showing a subscriber an upsell for something they already pay for
 * would be worse than showing the error alone (AC 6).
 */
function resolveSectionView(
  sectionState: SectionState,
  theme: PremiumTheme | null
): SectionView {
  const resolved = sectionState === 'ready' ? theme : null
  const entitled = resolved?.isEntitled === true
  const selectable = entitled && resolved?.themesEnabled === true

  return {
    showGallery: entitled,
    showLocked: sectionState === 'signed_out' || (resolved !== null && !entitled),
    isSelectable: selectable,
    showUnavailableNote: entitled && !selectable,
  }
}

function PaletteCard({
  option,
  isSelected,
  isSaving,
  isSelectable,
  onSelect,
}: {
  option: ThemeOption
  isSelected: boolean
  isSaving: boolean
  isSelectable: boolean
  onSelect: () => void
}) {
  const { t } = useTranslation()

  return (
    <li>
      <button
        type="button"
        data-theme={option.dataTheme}
        data-testid={`premium-theme-option-${option.dataTheme}`}
        aria-pressed={isSelected}
        aria-busy={isSaving}
        aria-describedby={isSelectable ? undefined : UNAVAILABLE_HINT_ID}
        disabled={!isSelectable}
        onClick={onSelect}
        className="flex w-full flex-col items-start gap-3 rounded-lg border border-[color:var(--theme-card-border)] bg-[var(--theme-card-bg)] p-4 text-left text-[color:var(--theme-card-text)] disabled:opacity-70"
      >
        <span className="flex items-center gap-2">
          {/*
            The two swatches are the only place `primary` and `secondary` appear. Both
            are ringed in `--theme-card-text` because Autumn Umber's Wheat and Winter
            Metallic's Platinum measure 1.68:1 and 1.36:1 against their own card
            backgrounds: the fill alone would leave no discernible boundary. The ring
            sits at the same 8.01-11.58:1 as the card's text, which clears SC 1.4.11's
            3:1 non-text floor with room to spare.
          */}
          <span
            aria-hidden="true"
            className="h-4 w-4 rounded-full border border-[color:var(--theme-card-text)] bg-[var(--theme-primary)]"
            data-testid={`premium-theme-swatch-primary-${option.dataTheme}`}
          />
          <span
            aria-hidden="true"
            className="h-4 w-4 rounded-full border border-[color:var(--theme-card-text)] bg-[var(--theme-secondary)]"
            data-testid={`premium-theme-swatch-secondary-${option.dataTheme}`}
          />
          <span className="text-base font-semibold">{t(option.labelKey)}</span>
        </span>
        <span
          className="text-sm font-medium"
          data-testid={`premium-theme-state-${option.dataTheme}`}
        >
          {isSelected
            ? t('commerce.premium.theme.selected')
            : t('commerce.premium.theme.select')}
        </span>
      </button>
    </li>
  )
}

/**
 * The surface the applied palette actually re-colors (AC 4, Decision 4).
 *
 * Deliberately the one element in this section that sets no `data-theme` of its own: it
 * inherits the attribute `applyWebThemeAttribute` writes to `<html>`, which is what
 * makes "the choice re-colors the surface immediately" something a reader can see. Every
 * `PaletteCard` pins its own palette so it can advertise that palette, and a card's
 * pinned value beats anything inherited — so without this element the attribute would
 * change nothing on screen and the plumbing would be proven only in a DOM inspector.
 * If a palette is ever added here, do not give it a `data-theme`.
 *
 * The rest of the section stays in the page's own monochrome. That is not an omission:
 * these tokens are a light card system (`--theme-card-text` is #111111 for Default),
 * and painting the section heading or the disclosure with them on `/settings`'s
 * `bg-neutral-950` would put dark text on a near-black page. The preview carries its own
 * background, so it re-colors without ever leaving the pairing that was measured.
 *
 * Both pairings it renders are ones the gallery already proves: text is
 * `--theme-card-text` on `--theme-card-bg` (8.01-17.34:1, `5.3-WEB-122`), and the
 * `--theme-primary` accent is non-text UI carrying no copy (3.05:1 and up,
 * `5.3-WEB-123`).
 */
function LivePreview() {
  const { t } = useTranslation()

  return (
    <div
      className="mt-6 rounded-lg border border-[color:var(--theme-card-border)] bg-[var(--theme-card-bg)] p-4 text-[color:var(--theme-card-text)]"
      data-testid="premium-theme-preview"
    >
      <span
        aria-hidden="true"
        className="block h-1.5 w-16 rounded-full bg-[var(--theme-primary)]"
        data-testid="premium-theme-preview-accent"
      />
      <p className="mt-3 text-base font-semibold">
        {t('commerce.premium.theme.preview.title')}
      </p>
      <p className="mt-1 text-sm leading-relaxed">
        {t('commerce.premium.theme.preview.body')}
      </p>
    </div>
  )
}

/**
 * The locked upsell for a signed-out or non-entitled reader.
 *
 * Same panel shape and `data-testid` convention as `planner-rail.tsx`'s locked branch,
 * with one deliberate divergence (Decision 11): the rail's gold CTA links to
 * `/settings`, and this section already sits on `/settings` two siblings below the
 * subscribe controls. A link back to the page it is already on would be a dead control,
 * so the copy points at those controls instead. No modal, no countdown, no urgency.
 *
 * The body splits by audience because Decision 11's justification only holds for one of
 * them. "Subscribe with the controls above" is true for a signed-in reader, who really
 * does have `SubscriptionSection`'s subscribe controls two siblings up. A signed-out
 * reader does not: that section renders `commerce.premium.signedOutHint` and nothing
 * else, so the same sentence pointed at a control that is not on the page. The
 * signed-out copy names the sign-in step first instead.
 */
/**
 * The palette names, joined the way the reader's language joins a list.
 *
 * The locked copy used to spell all three names out inside every translated
 * sentence, so adding or retiring a palette meant hand-editing twenty localized
 * strings and hoping none was missed. The names now arrive as one
 * `{{palettes}}` interpolation built from `PREMIUM_THEME_KEYS`, which makes the
 * gallery and the upsell copy the same source of truth.
 *
 * `Intl.ListFormat` rather than `join(', ')` because the join is not the same in
 * every language this ships in: German wants "und", French "et", Turkish "ve",
 * Spanish "y", and English and Canadian English disagree about the serial comma
 * — CLDR gives en-US "A, B, and C" and en-CA "A, B and C". Hand-joining would
 * have to encode all of that, wrongly, in ten places.
 *
 * Turkish attaches its case suffix to the end of the list ("{{palettes}}'in"),
 * which works because the formatter puts the final name last in every locale.
 */
function usePaletteNameList(): string {
  const { t, i18n } = useTranslation()
  const language = i18n.language

  return useMemo(() => {
    const names = PREMIUM_THEME_KEYS.map((key) => t(PALETTE_LABEL_KEYS[key]))
    return new Intl.ListFormat(language, {
      style: 'long',
      type: 'conjunction',
    }).format(names)
  }, [t, language])
}

function LockedPanel({ isSignedOut }: { isSignedOut: boolean }) {
  const { t } = useTranslation()
  const palettes = usePaletteNameList()

  return (
    <div
      className="mt-6 space-y-3 rounded-lg border border-neutral-700 bg-neutral-900 p-4"
      data-testid="premium-theme-locked"
    >
      <p className="text-sm font-medium text-white">
        {t('commerce.premium.theme.locked.title')}
      </p>
      <p className="text-sm text-neutral-300">
        {t(
          isSignedOut
            ? 'commerce.premium.theme.locked.signedOutBody'
            : 'commerce.premium.theme.locked.body',
          { palettes }
        )}
      </p>
    </div>
  )
}

export function PremiumThemeSection() {
  const { t } = useTranslation()
  const [sectionState, setSectionState] = useState<SectionState>('checking')
  const [theme, setTheme] = useState<PremiumTheme | null>(null)
  /** The `dataTheme` of the card whose save is in flight, or null when idle. */
  const [savingTheme, setSavingTheme] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  /**
   * The in-flight save, so unmounting cancels it.
   *
   * The read has had this from the start via its own effect controller; the write did
   * not, even though `setThemeFromWeb` already takes a signal. Navigating away mid-save
   * therefore ran the request to completion and then wrote `data-theme` onto the `<html>`
   * of whatever page the reader had moved to, from a component that no longer existed.
   */
  const saveControllerRef = useRef<AbortController | null>(null)

  useEffect(() => () => saveControllerRef.current?.abort(), [])

  /*
   * Resolved outside the effect and depended on by value, mirroring
   * `SubscriptionSection`: depending on `t` itself would tie the effect to a function
   * identity and risk a request loop.
   */
  const loadErrorMessage = t('commerce.premium.theme.loadError')

  useEffect(() => {
    if (!hasWebSession()) {
      // A signed-out reader gets Default, whatever a previous session left behind.
      applyWebThemeAttribute(null)
      setSectionState('signed_out')
      return
    }

    const controller = new AbortController()
    setSectionState('loading')

    void (async () => {
      try {
        const next = await getThemeFromWeb(controller.signal)
        if (controller.signal.aborted) {
          return
        }
        setTheme(next)
        applyWebThemeAttribute(next.theme)
        setSectionState('ready')
      } catch (loadError: unknown) {
        if (controller.signal.aborted) {
          return
        }
        /*
         * AC 6: a failed read renders Default with a quiet inline error. It must not
         * block the rest of the settings page, and it must not leave the surface
         * showing a palette the server no longer confirms.
         */
        applyWebThemeAttribute(null)
        if (premiumThemeFailureReason(loadError) === 'signed_out') {
          // An expired or cleared token is not a broken read. Show the locked panel the
          // signed-out branch already renders instead of an error the reader cannot act
          // on, and never surface the guard's untranslated developer string.
          setSectionState('signed_out')
          return
        }
        setError(loadErrorMessage)
        setSectionState('load_failed')
      }
    })()

    return () => controller.abort()
  }, [loadErrorMessage])

  /**
   * The palette the server last confirmed, which is both what the gallery marks
   * "Selected" and what `handleSelect` compares a press against. Declared here rather
   * than beside `view` below so it reads before its first use.
   */
  const selectedKey = theme?.theme ?? null

  /**
   * Applied on success only, never optimistically.
   *
   * AC 4 is "on successful save, the choice re-colors the surface". Re-coloring the
   * whole page before the server agrees would leave a rejected write (403, or 503 while
   * the kill switch is off) showing a palette that is not stored anywhere, which is a
   * worse lie than a moment of latency on a settings screen.
   */
  async function handleSelect(option: ThemeOption): Promise<void> {
    // Re-pressing the active card would issue a full PUT and emit a second
    // `premium_theme_selected` for one real choice, inflating exactly the adoption count
    // Decision 14 exists to measure, and bumping `updated_at` for a no-op. The server
    // answers 200 for an unchanged value by design, so the client is the only place this
    // can be suppressed.
    if (savingTheme !== null || option.key === selectedKey) {
      return
    }

    // The session is re-read here, not trusted from mount. Signing out in another tab
    // leaves this section rendered and interactive, and without this check the write
    // would fail inside the lib and surface PREMIUM_THEME_SIGNED_OUT_MESSAGE — a
    // developer string with no catalog entry, so English in all ten locales.
    if (!hasWebSession()) {
      applyWebThemeAttribute(null)
      setTheme(null)
      setError(null)
      setSectionState('signed_out')
      return
    }

    const controller = new AbortController()
    saveControllerRef.current = controller
    setSavingTheme(option.dataTheme)
    setError(null)

    try {
      const saved = await setThemeFromWeb(option.key, controller.signal)
      if (controller.signal.aborted) {
        return
      }
      setTheme(saved)
      applyWebThemeAttribute(saved.theme)
    } catch (saveError: unknown) {
      if (controller.signal.aborted) {
        return
      }
      applySaveFailure(saveError)
    } finally {
      if (saveControllerRef.current === controller) {
        saveControllerRef.current = null
      }
      if (!controller.signal.aborted) {
        setSavingTheme(null)
      }
    }
  }

  /**
   * A rejected save re-resolves the section, it does not just print a line.
   *
   * Entitlement can lapse and the kill switch can flip while this page is open. Handling
   * those as error text alone left `isEntitled`/`themesEnabled` stale at `true`, so the
   * gallery stayed fully enabled and every further click failed the same way — the
   * locked panel and the kill-switch note were unreachable from that state, which is the
   * clean fallback AC 6 requires. Folding the rejection back into `theme` renders the
   * localized explanation the catalogs already carry, and costs no extra request.
   *
   * Only the `unknown` branch prints anything, and it prints the catalog string rather
   * than the server's message: `PREMIUM_THEMES_DISABLED_MESSAGE` and
   * `PREMIUM_REQUIRED_MESSAGE` are untranslated English (AC 7).
   */
  function applySaveFailure(saveError: unknown): void {
    switch (premiumThemeFailureReason(saveError)) {
      case 'signed_out':
        applyWebThemeAttribute(null)
        setTheme(null)
        setSectionState('signed_out')
        return
      case 'not_entitled':
        applyWebThemeAttribute(null)
        setTheme((current) =>
          current === null ? null : { ...current, theme: null, isEntitled: false }
        )
        return
      case 'themes_disabled':
        setTheme((current) =>
          current === null ? null : { ...current, themesEnabled: false }
        )
        return
      default:
        setError(t('commerce.premium.theme.saveError'))
    }
  }

  const view = resolveSectionView(sectionState, theme)

  return (
    <section
      aria-labelledby="premium-theme-title"
      data-testid="premium-theme-section"
      aria-busy={sectionState === 'checking' || sectionState === 'loading'}
      className="mt-10 max-w-2xl border-t border-neutral-800 pt-8"
    >
      <h2
        id="premium-theme-title"
        className="text-xl font-semibold text-white"
        data-testid="premium-theme-title"
      >
        {t('commerce.premium.theme.sectionTitle')}
      </h2>

      {/*
        AC 7: what a palette is, where the choice is stored, and what it does not
        change. A sibling text node in reading order before the gallery, never a
        tooltip and never only an accessible name.
      */}
      <p
        className="mt-3 text-sm leading-relaxed text-neutral-200"
        data-testid="premium-theme-disclosure"
      >
        {t('commerce.premium.theme.disclosure')}
      </p>

      {/*
        The kill-switch note precedes the cards it explains, and is the target of their
        `aria-describedby`, so a disabled card is never disabled without a reason.
      */}
      {view.showUnavailableNote && (
        <p
          id={UNAVAILABLE_HINT_ID}
          className="mt-4 text-sm text-neutral-300"
          data-testid="premium-theme-unavailable"
        >
          {t('commerce.premium.theme.unavailable')}
        </p>
      )}

      {view.showGallery && (
        <>
          <ul
            className="mt-6 grid gap-4 sm:grid-cols-2"
            data-testid="premium-theme-gallery"
          >
            {THEME_OPTIONS.map((option) => (
              <PaletteCard
                key={option.dataTheme}
                option={option}
                isSelected={selectedKey === option.key}
                isSaving={savingTheme === option.dataTheme}
                isSelectable={view.isSelectable}
                onSelect={() => {
                  void handleSelect(option)
                }}
              />
            ))}
          </ul>
          {/*
            After the cards, not before them: the reader picks a palette and then sees
            what it does. It also has to sit outside the `<ul>` — a non-`li` child of a
            list is an axe failure, and inside a card it would inherit that card's
            pinned palette instead of the applied one.
          */}
          <LivePreview />
        </>
      )}

      {view.showLocked && <LockedPanel isSignedOut={sectionState === 'signed_out'} />}

      {error && (
        <p
          role="alert"
          className="mt-4 text-sm text-red-300"
          data-testid="premium-theme-error"
        >
          {error}
        </p>
      )}
    </section>
  )
}
