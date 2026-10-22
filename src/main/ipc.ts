import { ipcMain, shell, type BrowserWindow } from 'electron'
import type Database from 'better-sqlite3'
import type { ThemeTokens, VaultPaths } from '../shared/types'
import { getSetting, setSetting } from './db/database'
import { resolveActiveThemeId } from './theme'
import type { SidecarManager } from './sidecar'

export interface IpcDeps {
  getWindow: () => BrowserWindow | null
  vault: VaultPaths
  db: Database.Database
  themes: ThemeTokens[]
  sidecar: SidecarManager
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

  ipcMain.handle('layout:load', () => getSetting(db, 'layout.dockview'))
  ipcMain.handle('layout:save', (_e, json: unknown) => {
    if (typeof json !== 'string') throw new Error('Layout tidak valid')
    setSetting(db, 'layout.dockview', json)
  })
}
