// Story 6.3 mobile owner: render the controls in `apps/mobile/components/community/community-reactions.tsx` and coordinate them in `apps/mobile/src/features/community/community-screen.tsx`
import { Pressable, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import type { ReactionControls } from '@couture/api-client'
import type { CommunityReactionFeedItem } from '@couture/api-client/contracts/http'
import { useHeroPalette } from '@/components/hero/hero-theme'
const choices = [
  { id: 'applause', emoji: '👏' },
  { id: 'love', emoji: '❤️' },
  { id: 'inspiration', emoji: '✨' },
] as const

/** Presentational controls. The screen retains requests and recovery state. */
export function CommunityReactions({
  item,
  controls,
}: {
  item: CommunityReactionFeedItem
  controls: ReactionControls
}) {
  const { t } = useTranslation()
  const palette = useHeroPalette()
  const { pending, errorKey, canRetry, onSubmit } = controls
  const summary = item.reactions
  if (!summary) return null

  return (
    <View
      testID={`community-reactions-${item.id}`}
      style={{ paddingHorizontal: 16, gap: 8 }}
    >
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {choices.map(({ id, emoji }) => (
          <Pressable
            key={id}
            testID={`community-reaction-${id}-${item.id}`}
            accessibilityRole="button"
            aria-pressed={summary.viewerReaction === id}
            accessibilityLabel={`${t(`community.reactions.${id}`)}, ${summary.counts[id]}`}
            accessibilityState={{
              selected: summary.viewerReaction === id,
              disabled: pending || canRetry,
              busy: pending,
            }}
            // react-native-web 0.21 drops `accessibilityState.busy`; the aria
            // mirror is what reaches the DOM.
            aria-busy={pending}
            disabled={pending || canRetry}
            onPress={() => {
              onSubmit(id)
            }}
            style={{
              minHeight: 44,
              minWidth: 44,
              paddingHorizontal: 12,
              borderRadius: 22,
              borderWidth: 1,
              borderColor: summary.viewerReaction === id ? '#C9A14A' : palette.mutedText,
              backgroundColor:
                summary.viewerReaction === id ? '#C9A14A' : palette.surface,
              justifyContent: 'center',
              opacity: pending ? 0.6 : 1,
            }}
          >
            <Text
              testID={`community-reaction-count-${id}-${item.id}`}
              style={{ color: summary.viewerReaction === id ? '#111111' : palette.text }}
            >
              {emoji} {summary.counts[id]}
            </Text>
          </Pressable>
        ))}
      </View>
      <Text
        testID={`community-reaction-total-${item.id}`}
        style={{ color: palette.text }}
      >
        {t('community.reactions.total', { count: summary.total })}
      </Text>
      {pending && (
        <Text style={{ color: palette.text }}>{t('community.reactions.pending')}</Text>
      )}
      {errorKey && (
        <View>
          <Text style={{ color: palette.text }}>{t(errorKey)}</Text>
          {canRetry && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('community.reactions.retry')}
              style={{ minHeight: 44, justifyContent: 'center' }}
              onPress={() => {
                onSubmit()
              }}
            >
              <Text style={{ color: palette.text }}>
                {t('community.reactions.retry')}
              </Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  )
}
