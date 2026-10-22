import fs from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'
import { net, protocol } from 'electron'

export const VAULT_SCHEME = 'alfonso-vault'
const ALLOWED_DIRS = new Set(['files', 'thumbs'])

// Murni (tanpa Electron) supaya bisa dites: hanya file di vault/files dan vault/thumbs yang boleh keluar.
export function handleVaultRequest(vaultRoot: string, url: string): { path: string } | { status: 400 | 404 } {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { status: 400 }
  }
  if (parsed.protocol !== `${VAULT_SCHEME}:` || !ALLOWED_DIRS.has(parsed.host)) return { status: 400 }
  let rel: string
  try {
    rel = decodeURIComponent(parsed.pathname)
  } catch {
    return { status: 400 }
  }
  const base = path.join(vaultRoot, parsed.host)
  const target = path.resolve(base, '.' + path.sep + rel.replace(/^[/\\]+/, ''))
  const relative = path.relative(base, target)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return { status: 400 }
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) return { status: 404 }
  return { path: target }
}

// Harus dipanggil sebelum `ready`.
export function registerVaultScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: VAULT_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }])
}

// Dipanggil sesudah `ready`.
export function handleVaultScheme(vaultRoot: string): void {
  protocol.handle(VAULT_SCHEME, (req) => {
    const r = handleVaultRequest(vaultRoot, req.url)
    if ('status' in r) return new Response(null, { status: r.status })
    return net.fetch(pathToFileURL(r.path).toString())
  })
}
