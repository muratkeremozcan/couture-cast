// Story 6.8 Task 4 step 2 owner: prepare a real ritual card on web in `apps/web/src/app/components/ritual-share-card-launcher.tsx`
'use client'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Link from 'next/link'
import type { ScenarioOutfit } from '@couture/api-client/contracts/http'
import { getGuestPreviewStrings } from '@couture/utils'
import { getRitualFromWeb, ritualFailure, SET_CITY_FROM_HOME } from '../../lib/ritual'
import { currentI18n } from '../../i18n'
import { resolveWebSessionToken, webSessionIdentity } from '../../lib/web-session'
import { ShareCardControl } from './share-card-dialog'

export function RitualShareCardLauncher({ outfit }: { outfit?: ScenarioOutfit } = {}) {
  if (outfit) {
    return (
      <div data-testid="ritual-share-card-launcher">
        <ShareCardControl
          key={outfit.id}
          source={{ kind: 'outfit', recommendationId: outfit.id }}
        />
      </div>
    )
  }
  return <RitualShareCardSourcePicker />
}

function RitualShareCardSourcePicker() {
  const { t, i18n } = useTranslation(undefined, { i18n: currentI18n() })
  const [outfits, setOutfits] = useState<ScenarioOutfit[]>([])
  const [scenario, setScenario] = useState('morning')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<'missing-city' | 'failed' | null>(null)
  const pending = useRef<AbortController | null>(null)
  useEffect(() => {
    let member = webSessionIdentity()
    const clear = () => {
      pending.current?.abort()
      pending.current = null
      setOutfits([])
      setBusy(false)
      setError(null)
    }
    const sessionChanged = () => {
      const next = webSessionIdentity()
      // Initial verification publishes the member that the pending resolver awaits.
      // A known owner's departure invalidates that owner's request and composition.
      if (member !== null && member !== next) clear()
      member = next
    }
    window.addEventListener('couture:session', sessionChanged)
    return () => {
      clear()
      window.removeEventListener('couture:session', sessionChanged)
    }
  }, [])
  const activate = async () => {
    if (pending.current) return
    const abort = new AbortController()
    pending.current = abort
    setBusy(true)
    setError(null)
    try {
      if (!navigator.onLine) throw new Error('offline')
      const token = await resolveWebSessionToken()
      if (abort.signal.aborted) return
      if (!token) throw new Error('signed_out')
      const result = await getRitualFromWeb(token, i18n.language, abort.signal)
      if (!abort.signal.aborted)
        setOutfits(result.outfits.filter((outfit) => outfit.garmentIds.length > 0))
    } catch (error) {
      const kind = await ritualFailure(error)
      if (!abort.signal.aborted) setError(kind)
    } finally {
      if (pending.current === abort) {
        pending.current = null
        setBusy(false)
      }
    }
  }
  const selected = outfits.find((outfit) => outfit.scenario === scenario)
  return (
    <div
      className="rounded-lg border border-[color:var(--lookbook-cream-line)] bg-[var(--lookbook-cream)] p-4 text-[color:var(--lookbook-cream-ink)]"
      data-testid="ritual-share-card-launcher"
    >
      <button
        type="button"
        className="min-h-[44px] text-sm font-semibold text-[color:var(--lookbook-cream-ink)]"
        disabled={busy}
        onClick={() => void activate()}
      >
        {t(`shareCard.${busy ? 'preparing' : 'launcher'}`)}
      </button>
      {error === 'failed' && <p role="alert">{t('shareCard.sourceUnavailable')}</p>}
      {error === 'missing-city' && (
        <Link
          className="inline-flex min-h-11 items-center px-2 underline"
          href={SET_CITY_FROM_HOME}
        >
          {getGuestPreviewStrings(i18n.language).firstUse.setCity}
        </Link>
      )}
      {outfits.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm">
            {t('shareCard.sourceOutfit')}
            <select
              className="ml-2 min-h-[44px] rounded bg-[var(--lookbook-surface)] px-3"
              value={scenario}
              onChange={(event) => setScenario(event.target.value)}
            >
              {['morning', 'midday', 'evening'].map((value) => (
                <option key={value} value={value}>
                  {t(`shareCard.scenarios.${value}`)}
                </option>
              ))}
            </select>
          </label>
          {selected && (
            <ShareCardControl
              key={selected.id}
              source={{ kind: 'outfit', recommendationId: selected.id }}
            />
          )}
        </div>
      )}
    </div>
  )
}
