import { dialog, ipcMain, shell, type BrowserWindow, type MessageBoxOptions } from 'electron'
import fs from 'fs'
import path from 'path'
import type Database from 'better-sqlite3'
import type { ThemeTokens, VaultPaths } from '../shared/types'
import { getSetting, setSetting } from './db/database'
import { resolveActiveThemeId } from './theme'
import type { SidecarManager } from './sidecar'
import type { IngestService } from './ingest/service'
import type { CardPatch, Point, Viewport } from '../shared/board-types'
import { createLink, deleteCards, deleteLink, getActiveBoard, insertCard, loadBoard, saveCards, saveViewport } from './board/repo'
import { searchAssets } from './search'
import { createBoard, createProject, listProjects, renameBoard, renameProject, setActiveBoard } from './projects/repo'
import { listAssets, parseLibraryQuery } from './library/query'
import { addTag, listTags, removeTag } from './library/tags'
import { assetFilePath, getAssetDetail } from './library/detail'
import { addAssetCard } from './library/add-card'
import type { TranscriptModel } from './transcript-model'
import type { FolderWatcher } from './ingest/watcher'

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
  transcriptModel: TranscriptModel
  watcher: FolderWatcher
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

  ipcMain.handle('projects:list', () => listProjects(db))
  ipcMain.handle('projects:create', (_e, name: unknown) => {
    assert(typeof name === 'string')
    return createProject(db, name)
  })
  ipcMain.handle('projects:rename', (_e, id: unknown, name: unknown) => {
    assert(typeof id === 'string' && typeof name === 'string')
    renameProject(db, id, name)
  })
  ipcMain.handle('projects:createBoard', (_e, projectId: unknown, name: unknown) => {
    assert(typeof projectId === 'string' && typeof name === 'string')
    return createBoard(db, projectId, name)
  })
  ipcMain.handle('projects:renameBoard', (_e, id: unknown, name: unknown) => {
    assert(typeof id === 'string' && typeof name === 'string')
    renameBoard(db, id, name)
  })
  ipcMain.handle('projects:getActiveBoardId', () => getActiveBoard(db).id)
  ipcMain.handle('projects:setActiveBoard', (_e, id: unknown) => {
    assert(typeof id === 'string')
    setActiveBoard(db, id)
  })

  ipcMain.handle('library:query', (_e, q: unknown) => listAssets(db, parseLibraryQuery(q)))
  ipcMain.handle('library:tags', () => listTags(db))
  ipcMain.handle('library:detail', (_e, id: unknown) => {
    assert(typeof id === 'string')
    return getAssetDetail(db, id)
  })
  ipcMain.handle('library:addTag', (_e, id: unknown, tag: unknown) => {
    assert(typeof id === 'string' && typeof tag === 'string')
    return addTag(db, id, tag)
  })
  ipcMain.handle('library:removeTag', (_e, id: unknown, tag: unknown) => {
    assert(typeof id === 'string' && typeof tag === 'string')
    removeTag(db, id, tag)
  })
  // Hanya menyorot file di Explorer; file vault tidak dibuka dengan aplikasi lain (bisa mengubah isinya).
  ipcMain.handle('library:showInFolder', (_e, id: unknown) => {
    assert(typeof id === 'string')
    shell.showItemInFolder(assetFilePath(db, vault, id))
  })

  ipcMain.handle('board:open', (_e, boardId: unknown) => {
    assert(boardId === undefined || typeof boardId === 'string')
    return loadBoard(db, boardId)
  })
  ipcMain.handle('board:addAssetCard', (_e, assetId: unknown, at: unknown) => {
    assert(typeof assetId === 'string' && isPoint(at))
    return addAssetCard(db, assetId, at)
  })
  ipcMain.handle('board:saveCards', (_e, patches: unknown) => {
    assert(Array.isArray(patches) && patches.every((p) => typeof p?.id === 'string'))
    saveCards(db, patches as CardPatch[])
  })
  ipcMain.handle('board:createNote', (_e, at: unknown) => {
    assert(isPoint(at))
    return insertCard(db, { boardId: getActiveBoard(db).id, type: 'catatan', x: at.x, y: at.y, content: '' })
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
  ipcMain.handle('board:saveViewport', (_e, v: unknown, boardId: unknown) => {
    assert(isPoint(v) && Number.isFinite((v as Viewport).zoom) && (boardId === undefined || typeof boardId === 'string'))
    saveViewport(db, v as Viewport, boardId)
  })

  const ask = async (opts: MessageBoxOptions): Promise<number> => {
    const w = deps.getWindow()
    return (w ? await dialog.showMessageBox(w, opts) : await dialog.showMessageBox(opts)).response
  }

  ipcMain.handle('ingest:importPaths', async (_e, paths: unknown, at: unknown) => {
    assert(isStringArray(paths) && isPoint(at))
    const files: string[] = []
    for (const p of paths) {
      const st = await fs.promises.stat(p).catch(() => null)
      if (!st?.isDirectory()) {
        files.push(p)
        continue
      }
      // Folder yang di-drop ditawarkan untuk dipantau, bukan diimpor sekaligus.
      const yes = (await ask({ type: 'question', title: 'Alfonso', message: `Pantau folder "${path.basename(p)}"?`, detail: 'File di folder ini dan file baru yang masuk akan disalin ke vault. File aslinya tidak diubah.', buttons: ['Pantau', 'Batal'], defaultId: 0, cancelId: 1 })) === 0
      if (yes) await deps.watcher.add(p)
    }
    return files.length ? deps.ingest.importPaths(files, at) : []
  })

  ipcMain.handle('watch:add', async () => {
    const w = deps.getWindow()
    const opts = { title: 'Pilih folder yang dipantau', properties: ['openDirectory' as const] }
    const r = w ? await dialog.showOpenDialog(w, opts) : await dialog.showOpenDialog(opts)
    if (r.canceled || r.filePaths.length === 0) return { message: 'Batal.' }
    try {
      return { message: `Memantau folder: ${await deps.watcher.add(r.filePaths[0])}` }
    } catch (err) {
      return { message: (err as Error).message }
    }
  })
  ipcMain.handle('watch:remove', async () => {
    const dirs = deps.watcher.list().slice(0, 8)
    if (dirs.length === 0) return { message: 'Tidak ada folder yang dipantau.' }
    const i = await ask({ type: 'question', title: 'Alfonso', message: 'Berhenti memantau folder yang mana?', detail: 'File yang sudah masuk vault tetap ada.', buttons: [...dirs.map((d) => path.basename(d) || d), 'Batal'], cancelId: dirs.length })
    if (i >= dirs.length) return { message: 'Batal.' }
    await deps.watcher.remove(dirs[i])
    return { message: `Berhenti memantau: ${dirs[i]}` }
  })
  ipcMain.handle('ingest:pasteImage', (_e, bytes: unknown, mime: unknown, at: unknown) => {
    // ArrayBuffer dari renderer tiba sebagai ArrayBuffer (structured clone); ukuran dan tipe dicek di layanan.
    assert((bytes instanceof ArrayBuffer || bytes instanceof Uint8Array) && typeof mime === 'string' && isPoint(at))
    return deps.ingest.pasteImage(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), mime, at)
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

  // Dialog konfirmasi ada di proses utama (transcript-model.confirm), bukan di renderer.
  ipcMain.handle('transkrip:downloadModel', () => deps.transcriptModel.download())

  ipcMain.handle('layout:load', () => getSetting(db, 'layout.dockview'))
  ipcMain.handle('layout:save', (_e, json: unknown) => {
    if (typeof json !== 'string') throw new Error('Layout tidak valid')
    setSetting(db, 'layout.dockview', json)
  })
}
