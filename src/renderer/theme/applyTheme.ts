import type { ThemeTokens } from '../../shared/types'
import { tokensToCssVars } from '../../shared/theme-css'

export function applyTheme(t: ThemeTokens, root: HTMLElement = document.documentElement): void {
  for (const [name, value] of Object.entries(tokensToCssVars(t))) root.style.setProperty(name, value)
  root.dataset.themeMode = t.mode
}
