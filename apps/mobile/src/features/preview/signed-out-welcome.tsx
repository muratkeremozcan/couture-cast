// Story 6.16 D1: what a signed-out launch shows on Home in place of a failed ritual
// request: the way into the sample preview, account creation and sign-in.
import { router } from 'expo-router'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import {
  colorRoles,
  createMemberSampleOutfit,
  getGuestPreviewStrings,
} from '@couture/utils'
import { SampleGarmentArt } from './guest-preview-parts'
import { useHeroPalette } from '@/components/hero/hero-theme'

export function SignedOutWelcome() {
  const { i18n } = useTranslation()
  const strings = getGuestPreviewStrings(i18n.language)
  const palette = useHeroPalette()
  const actions = [
    {
      label: strings.firstUse.sampleEntry,
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
      style={[styles.card, { backgroundColor: palette.card, borderColor: palette.line }]}
    >
      <Text accessibilityRole="header" style={[styles.heading, { color: palette.ink }]}>
        {strings.chrome.welcomeHeading}
      </Text>
      <Text style={[styles.body, { color: palette.inkMuted }]}>
        {strings.chrome.sampleLabel}
      </Text>
      <View
        style={styles.art}
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
      >
        {createMemberSampleOutfit().garments.map((garment) => (
          <View key={garment.id} style={styles.tile}>
            <SampleGarmentArt garment={garment} size={44} />
          </View>
        ))}
      </View>
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
              // Story CC-7.9 D3: a filled button is ink; any other is the neutral outline.
              primary
                ? { backgroundColor: palette.inverse }
                : { borderColor: palette.lineStrong, borderWidth: 1 },
            ]}
          >
            <Text
              style={[
                styles.buttonText,
                { color: primary ? palette.onInverse : palette.ink },
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
  art: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  // The sample art is drawn for a light ground, so its tile is the light card in both schemes.
  tile: { backgroundColor: colorRoles.light.card, padding: 4, borderRadius: 8 },
  card: {
    marginHorizontal: 20,
    marginTop: 24,
    paddingHorizontal: 24,
    paddingVertical: 24,
    borderWidth: 1,
    borderRadius: 16,
    gap: 12,
  },
  heading: { fontSize: 24, fontWeight: '700', lineHeight: 30 },
  body: { fontSize: 16, lineHeight: 24, marginBottom: 8 },
  button: {
    minHeight: 48,
    borderRadius: 9999,
    paddingVertical: 12,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { fontSize: 16, fontWeight: '700', textAlign: 'center' },
})
