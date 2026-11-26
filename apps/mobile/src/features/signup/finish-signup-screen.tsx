// Story 6.17 D3: "Finish creating your account" on iOS and Android. The Google identity is
// already verified; the only question is the birthdate, and the server's age gate decides.
import { useEffect, useRef, useState } from 'react'
import { BackHandler, Pressable, ScrollView, TextInput } from 'react-native'
import { useTranslation } from 'react-i18next'
import {
  guardianInvitationInputSchema,
  type GuardianInvitationInput,
  type GuardianInvitationResponse,
  type SignupResponse,
} from '@couture/api-client/contracts/http'
import { evaluateBirthdateInput, getFederatedSignInStrings } from '@couture/utils'
import { Text, View, createSchemeStyles } from '@/components/themed'
import { useAccessibilityAnnouncer } from '@/src/hooks/use-accessibility-announcer'
import { inviteGuardianFromMobile } from '@/src/lib/guardian'
import type {
  NativeFederatedFinishResult,
  readNativeFederatedIdentity as ReadIdentity,
} from '@/src/lib/native-session'

type Phase =
  | { kind: 'loading' }
  | { kind: 'no_session' }
  | { kind: 'form'; email: string | null }
  | { kind: 'refused' }
  | { kind: 'underage' }
  | { kind: 'created'; account: SignupResponse }
  // A returning teen whose guardian has not approved (or has revoked): the invitation again.
  | { kind: 'awaiting_guardian'; accountId: string }

/**
 * `until_approved`: a teen leaves the guardian step. Every signed-in request refuses them until
 * a guardian approves, so the route ends the session before leaving.
 */
export type FinishSignupExit =
  | 'continue'
  | 'cancelled'
  | 'home'
  | 'signin'
  | 'until_approved'

type FinishSignupScreenProps = {
  /** The route navigates; this screen stays router-free. */
  onExit: (exit: FinishSignupExit) => void
  /** Story 6.16 D2: an age refusal outranks the preview's self-reported gate. */
  onUnderage?: () => void
  /**
   * The header title for the current phase: the finish step's title while the form shows,
   * none once the step has an outcome (a refusal, or an account that already exists).
   */
  onTitleChange?: (title: string) => void
  readIdentity?: typeof ReadIdentity
  /** The teen account the identity waits on a guardian for, or null (the birthdate form). */
  awaitingAccount?: (accessToken: string) => Promise<string | null>
  finish?: (birthdate: string) => Promise<NativeFederatedFinishResult>
  cancel?: () => Promise<void>
  inviteGuardian?: (input: GuardianInvitationInput) => Promise<GuardianInvitationResponse>
}

const session = () => import('../../lib/native-session.js')

// Module-level, so each default keeps one identity across renders: the identity read below runs
// once per `readIdentity`, and a fresh default on every render would re-read it after each state
// change, replacing an under-13 refusal (identity signed out) with the no-session text and a
// teen's guardian step with the form again.
const readSessionIdentity: typeof ReadIdentity = async () =>
  (await session()).readNativeFederatedIdentity()
const finishSession = async (birthdate: string) =>
  (await session()).finishNativeFederatedSignup(birthdate)
const cancelSession = async () => (await session()).cancelNativeFederatedSignup()
const awaitingSessionAccount = async (accessToken: string) =>
  (await session()).fetchNativeAwaitingGuardianAccount(accessToken)
const ignoreUnderage = () => undefined

/**
 * D3: the email signup's inline birthdate messages, as signup-screen.tsx shows them. An
 * under-13 birthdate is an error (styled, an alert, announced); the rest are guidance.
 */
function birthdateNotice(birthdate: string) {
  const check = evaluateBirthdateInput(birthdate)
  return {
    message: check.message,
    error: check.gate?.accountStatus === 'blocked_underage' ? check.message : null,
  }
}

