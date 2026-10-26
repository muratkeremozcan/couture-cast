'use client'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { withRequestDeadline } from '@couture/api-client'
import {
  ritualResponseSchema,
  resolveSupportedLocale,
  type ScenarioOutfit,
} from '@couture/api-client/contracts/http'
import { currentI18n } from '../../i18n'
import { createWebApiClient } from '../../lib/api-client'
import { resolveWebSessionToken, webSessionIdentity } from '../../lib/web-session'
import { ShareCardControl } from './share-card-dialog'

export function RitualShareCardLauncher() {
  const { t, i18n } = useTranslation(undefined, { i18n: currentI18n() })
  const [outfits, setOutfits] = useState<ScenarioOutfit[]>([])
  const [scenario, setScenario] = useState('morning')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const pending = useRef<AbortController | null>(null)
  useEffect(() => {
    let member = webSessionIdentity()
    const clear = () => {
      pending.current?.abort()
      pending.current = null
      setOutfits([])
      setBusy(false)
      setError(false)
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
    setError(false)
    try {
      if (!navigator.onLine) throw new Error('offline')
      const token = await resolveWebSessionToken()
      if (abort.signal.aborted) return
      if (!token) throw new Error('signed_out')
      const api = createWebApiClient({ accessToken: token })
      const result = await withRequestDeadline(16000, [abort.signal], (signal) =>
        api.apiV1RitualGet(
          { locale: resolveSupportedLocale(i18n.language) ?? 'en-US' },
          { signal }
        )
      )
      if (!abort.signal.aborted)
        setOutfits(ritualResponseSchema.parse(result).data.outfits)
    } catch {
      if (!abort.signal.aborted) setError(true)
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
      className="rounded-lg border border-[#D7C8A7] bg-[#F7F3E8] p-4"
      data-testid="ritual-share-card-launcher"
    >
      <button
        type="button"
        className="min-h-[44px] text-sm font-semibold text-[#292724]"
        disabled={busy}
        onClick={() => void activate()}
      >
        {t(`shareCard.${busy ? 'preparing' : 'launcher'}`)}
      </button>
      {error && <p role="alert">{t('shareCard.sourceUnavailable')}</p>}
      {outfits.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm">
            {t('shareCard.sourceOutfit')}
            <select
              className="ml-2 min-h-[44px] rounded bg-white px-3"
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
