// Story CC-7.7 D1, D3 owner: the native screen gate. Each tab body sits inside one gate, so a
// member sees the fixed shell (native header, tab bar) and a neutral placeholder until the
// body's first reads settle, and then the body appears as one unit instead of jumping in
// piece by piece. Web has the same gate in apps/web/src/app/components/screen-gate.tsx.
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
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

function GateFrame({
  screen,
  ready,
  session: current,
  style,
  children,
}: ScreenGateProps & { session: MemberSessionState }) {
  const { t } = useTranslation()
  const colors = useSchemeColors()
  const owner = useSyncExternalStore(
    subscribeMobileApplicationUser,
    mobileApplicationUserId,
    mobileApplicationUserId
  )
  // The member the gate last opened for; undefined until it first opens.
  const [openedFor, setOpenedFor] = useState<string | null | undefined>(undefined)
  const settled = screenGateSettled(current, ready)
  const open = current !== 'restoring' && (settled || openedFor === owner)

  useEffect(() => {
    if (settled) setOpenedFor(owner)
    else if (current === 'restoring') setOpenedFor(undefined)
  }, [current, owner, settled])

  // The deadline counts from the moment the gate waits on this member's reads.
  useEffect(() => {
    if (open || current === 'restoring') return
    const timer = setTimeout(() => setOpenedFor(owner), SCREEN_GATE_DEADLINE_MS)
    return () => clearTimeout(timer)
  }, [current, open, owner])

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
          style={[styles.placeholder, { backgroundColor: colors.surface }]}
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
