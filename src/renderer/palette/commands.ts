import type { AlfonsoApi, ThemeTokens } from '../../shared/types'
import { sidecarLabel } from '../layout/layout'

export interface Command {
  id: string
  label: string
  run(): void | Promise<void>
}

export interface CommandContext {
  themes: ThemeTokens[]
  api: AlfonsoApi
  resetLayout(): void
  showMessage(m: string): void
  applyThemeById(id: string): void
}

export function buildCommands(ctx: CommandContext): Command[] {
  return [
    ...ctx.themes.map((t) => ({
      id: `theme.switch:${t.id}`,
      label: `Ganti tema: ${t.name}`,
      run: () => ctx.applyThemeById(t.id)
    })),
    { id: 'vault.open', label: 'Buka folder vault', run: () => ctx.api.vault.openFolder() },
    {
      id: 'sidecar.status',
      label: 'Status sidecar',
      run: async () => ctx.showMessage(sidecarLabel(await ctx.api.sidecar.getStatus()))
    },
    { id: 'layout.reset', label: 'Reset tata letak', run: () => ctx.resetLayout() }
  ]
}

export function filterCommands(cmds: Command[], query: string): Command[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return cmds
  return cmds.filter((c) => {
    const label = c.label.toLowerCase()
    return words.every((w) => label.includes(w))
  })
}
