'use client'
import {
  communityPreferenceChanges,
  communityDeviceTimezoneDraft,
  isCommunityPreferenceConflict,
  communityPreferenceFailureKey,
  rebaseCommunityPreferenceDraft,
} from '@couture/api-client'
import Link from 'next/link'
import { useEffect, useState, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { CommunityNotificationSettings } from '@couture/api-client/contracts/http'
import { getI18n } from '../../i18n'
import { communitySyncFromWeb } from '../../lib/community'
import {
  webSessionIdentity,
  resolveWebSessionToken,
  signOutWebSession,
} from '../../lib/web-session'
export default function NotificationSettingsPage() {
  const { t } = useTranslation('translation', { i18n: getI18n() })
  const [settings, setSettings] = useState<CommunityNotificationSettings | null>(null)
  const [draft, setDraft] = useState<CommunityNotificationSettings | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const suggestedTimezone = useRef<string | undefined>(undefined)
  const generation = useRef(0)
  const clientRef = useRef<ReturnType<typeof communitySyncFromWeb> | null>(null)
  useEffect(() => {
    let active = true
    let owner: string | null | undefined
    const update = () => {
      const next = webSessionIdentity()
      if (next === owner) return
      owner = next
      const request = ++generation.current
      clientRef.current = null
      setSettings(null)
      setDraft(null)
      setMessage(null)
      setBusy(false)
      if (!next) return
      void (async () => {
        const token = await resolveWebSessionToken()
        if (
          !active ||
          request !== generation.current ||
          webSessionIdentity() !== next ||
          !token
        )
          return
        const client = communitySyncFromWeb(async () => {
          const fresh = await resolveWebSessionToken()
          if (!fresh || webSessionIdentity() !== next)
            throw new Error('Notification account changed.')
          return fresh
        })
        clientRef.current = client
        const value = await client.preferences()
        if (!active || request !== generation.current || webSessionIdentity() !== next)
          return
        setSettings(value)
        const draft = communityDeviceTimezoneDraft(
          value,
          Intl.DateTimeFormat().resolvedOptions().timeZone
        )
        suggestedTimezone.current = value.timezoneConfigured ? undefined : draft.timezone
        setDraft(draft)
      })().catch(() => {
        if (active && request === generation.current)
          setMessage('community.notifications.failed')
      })
    }
    update()
    window.addEventListener('couture:session', update)
    const retire = () => {
      generation.current++
      clientRef.current = null
    }
    return () => {
      active = false
      retire()
      window.removeEventListener('couture:session', update)
    }
  }, [])
  const recoverSave = async (
    error: unknown,
    client: ReturnType<typeof communitySyncFromWeb>,
    settings: CommunityNotificationSettings,
    current: () => boolean
  ) => {
    if (isCommunityPreferenceConflict(error)) {
      setMessage('community.notifications.conflict')
      try {
        const value = await client.preferences()
        if (current()) {
          setSettings(value)
          setDraft((previous) =>
            previous
              ? rebaseCommunityPreferenceDraft(
                  settings,
                  value,
                  previous,
                  suggestedTimezone.current
                )
              : value
          )
        }
      } catch {
        if (current()) setMessage('community.notifications.failed')
      }
    } else setMessage(communityPreferenceFailureKey(error))
  }
  const save = async () => {
    const client = clientRef.current
    const owner = webSessionIdentity()
    if (!draft || !settings || !client || !owner || busy) return
    const request = generation.current
    const current = () => request === generation.current && webSessionIdentity() === owner
    setBusy(true)
    try {
      const base = settings
      const changes = communityPreferenceChanges(settings, draft)
      const updated = Object.keys(changes).length
        ? await client.patchPreferences({ baseRevision: base.revision, ...changes })
        : base
      if (!current()) return
      setSettings(updated)
      setDraft(updated)
      setMessage('community.notifications.saved')
    } catch (error) {
      if (!current()) return
      await recoverSave(error, client, settings, current)
    } finally {
      if (current()) setBusy(false)
    }
  }
  return (
    <main id="main-content" className="mx-auto flex max-w-lg flex-col gap-5 p-6">
      <h1 className="text-3xl font-semibold">{t('community.notifications.title')}</h1>
      {draft && settings && (
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            void save()
          }}
        >
          <label className="flex min-h-12 items-center gap-3">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
            />
            {t('community.notifications.enabled')}
          </label>
          <label className="flex min-h-12 items-center gap-3">
            <input
              type="checkbox"
              checked={draft.quietHoursEnabled}
              onChange={(event) =>
                setDraft({ ...draft, quietHoursEnabled: event.target.checked })
              }
            />
            {t('community.notifications.quiet')}
          </label>
          <label className="flex flex-col gap-2">
            {t('community.notifications.start')}
            <input
              type="time"
              required
              value={draft.quietHoursStart}
              onChange={(event) =>
                setDraft({ ...draft, quietHoursStart: event.target.value })
              }
              className="min-h-12 rounded border p-3"
            />
          </label>
          <label className="flex flex-col gap-2">
            {t('community.notifications.end')}
            <input
              type="time"
              required
              value={draft.quietHoursEnd}
              onChange={(event) =>
                setDraft({ ...draft, quietHoursEnd: event.target.value })
              }
              className="min-h-12 rounded border p-3"
            />
          </label>
          <label className="flex flex-col gap-2">
            {t('community.notifications.timezone')}
            <input
              required
              value={draft.timezone}
              onChange={(event) => {
                suggestedTimezone.current = undefined
                setDraft({ ...draft, timezone: event.target.value })
              }}
              className="min-h-12 rounded border p-3"
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="min-h-12 rounded bg-[#C9A14A] px-4 py-3 text-black"
          >
            {t('community.notifications.save')}
          </button>
        </form>
      )}
      <p role="status" aria-live="polite">
        {message ? t(message) : ''}
      </p>
      <Link href="/signin" className="min-h-12 underline">
        {t('community.notifications.signin')}
      </Link>
      <button
        type="button"
        onClick={() => {
          void signOutWebSession().then(() => window.location.assign('/'))
        }}
        className="min-h-12 underline"
      >
        {t('community.notifications.signout')}
      </button>
      <Link href="/" className="min-h-12 underline">
        {t('community.notifications.back')}
      </Link>
    </main>
  )
}
