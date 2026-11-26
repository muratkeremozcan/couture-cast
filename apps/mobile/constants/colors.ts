// Story CC-7.9 D1, D2: the OS light/dark chrome colors are the shared design token roles
// (`packages/utils/src/design-tokens.ts`), the same names web uses. Their contrast pairings are
// pinned once in `design-tokens.spec.ts`. New code reads them through `useTokens()`
// (`src/theme/tokens.ts`); this table stays for stylesheet factories and navigation themes.
// The premium palettes in `src/theme/theme-palettes.ts` are a separate axis and ride on top.
import { colorRoles, type ColorRoles } from '@couture/utils'

const Colors = colorRoles

export type SchemeColors = ColorRoles

export default Colors
