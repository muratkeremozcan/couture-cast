'use client'

import { useState, type FormEvent } from 'react'
import type { SignupInput, SignupResponse } from '@couture/api-client/contracts/http'
import {
  AGE_GATE_MESSAGES,
  evaluateBirthdateInput,
  INVALID_BIRTHDATE_MESSAGE,
} from '@couture/utils'
import { submitWebSignup } from '../../lib/signup'

type SignupFormProps = {
  submitSignup?: (input: SignupInput) => Promise<SignupResponse>
}

export function SignupForm({ submitSignup = submitWebSignup }: SignupFormProps) {
  const [email, setEmail] = useState('')
  const [birthdate, setBirthdate] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const birthdateEvaluation = evaluateBirthdateInput(birthdate)
  const inlineMessage = birthdateEvaluation.message

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setErrorMessage(null)
    setSuccessMessage(null)

    if (birthdateEvaluation.kind !== 'valid') {
      setErrorMessage(INVALID_BIRTHDATE_MESSAGE)
      return
    }

    const { gate } = birthdateEvaluation

    if (!gate.allowed) {
      setErrorMessage(AGE_GATE_MESSAGES.underage)
      return
    }

    setIsSubmitting(true)

    try {
      const response = await submitSignup({ email, birthdate })
      setSuccessMessage(
        response.guardianConsentRequired
          ? AGE_GATE_MESSAGES.guardianRequired
          : 'Account created. You can continue to onboarding.'
      )
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Signup failed')
    } finally {
      setIsSubmitting(false)
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    void handleSubmit(event)
  }

  return (
    <form
      className="space-y-6 rounded-3xl border border-white/10 bg-white/5 p-8"
      onSubmit={onSubmit}
    >
      <div className="space-y-2">
        <label htmlFor="signup-email" className="text-sm font-medium text-neutral-100">
          Email
        </label>
        <input
          id="signup-email"
          name="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="w-full rounded-xl border border-white/15 bg-black/30 px-4 py-3 text-white outline-none transition focus:border-amber-300"
        />
      </div>

      <div className="space-y-2">
        <label
          htmlFor="signup-birthdate"
          className="text-sm font-medium text-neutral-100"
        >
          Birthdate
        </label>
        <input
          id="signup-birthdate"
          name="birthdate"
          type="date"
          required
          value={birthdate}
          onChange={(event) => setBirthdate(event.target.value)}
          className="w-full rounded-xl border border-white/15 bg-black/30 px-4 py-3 text-white outline-none transition focus:border-amber-300"
        />
        {inlineMessage ? (
          <p
            data-testid="signup-inline-message"
            className="text-sm text-amber-200"
            aria-live="polite"
          >
            {inlineMessage}
          </p>
        ) : null}
      </div>

      {errorMessage ? (
        <p
          data-testid="signup-error-message"
          className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200"
          aria-live="assertive"
        >
          {errorMessage}
        </p>
      ) : null}

      {successMessage ? (
        <p
          data-testid="signup-success-message"
          className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200"
          aria-live="polite"
        >
          {successMessage}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full rounded-full bg-amber-300 px-5 py-3 text-sm font-semibold uppercase tracking-[0.24em] text-black transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-70"
      >
        {isSubmitting ? 'Creating account…' : 'Create account'}
      </button>
    </form>
  )
}
