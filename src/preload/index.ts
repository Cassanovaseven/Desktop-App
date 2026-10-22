import { contextBridge, ipcRenderer } from 'electron'
import type { AlfonsoApi, SidecarStatus } from '../shared/types'

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
  }
}

contextBridge.exposeInMainWorld('alfonso', api)
