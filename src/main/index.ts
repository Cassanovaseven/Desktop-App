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
import { registerVaultScheme, handleVaultScheme } from './vault-protocol'
import { createIngestService, type IngestService } from './ingest/service'
import { createSidecarExtractor } from './sidecar-client'
import { DEFAULT_SIZE, getOrCreateDefaultBoard, insertCard } from './board/repo'

// Harus sebelum `ready`; foldernya dibuat dulu.
if (process.env.ALFONSO_USER_DATA) {
  fs.mkdirSync(process.env.ALFONSO_USER_DATA, { recursive: true })
  app.setPath('userData', process.env.ALFONSO_USER_DATA)
}

// Skema vault harus didaftarkan sebelum `ready`.
registerVaultScheme()

// out/main → root aplikasi
const appRoot = join(__dirname, '../..')
let win: BrowserWindow | null = null
let db: Database.Database | null = null
let sidecar: SidecarManager | null = null
let ingest: IngestService | null = null
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
    env: { ALFONSO_VAULT_ROOT: vault.root },
    log
  })
  sidecar = manager
  handleVaultScheme(vault.root)

  const service = createIngestService({
    db,
    vault,
    log,
    extract: createSidecarExtractor(manager),
    notify: (e) => win?.webContents.send('ingest:event', e),
    secrets: () => [manager.token]
  })
  ingest = service
  // Antrean baru berjalan setelah sidecar siap; job yang masuk sebelumnya menunggu dengan status 'antre'.
  manager.onStatus((s) => {
    if (s.state === 'ready') service.queue.start()
  })

  registerIpc({ getWindow: () => win, vault, db, themes, sidecar: manager, ingest: service })

  // Kait khusus tes e2e, hanya ada di proses utama dan hanya bila ALFONSO_E2E=1 (tidak terjangkau renderer).
  if (process.env.ALFONSO_E2E === '1') {
    const testDb = db
    ;(globalThis as Record<string, unknown>).__alfonsoTest = {
      importPaths: (paths: string[], at: { x: number; y: number }) => service.importPaths(paths, at),
      fillBoard: (count: number) => {
        const board = getOrCreateDefaultBoard(testDb)
        testDb.transaction(() => {
          for (let i = 0; i < count; i++) {
            insertCard(testDb, { boardId: board.id, type: 'catatan', x: (i % 100) * 260, y: Math.floor(i / 100) * 180, content: `Kartu ${i}`, ...DEFAULT_SIZE.catatan })
          }
        })()
      }
    }
  }
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
      await ingest?.queue.stop()
      await sidecar?.stop()
      db?.close()
    } finally {
      app.exit(0)
    }
  })()
})
