import { useColorScheme } from 'react-native'

const heroPalettes = {
  light: {
    background: '#FFFFFF',
    surface: '#FFFFFF',
    text: '#111111',
    mutedText: '#737373',
    divider: '#E6E6ED',
    subtleSurface: 'rgba(0,0,0,0.02)',
    skeleton: '#E6E6ED',
    danger: '#B42318',
  },
  dark: {
    background: '#000000',
    surface: '#111111',
    text: '#FFFFFF',
    mutedText: '#C7C7CC',
    divider: '#E6E6ED',
    subtleSurface: 'rgba(255,255,255,0.08)',
    skeleton: '#2C2C2E',
    // The light scheme's #B42318 falls to roughly 4:1 on the dark hero surface,
    // under the WCAG 2.2 AA floor for body text, so the dark scheme lightens it.
    danger: '#FF9A8F',
  },
} as const

export function useHeroPalette() {
  return heroPalettes[useColorScheme() === 'dark' ? 'dark' : 'light']
}
