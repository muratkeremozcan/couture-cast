// Story CC-7.11 D8 owner: the Looks tab. It opens on the member's saved looks (the same list the
// Closet row shows, read through useSavedLooks), then a Capsules row and a Plan row. With no saved
// looks it shows one line and the two rows. Segments, filters and Ideas are CC-7.12's.
// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
import FontAwesome from '@expo/vector-icons/FontAwesome'
import { router, useFocusEffect, type Href } from 'expo-router'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import type {
  GarmentItemContract,
  SavedLookContract,
} from '@couture/api-client/contracts/http'
import type { StylePieceSelection } from '@couture/utils'
import { ScreenGate } from '@/src/components/screen-gate'
import {
  mobileApplicationUserId,
  mobileIdentityEpoch,
  resolveMobileAccessToken,
  subscribeMobileApplicationUser,
} from '@/src/lib/mobile-auth'
import { onWardrobeChanged } from '@/src/lib/wardrobe-changes'
import { listGarmentsFromMobile } from '@/src/lib/wardrobe'
import { TAB_BODY_INSET, useTokens } from '@/src/theme/tokens'
import { ClosetSavedLooksRow } from '@/src/features/wardrobe/saved-looks-row'
import { StylePiecePanel } from '@/src/features/wardrobe/style-piece-panel'
import { useSavedLooks } from '@/src/features/wardrobe/use-saved-looks'

/** One member's Looks tab; a sign-in, sign-out or account switch mounts a fresh one. */
export function LooksScreen() {
  const epoch = useSyncExternalStore(subscribeMobileApplicationUser, mobileIdentityEpoch)
  return <MemberLooks key={epoch} epoch={epoch} />
}

/**
 * The member's garments, for reopening a Style piece look in its editor (the editor needs the
 * anchor piece). The Looks gate never waits on it: without it a look opens in its detail.
 */
function useClosetGarments(owner: string | null, epoch: number) {
  const [garments, setGarments] = useState<GarmentItemContract[]>([])
  const [attempt, setAttempt] = useState(0)

  const loadInventory = useCallback(
    async (signal?: AbortSignal) => {
      const token = await resolveMobileAccessToken()
      if (!token || signal?.aborted || epoch !== mobileIdentityEpoch()) return null
      const next = await listGarmentsFromMobile(token, signal)
      if (signal?.aborted || epoch !== mobileIdentityEpoch()) return null
      setGarments(next)
      return next
    },
    [epoch]
  )

  useEffect(() => {
    if (!owner) {
      setGarments([])
      return
    }
    const controller = new AbortController()
    void loadInventory(controller.signal).catch(() => undefined)
    return () => controller.abort()
  }, [attempt, loadInventory, owner])

  const reload = useCallback(() => setAttempt((value) => value + 1), [])
  return { garments, loadInventory, reload }
}

function MemberLooks({ epoch }: { epoch: number }) {
  const { t, i18n } = useTranslation()
  const { colors, shell, space, type } = useTokens()
  const owner = mobileApplicationUserId()
  const looks = useSavedLooks({ owner, epoch })
  const closet = useClosetGarments(owner, epoch)
  const [styleSelection, setStyleSelection] = useState<StylePieceSelection | null>(null)
  const [initialSavedLook, setInitialSavedLook] = useState<SavedLookContract | null>(null)
  const [styleClosing, setStyleClosing] = useState(false)

  // A tag edit or a delete elsewhere changes which looks can reopen and their status.
  const { reload: reloadLooks } = looks
  const { reload: reloadCloset } = closet
  useEffect(
    () =>
      onWardrobeChanged(() => {
        if (epoch !== mobileIdentityEpoch()) return
        reloadCloset()
        reloadLooks()
      }),
    [epoch, reloadCloset, reloadLooks]
  )

  // Tabs stay mounted, so a return to Looks is a focus: it reads the looks again in place, and
  // the list and its scroll offset stay (as the Closet does, CC-7.7 D5).
  const leftRef = useRef(false)
  useFocusEffect(
    useCallback(() => {
      if (leftRef.current && epoch === mobileIdentityEpoch()) reloadLooks()
      leftRef.current = false
      return () => {
        leftRef.current = true
      }
    }, [epoch, reloadLooks])
  )

  const empty = looks.settled && looks.savedLooks.length === 0 && !looks.error
  const row = [
    styles.row,
    {
      minHeight: shell.touchTarget,
      gap: space[3],
      paddingVertical: space[3],
      borderBottomColor: colors.line,
    },
  ]
  const rowText = { color: colors.ink, fontSize: type.base.fontSize }
  const linkRow = (testID: string, label: string, href: Href) => (
    <Pressable
      testID={testID}
      accessibilityRole="link"
      style={row}
      onPress={() => router.push(href)}
    >
      <Text style={[styles.rowLabel, rowText]}>{label}</Text>
      <FontAwesome name="chevron-right" size={type.sm.fontSize} color={colors.inkMuted} />
    </Pressable>
  )

  return (
    <>
      <View style={styles.screen} testID="looks-screen">
        <ScreenGate screen="looks" ready={looks.settled} style={styles.gate}>
          <ScrollView
            contentContainerStyle={[
              styles.content,
              { paddingVertical: space[5], gap: space[6] },
            ]}
          >
            {empty || !owner ? (
              <Text
                testID="looks-first-content"
                style={{ color: colors.inkMuted, fontSize: type.base.fontSize }}
              >
                {t('looks.empty')}
              </Text>
            ) : (
              <View testID="looks-first-content">
                <ClosetSavedLooksRow
                  variant="list"
                  owner={owner}
                  savedLooks={looks.savedLooks}
                  totalCount={looks.total}
                  hasMore={looks.hasMore}
                  isLoadingMore={looks.loadingMore}
                  onLoadMore={looks.loadMore}
                  isLoading={looks.loading && !looks.settled}
                  loadError={looks.error}
                  garments={closet.garments}
                  onRetry={reloadLooks}
                  onChanged={reloadLooks}
                  onReopenStylePiece={(look) => {
                    const anchor = closet.garments.find(
                      (item) => item.id === look.anchorGarmentId
                    )
                    if (!anchor || !anchor.category || !anchor.comfortRange) return
                    if (styleSelection) return
                    setInitialSavedLook(look)
                    setStyleSelection({
                      id: anchor.id,
                      category: anchor.category,
                      comfortRange: anchor.comfortRange,
                    })
                  }}
                />
              </View>
            )}
            {/* Neutral rows: Looks has no primary action of its own. */}
            <View style={[styles.rows, { borderTopColor: colors.line }]}>
              {linkRow('looks-capsules-row', t('looks.capsules'), '/wardrobe-capsules')}
              {linkRow('looks-plan-row', t('looks.plan'), '/planner')}
            </View>
          </ScrollView>
        </ScreenGate>
      </View>

      {owner && styleSelection && (
        <StylePiecePanel
          selection={styleSelection}
          initialSavedLook={initialSavedLook}
          inWardrobe={closet.garments.some(({ id }) => id === styleSelection.id)}
          loadInventory={closet.loadInventory}
          visible={!styleClosing}
          owner={owner}
          epoch={epoch}
          locale={i18n.language}
          onSavedLooksChanged={reloadLooks}
          onClose={() => setStyleClosing(true)}
          onDismiss={() => {
            setStyleSelection(null)
            setInitialSavedLook(null)
            setStyleClosing(false)
          }}
        />
      )}
    </>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  gate: { flex: 1 },
  content: { paddingHorizontal: TAB_BODY_INSET },
  rows: { borderTopWidth: StyleSheet.hairlineWidth },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowLabel: { flex: 1 },
})
