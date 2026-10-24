import type { AlfonsoApi, ThemeTokens } from '../../shared/types'
import { sidecarLabel } from '../layout/layout'
import type { StudioOpenRequest } from '../../shared/studio-types'

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
  addNote(): void
  openSearch(): void
  openLibrary(): void
  searchLibrary(): void
  newProject(): void
  newBoard(): void
  switchBoard(): void
  openStudio(req: StudioOpenRequest): void
  generateFromSelection(): void
}

export function buildCommands(ctx: CommandContext): Command[] {
  return [
    { id: 'board.addNote', label: 'Tambah catatan', run: () => ctx.addNote() },
    { id: 'search.files', label: 'Cari isi file…', run: () => ctx.openSearch() },
    { id: 'library.open', label: 'Buka Library', run: () => ctx.openLibrary() },
    { id: 'library.search', label: 'Cari di Library…', run: () => ctx.searchLibrary() },
    { id: 'project.new', label: 'Proyek baru…', run: () => ctx.newProject() },
    { id: 'board.new', label: 'Board baru…', run: () => ctx.newBoard() },
    { id: 'board.switch', label: 'Pindah ke board…', run: () => ctx.switchBoard() },
    { id: 'studio.open', label: 'Buka Studio', run: () => ctx.openStudio({}) },
    { id: 'studio.newPrompt', label: 'Prompt baru…', run: () => ctx.openStudio({ newPrompt: true }) },
    { id: 'studio.fromSelection', label: 'Generate dari kartu terpilih', run: () => ctx.generateFromSelection() },
    { id: 'studio.account', label: 'Studio: Akun & biaya…', run: () => ctx.openStudio({ account: true }) },
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
    {
      id: 'transkrip.download',
      label: 'Unduh model transkrip…',
      run: async () => {
        ctx.showMessage('Menyiapkan model transkrip…')
        ctx.showMessage((await ctx.api.transkrip.downloadModel()).message)
      }
    },
    { id: 'watch.add', label: 'Pantau folder…', run: async () => ctx.showMessage((await ctx.api.watch.add()).message) },
    { id: 'watch.remove', label: 'Berhenti memantau folder…', run: async () => ctx.showMessage((await ctx.api.watch.remove()).message) },
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
