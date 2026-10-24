import fs from 'fs'
import os from 'os'
import path from 'path'
import { PermanentError } from '../../ingest/service'
import type { GenerationDTO, PromptParams } from '../../../shared/studio-types'

/** Hasil adapter: file sementara di `tempDir` (folder alfonso-gen-*), dihapus runner setelah disalin ke vault. */
export interface AdapterResult { file: string; ext: string; tempDir: string }

export interface RenderImageRequest { code: string; seed: number; width: number; height: number }
export interface RenderFramesRequest extends RenderImageRequest { fps: number; frames: number }

/** Menjalankan sketsa p5 di jendela tersembunyi yang terkunci (lihat render-window.ts). */
export interface P5Renderer {
  renderImage(req: RenderImageRequest): Promise<Buffer>
  renderFrames(req: RenderFramesRequest, onFrame: (index: number, png: Buffer) => Promise<void>): Promise<void>
}

export const MAX_SVG = 5 * 1024 * 1024
export const MAX_SECONDS = 20
export const FPS = [12, 24, 25, 30, 60]

const svgError = (why: string): PermanentError => new PermanentError(`SVG ditolak: ${why}.`)

/**
 * Pemeriksaan SVG tanpa pustaka: harus satu elemen <svg> dan tidak boleh berisi skrip, event handler,
 * atau rujukan ke file/alamat luar (hanya `#id` dan `data:image/…`).
 */
export function validateSvg(text: string): string {
  if (text.length > MAX_SVG) throw svgError('lebih dari 5 MB')
  const body = text.replace(/^﻿/, '').replace(/^\s*(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*)*/, '')
  const closed = /<\/svg>\s*$/i.test(body) || /^<svg\b[^>]*\/>\s*$/i.test(body)
  if (!/^<svg[\s>/]/i.test(body) || !closed) throw svgError('harus diawali <svg> dan diakhiri </svg>')
  if (/<\s*(script|foreignObject|iframe|embed|object)\b/i.test(text)) throw svgError('berisi skrip atau elemen tertanam')
  if (/[\s/"']on[a-z]+\s*=/i.test(text)) throw svgError('berisi event handler (on…=)')
  if (/javascript\s*:/i.test(text)) throw svgError('berisi javascript:')
  if (/@import/i.test(text)) throw svgError('berisi @import')
  for (const m of text.matchAll(/(?:href\s*=\s*["']([^"']*)["'])|(?:url\(\s*["']?([^"')]*)["']?\s*\))/gi)) {
    const ref = (m[1] ?? m[2] ?? '').trim()
    if (ref && !ref.startsWith('#') && !/^data:image\//i.test(ref)) throw svgError(`merujuk ke luar (${ref.slice(0, 60)})`)
  }
  return text
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, Math.round(n)))

export function renderSize(params: PromptParams): { width: number; height: number } {
  const lebar = Number(params.lebar)
  const tinggi = Number(params.tinggi)
  const m = typeof params.rasio === 'string' ? /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(params.rasio) : null
  let w = Number.isFinite(lebar) && lebar > 0 ? lebar : 1024
  let h = Number.isFinite(tinggi) && tinggi > 0 ? tinggi : NaN
  if (Number.isNaN(h)) h = m ? (w * Number(m[2])) / Number(m[1]) : w
  if (!(Number.isFinite(lebar) && lebar > 0) && m && Number.isFinite(tinggi) && tinggi > 0) w = (h * Number(m[1])) / Number(m[2])
  return { width: clamp(w, 16, 4096), height: clamp(h, 16, 4096) }
}

const mkTemp = (prefix: 'alfonso-gen-' | 'alfonso-frames-'): Promise<string> => fs.promises.mkdtemp(path.join(os.tmpdir(), prefix))

export interface CodeAdapterDeps {
  renderer: P5Renderer
  /** Merakit folder frame PNG menjadi MP4 (sidecar /encode/video). */
  encodeVideo: (framesDir: string, fps: number) => Promise<{ path: string; tempDir: string }>
}

/** Jalur kode (spec 6 "Render kode"): SVG langsung, p5 → PNG, p5 beranimasi → MP4. Tanpa GPU dan tanpa internet. */
export function createCodeAdapter(deps: CodeAdapterDeps) {
  return {
    async run(g: GenerationDTO): Promise<AdapterResult> {
      const code = g.promptText ?? ''
      const seed = typeof g.params.seed === 'number' ? g.params.seed : 1
      if (g.model === 'svg') {
        const svg = validateSvg(code)
        const dir = await mkTemp('alfonso-gen-')
        const file = path.join(dir, 'hasil.svg')
        await fs.promises.writeFile(file, svg, 'utf8')
        return { file, ext: 'svg', tempDir: dir }
      }
      const size = renderSize(g.params)
      if (g.model === 'p5-gambar') {
        const png = await deps.renderer.renderImage({ code, seed, ...size })
        const dir = await mkTemp('alfonso-gen-')
        const file = path.join(dir, 'hasil.png')
        await fs.promises.writeFile(file, png)
        return { file, ext: 'png', tempDir: dir }
      }
      if (g.model === 'p5-motion') {
        const fps = Number(g.params.fps ?? 30)
        const seconds = Number(g.params.durasi ?? 4)
        if (!FPS.includes(fps)) throw new PermanentError(`fps harus salah satu dari ${FPS.join(', ')}.`)
        if (!(seconds > 0 && seconds <= MAX_SECONDS)) throw new PermanentError(`Durasi harus lebih dari 0 dan paling lama ${MAX_SECONDS} detik.`)
        const frames = Math.max(1, Math.round(seconds * fps))
        const dir = await mkTemp('alfonso-frames-')
        try {
          await deps.renderer.renderFrames({ code, seed, ...size, fps, frames }, (i, png) =>
            fs.promises.writeFile(path.join(dir, `${String(i).padStart(5, '0')}.png`), png))
          const out = await deps.encodeVideo(dir, fps)
          return { file: out.path, ext: 'mp4', tempDir: out.tempDir }
        } finally {
          await fs.promises.rm(dir, { recursive: true, force: true })
        }
      }
      throw new PermanentError(`Model jalur kode tidak dikenal: ${g.model}`)
    }
  }
}
