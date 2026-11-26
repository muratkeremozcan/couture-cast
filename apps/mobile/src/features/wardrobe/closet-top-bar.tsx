// Story CC-7.11 D4, D5 owner: the Closet's top bar actions and its More sheet. Add (the screen's one
// gold primary) and a neutral More sit in the top bar's trailing slot, so the Closet opens on its
// grid; More lists Closet setup and Silhouette, which used to sit above the grid.
// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
import { router, type Href } from 'expo-router'
import type { ComponentRef, RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import {
  EdgeToEdgeModal,
  LayerSwipeHandle,
  useModalInsets,
} from '@/components/edge-to-edge-modal'
import { useModalAnimation } from '@/src/hooks/use-modal-animation'
import { ShellIcon } from '@/src/components/shell-icons'
import { useTokens } from '@/src/theme/tokens'

type PressableRef = ComponentRef<typeof Pressable>

/** The top bar's trailing slot on the Closet: Add, then More. */
export function ClosetTopBarActions({
  addRef,
  moreRef,
  onAdd,
  onMore,
}: {
  addRef: RefObject<PressableRef | null>
  moreRef: RefObject<PressableRef | null>
  onAdd: () => void
  onMore: () => void
}) {
  const { t } = useTranslation()
  const { colors, radius, shell, space, type, fontWeight } = useTokens()
  const button = {
    minHeight: shell.touchTarget,
    minWidth: shell.touchTarget,
    borderRadius: radius.md,
    paddingHorizontal: space[3],
  }
  const label = { fontSize: type.sm.fontSize, fontWeight: fontWeight.semibold }
  return (
    <View style={[styles.actions, { gap: space[2], paddingEnd: space[2] }]}>
      <Pressable
        ref={addRef}
        accessibilityRole="button"
        // The full name for assistive tech; the short visible label is a word of it, and it
        // keeps the Closet title from truncating in long locales.
        accessibilityLabel={t('wardrobe.add_garment')}
        testID="garment-capture-open"
        // D4: the Closet's one main action takes the primary role (gold), as on web.
        style={[styles.button, button, { backgroundColor: colors.primary }]}
        onPress={onAdd}
      >
        <Text
          style={[label, { color: colors.onPrimary }]}
        >{`+ ${t('wardrobe.menu.add')}`}</Text>
      </Pressable>
      <Pressable
        ref={moreRef}
        accessibilityRole="button"
        accessibilityLabel={t('wardrobe.menu.more')}
        accessibilityHint={t('wardrobe.menu.label')}
        testID="closet-more-menu"
        style={[
          styles.button,
          button,
          styles.outline,
          { borderColor: colors.lineStrong },
        ]}
        onPress={onMore}
      >
        <Text style={[label, { color: colors.ink }]}>{t('wardrobe.menu.more')}</Text>
      </Pressable>
    </View>
  )
}

/**
 * D5: the More sheet. Closet setup reads "Closet setup: done" once onboarding is completed. A row
 * closes the sheet and opens its screen; X, system back and a swipe down close it, and focus
 * returns to More.
 */
export function ClosetMoreSheet({
  visible,
  setupDone,
  onClose,
  returnFocusRef,
}: {
  visible: boolean
  setupDone: boolean
  onClose: () => void
  returnFocusRef: RefObject<PressableRef | null>
}) {
  const { t } = useTranslation()
  const { colors, scrim, radius, shell, space, type, fontWeight } = useTokens()
  const insets = useModalInsets()
  const modalAnimation = useModalAnimation('slide')
  const open = (href: Href) => {
    onClose()
    router.push(href)
  }
  const row = {
    minHeight: shell.touchTarget,
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    borderTopColor: colors.line,
  }
  const rowText = { color: colors.ink, fontSize: type.base.fontSize }
  return (
    <EdgeToEdgeModal
      visible={visible}
      animationType={modalAnimation}
      onRequestClose={onClose}
      returnFocusRef={returnFocusRef}
      scrim={scrim}
    >
      <View style={styles.overlay}>
        <View
          testID="closet-more-sheet"
          accessibilityViewIsModal
          onAccessibilityEscape={onClose}
          style={[
            styles.sheet,
            {
              backgroundColor: colors.page,
              borderTopLeftRadius: radius.xl,
              borderTopRightRadius: radius.xl,
              paddingBottom: space[4] + insets.bottom,
            },
          ]}
        >
          <LayerSwipeHandle
            style={[styles.header, { paddingStart: space[4], paddingEnd: space[2] }]}
          >
            <Text
              accessibilityRole="header"
              style={{
                color: colors.ink,
                fontSize: type.lg.fontSize,
                fontWeight: fontWeight.semibold,
              }}
            >
              {t('wardrobe.menu.label')}
            </Text>
            <Pressable
              testID="closet-more-close"
              accessibilityRole="button"
              accessibilityLabel={t('wardrobe.menu.close')}
              onPress={onClose}
              style={[
                styles.close,
                { minHeight: shell.touchTarget, minWidth: shell.touchTarget },
              ]}
            >
              <ShellIcon name="close" size={type.lg.fontSize} color={colors.ink} />
            </Pressable>
          </LayerSwipeHandle>
          <Pressable
            testID="closet-more-setup"
            accessibilityRole="link"
            style={[styles.row, row]}
            onPress={() => open('/wardrobe-onboarding')}
          >
            <Text style={rowText}>
              {setupDone ? t('wardrobe.menu.setupDone') : t('wardrobe.menu.setup')}
            </Text>
          </Pressable>
          <Pressable
            testID="closet-more-silhouette"
            accessibilityRole="link"
            style={[styles.row, row]}
            onPress={() => open('/wardrobe-silhouette')}
          >
            <Text style={rowText}>{t('wardrobe.menu.silhouette')}</Text>
          </Pressable>
        </View>
      </View>
    </EdgeToEdgeModal>
  )
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', alignItems: 'center' },
  button: { alignItems: 'center', justifyContent: 'center' },
  outline: { borderWidth: 1 },
  overlay: { flex: 1, justifyContent: 'flex-end' },
  sheet: {},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  close: { alignItems: 'center', justifyContent: 'center' },
  row: { justifyContent: 'center', borderTopWidth: StyleSheet.hairlineWidth },
})
