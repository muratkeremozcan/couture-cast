// Story CC-7.7 D1, D3 owner: the native screen gate. Each tab body sits inside one gate, so a
// member sees the fixed shell (native header, tab bar) and a neutral placeholder until the
// body's first reads settle, and then the body appears as one unit instead of jumping in
// piece by piece. Web has the same gate in apps/web/src/app/components/screen-gate.tsx.
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { useTranslation } from 'react-i18next'
import { underModalAccessibility } from '@/components/edge-to-edge-modal'
import { useSchemeColors } from '@/components/themed'
import { useMemberSessionState, type MemberSessionState } from '@/src/lib/member-session'
import {
  mobileApplicationUserId,
  subscribeMobileApplicationUser,
} from '@/src/lib/mobile-auth'

export type GatedScreen = 'home' | 'closet' | 'community' | 'profile'

/**
 * Story CC-7.7 (review triage P2-2, as on web): a gate whose reads have not all settled opens
 * after this long anyway, so one stalled read never hides the sections that answered or their
 * Retry.
 */
export const SCREEN_GATE_DEADLINE_MS = 10_000

export interface ScreenGateProps {
  screen: GatedScreen
  /**
   * True once the body's first reads settled for the member on screen: success, empty or
   * error. The gate never hides an error or Retry state, so a failed read counts as settled.
   */
  ready: boolean
  /**
   * The session the screen already follows (Home); the gate reads its own when omitted. While
   * it is `restoring` the placeholder shows; `signed-out` opens the gate at once.
   */
  session?: MemberSessionState
  /** Layout for the body wrapper, e.g. `{ flex: 1 }` around a list. */
  style?: StyleProp<ViewStyle>
  /**
   * Told each time the body becomes shown or hidden, the deadline opening included, so a
   * screen can hold a one-time focus until its target is on screen.
   */
  onOpenChange?: (open: boolean) => void
  children: ReactNode
}

/**
 * Whether the gate may open now, before its open-once latch is considered. A signed-out session
 * opens at once, and so does one whose check failed (`unavailable`): each section then shows its
 * own error and retry, which the gate must never hide (D3, as on web).
 */
export function screenGateSettled(session: MemberSessionState, ready: boolean): boolean {
  if (session === 'restoring') return false
  return session === 'signed-out' || session === 'unavailable' || ready
}

/**
 * Children mount at once, so their reads start beside the placeholder, but they take no
 * layout until the gate opens: when the reads settle, or {@link SCREEN_GATE_DEADLINE_MS} after
 * it started waiting. Once open for a member the gate stays open (a refresh never closes it
 * again); a different member, or a session restoring again, closes it until the new reads
 * settle, so one member never sees another's content.
 */
export function ScreenGate(props: ScreenGateProps) {
  return props.session === undefined ? (
    <SessionFollowingGate {...props} />
  ) : (
    <GateFrame {...props} session={props.session} />
  )
}

/** A gate for a screen that does not follow the session itself. */
function SessionFollowingGate(props: ScreenGateProps) {
  const [session] = useMemberSessionState()
  return <GateFrame {...props} session={session} />
}

/** What the gate remembers about the member on screen. */
interface GateIdentity {
  /** The application user the gate last rendered for. */
  owner: string | null
  /** The member the gate last opened for; undefined until it first opens. */
  openedFor: string | null | undefined
  /**
   * True from a member's departure while `ready` was true until `ready` is seen false: until
   * then `ready` may still describe the previous member's reads, so it settles nothing.
   */
  staleReady: boolean
}

/**
 * The gate's memory for this render. A new owner drops the open latch (a latch from member A
 * never reopens the gate for A's return over unsettled reads), and a `ready` still true from a
 * previous member's reads counts only once the screen has reported unsettled reads.
 */
function gateIdentityFor(
  last: GateIdentity,
  owner: string | null,
  ready: boolean
): GateIdentity {
  let next = last
  if (next.owner !== owner) {
    next = {
      owner,
      openedFor: undefined,
      staleReady: next.staleReady || (next.owner !== null && ready),
    }
  }
  if (next.staleReady && !ready) next = { ...next, staleReady: false }
  return next
}

function latchFor(last: GateIdentity, owner: string | null): GateIdentity {
  return last.owner !== owner || last.openedFor === owner
    ? last
    : { ...last, openedFor: owner }
}

function GateFrame({
  screen,
  ready,
  session: current,
  style,
  onOpenChange,
  children,
}: ScreenGateProps & { session: MemberSessionState }) {
  const { t } = useTranslation()
  const colors = useSchemeColors()
  const owner = useSyncExternalStore(
    subscribeMobileApplicationUser,
    mobileApplicationUserId,
    mobileApplicationUserId
  )
  const [identity, setIdentity] = useState<GateIdentity>(() => ({
    owner,
    openedFor: undefined,
    staleReady: false,
  }))
  // Settled at the identity boundary, during render, so the first frame for a new owner already
  // ignores the previous owner's latch and readiness (review r1).
  const gate = gateIdentityFor(identity, owner, ready)
  if (gate !== identity) setIdentity(gate)
  const latched = gate.openedFor === owner
  const settled = screenGateSettled(current, ready && !gate.staleReady)
  const open = current !== 'restoring' && (settled || latched)

  useEffect(() => {
    // Only a member's own settled reads latch the gate open. A signed-out or unavailable
    // session opens it without a latch: that state can lag a sign-in for a render, and a latch
    // taken then would keep the gate open over the new member's unsettled reads.
    if (settled && current === 'member') setIdentity((last) => latchFor(last, owner))
    else if (current === 'restoring')
      setIdentity((last) =>
        last.openedFor === undefined ? last : { ...last, openedFor: undefined }
      )
  }, [current, owner, settled])

  // The deadline counts from the moment the gate waits on this member's reads.
  useEffect(() => {
    if (open || current === 'restoring') return
    const timer = setTimeout(
      () => setIdentity((last) => latchFor(last, owner)),
      SCREEN_GATE_DEADLINE_MS
    )
    return () => clearTimeout(timer)
  }, [current, open, owner])

  const onOpenChangeRef = useRef(onOpenChange)
  onOpenChangeRef.current = onOpenChange
  useEffect(() => {
    onOpenChangeRef.current?.(open)
  }, [open])

  return (
    <View
      testID="screen-gate"
      // Same hook as the web gate's data attributes: TEA reads them on either platform.
      {...{ dataSet: open ? { screen, ready: 'true' } : { screen } }}
      style={[styles.gate, style]}
    >
      {open ? null : (
        <View
          testID="screen-placeholder"
          // One element to VoiceOver and TalkBack; on web it stays out of the tab order.
          accessible={Platform.OS !== 'web'}
          accessibilityLabel={t('common.loading')}
          accessibilityState={{ busy: true }}
          aria-busy
          style={[styles.placeholder, { backgroundColor: colors.cardMuted }]}
        />
      )}
      <View
        testID={`screen-gate-body-${screen}`}
        style={[styles.body, style, open ? null : styles.hidden]}
        // Hidden from the native accessibility tree too; on web `display: none` does it.
        {...underModalAccessibility(!open)}
      >
        {children}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  gate: {},
  body: {},
  // Not rendered for layout: the body neither takes space nor shows until the gate opens.
  hidden: { display: 'none' },
  // A plain surface where the body will be: no text, no sample, no skeleton cards.
  placeholder: { flexGrow: 1, minHeight: 320 },
})
