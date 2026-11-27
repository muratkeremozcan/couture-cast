'use client'
// Story 6.16 D2: the self-reported age gate. The birthdate stays in this component's
// state, is never sent or stored, and is cleared as soon as it is evaluated.
import Link from 'next/link'
import { useId, useRef, useState, type FormEvent } from 'react'
import { evaluateGuestPreviewGate, type GuestPreviewStrings } from '@couture/utils'

export function GuestPreviewGate({
  strings,
  onEligible,
}: {
  strings: GuestPreviewStrings
  onEligible: () => void
}) {
  const [birthdate, setBirthdate] = useState('')
  const [error, setError] = useState<'underage' | 'invalid' | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const errorId = useId()
  const inputId = useId()

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const result = evaluateGuestPreviewGate(birthdate)
    setBirthdate('')
    if (result.eligible) {
      setError(null)
      onEligible()
      return
    }
    setError(result.reason === 'underage' ? 'underage' : 'invalid')
    inputRef.current?.focus()
  }

  return (
    <section
      aria-labelledby={`${inputId}-heading`}
      data-testid="guest-preview-gate"
      data-surface="card"
      className="mx-auto w-full max-w-md space-y-5 rounded-xl border border-line bg-card p-3 shadow-card [overflow-wrap:anywhere] min-[361px]:p-6"
    >
      {/* Story CC-7.9 D6: the top bar owns the page's only h1. */}
      <h2 id={`${inputId}-heading`} className="text-2xl font-semibold text-ink">
        {strings.gate.heading}
      </h2>
      <p className="text-sm text-ink-soft">{strings.gate.body}</p>
      <form className="space-y-4" onSubmit={submit} noValidate>
        <div className="space-y-2">
          <label htmlFor={inputId} className="block text-sm font-medium text-ink">
            {strings.gate.field}
          </label>
          <input
            ref={inputRef}
            id={inputId}
            name="guest-birthdate"
            inputMode="numeric"
            autoComplete="off"
            placeholder="YYYY-MM-DD"
            value={birthdate}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            onChange={(event) => setBirthdate(event.target.value)}
            data-testid="guest-preview-birthdate"
            className="min-h-11 w-full rounded-lg border border-line-strong bg-page px-3 text-ink"
          />
        </div>
        {error ? (
          <p
            id={errorId}
            role="alert"
            data-testid="guest-preview-gate-error"
            className="text-sm font-medium text-danger-ink"
          >
            {error === 'underage' ? strings.gate.underage : strings.gate.invalid}
          </p>
        ) : null}
        <button
          type="submit"
          data-testid="guest-preview-gate-submit"
          className="min-h-11 w-full rounded-lg bg-inverse px-4 text-sm font-semibold text-on-inverse"
        >
          {strings.gate.submit}
        </button>
      </form>
      <p className="text-xs text-ink-muted">{strings.gate.selfReported}</p>
      <Link
        href="/"
        data-testid="guest-preview-gate-exit"
        className="inline-flex min-h-11 items-center text-sm font-medium text-ink underline underline-offset-4"
      >
        {strings.gate.exit}
      </Link>
    </section>
  )
}
