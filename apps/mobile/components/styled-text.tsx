import { Text } from './themed'
import type { TextProps } from './themed'

export function MonoText(props: TextProps) {
  return <Text {...props} style={[props.style, { fontFamily: 'SpaceMono' }]} />
}
