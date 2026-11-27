// Learning path Step 57: Google sign-in.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-57-google-sign-in
// Story 6.17 D3, D5, D11: the web finish step. W-A11Y-FOCUS (focus on the birthdate field),
// the email signup's inline birthdate messages announced, errors in role=alert, and Cancel
// (E-CANCEL at component level): the identity is deleted first, then the person goes back to
// the door, or to the preview they came from.
// Plan: _bmad-output/test-artifacts/test-design/cc617-google-sign-in-test-design.md
// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
// Story CC-7.11 test owner (TEA): the top bar's history-aware back reads the router (D11).
// Test design: _bmad-output/test-artifacts/test-design-7-11-five-tab-navigation-back-pattern.md
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type * as NextNavigation from 'next/navigation'
import {
  createGuestPreviewState,
  evaluateBirthdateInput,
  getFederatedSignInStrings,
  GUEST_PREVIEW_SAVE_INTENT,
  SAMPLE_CATALOG,
} from '@couture/utils'
import { getI18n } from '../../../i18n'
import type * as CoutureUtils from '@couture/utils'
import type * as WebSession from '../../../lib/web-session'

// The birthdate check under a chosen guardian consent policy, so the message a 13 to 15 year
// old saw under required_13_15 stays proven for the day consent comes back.
const agePolicy = vi.hoisted(() => ({ current: 'off' as 'off' | 'required_13_15' }))
vi.mock('@couture/utils', async (importOriginal) => {
  const utils = await importOriginal<typeof CoutureUtils>()
  return {
    ...utils,
    evaluateBirthdateInput: (input: string, today?: Date) =>
      utils.evaluateBirthdateInput(input, today, agePolicy.current),
  }
})
const session = vi.hoisted(() => ({
  read: vi.fn(),
  cancel: vi.fn(),
  finish: vi.fn(),
  awaiting: vi.fn(),
  signOut: vi.fn(),
}))
vi.mock('../../../lib/web-session', async (importOriginal) => ({
  ...(await importOriginal<typeof WebSession>()),
  readWebFederatedIdentity: session.read,
  cancelWebFederatedSignup: session.cancel,
  finishWebFederatedSignup: session.finish,
  fetchWebAwaitingGuardianAccount: session.awaiting,
  signOutWebSession: session.signOut,
}))
const preview = vi.hoisted(() => ({ clear: vi.fn(), load: vi.fn(), snapshot: vi.fn() }))
const guardian = vi.hoisted(() => ({ invite: vi.fn() }))
vi.mock('../../../lib/guardian', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  inviteGuardianFromWeb: guardian.invite,
}))
const destination = vi.hoisted(() => ({ next: vi.fn() }))
vi.mock('../../../lib/post-signin-destination', () => ({
  destinationAfterSignIn: destination.next,
}))
vi.mock('../../../lib/guest-preview', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  webGuestPreviewStore: () => ({
    clear: preview.clear,
    load: preview.load,
    snapshot: preview.snapshot,
  }),
}))
import { webGuestPreviewBirthdate } from '../../../lib/guest-preview-birthdate'
import { FinishSignupForm } from './finish-signup-form'

// Story CC-7.11 D11: the top bar's back reads the router. Outside a mounted app router the real
// hook throws, so the test supplies one and keeps the rest of next/navigation.
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof NextNavigation>()),
  useRouter: () => ({
    back: vi.fn(),
    replace: vi.fn(),
    push: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
}))

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
  session.awaiting.mockResolvedValue(null)
  session.signOut.mockResolvedValue(undefined)
  preview.load.mockResolvedValue({ state: null, persistent: true })
  preview.snapshot.mockReturnValue({ state: null, persistent: true })
  destination.next.mockResolvedValue('/')
  agePolicy.current = 'off'
})

