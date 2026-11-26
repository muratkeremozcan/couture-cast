// Story 6.17 D2: "Continue with Google", drawn to Google's sign-in branding guidelines.
import { useState } from 'react'
import { Pressable, StyleSheet, Text, useColorScheme, View } from 'react-native'
import Svg, { Path } from 'react-native-svg'
import { useTranslation } from 'react-i18next'
import {
  getFederatedSignInStrings,
  GOOGLE_BUTTON_THEME,
  GOOGLE_G_MARK_PATHS,
  GOOGLE_G_MARK_VIEWBOX,
  type SignInDoor,
} from '@couture/utils'
import Colors from '@/constants/colors'
import { useSchemeColors } from '@/components/themed'
import type { NativeOAuthOutcome } from '@/src/lib/native-session'

type GoogleSignInButtonProps = {
  /** Carried through the round trip; only `preview` survives it. */
  from?: string | null
  /** D5: the page that started the round trip; failures and Cancel return there. */
  door?: SignInDoor
  /** Google's neutral button for the OS scheme unless a screen asks for one. */
  theme?: 'light' | 'dark'
  onOutcome: (outcome: NativeOAuthOutcome) => void
  /** Injected by tests; the screen uses the real round trip. */
  start?: (options: {
    from?: string | null
    door?: SignInDoor
  }) => Promise<NativeOAuthOutcome>
}

const defaultStart = async (options: { from?: string | null; door?: SignInDoor }) =>
  (await import('../../lib/native-session.js')).startNativeGoogleSignIn(options)

export function GoogleSignInButton({
  from = null,
  door = 'signin',
  theme,
  onOutcome,
  start = defaultStart,
}: GoogleSignInButtonProps) {
  const { i18n } = useTranslation()
  const strings = getFederatedSignInStrings(i18n.language)
  const [opening, setOpening] = useState(false)
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light'
  const colours = GOOGLE_BUTTON_THEME[theme ?? scheme]
  return (
    <Pressable
      testID="google-sign-in"
      accessibilityRole="button"
      accessibilityLabel={strings.continueWithGoogle}
      accessibilityState={{ busy: opening, disabled: opening }}
      disabled={opening}
      onPress={() => {
        setOpening(true)
        void start({ from, door })
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

/**
 * The rule's line on each scheme's page: the `lineStrong` role, pinned at 3:1 or more
 * (WCAG 1.4.11) on `page` in both schemes. The label takes `inkMuted`, pinned at 4.5:1.
 */
export const SIGN_IN_DIVIDER_LINE = {
  light: Colors.light.lineStrong,
  dark: Colors.dark.lineStrong,
} as const

/** The "or" rule between Google and the email form, in the OS scheme's colors. */
export function SignInDivider() {
  const { i18n } = useTranslation()
  const label = getFederatedSignInStrings(i18n.language).divider
  const line = SIGN_IN_DIVIDER_LINE[useColorScheme() === 'dark' ? 'dark' : 'light']
  const colors = useSchemeColors()
  return (
    <View style={styles.divider} accessible accessibilityLabel={label}>
      <View
        testID="sign-in-divider-rule"
        style={[styles.rule, { backgroundColor: line }]}
      />
      <Text style={[styles.dividerText, { color: colors.inkMuted }]}>{label}</Text>
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
  onSignedIn: (outcome: 'member' | 'no_account' | 'awaiting_guardian') => void
  onFailure: (message: string) => void
}) {
  const { i18n } = useTranslation()
  return (
    <>
      <GoogleSignInButton
        from={fromPreview ? 'preview' : null}
        door="signup"
        onOutcome={(outcome) => {
          if (
            outcome.kind === 'member' ||
            outcome.kind === 'no_account' ||
            outcome.kind === 'awaiting_guardian'
          )
            onSignedIn(outcome.kind)
          else onFailure(getFederatedSignInStrings(i18n.language)[outcome.kind])
        }}
      />
      <SignInDivider />
    </>
  )
}

const styles = StyleSheet.create({
  button: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 9999,
    paddingHorizontal: 20,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  label: { fontSize: 16, fontWeight: '500', flexShrink: 1, textAlign: 'center' },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 24 },
  // One device pixel and more: a hairline at 3:1 still read as missing on a dense screen.
  rule: { flex: 1, height: 1 },
  dividerText: { fontSize: 14 },
})
