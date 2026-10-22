import type { ThemeTokens } from './types'

const GROUP_PREFIX = {
  colors: '--color-',
  typography: '--',
  radius: '--radius-',
  spacing: '--space-',
  shadow: '--shadow-',
  motion: '--motion-'
} as const

const kebab = (s: string): string => s.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())

export function tokensToCssVars(t: ThemeTokens): Record<string, string> {
  const vars: Record<string, string> = {}
  for (const [group, prefix] of Object.entries(GROUP_PREFIX)) {
    for (const [key, value] of Object.entries(t[group as keyof typeof GROUP_PREFIX])) {
      vars[prefix + kebab(key)] = value
    }
  }
  return vars
}
