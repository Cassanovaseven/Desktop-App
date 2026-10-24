import { useSyncExternalStore } from 'react'

/** Yang sedang dilihat Inspector: aset (dari Library atau kartu file), kartu tanpa aset, atau beberapa kartu. */
export type Selection =
  | { kind: 'asset'; assetId: string; cardId?: string }
  | { kind: 'card'; cardId: string; type: string; content: string | null }
  | { kind: 'cards'; count: number }
  | null

export interface WorkspaceState {
  activeBoardId: string | null
  activeProjectId: string | null
  selection: Selection
  /** Naik setiap kali isi Library mungkin berubah (impor, tag, kartu dihapus). */
  libraryVersion: number
  /** Naik setiap kali daftar proyek/board berubah. */
  projectsVersion: number
}

const initial = (): WorkspaceState => ({ activeBoardId: null, activeProjectId: null, selection: null, libraryVersion: 0, projectsVersion: 0 })

// Penyimpan kecil bersama untuk panel yang berbeda (Proyek, Board, Library, Inspector) di dalam dockview.
let state = initial()
let pendingFocus: string | null = null
const listeners = new Set<() => void>()
const emit = (): void => {
  for (const l of [...listeners]) l()
}
const set = (patch: Partial<WorkspaceState>): void => {
  state = { ...state, ...patch }
  emit()
}

export const workspace = {
  get: (): WorkspaceState => state,
  subscribe(fn: () => void): () => void {
    listeners.add(fn)
    return () => {
      listeners.delete(fn)
    }
  },
  setActiveBoard(boardId: string, projectId: string | null): void {
    if (state.activeBoardId === boardId && state.activeProjectId === projectId) return
    set({ activeBoardId: boardId, activeProjectId: projectId })
  },
  select(selection: Selection): void {
    set({ selection })
  },
  bumpLibrary(): void {
    set({ libraryVersion: state.libraryVersion + 1 })
  },
  bumpProjects(): void {
    set({ projectsVersion: state.projectsVersion + 1 })
  },
  /** Kartu yang harus dipusatkan Board setelah (pindah dan) selesai dimuat. */
  requestFocus(cardId: string): void {
    pendingFocus = cardId
    emit()
  },
  peekFocus(): string | null {
    return pendingFocus
  },
  takeFocus(): string | null {
    const id = pendingFocus
    pendingFocus = null
    return id
  },
  reset(): void {
    state = initial()
    pendingFocus = null
    listeners.clear()
  }
}

export function useWorkspace<T>(pick: (s: WorkspaceState) => T): T {
  return useSyncExternalStore(workspace.subscribe, () => pick(workspace.get()))
}
