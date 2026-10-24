import crypto from 'crypto'
import { app, BrowserWindow, dialog, safeStorage } from 'electron'
import fs from 'fs'
import { join } from 'path'
import type Database from 'better-sqlite3'
import { secureWindowOptions } from './window'
import { resolveVaultPath } from './vault'
import { createLogger } from './logger'
import { openDatabase } from './db/database'
import { alignFtsRowids } from './search'
import { autoTagsFor, ensureAutoTags, refreshFts } from './library/tags'
import { loadThemes } from './theme'
import { SidecarManager, findPython } from './sidecar'
import { registerIpc } from './ipc'
import { registerVaultScheme, handleVaultScheme } from './vault-protocol'
import { createIngestService, type IngestService } from './ingest/service'
import { createSidecarExtractor, createSidecarModelClient, createSidecarTranscriber } from './sidecar-client'
import { createTranscriptModel } from './transcript-model'
import { createFolderWatcher, type FolderWatcher } from './ingest/watcher'
import { downloadUrl } from './ingest/url'
import { DEFAULT_SIZE, getActiveBoard, insertAsset, insertCard } from './board/repo'
import { createKeyStore, type KeyStore } from './studio/keys'
import { createRemoteAdapters } from './studio/adapters/remote'
import { createCodeAdapter } from './studio/adapters/code'
import { createP5Renderer } from './studio/render-window'
import { createStudioRunner, type StudioRunner } from './studio/runner'
import { comfyUrl, registerStudioIpc } from './studio/ipc'

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
let watcher: FolderWatcher | null = null
let studio: StudioRunner | null = null
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
  let keys: KeyStore | null = null
  // Token sidecar dan kunci Higgsfield tidak pernah masuk log.
  const secrets = (): string[] => [...(manager ? [manager.token] : []), ...(keys ? keys.secrets() : [])]
  const log = createLogger(vault.logs, secrets)
  log.info('Alfonso mulai')
  db = openDatabase(vault.db)
  // Penyesuaian data Fase 1 → 2 (tanpa ubah skema): rowid indeks pencarian dan tag jenis/jalur yang belum ada.
  const ftsMoved = alignFtsRowids(db)
  const tagged = ensureAutoTags(db)
  if (ftsMoved || tagged) log.info(`Library disiapkan: ${ftsMoved} indeks diselaraskan, ${tagged} aset diberi tag otomatis`)
  const themes = loadThemes(vault.mods, log)
  manager = new SidecarManager({
    command: findPython(appRoot),
    args: ['-m', 'alfonso_sidecar'],
    cwd: join(appRoot, 'sidecar'),
    // Model Whisper di folder data aplikasi, bukan di vault (dibuat sidecar saat unduhan pertama).
    env: {
      ALFONSO_VAULT_ROOT: vault.root,
      ALFONSO_MODELS_DIR: join(app.getPath('userData'), 'models'),
      // Server Higgsfield tiruan hanya untuk tes e2e.
      ...(process.env.ALFONSO_E2E === '1' && process.env.ALFONSO_HIGGSFIELD_URL ? { ALFONSO_HIGGSFIELD_URL: process.env.ALFONSO_HIGGSFIELD_URL } : {})
    },
    log
  })
  sidecar = manager
  handleVaultScheme(vault.root)

  const appDb = db
  let modelName = (): string => 'small'
  const service = createIngestService({
    db,
    vault,
    log,
    extract: createSidecarExtractor(manager),
    transcribe: createSidecarTranscriber(manager, () => modelName()),
    // Alamat lokal hanya diizinkan di mode tes e2e (server tes berjalan di 127.0.0.1).
    download: (url, dir) => downloadUrl(url, { dir, allowPrivate: process.env.ALFONSO_E2E === '1' }),
    notify: (e) => win?.webContents.send('ingest:event', e),
    secrets
  })
  ingest = service

  // ---- Studio AI (Fase 3) ----
  // Uji e2e di Linux tanpa keyring saja; di Windows safeStorage selalu memakai DPAPI dan baris ini tidak berlaku.
  if (process.env.ALFONSO_E2E === '1' && process.platform === 'linux') safeStorage.setUsePlainTextEncryption(true)
  const keyStore = createKeyStore(db, safeStorage)
  keys = keyStore
  const remote = createRemoteAdapters({ sidecar: manager, db, readKey: () => keyStore.read(), comfyUrl: () => comfyUrl(appDb) })
  const p5 = createP5Renderer({
    preloadPath: join(__dirname, '../preload/render.js'),
    page: process.env['ELECTRON_RENDERER_URL'] ? { url: process.env['ELECTRON_RENDERER_URL'] } : { file: join(__dirname, '../renderer/render.html') }
  })
  const runner = createStudioRunner({
    db,
    vault,
    log,
    kode: createCodeAdapter({ renderer: p5, encodeVideo: remote.encodeVideo }),
    cloud: remote.cloud,
    lokal: remote.lokal,
    notify: (e) => win?.webContents.send('studio:event', e),
    notifyBoard: (e) => win?.webContents.send('ingest:event', e),
    onKeyRejected: () => keyStore.markRejected(),
    afterSave: () => service.queue.kick(),
    secrets
  })
  studio = runner
  const transcriptModel = createTranscriptModel({
    db: appDb,
    client: createSidecarModelClient(manager),
    confirm: async (model, sizeMb) => {
      const opts = {
        type: 'question' as const,
        title: 'Alfonso',
        message: `Unduh model transkrip "${model}" (sekitar ${sizeMb} MB) dari Hugging Face?`,
        detail: 'Model disimpan di folder data aplikasi dan hanya diunduh sekali. Transkrip berjalan di komputer ini.',
        buttons: ['Unduh', 'Batal'],
        defaultId: 0,
        cancelId: 1
      }
      const r = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts)
      return r.response === 0
    },
    onReady: () => service.requeueTranscripts()
  })
  modelName = transcriptModel.modelName

  const folderWatcher = createFolderWatcher({
    db: appDb,
    vaultRoot: vault.root,
    log,
    importPaths: (paths, at) => service.importPaths(paths, at, { skipKnown: true, tags: ['sumber:folder'] })
  })
  watcher = folderWatcher
  // Antrean baru berjalan setelah sidecar siap; job yang masuk sebelumnya menunggu dengan status 'antre'.
  manager.onStatus((s) => {
    if (s.state === 'ready') {
      service.queue.start()
      service.transcribeQueue.start()
      runner.start()
    }
  })

  registerIpc({ getWindow: () => win, vault, db, themes, sidecar: manager, ingest: service, transcriptModel, watcher: folderWatcher })
  registerStudioIpc({ getWindow: () => win, db, vault, keys: keyStore, runner, comfyRunning: remote.comfyRunning, kickExtract: () => service.queue.kick() })

  // Kait khusus tes e2e, hanya ada di proses utama dan hanya bila ALFONSO_E2E=1 (tidak terjangkau renderer).
  if (process.env.ALFONSO_E2E === '1') {
    const testDb = db
    ;(globalThis as Record<string, unknown>).__alfonsoTest = {
      importPaths: (paths: string[], at: { x: number; y: number }) => service.importPaths(paths, at),
      watchFolder: (dir: string) => folderWatcher.add(dir),
      // Aset palsu (tanpa file) untuk uji performa Library.
      fillLibrary: (count: number) => {
        testDb.transaction(() => {
          for (let i = 0; i < count; i++) {
            const name = i % 3 === 0 ? `gambar-${i}.png` : `dokumen-${i}.pdf`
            const sha = crypto.createHash('sha256').update(`palsu-${i}`).digest('hex')
            const a = insertAsset(testDb, { sha256: sha, vaultPath: `files/${sha.slice(0, 2)}/${sha}.bin`, originalName: name, mime: null, sizeBytes: i })
            testDb.prepare("UPDATE assets SET extract_status = 'siap' WHERE id = ?").run(a.id)
            for (const tag of autoTagsFor(name)) testDb.prepare('INSERT OR IGNORE INTO asset_tags (asset_id, tag) VALUES (?, ?)').run(a.id, tag)
            refreshFts(testDb, a.id)
          }
        })()
      },
      fillBoard: (count: number) => {
        const board = getActiveBoard(testDb)
        testDb.transaction(() => {
          for (let i = 0; i < count; i++) {
            insertCard(testDb, { boardId: board.id, type: 'catatan', x: (i % 100) * 260, y: Math.floor(i / 100) * 180, content: `Kartu ${i}`, ...DEFAULT_SIZE.catatan })
          }
        })()
      }
    }
  }
  win = createWindow()
  // Jendela tidak menunggu sidecar siap; job dari folder dipantau menunggu di antrean.
  void manager.start()
  void folderWatcher.start()
}

app.whenReady().then(bootstrap)

app.on('window-all-closed', () => app.quit())

app.on('before-quit', (e) => {
  if (quitting) return
  quitting = true
  e.preventDefault()
  void (async () => {
    try {
      await watcher?.close()
      await Promise.all([ingest?.queue.stop(), ingest?.transcribeQueue.stop(), studio?.stop()])
      await sidecar?.stop()
      db?.close()
    } finally {
      app.exit(0)
    }
  })()
})
