import React from 'react'
import { StyleSheet } from 'react-native'

import { ExternalLink } from './external-link'
import { MonoText } from './styled-text'
import { Text, View } from './themed'

import { useTokens } from '@/src/theme/tokens'

export default function EditScreenInfo({ path }: { path: string }) {
  const { colors } = useTokens()
  return (
    <View>
      <View style={styles.getStartedContainer}>
        <Text style={[styles.getStartedText, { color: colors.inkSoft }]}>
          Open up the code for this screen:
        </Text>

        <View
          style={[
            styles.codeHighlightContainer,
            styles.homeScreenFilename,
            { backgroundColor: colors.card },
          ]}
        >
          <MonoText>{path}</MonoText>
        </View>

        <Text style={[styles.getStartedText, { color: colors.inkSoft }]}>
          Change any of the text, save the file, and your app will automatically update.
        </Text>
      </View>

      <View style={styles.helpContainer}>
        <ExternalLink
          style={styles.helpLink}
          href="https://docs.expo.io/get-started/create-a-new-app/#opening-the-app-on-your-phonetablet"
        >
          <Text style={[styles.helpLinkText, { color: colors.ink }]}>
            Tap here if your app doesn't automatically update after making changes
          </Text>
        </ExternalLink>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  getStartedContainer: {
    alignItems: 'center',
    marginHorizontal: 48,
  },
  homeScreenFilename: {
    marginVertical: 8,
  },
  codeHighlightContainer: {
    borderRadius: 4,
    paddingHorizontal: 4,
  },
  getStartedText: {
    fontSize: 18,
    lineHeight: 28,
    textAlign: 'center',
  },
  helpContainer: {
    marginTop: 16,
    marginHorizontal: 20,
    alignItems: 'center',
  },
  helpLink: {
    paddingVertical: 16,
  },
  helpLinkText: {
    textAlign: 'center',
  },
})
