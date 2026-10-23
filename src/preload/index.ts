import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { AlfonsoApi, SidecarStatus } from '../shared/types'
import type { IngestEvent } from '../shared/board-types'

const api: AlfonsoApi = {
  vault: {
    getPath: () => ipcRenderer.invoke('vault:getPath'),
    openFolder: () => ipcRenderer.invoke('vault:openFolder')
  },
  theme: {
    list: () => ipcRenderer.invoke('theme:list'),
    getActiveId: () => ipcRenderer.invoke('theme:getActiveId'),
    setActive: (id) => ipcRenderer.invoke('theme:setActive', id)
  },
  sidecar: {
    getStatus: () => ipcRenderer.invoke('sidecar:getStatus'),
    onStatus: (cb) => {
      const w = (_e: Electron.IpcRendererEvent, v: SidecarStatus): void => cb(v)
      ipcRenderer.on('sidecar:status', w)
      return () => {
        ipcRenderer.off('sidecar:status', w)
      }
    }
  },
  layout: {
    load: () => ipcRenderer.invoke('layout:load'),
    save: (json) => ipcRenderer.invoke('layout:save', json)
  },
  board: {
    open: () => ipcRenderer.invoke('board:open'),
    saveCards: (patches) => ipcRenderer.invoke('board:saveCards', patches),
    createNote: (at) => ipcRenderer.invoke('board:createNote', at),
    deleteCards: (ids) => ipcRenderer.invoke('board:deleteCards', ids),
    link: (fromId, toId) => ipcRenderer.invoke('board:link', fromId, toId),
    unlink: (linkId) => ipcRenderer.invoke('board:unlink', linkId),
    saveViewport: (v) => ipcRenderer.invoke('board:saveViewport', v)
  },
  ingest: {
    // Path file hanya dibaca di preload lalu langsung dikirim ke proses utama; renderer tidak menerimanya.
    dropFiles: async (files, at) => {
      const paths = files.map((f) => webUtils.getPathForFile(f)).filter((p) => p !== '')
      if (paths.length === 0) throw new Error('File ini tidak berasal dari disk.')
      return ipcRenderer.invoke('ingest:importPaths', paths, at)
    },
    pasteText: (text, at) => ipcRenderer.invoke('ingest:pasteText', text, at),
    retry: (assetId) => ipcRenderer.invoke('ingest:retry', assetId),
    onEvent: (cb) => {
      const w = (_e: Electron.IpcRendererEvent, v: IngestEvent): void => cb(v)
      ipcRenderer.on('ingest:event', w)
      return () => {
        ipcRenderer.off('ingest:event', w)
      }
    }
  },
  search: {
    query: (q) => ipcRenderer.invoke('search:query', q)
  },
  transkrip: {
    downloadModel: () => ipcRenderer.invoke('transkrip:downloadModel')
  }
}

contextBridge.exposeInMainWorld('alfonso', api)
