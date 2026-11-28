'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { requestPhotoAiConsent, ResponseError } from '@couture/api-client'
import type { PhotoAiConsentResponse } from '@couture/api-client/contracts/http'
import { useTranslation } from 'react-i18next'
import { getI18n } from '../../i18n'
import { createWebApiClient } from '../../lib/api-client'
import {
  captureWebStyleBearer,
  currentWebSessionOwner,
  currentWebStyleScope,
  readAsMember,
  useWebStyleScope,
} from '../../lib/use-web-session'

export function PhotoAiConsent() {
  const scope = useWebStyleScope()
  return scope ? <MemberPhotoAiConsent key={scope} scope={scope} /> : null
}

function MemberPhotoAiConsent({ scope }: { scope: string }) {
  const { t } = useTranslation('translation', { i18n: getI18n() })
  const requestRef = useRef<AbortController | null>(null)
  const [data, setData] = useState<PhotoAiConsentResponse['data'] | null>(null)
  const [pending, setPending] = useState(true)
  const [feedback, setFeedback] = useState<'error' | 'revoked' | null>(null)

  const load = useCallback(
    async (grantId?: string) => {
      const owner = currentWebSessionOwner()
      if (!owner || currentWebStyleScope() !== scope || requestRef.current) return

      const controller = new AbortController()
      requestRef.current = controller
      const { signal } = controller
      const stillCurrent = () => !signal.aborted && currentWebStyleScope() === scope
      setPending(true)
      setFeedback(null)
      try {
        const response = await readAsMember(
          owner,
          () => {
            const accessToken = captureWebStyleBearer(scope)
            if (!accessToken || !stillCurrent())
              throw new Error('Photo AI session changed.')
            return requestPhotoAiConsent(
              createWebApiClient({
                accessToken,
                fetchApi: (input, init) => {
                  if (!stillCurrent()) throw new Error('Photo AI session changed.')
                  return fetch(input, init)
                },
              }),
              signal,
              grantId
            )
          },
          (error) => error instanceof ResponseError && error.response.status === 401,
          signal
        )
        if (stillCurrent()) {
          setData(response)
          if (grantId) setFeedback('revoked')
        }
      } catch {
        if (stillCurrent()) setFeedback('error')
      } finally {
        if (requestRef.current === controller) requestRef.current = null
        if (stillCurrent()) setPending(false)
      }
    },
    [scope]
  )

  useEffect(() => {
    void load()
    return () => {
      requestRef.current?.abort()
      requestRef.current = null
    }
  }, [load])

  return (
    <section
      aria-labelledby="photo-ai-heading"
      aria-busy={pending}
      className="mt-5 border-t border-line pt-4"
      data-testid="photo-ai-consent"
    >
      <h2 id="photo-ai-heading" className="font-semibold text-ink">
        {t('settings.photoAi.heading')}
      </h2>
      <p className="mt-1 text-sm text-ink-soft" data-testid="photo-ai-consent-status">
        {t('settings.photoAi.off')}
      </p>
      <p className="mt-1 text-sm text-ink-soft">{t('settings.photoAi.manual')}</p>
      {data && data.grants.length > 0 && (
        <ul className="mt-2 divide-y divide-line">
          {data.grants.map(({ id, feature, provider }) => {
            const featureName = t(`settings.photoAi.features.${feature}`)
            return (
              <li
                key={id}
                className="flex flex-wrap items-center justify-between gap-x-3 py-2"
              >
                <div className="min-w-0 break-words text-sm">
                  <p className="font-medium text-ink">{featureName}</p>
                  <p className="text-ink-soft">{provider}</p>
                </div>
                <button
                  aria-label={t('settings.photoAi.revokeLabel', {
                    feature: featureName,
                    provider,
                  })}
                  className="min-h-11 rounded px-2 text-sm font-medium text-ink underline disabled:opacity-50"
                  data-testid={`photo-ai-revoke-${id}`}
                  disabled={pending}
                  onClick={() => void load(id)}
                  type="button"
                >
                  {t('settings.photoAi.revoke')}
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {feedback && (
        <p className="mt-2 text-sm text-ink" role="status">
          {t(
            feedback === 'revoked'
              ? 'settings.photoAi.revoked'
              : data
                ? 'settings.photoAi.revokeError'
                : 'settings.photoAi.loadError'
          )}
        </p>
      )}
      {feedback === 'error' && !data && (
        <button
          type="button"
          className="min-h-11 text-sm text-ink underline"
          onClick={() => void load()}
        >
          {t('settings.photoAi.retry')}
        </button>
      )}
    </section>
  )
}
