import { Link, Stack } from 'expo-router'
import { StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'

import { Text, View } from '@/components/themed'
import { useTokens } from '@/src/theme/tokens'

// Story CC-7.9 D6, D7, D9: the stack top bar carries the title; the body sits on the page surface
// and its strings come from the catalogs.
export default function NotFoundScreen() {
  const { t } = useTranslation()
  const { colors } = useTokens()
  return (
    <>
      <Stack.Screen options={{ title: t('shell.notFound.title') }} />
      <View style={[styles.container, { backgroundColor: colors.page }]}>
        <Text style={[styles.body, { color: colors.inkSoft }]}>
          {t('shell.notFound.body')}
        </Text>

        <Link
          href="/"
          style={[styles.link, { borderColor: colors.lineStrong, color: colors.ink }]}
        >
          {t('shell.goHome')}
        </Link>
      </View>
    </>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'flex-start',
    padding: 16,
    gap: 16,
  },
  body: {
    fontSize: 16,
    lineHeight: 24,
  },
  link: {
    minHeight: 44,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderWidth: 1,
    borderRadius: 8,
    fontSize: 14,
    fontWeight: '500',
  },
})
