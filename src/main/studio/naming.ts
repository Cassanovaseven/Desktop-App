import fs from 'fs'

/** Huruf kecil ASCII, angka, dan `-`; aman sebagai bagian nama file Windows. */
export function slug(s: string, max = 40): string {
  const out = s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/, '')
  return out || 'tanpa-nama'
}

const pad = (n: number, w = 2): string => String(n).padStart(w, '0')
export const ymd = (d: Date): string => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
export const yearMonth = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`

export interface NameParts { project: string; jenis: string; subject: string; lane: string; date: Date; ext: string }

/** `<proyek>_<jenis>_<subjek>_<jalur>_<YYYYMMDD>_<nnn>.<ext>` (spec 9.2); nomor = terbesar yang ada di `dir` + 1. */
export function generatedFileName(dir: string, p: NameParts): string {
  const prefix = [slug(p.project), slug(p.jenis), slug(p.subject), slug(p.lane), ymd(p.date)].join('_') + '_'
  let max = 0
  for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    if (!f.startsWith(prefix)) continue
    const m = /^(\d{3,})\./.exec(f.slice(prefix.length))
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `${prefix}${pad(max + 1, 3)}.${p.ext}`
}
