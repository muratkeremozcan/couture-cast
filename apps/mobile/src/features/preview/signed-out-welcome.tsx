// Story 6.16 D1: what a signed-out launch shows on Home in place of a failed ritual
// request: the way into the sample preview, account creation and sign-in.
import { router } from 'expo-router'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { getGuestPreviewStrings } from '@couture/utils'
import { useHeroPalette } from '@/components/hero/hero-theme'

export function SignedOutWelcome() {
  const { i18n } = useTranslation()
  const strings = getGuestPreviewStrings(i18n.language)
  const palette = useHeroPalette()
  const actions = [
    {
      label: strings.chrome.entry,
      href: '/preview',
      testID: 'home-try-sample',
      primary: true,
    },
    {
      label: strings.chrome.createAccount,
      href: '/signup',
      testID: 'home-create-account',
    },
    { label: strings.chrome.signIn, href: '/signin', testID: 'home-sign-in' },
  ] as const
  return (
    <View
      testID="home-signed-out-welcome"
      style={[
        styles.card,
        { backgroundColor: palette.surface, borderColor: palette.divider },
      ]}
    >
      <Text accessibilityRole="header" style={[styles.heading, { color: palette.text }]}>
        {strings.chrome.welcomeHeading}
      </Text>
      <Text style={[styles.body, { color: palette.mutedText }]}>
        {strings.chrome.welcomeBody}
      </Text>
      {actions.map((action) => {
        const primary = 'primary' in action
        return (
          <Pressable
            key={action.testID}
            testID={action.testID}
            accessibilityRole="button"
            onPress={() => router.push(action.href)}
            style={[
              styles.button,
              primary
                ? { backgroundColor: palette.text }
                : { borderColor: palette.text, borderWidth: 1 },
            ]}
          >
            <Text
              style={[
                styles.buttonText,
                { color: primary ? palette.background : palette.text },
              ]}
            >
              {action.label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 20,
    marginTop: 28,
    paddingHorizontal: 24,
    paddingVertical: 28,
    borderWidth: 1,
    borderRadius: 20,
    gap: 12,
  },
  heading: { fontSize: 24, fontWeight: '700', lineHeight: 30 },
  body: { fontSize: 15, lineHeight: 22, marginBottom: 8 },
  button: {
    minHeight: 48,
    borderRadius: 999,
    paddingVertical: 12,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { fontSize: 15, fontWeight: '700', textAlign: 'center' },
})
