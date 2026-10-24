import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { AlfonsoApi, SidecarStatus } from '../shared/types'
import type { IngestEvent } from '../shared/board-types'
import type { StudioEvent } from '../shared/studio-types'

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
  projects: {
    list: () => ipcRenderer.invoke('projects:list'),
    create: (name) => ipcRenderer.invoke('projects:create', name),
    rename: (id, name) => ipcRenderer.invoke('projects:rename', id, name),
    createBoard: (projectId, name) => ipcRenderer.invoke('projects:createBoard', projectId, name),
    renameBoard: (id, name) => ipcRenderer.invoke('projects:renameBoard', id, name),
    getActiveBoardId: () => ipcRenderer.invoke('projects:getActiveBoardId'),
    setActiveBoard: (id) => ipcRenderer.invoke('projects:setActiveBoard', id)
  },
  library: {
    query: (q) => ipcRenderer.invoke('library:query', q),
    tags: () => ipcRenderer.invoke('library:tags'),
    detail: (assetId) => ipcRenderer.invoke('library:detail', assetId),
    addTag: (assetId, tag) => ipcRenderer.invoke('library:addTag', assetId, tag),
    removeTag: (assetId, tag) => ipcRenderer.invoke('library:removeTag', assetId, tag),
    showInFolder: (assetId) => ipcRenderer.invoke('library:showInFolder', assetId)
  },
  board: {
    open: (boardId) => ipcRenderer.invoke('board:open', boardId),
    addAssetCard: (assetId, at) => ipcRenderer.invoke('board:addAssetCard', assetId, at),
    locate: (cardId) => ipcRenderer.invoke('board:locate', cardId),
    saveCards: (patches) => ipcRenderer.invoke('board:saveCards', patches),
    createNote: (at) => ipcRenderer.invoke('board:createNote', at),
    deleteCards: (ids) => ipcRenderer.invoke('board:deleteCards', ids),
    link: (fromId, toId) => ipcRenderer.invoke('board:link', fromId, toId),
    unlink: (linkId) => ipcRenderer.invoke('board:unlink', linkId),
    saveViewport: (v, boardId) => ipcRenderer.invoke('board:saveViewport', v, boardId)
  },
  ingest: {
    // Path file hanya dibaca di preload lalu langsung dikirim ke proses utama; renderer tidak menerimanya.
    dropFiles: async (files, at) => {
      const paths = files.map((f) => webUtils.getPathForFile(f)).filter((p) => p !== '')
      if (paths.length === 0) throw new Error('File ini tidak berasal dari disk.')
      return ipcRenderer.invoke('ingest:importPaths', paths, at)
    },
    pasteText: (text, at) => ipcRenderer.invoke('ingest:pasteText', text, at),
    pasteImage: (bytes, mime, at) => ipcRenderer.invoke('ingest:pasteImage', bytes, mime, at),
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
  watch: {
    add: () => ipcRenderer.invoke('watch:add'),
    remove: () => ipcRenderer.invoke('watch:remove')
  },
  studio: {
    listPrompts: (filter) => ipcRenderer.invoke('studio:listPrompts', filter),
    getPrompt: (id) => ipcRenderer.invoke('studio:getPrompt', id),
    savePrompt: (input) => ipcRenderer.invoke('studio:savePrompt', input),
    history: (id) => ipcRenderer.invoke('studio:history', id),
    addExample: (promptId, assetId) => ipcRenderer.invoke('studio:addExample', promptId, assetId),
    estimate: (promptId, params) => ipcRenderer.invoke('studio:estimate', promptId, params),
    estimateGeneration: (id) => ipcRenderer.invoke('studio:estimateGeneration', id),
    generate: (req) => ipcRenderer.invoke('studio:generate', req),
    regenerate: (id, confirmedCost) => ipcRenderer.invoke('studio:regenerate', id, confirmedCost),
    retry: (id, confirmedCost) => ipcRenderer.invoke('studio:retry', id, confirmedCost),
    generations: (limit) => ipcRenderer.invoke('studio:generations', limit),
    generationForAsset: (assetId) => ipcRenderer.invoke('studio:generationForAsset', assetId),
    settings: () => ipcRenderer.invoke('studio:settings'),
    saveKey: (apiKey, secret) => ipcRenderer.invoke('studio:saveKey', apiKey, secret),
    clearKey: () => ipcRenderer.invoke('studio:clearKey'),
    setComfyUrl: (url) => ipcRenderer.invoke('studio:setComfyUrl', url),
    setCost: (model, credits) => ipcRenderer.invoke('studio:setCost', model, credits),
    comfyStatus: () => ipcRenderer.invoke('studio:comfyStatus'),
    pickWorkflow: () => ipcRenderer.invoke('studio:pickWorkflow'),
    assetName: (id) => ipcRenderer.invoke('studio:assetName', id),
    onEvent: (cb) => {
      const w = (_e: Electron.IpcRendererEvent, v: StudioEvent): void => cb(v)
      ipcRenderer.on('studio:event', w)
      return () => {
        ipcRenderer.off('studio:event', w)
      }
    }
  },
  transkrip: {
    downloadModel: () => ipcRenderer.invoke('transkrip:downloadModel')
  }
}

contextBridge.exposeInMainWorld('alfonso', api)
