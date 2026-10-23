import { ipcMain, shell, type BrowserWindow } from 'electron'
import type Database from 'better-sqlite3'
import type { ThemeTokens, VaultPaths } from '../shared/types'
import { getSetting, setSetting } from './db/database'
import { resolveActiveThemeId } from './theme'
import type { SidecarManager } from './sidecar'
import type { IngestService } from './ingest/service'
import type { CardPatch, Point, Viewport } from '../shared/board-types'
import { createLink, deleteCards, deleteLink, getOrCreateDefaultBoard, insertCard, loadBoard, saveCards, saveViewport } from './board/repo'
import { searchAssets } from './search'

const isPoint = (v: unknown): v is Point =>
  typeof v === 'object' && v !== null && Number.isFinite((v as Point).x) && Number.isFinite((v as Point).y)
const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string')
function assert(cond: unknown, msg = 'Permintaan tidak valid'): asserts cond {
  if (!cond) throw new Error(msg)
}

export interface IpcDeps {
  getWindow: () => BrowserWindow | null
  vault: VaultPaths
  db: Database.Database
  themes: ThemeTokens[]
  sidecar: SidecarManager
  ingest: IngestService
}

export function registerIpc(deps: IpcDeps): void {
  const { vault, db, themes, sidecar } = deps

  ipcMain.handle('vault:getPath', () => vault.root)
  ipcMain.handle('vault:openFolder', async () => {
    const err = await shell.openPath(vault.root)
    if (err) throw new Error(`Folder vault tidak bisa dibuka: ${err}`)
  })

  ipcMain.handle('theme:list', () => themes)
  ipcMain.handle('theme:getActiveId', () => resolveActiveThemeId(getSetting(db, 'theme.active'), themes))
  ipcMain.handle('theme:setActive', (_e, id: unknown) => {
    if (typeof id !== 'string' || !themes.some((t) => t.id === id)) throw new Error('Tema tidak dikenal')
    setSetting(db, 'theme.active', id)
  })

  ipcMain.handle('sidecar:getStatus', () => sidecar.getStatus())
  sidecar.onStatus((s) => deps.getWindow()?.webContents.send('sidecar:status', s))

  ipcMain.handle('board:open', () => loadBoard(db))
  ipcMain.handle('board:saveCards', (_e, patches: unknown) => {
    assert(Array.isArray(patches) && patches.every((p) => typeof p?.id === 'string'))
    saveCards(db, patches as CardPatch[])
  })
  ipcMain.handle('board:createNote', (_e, at: unknown) => {
    assert(isPoint(at))
    return insertCard(db, { boardId: getOrCreateDefaultBoard(db).id, type: 'catatan', x: at.x, y: at.y, content: '' })
  })
  ipcMain.handle('board:deleteCards', (_e, ids: unknown) => {
    assert(isStringArray(ids))
    deleteCards(db, ids)
  })
  ipcMain.handle('board:link', (_e, fromId: unknown, toId: unknown) => {
    assert(typeof fromId === 'string' && typeof toId === 'string')
    return createLink(db, fromId, toId)
  })
  ipcMain.handle('board:unlink', (_e, id: unknown) => {
    assert(typeof id === 'string')
    deleteLink(db, id)
  })
  ipcMain.handle('board:saveViewport', (_e, v: unknown) => {
    assert(isPoint(v) && Number.isFinite((v as Viewport).zoom))
    saveViewport(db, v as Viewport)
  })

  ipcMain.handle('ingest:importPaths', (_e, paths: unknown, at: unknown) => {
    assert(isStringArray(paths) && isPoint(at))
    return deps.ingest.importPaths(paths, at)
  })
  ipcMain.handle('ingest:pasteText', (_e, text: unknown, at: unknown) => {
    assert(typeof text === 'string' && text.length <= 1_000_000 && isPoint(at))
    return deps.ingest.pasteText(text, at)
  })
  ipcMain.handle('ingest:retry', (_e, assetId: unknown) => {
    assert(typeof assetId === 'string')
    return deps.ingest.retry(assetId)
  })

  ipcMain.handle('search:query', (_e, q: unknown) => {
    assert(typeof q === 'string')
    return searchAssets(db, q)
  })

  ipcMain.handle('layout:load', () => getSetting(db, 'layout.dockview'))
  ipcMain.handle('layout:save', (_e, json: unknown) => {
    if (typeof json !== 'string') throw new Error('Layout tidak valid')
    setSetting(db, 'layout.dockview', json)
  })
}
