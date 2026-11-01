const tintColorLight = '#2f95dc'
const tintColorDark = '#fff'

/**
 * OS light/dark tokens for app chrome: screens, headers, the tab bar, bands, buttons and
 * modals. Every text token clears WCAG AA (4.5:1) on `background`, `surface` and
 * `subtleSurface` of its own scheme, `onInverse` on `inverseSurface`, `onAccent` on `accent`,
 * and `noticeText`/`dangerText` on their own surfaces; `colors.test.ts` pins each pairing.
 * `border` draws rules and card edges; `strongBorder` outlines buttons, chips and fields.
 *
 * The premium palettes in `src/theme/theme-palettes.ts` are a separate axis and ride on top.
 */
const Colors = {
  light: {
    text: '#000',
    background: '#fff',
    tint: tintColorLight,
    tabIconDefault: '#ccc',
    tabIconSelected: tintColorLight,
    mutedText: '#5C5C66',
    surface: '#FFFFFF',
    subtleSurface: '#F5F5F7',
    border: '#E6E6ED',
    strongBorder: '#D4D4D8',
    inverseSurface: '#111111',
    onInverse: '#FFFFFF',
    accent: '#C9A14A',
    onAccent: '#111111',
    accentText: '#8A691F',
    noticeSurface: '#FEF9EF',
    noticeBorder: '#C5A059',
    noticeText: '#8A5A00',
    dangerSurface: '#FEE2E2',
    dangerBorder: '#FECACA',
    dangerText: '#991B1B',
    successText: '#276749',
  },
  dark: {
    text: '#fff',
    background: '#000',
    tint: tintColorDark,
    tabIconDefault: '#ccc',
    tabIconSelected: tintColorDark,
    mutedText: '#B8B8C2',
    surface: '#111111',
    subtleSurface: '#1C1C1E',
    border: '#3A3A3C',
    strongBorder: '#636366',
    inverseSurface: '#FFFFFF',
    onInverse: '#111111',
    accent: '#C9A14A',
    onAccent: '#111111',
    accentText: '#C9A14A',
    noticeSurface: '#2A2112',
    noticeBorder: '#8A6B2E',
    noticeText: '#F0D59A',
    dangerSurface: '#3B1416',
    dangerBorder: '#7F1D1D',
    dangerText: '#FFB4AB',
    successText: '#7EE2A8',
  },
}

export type SchemeColors = (typeof Colors)['light']

export default Colors
