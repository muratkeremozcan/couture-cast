// Story CC-7.9 D1: the hero and its neighbors read the shared color roles of the OS scheme.
// Kept as a name so the many hero call sites read one hook; it is `useTokens().colors`.
import type { ColorRoles } from '@couture/utils'
import { useTokens } from '@/src/theme/tokens'

export function useHeroPalette(): ColorRoles {
  return useTokens().colors
}
