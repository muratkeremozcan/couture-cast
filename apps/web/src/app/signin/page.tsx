'use client'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getI18n } from '../../i18n'
import { requestWebOtp, verifyWebOtp } from '../../lib/web-session'
export default function SignInPage() {
  const { t } = useTranslation('translation', { i18n: getI18n() })
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  return (
    <main id="main-content" className="mx-auto flex max-w-md flex-col gap-5 p-6">
      <h1 className="text-3xl font-semibold">{t('community.notifications.signin')}</h1>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          setBusy(true)
          setMessage(null)
          const action = sent ? verifyWebOtp(email, code) : requestWebOtp(email)
          void action
            .then(() => {
              if (sent) window.location.assign('/')
              else {
                setSent(true)
                setMessage('community.notifications.codeSent')
              }
            })
            .catch(() => setMessage('community.notifications.failed'))
            .finally(() => setBusy(false))
        }}
      >
        <label className="flex flex-col gap-2">
          {t('community.notifications.email')}
          <input
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            disabled={sent || busy}
            onChange={(event) => setEmail(event.target.value)}
            className="min-h-12 rounded border p-3"
          />
        </label>
        {sent && (
          <label className="flex flex-col gap-2">
            {t('community.notifications.code')}
            <input
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              value={code}
              onChange={(event) => setCode(event.target.value)}
              className="min-h-12 rounded border p-3"
            />
          </label>
        )}
        <button
          type="submit"
          disabled={busy}
          className="min-h-12 rounded bg-[#C9A14A] px-4 py-3 text-black focus-visible:outline focus-visible:outline-2"
        >
          {t(
            sent ? 'community.notifications.verify' : 'community.notifications.sendCode'
          )}
        </button>
      </form>
      <p role="status" aria-live="polite">
        {message ? t(message) : ''}
      </p>
    </main>
  )
}
