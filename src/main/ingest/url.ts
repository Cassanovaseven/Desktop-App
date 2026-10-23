import dns from 'dns'
import fs from 'fs'
import net from 'net'
import path from 'path'
import { Readable, Transform } from 'stream'
import { pipeline } from 'stream/promises'

export const MAX_URL_BYTES = 50 * 1024 * 1024

export interface DownloadOptions {
  /** Folder sementara milik pemanggil; file hasil unduhan ditulis di sini. */
  dir: string
  maxBytes?: number
  timeoutMs?: number
  maxRedirects?: number
  /** Hanya untuk tes dengan server lokal. */
  allowPrivate?: boolean
}

export interface DownloadResult {
  path: string
  originalName: string
  contentType: string | null
}

const blocked = new net.BlockList()
for (const [addr, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.168.0.0', 16], ['224.0.0.0', 4], ['240.0.0.0', 4]
] as const) blocked.addSubnet(addr, prefix, 'ipv4')
for (const [addr, prefix] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]] as const) blocked.addSubnet(addr, prefix, 'ipv6')

/** Loopback, jaringan privat, link-local, dan multicast. Sidecar di 127.0.0.1 tidak boleh terjangkau dari URL. */
export function isBlockedAddress(addr: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(addr)
  if (mapped) return blocked.check(mapped[1], 'ipv4')
  const family = net.isIP(addr)
  if (family === 4) return blocked.check(addr, 'ipv4')
  if (family === 6) return blocked.check(addr, 'ipv6')
  return true
}

const MSG = {
  scheme: 'Hanya tautan http/https yang bisa diunduh.',
  private: 'Alamat lokal atau jaringan privat tidak diizinkan.',
  big: 'File terlalu besar (maks. 50 MB).',
  timeout: 'Waktu habis saat mengunduh.',
  redirects: 'Terlalu banyak pengalihan.'
}

async function checkHost(url: URL, allowPrivate: boolean): Promise<void> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(MSG.scheme)
  if (allowPrivate) return
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost')) throw new Error(MSG.private)
  const addrs = net.isIP(host) ? [host] : (await dns.promises.lookup(host, { all: true })).map((a) => a.address)
  if (addrs.length === 0 || addrs.some(isBlockedAddress)) throw new Error(MSG.private)
}

const EXT_BY_TYPE: Record<string, string> = {
  'text/html': 'html', 'application/xhtml+xml': 'html', 'text/plain': 'txt', 'text/markdown': 'md', 'text/csv': 'csv',
  'application/json': 'json', 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp',
  'image/gif': 'gif', 'image/svg+xml': 'svg', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov', 'application/zip': 'zip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx'
}

// Karakter yang tidak boleh ada di nama file Windows diganti.
const safeName = (s: string): string =>
  s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' - ').replace(/\s+/g, ' ').replace(/^[\s.-]+|[\s.]+$/g, '').slice(0, 120) || 'unduhan'

const decodeEntities = (s: string): string =>
  s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n)))

function nameFor(url: URL, contentType: string | null, file: string): string {
  const ext = contentType ? EXT_BY_TYPE[contentType] : undefined
  if (ext === 'html') {
    const head = fs.readFileSync(file).subarray(0, 64 * 1024).toString('utf8')
    const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1]
    const t = title ? safeName(decodeEntities(title.trim())) : safeName(url.hostname)
    return `${t}.html`
  }
  const last = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() ?? '') || url.hostname
  const base = safeName(last)
  if (path.extname(base)) return base
  return ext ? `${base}.${ext}` : base
}

export async function downloadUrl(raw: string, o: DownloadOptions): Promise<DownloadResult> {
  const maxBytes = o.maxBytes ?? MAX_URL_BYTES
  const signal = AbortSignal.timeout(o.timeoutMs ?? 30_000)
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(MSG.scheme)
  }
  const file = path.join(o.dir, 'unduhan.bin')
  try {
    let res: Response | null = null
    for (let hop = 0; hop <= (o.maxRedirects ?? 5); hop++) {
      await checkHost(url, !!o.allowPrivate)
      // Pengalihan diikuti manual supaya setiap alamat tujuan dicek ulang.
      const r = await fetch(url, { redirect: 'manual', signal, headers: { 'User-Agent': 'Alfonso/0.1' } })
      const loc = r.headers.get('location')
      if (r.status >= 300 && r.status < 400 && loc) {
        await r.body?.cancel()
        url = new URL(loc, url)
        continue
      }
      res = r
      break
    }
    if (!res) throw new Error(MSG.redirects)
    if (!res.ok) {
      await res.body?.cancel()
      throw new Error(`Server menjawab ${res.status}.`)
    }
    if (Number(res.headers.get('content-length') ?? 0) > maxBytes) throw new Error(MSG.big)
    const contentType = res.headers.get('content-type')?.split(';')[0].trim().toLowerCase() || null
    let total = 0
    const limit = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        total += chunk.length
        cb(total > maxBytes ? new Error(MSG.big) : null, chunk)
      }
    })
    if (!res.body) throw new Error('Isi kosong.')
    await pipeline(Readable.fromWeb(res.body as import('stream/web').ReadableStream), limit, fs.createWriteStream(file, { flags: 'wx' }))
    const originalName = nameFor(url, contentType, file)
    const named = path.join(o.dir, originalName)
    await fs.promises.rename(file, named)
    return { path: named, originalName, contentType }
  } catch (err) {
    await fs.promises.rm(file, { force: true })
    if (signal.aborted || (err as Error).name === 'TimeoutError' || (err as Error).name === 'AbortError') throw new Error(MSG.timeout)
    throw err
  }
}