/** Announcements and the header title, which follow the phase and the messages. */
function useFinishStepChrome({
  phase,
  message,
  inlineError,
  onTitleChange,
}: {
  phase: Phase['kind']
  message: string | null
  inlineError: string | null
  onTitleChange?: (title: string) => void
}) {
  const { i18n } = useTranslation()
  const strings = getFederatedSignInStrings(i18n.language)
  const { announce } = useAccessibilityAnnouncer()

  useEffect(() => {
    if (message) announce('error', message)
  }, [announce, message])

  useEffect(() => {
    if (inlineError) announce('error', inlineError)
  }, [announce, inlineError])

  const headerTitle =
    phase === 'loading' || phase === 'form'
      ? strings.finishTitle
      : phase === 'created' || phase === 'awaiting_guardian'
        ? strings.guardianStepTitle
        : ''
  useEffect(() => {
    onTitleChange?.(headerTitle)
  }, [headerTitle, onTitleChange])

  // Outcome texts are announced too: VoiceOver ignores an alert role on plain text.
  useEffect(() => {
    if (phase === 'underage') announce('error', strings.underage)
    else if (phase === 'refused') announce('error', strings.refused)
    else if (phase === 'no_session') announce('error', strings.noSession)
    else if (phase === 'created') announce('feedback', strings.createdGuardianPending)
    else if (phase === 'awaiting_guardian') announce('feedback', strings.awaitingGuardian)
  }, [announce, phase, strings])
}

export function FinishSignupScreen({
  onExit,
  onUnderage = ignoreUnderage,
  readIdentity = readSessionIdentity,
  awaitingAccount = awaitingSessionAccount,
  finish = finishSession,
  cancel = cancelSession,
  inviteGuardian = inviteGuardianFromMobile,
  onTitleChange,
}: FinishSignupScreenProps) {
  const styles = useStyles()
  const { i18n } = useTranslation()
  const strings = getFederatedSignInStrings(i18n.language)
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  const [birthdate, setBirthdate] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState<'create' | 'cancel' | null>(null)
  const birthdateRef = useRef<TextInput>(null)
  const { message: inlineMessage, error: inlineError } = birthdateNotice(birthdate)

  useEffect(() => {
    let active = true
    void readIdentity()
      .then(async (identity) => {
        if (!identity) {
          if (active) setPhase({ kind: 'no_session' })
          return
        }
        const accountId = await awaitingAccount(identity.accessToken)
        if (active)
          setPhase(
            accountId
              ? { kind: 'awaiting_guardian', accountId }
              : { kind: 'form', email: identity.email }
          )
      })
      .catch(() => {
        if (active) setPhase({ kind: 'no_session' })
      })
    return () => {
      active = false
    }
  }, [readIdentity, awaitingAccount])

  useEffect(() => {
    if (phase.kind === 'form') birthdateRef.current?.focus()
  }, [phase.kind])

  useFinishStepChrome({ phase: phase.kind, message, inlineError, onTitleChange })

  function cancelFinish() {
    setBusy('cancel')
    void cancel().finally(() => onExit('cancelled'))
  }

  // Android Back on the open form is Cancel (D3): popping to Home would let Home's resume push
  // this step straight back and drop the typed birthdate.
  useEffect(() => {
    if (phase.kind !== 'form') return undefined
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (busy === null) cancelFinish()
      return true
    })
    return () => subscription.remove()
  })

  async function submit() {
    setMessage(null)
    if (evaluateBirthdateInput(birthdate).kind !== 'valid') {
      setMessage(strings.invalidBirthdate)
      return
    }
    setBusy('create')
    try {
      // An under-13 birthdate still goes to the server, which deletes the Google identity.
      const result = await finish(birthdate)
      switch (result.kind) {
        case 'created':
          if (result.account.guardianConsentRequired)
            setPhase({ kind: 'created', account: result.account })
          else onExit('continue')
          return
        case 'signed_in':
          onExit('continue')
          return
        case 'underage':
          onUnderage()
          setPhase({ kind: 'underage' })
          return
        case 'guardian_minor':
          setMessage(strings.guardianMinor)
          return
        case 'refused':
          setPhase({ kind: 'refused' })
          return
        case 'no_session':
          setPhase({ kind: 'no_session' })
          return
        default:
          setMessage(strings.createUnavailable)
      }
    } finally {
      setBusy(null)
    }
  }

  if (phase.kind === 'loading')
    return (
      <View style={styles.container}>
        <Text accessibilityLiveRegion="polite">{strings.finishing}</Text>
      </View>
    )

  if (
    phase.kind === 'underage' ||
    phase.kind === 'refused' ||
    phase.kind === 'no_session'
  ) {
    const text = {
      underage: strings.underage,
      refused: strings.refused,
      no_session: strings.noSession,
    }[phase.kind]
    return (
      <View style={styles.container}>
        <Text
          testID="finish-signup-outcome"
          accessibilityRole="alert"
          style={styles.body}
        >
          {text}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => onExit(phase.kind === 'underage' ? 'home' : 'signin')}
          style={styles.button}
        >
          <Text style={styles.buttonText}>{strings.continue}</Text>
        </Pressable>
      </View>
    )
  }

  if (onGuardianStep(phase))
    return (
      <GuardianStep
        phase={phase}
        inviteGuardian={inviteGuardian}
        onLeave={() => onExit('until_approved')}
      />
    )

  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.body}>{strings.finishIntro}</Text>
      {phase.email ? (
        <View style={styles.field}>
          <Text style={styles.label}>{strings.googleAccount}</Text>
          <Text testID="finish-signup-email" style={styles.body}>
            {phase.email}
          </Text>
        </View>
      ) : null}
      <View style={styles.field}>
        <Text style={styles.label}>{strings.birthdate}</Text>
        <TextInput
          ref={birthdateRef}
          testID="finish-signup-birthdate"
          accessibilityLabel={strings.birthdate}
          accessibilityHint={strings.birthdateHint}
          placeholder="YYYY-MM-DD"
          placeholderTextColor={styles.placeholder.color}
          value={birthdate}
          onChangeText={setBirthdate}
          style={styles.input}
        />
        <Text style={styles.hint}>{strings.birthdateHint}</Text>
        {inlineMessage ? (
          <Text
            testID="finish-signup-inline-message"
            accessibilityLiveRegion="polite"
            accessibilityRole={inlineError ? 'alert' : undefined}
            style={inlineError ? styles.error : styles.hint}
          >
            {inlineMessage}
          </Text>
        ) : null}
      </View>
      {message ? (
        <Text
          testID="finish-signup-message"
          accessibilityRole="alert"
          style={styles.error}
        >
          {message}
        </Text>
      ) : null}
      <Pressable
        testID="finish-signup-create"
        accessibilityRole="button"
        accessibilityState={{ disabled: busy !== null, busy: busy === 'create' }}
        disabled={busy !== null}
        onPress={() => {
          void submit()
        }}
        style={[styles.button, busy !== null ? styles.disabled : null]}
      >
        <Text style={styles.buttonText}>
          {busy === 'create' ? strings.creating : strings.create}
        </Text>
      </Pressable>
      <Pressable
        testID="finish-signup-cancel"
        accessibilityRole="button"
        accessibilityState={{ disabled: busy !== null, busy: busy === 'cancel' }}
        disabled={busy !== null}
        onPress={cancelFinish}
        style={[styles.secondary, busy !== null ? styles.disabled : null]}
      >
        <Text style={styles.secondaryText}>
          {busy === 'cancel' ? strings.cancelling : strings.cancel}
        </Text>
      </Pressable>
    </ScrollView>
  )
}

