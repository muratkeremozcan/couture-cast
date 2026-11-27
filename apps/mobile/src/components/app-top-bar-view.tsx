// Story CC-7.9 D6 owner: the one native top bar view. Story CC-7.11 D12: the full-height layers
// (saved look and post detail) draw it too, so it lives apart from the navigator glue in
// app-top-bar.tsx and imports no router.
// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
import type { ComponentRef, ReactNode, Ref } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ShellIcon } from '@/src/components/shell-icons'
import { useTokens } from '@/src/theme/tokens'

export interface AppTopBarProps {
  title: string
  /** Shows the back control; omitted on a tab root. */
  onBack?: () => void
  backRef?: Ref<ComponentRef<typeof Pressable>>
  /** Replaces the plain title text (the share card focus heading registers itself this way). */
  titleNode?: ReactNode
  trailing?: ReactNode
  wrapTitle?: boolean
  /**
   * Whether the bar sits under the status bar and pads by the top safe-area inset (a header, a
   * full-height layer). Default true.
   */
  safeAreaTop?: boolean
  /** The plain title text, for a layer that moves accessibility focus to its title on open. */
  titleRef?: Ref<Text>
}

/**
 * D6: 56 pt plus the top safe-area inset, one row: optional back, the title (header role) and an
 * optional trailing slot, on the `page` surface with a `line` rule below.
 */
export function AppTopBar({
  title,
  onBack,
  backRef,
  titleNode,
  trailing,
  wrapTitle = false,
  safeAreaTop = true,
  titleRef,
}: AppTopBarProps) {
  const { t } = useTranslation()
  const insets = useSafeAreaInsets()
  const { colors, shell, space, type, fontWeight } = useTokens()
  const backLabel = t('shell.back')
  const topInset = safeAreaTop ? insets.top : 0

  return (
    <View
      testID="app-top-bar"
      style={[
        styles.bar,
        wrapTitle
          ? { minHeight: shell.topBarHeight + topInset }
          : { height: shell.topBarHeight + topInset },
        {
          paddingTop: topInset,
          paddingHorizontal: space[2],
          backgroundColor: colors.page,
          borderBottomColor: colors.line,
        },
      ]}
    >
      {onBack ? (
        <Pressable
          ref={backRef}
          testID="app-top-bar-back"
          accessibilityRole="button"
          accessibilityLabel={backLabel}
          onPress={onBack}
          hitSlop={space[1]}
          style={[
            styles.back,
            { minHeight: shell.touchTarget, minWidth: shell.touchTarget, gap: space[1] },
            wrapTitle && styles.backWrap,
          ]}
        >
          <ShellIcon name="back" size={type.base.fontSize} color={colors.ink} />
          <Text
            style={{
              color: colors.ink,
              fontSize: type.sm.fontSize,
              fontWeight: fontWeight.medium,
              flexShrink: 1,
            }}
          >
            {backLabel}
          </Text>
        </Pressable>
      ) : null}
      {/* One `app-top-bar-title` either way, on the title Text itself (the tab heading carries it
          too): Android reports the title as a sibling of the bar, so UI tests match id and text
          on that one node. */}
      <View style={[styles.title, { paddingHorizontal: space[2] }]}>
        {titleNode ?? (
          <Text
            ref={titleRef}
            testID="app-top-bar-title"
            accessibilityRole="header"
            numberOfLines={wrapTitle ? undefined : 1}
            style={{
              color: colors.ink,
              fontSize: type.lg.fontSize,
              lineHeight: type.lg.lineHeight,
              fontWeight: fontWeight.semibold,
            }}
          >
            {title}
          </Text>
        )}
      </View>
      {trailing ? (
        <View style={[styles.trailing, wrapTitle && styles.trailingWrap]}>
          {trailing}
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  back: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    minWidth: 0,
  },
  backWrap: { maxWidth: '40%' },
  trailingWrap: { maxWidth: '55%', flexShrink: 1 },
  trailing: {
    flexDirection: 'row',
    alignItems: 'center',
  },
})
