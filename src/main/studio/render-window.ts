import { BrowserWindow, ipcMain, session, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { pathToFileURL } from 'url'
import { PermanentError } from '../ingest/service'
import type { P5Renderer, RenderFramesRequest } from './adapters/code'

export const RENDER_PARTITION = 'alfonso-render'
export const IMAGE_TIMEOUT_MS = 30_000
export const MOTION_TIMEOUT_MS = 120_000

export interface RenderWindowOptions {
  preloadPath: string
  /** Path file render.html (produksi) atau URL server dev. */
  page: { file: string } | { url: string }
}

/** Satu-satunya asal yang boleh dimuat jendela render: folder renderer Alfonso (atau server dev). Semua jaringan lain diblokir. */
function allowedPrefix(page: RenderWindowOptions['page']): string {
  if ('url' in page) return new URL(page.url).origin + '/'
  return pathToFileURL(page.file).href.replace(/[^/]*$/, '')
}

let sessionReady = false
function lockSession(prefix: string): void {
  if (sessionReady) return
  sessionReady = true
  const s = session.fromPartition(RENDER_PARTITION)
  s.webRequest.onBeforeRequest((details, cb) => {
    const ok = details.url.startsWith(prefix) || details.url.startsWith('devtools:') || details.url.startsWith('data:') || details.url.startsWith('blob:')
    cb({ cancel: !ok })
  })
  s.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))
  s.setPermissionCheckHandler(() => false)
}

/**
 * Menjalankan sketsa p5 pengguna di BrowserWindow tersembunyi: sandbox, context isolation, tanpa Node,
 * CSP ketat (render.html), jaringan diblokir di level sesi, navigasi dan jendela baru ditolak.
 */
export function createP5Renderer(o: RenderWindowOptions): P5Renderer {
  const prefix = allowedPrefix(o.page)

  async function run(req: RenderFramesRequest, timeoutMs: number, onFrame: (i: number, png: Buffer) => Promise<void>): Promise<void> {
    lockSession(prefix)
    const win = new BrowserWindow({
      show: false,
      width: Math.min(req.width, 4096),
      height: Math.min(req.height, 4096),
      useContentSize: true,
      paintWhenInitiallyHidden: true,
      webPreferences: {
        preload: o.preloadPath,
        partition: RENDER_PARTITION,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        backgroundThrottling: false,
        spellcheck: false,
        devTools: false
      }
    })
    const wc = win.webContents
    wc.on('will-navigate', (e) => e.preventDefault())
    wc.setWindowOpenHandler(() => ({ action: 'deny' }))
    const id = wc.id
    let timer: NodeJS.Timeout | undefined
    const cleanup: (() => void)[] = []
    try {
      await new Promise<void>((resolve, reject) => {
        timer = setTimeout(() => reject(new PermanentError(`Sketsa terlalu lama (lebih dari ${Math.round(timeoutMs / 1000)} detik).`)), timeoutMs)
        let chain = Promise.resolve()
        const onFrameIpc = (e: IpcMainInvokeEvent, i: unknown, png: unknown): Promise<void> => {
          if (e.sender.id !== id) return Promise.reject(new Error('bukan jendela render'))
          if (!Number.isInteger(i) || (i as number) < 0 || (i as number) >= req.frames || !(png instanceof ArrayBuffer || png instanceof Uint8Array)) {
            return Promise.reject(new Error('frame tidak valid'))
          }
          const buf = Buffer.from(png instanceof Uint8Array ? png : new Uint8Array(png))
          chain = chain.then(() => onFrame(i as number, buf))
          return chain.catch((err) => { reject(err); throw err })
        }
        const onDone = (e: IpcMainEvent): void => { if (e.sender.id === id) chain.then(resolve, reject) }
        const onFail = (e: IpcMainEvent, msg: unknown): void => {
          if (e.sender.id === id) reject(new PermanentError(`Sketsa error: ${String(msg)}`))
        }
        // Satu jendela render per waktu memakai saluran ini (runner menjalankan job jalur kode satu per satu).
        ipcMain.removeHandler('render:frame')
        ipcMain.handle('render:frame', onFrameIpc)
        ipcMain.on('render:done', onDone)
        ipcMain.on('render:fail', onFail)
        cleanup.push(() => ipcMain.removeHandler('render:frame'), () => ipcMain.off('render:done', onDone), () => ipcMain.off('render:fail', onFail))
        wc.on('render-process-gone', () => reject(new PermanentError('Jendela render berhenti mendadak.')))
        wc.once('did-finish-load', () => wc.send('render:job', { code: req.code, seed: req.seed, width: req.width, height: req.height, frames: req.frames }))
        wc.once('did-fail-load', (_e, _code, desc) => reject(new Error(`Halaman render gagal dimuat: ${desc}`)))
        const load = 'url' in o.page ? win.loadURL(new URL('/render.html', o.page.url).href) : win.loadFile(o.page.file)
        load.catch(reject)
      })
    } finally {
      clearTimeout(timer)
      for (const c of cleanup) c()
      if (!win.isDestroyed()) win.destroy()
    }
  }

  return {
    async renderImage(req) {
      let out: Buffer | null = null
      await run({ ...req, fps: 1, frames: 1 }, IMAGE_TIMEOUT_MS, async (_i, png) => { out = png })
      if (!out) throw new PermanentError('Sketsa tidak menghasilkan gambar.')
      return out
    },
    renderFrames: (req, onFrame) => run(req, MOTION_TIMEOUT_MS, onFrame)
  }
}
