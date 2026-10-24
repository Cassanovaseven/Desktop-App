import p5 from 'p5'
import type { RenderJob } from '../preload/render'

interface RenderBridge {
  onJob(cb: (job: RenderJob) => void): void
  frame(index: number, png: ArrayBuffer): Promise<void>
  done(): void
  fail(message: string): void
}
type Sketch = { setup?: () => unknown; draw?: () => unknown; preload?: () => unknown }

const bridge = (window as unknown as { alfonsoRender: RenderBridge }).alfonsoRender
const w = window as unknown as Record<string, unknown>
let failed = false
const fail = (msg: unknown): void => {
  if (failed) return
  failed = true
  bridge.fail(msg instanceof Error ? msg.message : String(msg))
}
window.addEventListener('error', (e) => fail(e.error ?? e.message))
window.addEventListener('unhandledrejection', (e) => fail(e.reason))

function canvasPng(): Promise<ArrayBuffer> {
  const c = document.querySelector('canvas')
  if (!c) return Promise.reject(new Error('Sketsa tidak membuat kanvas (panggil createCanvas di setup).'))
  if (c.width > 4096 || c.height > 4096) return Promise.reject(new Error('Kanvas terlalu besar (maks. 4096 px).'))
  return new Promise((resolve, reject) =>
    c.toBlob((b) => (b ? b.arrayBuffer().then(resolve, reject) : reject(new Error('Kanvas tidak bisa diambil.'))), 'image/png'))
}

bridge.onJob((job) => {
  try {
    // Sketsa ditulis dalam mode global p5 (function setup / draw). LEBAR, TINGGI, SEED tersedia sebagai variabel.
    const sketch = new Function('LEBAR', 'TINGGI', 'SEED', `${job.code}
;return { setup: typeof setup === 'function' ? setup : undefined, draw: typeof draw === 'function' ? draw : undefined, preload: typeof preload === 'function' ? preload : undefined }`)(job.width, job.height, job.seed) as Sketch
    Object.assign(w, { LEBAR: job.width, TINGGI: job.height, SEED: job.seed })
    let allowDraw = false
    let ready: () => void
    const setupDone = new Promise<void>((r) => (ready = r))
    const api = (): Record<string, (...a: unknown[]) => void> => w as never
    if (sketch.preload) w.preload = sketch.preload
    w.setup = async () => {
      api().randomSeed(job.seed)
      api().noiseSeed(job.seed)
      if (sketch.setup) await sketch.setup()
      else api().createCanvas(job.width, job.height)
      api().noLoop()
      ready()
    }
    // draw hanya berjalan saat Alfonso mengambil frame, supaya urutan frame selalu sama.
    w.draw = () => { if (allowDraw && sketch.draw) sketch.draw() }
    ;(p5 as unknown as { disableFriendlyErrors: boolean }).disableFriendlyErrors = true
    new (p5 as unknown as new () => unknown)()
    void (async () => {
      await setupDone
      for (let i = 0; i < job.frames && !failed; i++) {
        if (sketch.draw) {
          allowDraw = true
          api().redraw()
          allowDraw = false
        }
        await bridge.frame(i, await canvasPng())
      }
      if (!failed) bridge.done()
    })().catch(fail)
  } catch (e) {
    fail(e)
  }
})
