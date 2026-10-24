import { useSyncExternalStore } from 'react'
import type { StudioOpenRequest } from '../../shared/studio-types'

/** Permintaan membuka Studio dari luar (klik kanan kartu, palette, Inspector) + cara menampilkan tab Studio. */
let pending: StudioOpenRequest | null = null
let version = 0
let showPanel: (() => void) | null = null
const listeners = new Set<() => void>()
const emit = (): void => {
  version++
  for (const l of [...listeners]) l()
}

export const studioStore = {
  /** Diatur App: mengaktifkan tab Studio di dockview. */
  setShowPanel(fn: (() => void) | null): void {
    showPanel = fn
  },
  open(req: StudioOpenRequest = {}): void {
    pending = req
    showPanel?.()
    emit()
  },
  take(): StudioOpenRequest | null {
    const r = pending
    pending = null
    return r
  },
  subscribe(fn: () => void): () => void {
    listeners.add(fn)
    return () => {
      listeners.delete(fn)
    }
  },
  reset(): void {
    pending = null
    showPanel = null
    listeners.clear()
  }
}

export function useStudioRequests(): number {
  return useSyncExternalStore(studioStore.subscribe, () => version)
}
