// Story CC-7.11 D8 owner: the Looks tab.
// Story CC-7.12 D1 to D4, D9, D10, D13: three segments, Saved, Ideas and Plan, in the tab params
// (`segment`, `filter`; a change is `setParams`). With no segment, Looks opens on Saved when the
// member has a saved look or capsule and on Ideas otherwise, decided once per entry after both
// first reads settle (TEA P1). Saved is one newest-first tile grid with All, Today and Capsules,
// each read from the server (P2); Ideas shows the sample looks; Plan holds the planner, whose
// locked states show the free preview. `looks-first-content` marks the open segment's first block.
// Learning path Step 69: Looks tab for saved looks, ideas and plans.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-69-looks-tab-for-saved-looks-ideas-and-plans
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import {
  LOOKS_FILTERS,
  LOOKS_SEGMENTS,
  looksIdeas,
  parseLooksFilter,
  parseLooksSegment,
  type LooksFilter,
  type LooksSegment,
} from '@couture/utils'
import { ScreenGate } from '@/src/components/screen-gate'
import { ShellIcon } from '@/src/components/shell-icons'
import { PlannerBody } from '@/src/features/premium/planner-screen'
import {
  mobileApplicationUserId,
  mobileIdentityEpoch,
  subscribeMobileApplicationUser,
} from '@/src/lib/mobile-auth'
import { onWardrobeChanged } from '@/src/lib/wardrobe-changes'
import { TAB_BODY_INSET, useTokens } from '@/src/theme/tokens'
import { savedLookRoute } from './looks-routes'
import { CapsuleTile, IdeaTile, LooksTileGrid, SavedLookTile } from './looks-tile'
import { useLooksFeed, type LooksFeedState } from './use-looks-feed'

/**
 * One member's Looks tab; a sign-in, sign-out or account switch mounts a fresh one, so the
 * first paint after a member change holds no tile of the previous member (CC-7.7 D5, TEA P9).
 */
export function LooksScreen() {
  const epoch = useSyncExternalStore(subscribeMobileApplicationUser, mobileIdentityEpoch)
  return <MemberLooks key={epoch} epoch={epoch} />
}

function MemberLooks({ epoch }: { epoch: number }) {
  const { space } = useTokens()
  const owner = mobileApplicationUserId()
  const params = useLocalSearchParams<{ segment?: string; filter?: string }>()
  const addressSegment = parseLooksSegment(params.segment)
  const filter = parseLooksFilter(params.filter)
  const feed = useLooksFeed({ owner, epoch, filter })

  // P1: decided once per entry; removing the last look while on Saved keeps Saved.
  const [defaultSegment, setDefaultSegment] = useState<LooksSegment | null>(() =>
    owner ? null : 'ideas'
  )
  useEffect(() => {
    if (defaultSegment || addressSegment || !feed.settled) return
    setDefaultSegment(feed.failed || feed.hasItems ? 'saved' : 'ideas')
  }, [addressSegment, defaultSegment, feed.failed, feed.hasItems, feed.settled])

  const segment = addressSegment ?? defaultSegment
  const ready = segment !== null && (segment !== 'saved' || feed.settled)

  // A tag edit or a garment delete elsewhere changes a look's state line.
  const { reload } = feed
  useEffect(
    () =>
      onWardrobeChanged(() => {
        if (epoch === mobileIdentityEpoch()) reload()
      }),
    [epoch, reload]
  )

  // Tabs stay mounted, so a return to Looks is a focus: it reads the feed again in place, and
  // the tiles and the scroll offset stay (as the Closet does, CC-7.7 D5).
  const leftRef = useRef(false)
  useFocusEffect(
    useCallback(() => {
      if (leftRef.current && epoch === mobileIdentityEpoch()) reload()
      leftRef.current = false
      return () => {
        leftRef.current = true
      }
    }, [epoch, reload])
  )

  // A new segment or filter starts at its top.
  const scrollRef = useRef<ScrollView | null>(null)
  useEffect(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false })
  }, [segment, filter])

  return (
    <View style={styles.screen} testID="looks-screen">
      <ScreenGate
        screen="looks"
        ready={ready}
        style={styles.gate}
        // The gate's deadline opened it before the reads answered: Saved shows their progress.
        onOpenChange={(open) => {
          if (open && !addressSegment && !defaultSegment) setDefaultSegment('saved')
        }}
      >
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={[
            styles.content,
            { paddingVertical: space[4], gap: space[4] },
          ]}
        >
          {segment ? (
            <>
              <SegmentControl
                segment={segment}
                onSelect={(next) => router.setParams({ segment: next })}
              />
              {segment === 'saved' ? (
                <SavedPanel
                  owner={owner}
                  filter={filter}
                  feed={feed}
                  onFilter={(next) =>
                    router.setParams({ segment: 'saved', filter: next })
                  }
                />
              ) : null}
              {segment === 'ideas' ? (
                <IdeasPanel showEmptyLine={!owner || (feed.settled && !feed.hasItems)} />
              ) : null}
              {segment === 'plan' ? (
                <View testID="looks-first-content" style={{ gap: space[3] }}>
                  <PlannerBody />
                </View>
              ) : null}
            </>
          ) : null}
        </ScrollView>
      </ScreenGate>
    </View>
  )
}

