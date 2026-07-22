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
  },
  dark: {
    background: '#000000',
    surface: '#111111',
    text: '#FFFFFF',
    mutedText: '#C7C7CC',
    divider: '#E6E6ED',
    subtleSurface: 'rgba(255,255,255,0.08)',
    skeleton: '#2C2C2E',
  },
} as const

export function useHeroPalette() {
  return heroPalettes[useColorScheme() === 'dark' ? 'dark' : 'light']
}
