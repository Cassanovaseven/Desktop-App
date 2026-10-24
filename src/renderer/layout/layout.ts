import type { DockviewApi } from 'dockview-react'
import type { SidecarStatus } from '../../shared/types'

export interface PanelDef {
  id: string
  title: string
  component: 'placeholder' | 'queue' | 'board' | 'projects' | 'library' | 'inspector'
  placeholder?: string
}

export const PANELS: PanelDef[] = [
  { id: 'explorer', title: 'Proyek', component: 'projects' },
  { id: 'library', title: 'Library', component: 'library' },
  { id: 'board', title: 'Board', component: 'board' },
  { id: 'studio', title: 'Studio', component: 'placeholder', placeholder: 'Segera hadir — Fase 3' },
  { id: 'deck', title: 'Deck', component: 'placeholder', placeholder: 'Segera hadir — Fase 4' },
  { id: 'inspector', title: 'Inspector', component: 'inspector' },
  { id: 'queue', title: 'Antrean & Log', component: 'queue' }
]

const byId = (id: string): PanelDef => PANELS.find((p) => p.id === id)!

function add(api: DockviewApi, id: string, position?: { referencePanel: string; direction: 'left' | 'right' | 'below' | 'within' }, inactive = false): void {
  const p = byId(id)
  api.addPanel({ id: p.id, component: p.component, title: p.title, params: { text: p.placeholder }, position, inactive })
}

export function buildDefaultLayout(api: DockviewApi): void {
  add(api, 'board')
  // `inactive` menjaga Board tetap jadi tab aktif (dockview.dev/docs/core/panels/add).
  add(api, 'studio', { referencePanel: 'board', direction: 'within' }, true)
  add(api, 'deck', { referencePanel: 'board', direction: 'within' }, true)
  add(api, 'explorer', { referencePanel: 'board', direction: 'left' })
  add(api, 'library', { referencePanel: 'explorer', direction: 'within' })
  add(api, 'inspector', { referencePanel: 'board', direction: 'right' })
  add(api, 'queue', { referencePanel: 'board', direction: 'below' })
}

/** Tata letak tersimpan dari fase sebelumnya: panel baru (Library) ditambahkan; susunan lain tidak diubah. */
export function ensurePanels(api: DockviewApi): void {
  if (api.getPanel('library')) return
  if (api.getPanel('explorer')) add(api, 'library', { referencePanel: 'explorer', direction: 'within' })
  else if (api.getPanel('board')) add(api, 'library', { referencePanel: 'board', direction: 'left' })
  else add(api, 'library')
}

export function restoreLayout(api: DockviewApi, saved: string | null, log: (m: string) => void): 'restored' | 'default' {
  if (saved) {
    try {
      api.fromJSON(JSON.parse(saved))
      ensurePanels(api)
      return 'restored'
    } catch (err) {
      log(`Tata letak tersimpan rusak, memakai default: ${(err as Error).message}`)
      api.clear()
    }
  }
  buildDefaultLayout(api)
  return 'default'
}

export function sidecarLabel(s: SidecarStatus | null): string {
  if (!s) return 'Sidecar: memulai…'
  switch (s.state) {
    case 'ready':
      return `Sidecar: siap (port ${s.port})`
    case 'starting':
      return 'Sidecar: memulai…'
    case 'restarting':
      return `Sidecar: memulai ulang… (percobaan ${s.restarts})`
    case 'failed':
      return `Sidecar: gagal — ${s.message ?? 'tidak diketahui'}`
    case 'stopped':
      return 'Sidecar: berhenti'
  }
}
