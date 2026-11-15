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
      className="mx-auto w-full max-w-md space-y-5 rounded-[8px] border border-[#E6E6ED] bg-[#FFFFFF] p-6 shadow-sm"
    >
      <h1
        id={`${inputId}-heading`}
        className="lookbook-display text-2xl font-semibold text-[#111111]"
      >
        {strings.gate.heading}
      </h1>
      <p className="text-sm text-[#36363D]">{strings.gate.body}</p>
      <form className="space-y-4" onSubmit={submit} noValidate>
        <div className="space-y-2">
          <label htmlFor={inputId} className="block text-sm font-medium text-[#111111]">
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
            className="min-h-11 w-full rounded-lg border border-[#C9C9D1] bg-[#FFFFFF] px-3 text-[#111111]"
          />
        </div>
        {error ? (
          <p
            id={errorId}
            role="alert"
            data-testid="guest-preview-gate-error"
            className="text-sm font-medium text-[#9F1D1D]"
          >
            {error === 'underage' ? strings.gate.underage : strings.gate.invalid}
          </p>
        ) : null}
        <button
          type="submit"
          data-testid="guest-preview-gate-submit"
          className="min-h-11 w-full rounded-lg bg-[#111111] px-4 text-sm font-semibold text-[#FFFFFF]"
        >
          {strings.gate.submit}
        </button>
      </form>
      <p className="text-xs text-[#5C5C66]">{strings.gate.selfReported}</p>
      <Link
        href="/"
        data-testid="guest-preview-gate-exit"
        className="inline-flex min-h-11 items-center text-sm font-medium text-[#8A691F] underline underline-offset-4"
      >
        {strings.gate.exit}
      </Link>
    </section>
  )
}