type GuardianPhase = Extract<Phase, { kind: 'created' | 'awaiting_guardian' }>

const onGuardianStep = (phase: Phase): phase is GuardianPhase =>
  phase.kind === 'created' || phase.kind === 'awaiting_guardian'

/**
 * The teen's guardian step: a new account (`created`) or a returning teen still waiting
 * (`awaiting_guardian`). Leaving it ends the session, because every signed-in request refuses
 * the teen until a guardian approves.
 */
function GuardianStep({
  phase,
  inviteGuardian,
  onLeave,
}: {
  phase: GuardianPhase
  inviteGuardian: (input: GuardianInvitationInput) => Promise<GuardianInvitationResponse>
  onLeave: () => void
}) {
  const styles = useStyles()
  const { i18n } = useTranslation()
  const strings = getFederatedSignInStrings(i18n.language)
  const created = phase.kind === 'created'
  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.container}>
      <Text
        testID="finish-signup-outcome"
        accessibilityRole="alert"
        style={styles.success}
      >
        {created ? strings.createdGuardianPending : strings.awaitingGuardian}
      </Text>
      <GuardianInvitePanel
        teenId={created ? phase.account.userId : phase.accountId}
        inviteGuardian={inviteGuardian}
      />
      <Pressable
        accessibilityRole="button"
        testID="guardian-step-continue"
        onPress={onLeave}
        style={styles.button}
      >
        <Text style={styles.buttonText}>{strings.guardianStepLeave}</Text>
      </Pressable>
    </ScrollView>
  )
}

