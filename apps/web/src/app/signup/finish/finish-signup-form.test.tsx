// Learning path Step 57: Google sign-in.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-57-google-sign-in
// Story 6.17 D3, D5, D11: the web finish step. W-A11Y-FOCUS (focus on the birthdate field),
// the email signup's inline birthdate messages announced, errors in role=alert, and Cancel
// (E-CANCEL at component level): the identity is deleted first, then the person goes back to
// the door, or to the preview they came from.
// Plan: _bmad-output/test-artifacts/test-design/cc617-google-sign-in-test-design.md
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { evaluateBirthdateInput, getFederatedSignInStrings } from '@couture/utils'
import { getI18n } from '../../../i18n'
import type * as WebSession from '../../../lib/web-session'

const session = vi.hoisted(() => ({
  read: vi.fn(),
  cancel: vi.fn(),
  finish: vi.fn(),
}))
vi.mock('../../../lib/web-session', async (importOriginal) => ({
  ...(await importOriginal<typeof WebSession>()),
  readWebFederatedIdentity: session.read,
  cancelWebFederatedSignup: session.cancel,
  finishWebFederatedSignup: session.finish,
}))
import { FinishSignupForm } from './finish-signup-form'

const strings = getFederatedSignInStrings('en-US')
const realLocation = window.location
let replace: Mock

/** A birthdate `age` years and half a year ago, so the age holds whatever the date. */
function birthdate(age: number) {
  const now = new Date()
  const birthday = Date.UTC(
    now.getUTCFullYear() - age,
    now.getUTCMonth(),
    now.getUTCDate()
  )
  return new Date(birthday - 182 * 86_400_000).toISOString().slice(0, 10)
}

async function renderForm(
  props: { fromPreview?: boolean; door?: 'signin' | 'signup' } = {}
) {
  render(
    <FinishSignupForm
      fromPreview={props.fromPreview ?? false}
      door={props.door ?? 'signin'}
    />
  )
  return screen.findByLabelText(strings.birthdate)
}

/** The live region (role=alert or aria-live) that announces `element`, if any. */
function liveRegionOf(element: HTMLElement) {
  return element.closest('[role="alert"], [role="status"], [aria-live]')
}

beforeEach(async () => {
  await getI18n().changeLanguage('en-US')
  replace = vi.fn()
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...realLocation, replace },
  })
  session.read.mockResolvedValue({
    accessToken: 'signed-waiting-identity',
    email: 'waiting@synthetic.test',
  })
  session.cancel.mockResolvedValue(undefined)
})

afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: realLocation })
  vi.clearAllMocks()
})

describe('W-A11Y-FOCUS: the finish step opens on its only question', () => {
  it('moves focus to the birthdate field and shows the Google address read-only', async () => {
    const field = await renderForm()
    await waitFor(() => expect(field).toHaveFocus())
    expect(screen.getByTestId('finish-signup-email')).toHaveTextContent(
      'waiting@synthetic.test'
    )
    expect(screen.queryByRole('textbox', { name: /email/i })).toBeNull()
  })
})

describe('D3: the email signup inline birthdate messages, announced', () => {
  // Review finding 3: red on the pre-fix range, which showed one fixed message only on submit.
  it.each([
    ['under 13', birthdate(10)],
    ['13 to 15', birthdate(14)],
  ])(
    "a birthdate %s announces evaluateBirthdateInput's message",
    async (_label, value) => {
      const field = await renderForm()
      fireEvent.change(field, { target: { value } })
      const expected = evaluateBirthdateInput(value).message
      expect(expected).not.toBeNull()
      const shown = await screen.findByText(expected!)
      expect(liveRegionOf(shown)).not.toBeNull()
    }
  )

  it('an adult birthdate shows no inline message', async () => {
    const field = await renderForm()
    fireEvent.change(field, { target: { value: birthdate(30) } })
    expect(evaluateBirthdateInput(birthdate(30)).message).toBeNull()
    expect(screen.queryByTestId('finish-signup-inline-message')).toBeNull()
  })

  it('a submit with no usable birthdate is refused in role=alert and sends nothing', async () => {
    await renderForm()
    fireEvent.submit(
      screen.getByRole('button', { name: strings.create }).closest('form')!
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(strings.invalidBirthdate)
    expect(session.finish).not.toHaveBeenCalled()
  })
})

describe('E-CANCEL: Cancel deletes the waiting identity, then leaves', () => {
  it.each([
    [{ door: 'signin' as const }, '/signin'],
    [{ door: 'signup' as const }, '/signup'],
    // D5 (TEA ruling): back to the door, which keeps the preview intent and its Back to preview link.
    [{ fromPreview: true, door: 'signup' as const }, '/signup?from=preview'],
  ])('%j leaves for %s only after the cancel settles', async (props, destination) => {
    let settle!: () => void
    session.cancel.mockReturnValue(
      new Promise<void>((resolve) => {
        settle = resolve
      })
    )
    await renderForm(props)
    fireEvent.click(screen.getByRole('button', { name: strings.cancel }))
    await waitFor(() => expect(session.cancel).toHaveBeenCalledTimes(1))
    expect(replace).not.toHaveBeenCalled()
    settle()
    await waitFor(() => expect(replace).toHaveBeenCalledWith(destination))
  })
})
