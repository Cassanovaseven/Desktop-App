import type { Lane, PromptParams } from '../../shared/studio-types'

/** "nama=nilai" per baris ↔ objek parameter. Angka dan true/false dikenali; sisanya teks. */
export function paramsToText(p: PromptParams): string {
  return Object.entries(p).map(([k, v]) => `${k}=${v}`).join('\n')
}

export function textToParams(text: string): PromptParams {
  const out: PromptParams = {}
  for (const [i, raw] of text.split('\n').entries()) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) throw new Error(`Parameter baris ${i + 1} harus berbentuk nama=nilai.`)
    const k = line.slice(0, eq).trim()
    const v = line.slice(eq + 1).trim()
    if (!/^[A-Za-z_][\w-]{0,39}$/.test(k)) throw new Error(`Nama parameter tidak valid: ${k}`)
    out[k] = v === 'true' ? true : v === 'false' ? false : v !== '' && Number.isFinite(Number(v)) && !/^0\d/.test(v) && !v.includes(':') ? Number(v) : v
  }
  return out
}

export const PARAM_HINT: Record<Lane, string> = {
  kode: 'Contoh: jumlah=1, seed=7, lebar=1024, tinggi=1024 (p5 motion: durasi=4, fps=30)',
  cloud: 'Contoh: jumlah=4, rasio=1:1, resolusi=2K, seed=7, kunci_referensi=image_url',
  lokal: 'Contoh: jumlah=1, seed=7, lebar=1024, tinggi=1024, negatif=buram'
}

export const LANE_LABEL: Record<Lane, string> = { kode: 'Kode (SVG / p5)', cloud: 'Cloud (Higgsfield)', lokal: 'Lokal (ComfyUI)' }
export const CODE_MODEL_LABEL: Record<string, string> = { svg: 'SVG', 'p5-gambar': 'p5.js → gambar', 'p5-motion': 'p5.js → video' }
export const STATUS_LABEL: Record<string, string> = { antre: 'Antre', berjalan: 'Berjalan…', selesai: 'Selesai', gagal: 'Gagal' }
export const COMFY_OFF = 'ComfyUI tidak berjalan'