function GuardianInvitePanel({
  teenId,
  inviteGuardian,
}: {
  teenId: string
  inviteGuardian: (input: GuardianInvitationInput) => Promise<GuardianInvitationResponse>
}) {
  const styles = useStyles()
  const { i18n } = useTranslation()
  const strings = getFederatedSignInStrings(i18n.language)
  const [guardianEmail, setGuardianEmail] = useState('')
  const [consentLevel, setConsentLevel] =
    useState<GuardianInvitationInput['consentLevel']>('read_only')
  const [message, setMessage] = useState<string | null>(null)
  const [inviteLink, setInviteLink] = useState<string | null>(null)
  const [inviting, setInviting] = useState(false)

  async function invite() {
    setMessage(null)
    setInviteLink(null)
    if (
      !guardianInvitationInputSchema.shape.guardianEmail.safeParse(guardianEmail).success
    ) {
      setMessage(strings.invalidGuardianEmail)
      return
    }
    setInviting(true)
    try {
      const response = await inviteGuardian({ teenId, guardianEmail, consentLevel })
      setInviteLink(response.invitationLink)
      setMessage(strings.inviteSent.replace('{email}', response.guardianEmail))
    } catch {
      setMessage(strings.inviteFailed)
    } finally {
      setInviting(false)
    }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.eyebrow}>{strings.guardianTitle}</Text>
      <Text style={styles.body}>{strings.guardianIntro}</Text>
      <Text style={styles.label}>{strings.guardianEmail}</Text>
      <TextInput
        testID="guardian-invite-email"
        accessibilityLabel={strings.guardianEmail}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        value={guardianEmail}
        onChangeText={setGuardianEmail}
        style={styles.input}
      />
      <Text style={styles.label}>{strings.consentLevel}</Text>
      <View style={styles.segmentRow} accessibilityRole="radiogroup">
        {(['read_only', 'full_access'] as const).map((level) => (
          <Pressable
            key={level}
            accessibilityRole="radio"
            accessibilityLabel={
              level === 'read_only' ? strings.readOnlyConsent : strings.fullAccessConsent
            }
            accessibilityState={{ selected: consentLevel === level }}
            onPress={() => setConsentLevel(level)}
            style={[styles.segment, consentLevel === level ? styles.segmentActive : null]}
          >
            <Text style={styles.segmentText}>
              {level === 'read_only' ? strings.readOnly : strings.fullAccess}
            </Text>
          </Pressable>
        ))}
      </View>
      <Pressable
        accessibilityRole="button"
        disabled={inviting}
        onPress={() => {
          void invite()
        }}
        style={[styles.secondary, inviting ? styles.disabled : null]}
      >
        <Text style={styles.secondaryText}>
          {inviting ? strings.sendingInvite : strings.sendInvite}
        </Text>
      </Pressable>
      {message ? <Text accessibilityLiveRegion="polite">{message}</Text> : null}
      {inviteLink ? (
        <Text selectable testID="guardian-invite-link">
          {inviteLink}
        </Text>
      ) : null}
    </View>
  )
}

/** Layout plus the OS light/dark chrome tokens (`constants/colors.ts`), as the signup screen. */
const useStyles = createSchemeStyles((colors) => ({
  page: { flex: 1, backgroundColor: colors.page },
  container: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingVertical: 32,
    gap: 16,
    backgroundColor: colors.page,
  },
  body: { fontSize: 16, lineHeight: 24, color: colors.ink },
  hint: { fontSize: 14, lineHeight: 20, color: colors.inkMuted },
  placeholder: { color: colors.inkMuted },
  field: { gap: 8, backgroundColor: 'transparent' },
  label: { fontSize: 14, fontWeight: '600', color: colors.ink },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.ink,
  },
  error: { fontSize: 14, color: colors.dangerInk },
  success: { fontSize: 16, lineHeight: 24, color: colors.successInk },
  button: {
    minHeight: 48,
    borderRadius: 9999,
    backgroundColor: colors.primary,
    paddingVertical: 16,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { color: colors.onPrimary, fontSize: 16, fontWeight: '700' },
  secondary: {
    minHeight: 48,
    borderRadius: 9999,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    paddingVertical: 16,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: { fontSize: 16, fontWeight: '600', color: colors.ink },
  disabled: { opacity: 0.6 },
  card: {
    gap: 12,
    borderWidth: 1,
    borderColor: colors.noticeLine,
    borderRadius: 16,
    padding: 16,
    backgroundColor: colors.noticeSurface,
  },
  eyebrow: {
    fontSize: 12,
    letterSpacing: 2,
    textTransform: 'uppercase',
    fontWeight: '700',
    color: colors.noticeInk,
  },
  segmentRow: { flexDirection: 'row', gap: 12, backgroundColor: 'transparent' },
  segment: {
    minHeight: 44,
    flex: 1,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Story CC-7.9 D3: the chosen consent level is marked in `inverse`; gold stays with the button.
  segmentActive: { borderColor: colors.inverse, borderWidth: 2 },
  segmentText: { color: colors.ink },
}))