/** D1: Saved, Ideas and Plan as tabs. Not pill shaped, so the CC-7.10 guard sees no chip row. */
function SegmentControl({
  segment,
  onSelect,
}: {
  segment: LooksSegment
  onSelect: (segment: LooksSegment) => void
}) {
  const { t } = useTranslation()
  const { colors, radius, shell, space, type, fontWeight } = useTokens()
  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={t('looks.segments.label')}
      testID="looks-segments"
      style={[
        styles.segments,
        { borderRadius: radius.md, borderColor: colors.lineStrong, padding: space[0.5] },
      ]}
    >
      {LOOKS_SEGMENTS.map((id) => {
        const selected = id === segment
        return (
          <Pressable
            key={id}
            testID={`looks-segment-${id}`}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            aria-selected={selected}
            onPress={() => {
              if (!selected) onSelect(id)
            }}
            style={[
              styles.segment,
              {
                minHeight: shell.touchTarget,
                borderRadius: radius.sm,
                backgroundColor: selected ? colors.inverse : undefined,
              },
            ]}
          >
            <Text
              style={{
                color: selected ? colors.onInverse : colors.ink,
                fontSize: type.sm.fontSize,
                fontWeight: selected ? fontWeight.semibold : fontWeight.medium,
              }}
            >
              {t(`looks.segments.${id}`)}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

/** D4: one chip row, each filter its own feed. */
function FilterChips({
  filter,
  onSelect,
}: {
  filter: LooksFilter
  onSelect: (filter: LooksFilter) => void
}) {
  const { t } = useTranslation()
  const { colors, radius, shell, space, type, fontWeight } = useTokens()
  return (
    <View
      role="group"
      accessibilityLabel={t('looks.filters.label')}
      testID="looks-filters"
      style={[styles.chips, { gap: space[2] }]}
    >
      {LOOKS_FILTERS.map((id) => {
        const pressed = id === filter
        return (
          <Pressable
            key={id}
            testID={`looks-filter-${id}`}
            accessibilityRole="button"
            accessibilityState={{ selected: pressed }}
            aria-pressed={pressed}
            onPress={() => {
              if (!pressed) onSelect(id)
            }}
            style={[
              styles.chip,
              {
                minHeight: shell.touchTarget,
                borderRadius: radius.full,
                paddingHorizontal: space[4],
                borderColor: pressed ? colors.inverse : colors.lineStrong,
                backgroundColor: pressed ? colors.inverse : colors.page,
              },
            ]}
          >
            <Text
              style={{
                color: pressed ? colors.onInverse : colors.ink,
                fontSize: type.sm.fontSize,
                fontWeight: pressed ? fontWeight.semibold : fontWeight.medium,
              }}
            >
              {t(`looks.filters.${id}`)}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

/** A neutral outline control (Load more, Retry, Sign in): the screen's primary is Plan's alone. */
function OutlineButton({
  label,
  testID,
  disabled = false,
  onPress,
}: {
  label: string
  testID: string
  disabled?: boolean
  onPress: () => void
}) {
  const { colors, radius, shell, space, type, fontWeight } = useTokens()
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      aria-disabled={disabled}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.outline,
        {
          minHeight: shell.touchTarget,
          borderRadius: radius.md,
          borderColor: colors.lineStrong,
          paddingHorizontal: space[3],
          opacity: disabled ? 0.6 : 1,
        },
      ]}
    >
      <Text
        style={{
          color: colors.ink,
          fontSize: type.sm.fontSize,
          fontWeight: fontWeight.semibold,
        }}
      >
        {label}
      </Text>
    </Pressable>
  )
}

function SavedPanel({
  owner,
  filter,
  feed,
  onFilter,
}: {
  owner: string | null
  filter: LooksFilter
  feed: LooksFeedState
  onFilter: (filter: LooksFilter) => void
}) {
  const { t } = useTranslation()
  const { colors, radius, shell, space, type } = useTokens()
  const line = { color: colors.inkMuted, fontSize: type.base.fontSize }

  // Signed out: one line and one way to sign in; nothing is read.
  if (!owner) {
    return (
      <View testID="looks-first-content" style={{ gap: space[3] }}>
        <Text style={line}>{t('looks.detail.signIn')}</Text>
        <OutlineButton
          label={t('looks.detail.signInAction')}
          testID="looks-sign-in"
          onPress={() => router.push('/signin')}
        />
      </View>
    )
  }

  const manage =
    filter === 'capsules' ? (
      <Pressable
        testID="looks-manage-capsules"
        accessibilityRole="link"
        onPress={() => router.push('/wardrobe-capsules')}
        style={[
          styles.row,
          {
            minHeight: shell.touchTarget,
            gap: space[3],
            borderTopColor: colors.line,
            borderBottomColor: colors.line,
          },
        ]}
      >
        <Text
          style={[styles.rowLabel, { color: colors.ink, fontSize: type.base.fontSize }]}
        >
          {t('looks.manageCapsules')}
        </Text>
        <ShellIcon name="forward" size={type.sm.fontSize} color={colors.inkMuted} />
      </Pressable>
    ) : null

  let body
  if (!feed.settled) {
    // TEA T1: a new filter's first read is in flight; no tile of the previous filter shows.
    body = (
      <View testID="looks-first-content" style={{ paddingVertical: space[6] }}>
        <ActivityIndicator testID="looks-feed-loading" color={colors.ink} />
      </View>
    )
  } else if (feed.failed) {
    body = (
      <View
        testID="looks-first-content"
        accessibilityRole="alert"
        style={[
          {
            gap: space[2],
            padding: space[3],
            borderRadius: radius.lg,
            backgroundColor: colors.dangerSurface,
          },
        ]}
      >
        <Text style={{ color: colors.dangerInk }}>{t('savedLooks.loadFailed')}</Text>
        <OutlineButton
          label={t('savedLooks.retry')}
          testID="saved-looks-retry"
          onPress={feed.reload}
        />
      </View>
    )
  } else if (feed.view.entries.length === 0 && feed.view.next === null) {
    const empty =
      filter === 'today'
        ? t('looks.filterEmpty.today')
        : filter === 'capsules'
          ? t('looks.filterEmpty.capsules')
          : t('looks.empty')
    body = (
      <View testID="looks-first-content">
        <Text testID="looks-filter-empty" style={line}>
          {empty}
        </Text>
      </View>
    )
  } else {
    body = (
      <>
        <View testID="looks-first-content">
          <LooksTileGrid testID="looks-saved-grid">
            {feed.view.entries.map((entry) =>
              entry.kind === 'look' ? (
                <SavedLookTile
                  key={`look:${entry.id}`}
                  look={entry.item}
                  onPress={() => router.push(savedLookRoute(entry.id, filter))}
                />
              ) : (
                <CapsuleTile
                  key={`capsule:${entry.id}`}
                  capsule={entry.item}
                  onPress={() =>
                    router.push({
                      pathname: '/wardrobe-capsules',
                      params: { capsule: entry.id },
                    })
                  }
                />
              )
            )}
          </LooksTileGrid>
        </View>
        {feed.view.next !== null ? (
          <OutlineButton
            label={feed.loadingMore ? '…' : t('looks.loadMore')}
            testID="saved-looks-load-more"
            disabled={feed.loadingMore}
            onPress={feed.loadMore}
          />
        ) : null}
      </>
    )
  }

  return (
    <>
      <FilterChips filter={filter} onSelect={onFilter} />
      {body}
      {manage}
    </>
  )
}

/** D9: the sample looks as picture tiles; with nothing saved, the one line comes first. */
function IdeasPanel({ showEmptyLine }: { showEmptyLine: boolean }) {
  const { t } = useTranslation()
  const { colors, space, type } = useTokens()
  const ideas = useMemo(() => looksIdeas(), [])
  return (
    <View testID="looks-first-content" style={{ gap: space[3] }}>
      {showEmptyLine ? (
        <Text
          testID="looks-ideas-empty-line"
          style={{ color: colors.inkMuted, fontSize: type.base.fontSize }}
        >
          {t('looks.empty')}
        </Text>
      ) : null}
      <LooksTileGrid testID="looks-ideas-grid">
        {ideas.map((idea) => (
          <IdeaTile key={idea.look.id} idea={idea} />
        ))}
      </LooksTileGrid>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  gate: { flex: 1 },
  content: { paddingHorizontal: TAB_BODY_INSET },
  segments: { flexDirection: 'row', borderWidth: 1 },
  segment: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: { alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  outline: { alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowLabel: { flex: 1 },
})
