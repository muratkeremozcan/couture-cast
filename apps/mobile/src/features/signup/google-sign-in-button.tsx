// Story 6.17 D2: "Continue with Google", drawn to Google's sign-in branding guidelines.
import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import Svg, { Path } from 'react-native-svg'
import { useTranslation } from 'react-i18next'
import {
  getFederatedSignInStrings,
  GOOGLE_BUTTON_THEME,
  GOOGLE_G_MARK_PATHS,
  GOOGLE_G_MARK_VIEWBOX,
} from '@couture/utils'
import type { NativeOAuthOutcome } from '@/src/lib/native-session'

type GoogleSignInButtonProps = {
  /** Carried through the round trip; only `preview` survives it. */
  from?: string | null
  theme?: 'light' | 'dark'
  onOutcome: (outcome: NativeOAuthOutcome) => void
  /** Injected by tests; the screen uses the real round trip. */
  start?: (options: { from?: string | null }) => Promise<NativeOAuthOutcome>
}

const defaultStart = async (options: { from?: string | null }) =>
  (await import('../../lib/native-session.js')).startNativeGoogleSignIn(options)

export function GoogleSignInButton({
  from = null,
  theme = 'light',
  onOutcome,
  start = defaultStart,
}: GoogleSignInButtonProps) {
  const { i18n } = useTranslation()
  const strings = getFederatedSignInStrings(i18n.language)
  const [opening, setOpening] = useState(false)
  const colours = GOOGLE_BUTTON_THEME[theme]
  return (
    <Pressable
      testID="google-sign-in"
      accessibilityRole="button"
      accessibilityLabel={strings.continueWithGoogle}
      accessibilityState={{ busy: opening, disabled: opening }}
      disabled={opening}
      onPress={() => {
        setOpening(true)
        void start({ from })
          .catch((): NativeOAuthOutcome => ({ kind: 'unavailable' }))
          .then((outcome) => {
            setOpening(false)
            onOutcome(outcome)
          })
      }}
      style={[
        styles.button,
        { backgroundColor: colours.background, borderColor: colours.border },
      ]}
    >
      <Svg width={20} height={20} viewBox={GOOGLE_G_MARK_VIEWBOX} accessible={false}>
        {GOOGLE_G_MARK_PATHS.map((path) => (
          <Path key={path.fill} fill={path.fill} d={path.d} />
        ))}
      </Svg>
      <Text style={[styles.label, { color: colours.text }]}>
        {opening ? strings.opening : strings.continueWithGoogle}
      </Text>
    </Pressable>
  )
}

/** The "or" rule between Google and the email form. */
export function SignInDivider({ tone = 'light' }: { tone?: 'light' | 'dark' }) {
  const { i18n } = useTranslation()
  const label = getFederatedSignInStrings(i18n.language).divider
  const line = tone === 'dark' ? 'rgba(255,255,255,0.2)' : '#d4d4d4'
  return (
    <View style={styles.divider} accessible accessibilityLabel={label}>
      <View style={[styles.rule, { backgroundColor: line }]} />
      <Text style={[styles.dividerText, tone === 'dark' ? styles.dividerTextDark : null]}>
        {label}
      </Text>
      <View style={[styles.rule, { backgroundColor: line }]} />
    </View>
  )
}

/** Google and the divider above the signup screen's email form (Story 6.17 D2). */
export function SignupGoogleEntry({
  fromPreview,
  onSignedIn,
  onFailure,
}: {
  fromPreview: boolean
  onSignedIn: (outcome: 'member' | 'no_account') => void
  onFailure: (message: string) => void
}) {
  const { i18n } = useTranslation()
  return (
    <>
      <GoogleSignInButton
        from={fromPreview ? 'preview' : null}
        theme="dark"
        onOutcome={(outcome) => {
          if (outcome.kind === 'member' || outcome.kind === 'no_account')
            onSignedIn(outcome.kind)
          else onFailure(getFederatedSignInStrings(i18n.language)[outcome.kind])
        }}
      />
      <SignInDivider tone="dark" />
    </>
  )
}

const styles = StyleSheet.create({
  button: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 20,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  label: { fontSize: 15, fontWeight: '500', flexShrink: 1, textAlign: 'center' },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 24 },
  rule: { flex: 1, height: StyleSheet.hairlineWidth },
  dividerText: { fontSize: 14, color: '#525252' },
  dividerTextDark: { color: '#d4d4d4' },
})