afterEach(() => {
  webGuestPreviewBirthdate.clear()
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
  it.each([['under 13', birthdate(10)]])(
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

  it('announces the guardian approval notice under the required policy for a 13 to 15 birthdate', async () => {
    agePolicy.current = 'required_13_15'
    const field = await renderForm()
    fireEvent.change(field, { target: { value: birthdate(14) } })
    const shown = await screen.findByText('You need your guardian’s approval.', {
      exact: true,
    })
    expect(liveRegionOf(shown)).not.toBeNull()
  })

  // Guardian consent is off (owner ruling 2026-11-16): a teen sees no guardian message.
  it.each([
    ['13 to 15', birthdate(14)],
    ['an adult', birthdate(30)],
  ])('%s birthdate shows no inline message', async (_label, value) => {
    const field = await renderForm()
    fireEvent.change(field, { target: { value } })
    expect(evaluateBirthdateInput(value).message).toBeNull()
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

it('lets a guardian-pending teen continue to the first-run review', async () => {
  preview.load.mockResolvedValue({
    state: { conversion: { intent: GUEST_PREVIEW_SAVE_INTENT } },
    persistent: true,
  })
  session.awaiting.mockResolvedValue('teen-pending')
  destination.next.mockResolvedValue('/preview/continue')
  render(<FinishSignupForm fromPreview door="signup" />)
  const continueButton = await screen.findByRole('button', { name: strings.continue })
  expect(screen.getByLabelText(strings.guardianEmail)).toBeVisible()
  fireEvent.click(continueButton)
  await waitFor(() => expect(replace).toHaveBeenCalledWith('/preview/continue'))
  expect(session.signOut).not.toHaveBeenCalled()
})

it('reuses the age-check date when Google returns to a first-run look in the same app', async () => {
  const draft = createGuestPreviewState(Date.now(), SAMPLE_CATALOG)
  const snapshot = {
    state: { ...draft, conversion: { intent: GUEST_PREVIEW_SAVE_INTENT } },
    persistent: true,
  }
  preview.load.mockResolvedValue(snapshot)
  preview.snapshot.mockReturnValue(snapshot)
  const date = birthdate(30)
  webGuestPreviewBirthdate.remember(draft, date)
  session.finish.mockResolvedValue({ kind: 'signed_in' })
  destination.next.mockResolvedValue('/preview/continue')
  const field = await renderForm({ fromPreview: true, door: 'signup' })
  await waitFor(() => expect(field).toHaveValue(date))
  fireEvent.click(screen.getByRole('button', { name: strings.create }))
  await waitFor(() => expect(replace).toHaveBeenCalledWith('/preview/continue'))
  expect(session.finish).toHaveBeenCalledExactlyOnceWith(date, true)
  expect(field).toHaveValue('')
})

it.each([
  ['guardian_minor', strings.guardianMinor, 'finish-signup-message'],
  ['unavailable', strings.createUnavailable, 'finish-signup-message'],
  ['refused', strings.refused, 'finish-signup-outcome'],
  ['no_session', strings.noSession, 'finish-signup-outcome'],
] as const)('shows the finish outcome for %s', async (kind, copy, target) => {
  session.finish.mockResolvedValue({ kind })
  const field = await renderForm()
  fireEvent.change(field, { target: { value: birthdate(30) } })
  fireEvent.click(screen.getByRole('button', { name: strings.create }))
  await waitFor(() => expect(screen.getByTestId(target)).toHaveTextContent(copy))
  expect(replace).not.toHaveBeenCalled()
})

// Antigravity P2-1, D3: an age refusal clears any guest preview stored on this device, whichever
// door started the round trip, not only a conversion that carried from=preview.
describe('W-UNDERAGE: the refusal clears stored guest preview state', () => {
  it.each([{ fromPreview: false }, { fromPreview: true }])('%j', async (props) => {
    session.finish.mockResolvedValue({ kind: 'underage' })
    const input = await renderForm(props)
    fireEvent.change(input, { target: { value: birthdate(10) } })
    fireEvent.click(screen.getByRole('button', { name: strings.create }))
    await waitFor(() => expect(preview.clear).toHaveBeenCalledTimes(1))
  })
})

// TEA sign-off F-2 (guardian consent off): the server creates a 13 to 15 year old active with
// no guardian, and the client keys on that answer alone, never on the age it carries.
describe('W-OFF-TEEN-CREATED: an active 13 to 15 account goes straight in', () => {
  it.each([13, 14, 15])('age %i', async (age) => {
    session.finish.mockResolvedValue({
      kind: 'created',
      account: {
        userId: 'teen-google-off',
        age,
        accountStatus: 'active',
        guardianConsentRequired: false,
      },
    })
    const input = await renderForm()
    fireEvent.change(input, { target: { value: birthdate(age) } })
    fireEvent.click(screen.getByRole('button', { name: strings.create }))
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'))
    expect(destination.next).toHaveBeenCalledExactlyOnceWith(false)
    expect(screen.queryByLabelText(strings.guardianEmail)).toBeNull()
    expect(screen.queryByText(strings.guardianStepTitle)).toBeNull()
    expect(screen.queryByText(strings.guardianTitle)).toBeNull()
  })
})

// D3: a teen created through Google lands on the email signup's guardian invitation step.
describe('W-TEEN-GUARDIAN: the guardian step after a 13 to 15 account is created', () => {
  async function createTeen() {
    session.finish.mockResolvedValue({
      kind: 'created',
      account: {
        userId: 'teen-google-1',
        age: 14,
        accountStatus: 'pending_guardian_consent',
        guardianConsentRequired: true,
      },
    })
    const input = await renderForm()
    fireEvent.change(input, { target: { value: birthdate(14) } })
    fireEvent.click(screen.getByRole('button', { name: strings.create }))
    await screen.findByText(strings.guardianTitle)
    expect(screen.getByTestId('finish-signup-outcome').textContent).toBe(
      strings.createdGuardianPending
    )
  }

  it('refuses an invalid guardian address and sends nothing', async () => {
    await createTeen()
    fireEvent.change(screen.getByLabelText(strings.guardianEmail), {
      target: { value: 'not-an-address' },
    })
    fireEvent.click(screen.getByRole('button', { name: strings.sendInvite }))
    await screen.findByText(strings.invalidGuardianEmail)
    expect(guardian.invite).not.toHaveBeenCalled()
  })

  it('sends the invite with the chosen consent level and shows the link', async () => {
    guardian.invite.mockResolvedValue({
      guardianEmail: 'guardian@synthetic.test',
      invitationLink: 'https://couturecast.synthetic.test/guardian/accept?token=t',
    })
    await createTeen()
    fireEvent.change(screen.getByLabelText(strings.guardianEmail), {
      target: { value: 'guardian@synthetic.test' },
    })
    fireEvent.change(screen.getByLabelText(strings.consentLevel), {
      target: { value: 'full_access' },
    })
    fireEvent.click(screen.getByRole('button', { name: strings.sendInvite }))
    await screen.findByText(
      strings.inviteSent.replace('{email}', 'guardian@synthetic.test')
    )
    expect(guardian.invite).toHaveBeenCalledWith({
      teenId: 'teen-google-1',
      guardianEmail: 'guardian@synthetic.test',
      consentLevel: 'full_access',
    })
    expect(
      screen.getByText('https://couturecast.synthetic.test/guardian/accept?token=t')
    ).toBeTruthy()
  })

  it('says the invite failed when the request fails', async () => {
    guardian.invite.mockRejectedValue(new Error('down'))
    await createTeen()
    fireEvent.change(screen.getByLabelText(strings.guardianEmail), {
      target: { value: 'guardian@synthetic.test' },
    })
    fireEvent.click(screen.getByRole('button', { name: strings.sendInvite }))
    await screen.findByText(strings.inviteFailed)
  })
})

// Owner's production loop (2026-11-15): a returning teen the guardian lock refuses gets the
// guardian invitation, and leaving the step ends the session.
describe('W-TEEN-RESIGN: the finish step for a teen waiting on a guardian', () => {
  it('shows the guardian invitation, never the birthdate question', async () => {
    session.awaiting.mockResolvedValue('teen-pending-1')
    render(<FinishSignupForm fromPreview={false} door="signin" />)
    await screen.findByText(strings.awaitingGuardian)
    expect(session.awaiting).toHaveBeenCalledWith('signed-waiting-identity')
    expect(screen.getByLabelText(strings.guardianEmail)).toBeTruthy()
    expect(screen.queryByLabelText(strings.birthdate)).toBeNull()
    guardian.invite.mockResolvedValue({
      guardianEmail: 'guardian@synthetic.test',
      invitationLink: 'https://couturecast.synthetic.test/guardian/accept?token=t',
    })
    fireEvent.change(screen.getByLabelText(strings.guardianEmail), {
      target: { value: 'guardian@synthetic.test' },
    })
    fireEvent.click(screen.getByRole('button', { name: strings.sendInvite }))
    await waitFor(() =>
      expect(guardian.invite).toHaveBeenCalledWith({
        teenId: 'teen-pending-1',
        guardianEmail: 'guardian@synthetic.test',
        consentLevel: 'read_only',
      })
    )
  })

  it('Sign out ends the session before going home', async () => {
    let settle!: () => void
    session.signOut.mockReturnValue(
      new Promise<void>((resolve) => {
        settle = resolve
      })
    )
    session.awaiting.mockResolvedValue('teen-pending-1')
    render(<FinishSignupForm fromPreview={false} door="signin" />)
    await screen.findByText(strings.awaitingGuardian)
    expect(screen.getByRole('heading', { name: strings.guardianStepTitle })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: strings.guardianStepLeave }))
    await waitFor(() => expect(session.signOut).toHaveBeenCalledTimes(1))
    expect(replace).not.toHaveBeenCalled()
    settle()
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'))
  })
})
