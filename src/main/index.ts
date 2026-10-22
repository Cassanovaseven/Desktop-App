import { app, BrowserWindow, dialog } from 'electron'
import fs from 'fs'
import { join } from 'path'
import type Database from 'better-sqlite3'
import { secureWindowOptions } from './window'
import { resolveVaultPath } from './vault'
import { createLogger } from './logger'
import { openDatabase } from './db/database'
import { loadThemes } from './theme'
import { SidecarManager, findPython } from './sidecar'
import { registerIpc } from './ipc'

// Harus sebelum `ready`; foldernya dibuat dulu.
if (process.env.ALFONSO_USER_DATA) {
  fs.mkdirSync(process.env.ALFONSO_USER_DATA, { recursive: true })
  app.setPath('userData', process.env.ALFONSO_USER_DATA)
}

// out/main → root aplikasi
const appRoot = join(__dirname, '../..')
let win: BrowserWindow | null = null
let db: Database.Database | null = null
let sidecar: SidecarManager | null = null
let quitting = false

function createWindow(): BrowserWindow {
  const w = new BrowserWindow(secureWindowOptions(join(__dirname, '../preload/index.js')))
  w.once('ready-to-show', () => w.show())
  w.on('closed', () => {
    if (win === w) win = null
  })
  if (process.env['ELECTRON_RENDERER_URL']) {
    w.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    w.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return w
}

async function bootstrap(): Promise<void> {
  const vault = await resolveVaultPath({
    env: process.env,
    userDataDir: app.getPath('userData'),
    ask: async () => {
      const r = await dialog.showOpenDialog({ title: 'Pilih folder vault Alfonso', properties: ['openDirectory'] })
      return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0]
    },
    notify: async (message) => {
      await dialog.showMessageBox({ type: 'warning', title: 'Alfonso', message })
    }
  })
  if (!vault) {
    await dialog.showMessageBox({ type: 'info', title: 'Alfonso', message: 'Alfonso butuh folder vault untuk berjalan.' })
    app.quit()
    return
  }

  let manager: SidecarManager | null = null
  const log = createLogger(vault.logs, () => (manager ? [manager.token] : []))
  log.info('Alfonso mulai')
  db = openDatabase(vault.db)
  const themes = loadThemes(vault.mods, log)
  manager = new SidecarManager({
    command: findPython(appRoot),
    args: ['-m', 'alfonso_sidecar'],
    cwd: join(appRoot, 'sidecar'),
    log
  })
  sidecar = manager

  registerIpc({ getWindow: () => win, vault, db, themes, sidecar: manager })
  win = createWindow()
  // Jendela tidak menunggu sidecar siap.
  void manager.start()
}

app.whenReady().then(bootstrap)

app.on('window-all-closed', () => app.quit())

app.on('before-quit', (e) => {
  if (quitting) return
  quitting = true
  e.preventDefault()
  void (async () => {
    try {
      await sidecar?.stop()
      db?.close()
    } finally {
      app.exit(0)
    }
  })()
})
