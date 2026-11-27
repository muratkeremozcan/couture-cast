// Story CC-7.11 D7, D8 owner: the native one-line row that opens a sub-screen (Profile > Style and
// the Style rows), matching the web NavRow: label at the start, chevron at the end, a hairline
// rule below and a 44 pt target.
// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
import { Pressable, StyleSheet, Text } from 'react-native'
import { ShellIcon } from '@/src/components/shell-icons'
import { useTokens } from '@/src/theme/tokens'

export function NavRow({
  label,
  value,
  testID,
  onPress,
}: {
  label: string
  value?: string
  testID: string
  onPress: () => void
}) {
  const { colors, shell, space, type } = useTokens()
  return (
    <Pressable
      testID={testID}
      accessibilityRole="link"
      accessibilityLabel={value ? `${label}, ${value}` : label}
      onPress={onPress}
      style={[
        styles.row,
        {
          minHeight: shell.touchTarget,
          gap: space[3],
          paddingVertical: space[3],
          borderBottomColor: colors.line,
        },
      ]}
    >
      <Text style={[styles.label, { color: colors.ink, fontSize: type.base.fontSize }]}>
        {label}
      </Text>
      {value ? (
        <Text
          style={[styles.value, { color: colors.inkMuted, fontSize: type.sm.fontSize }]}
        >
          {value}
        </Text>
      ) : null}
      <ShellIcon name="forward" size={type.sm.fontSize} color={colors.inkMuted} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  label: { flex: 1 },
  value: { maxWidth: '45%', flexShrink: 1, textAlign: 'right' },
})
