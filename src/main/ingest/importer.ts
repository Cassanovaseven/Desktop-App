import fs from 'fs'
import path from 'path'
import type Database from 'better-sqlite3'
import type { CardDTO, CardType, Point } from '../../shared/board-types'
import type { VaultPaths } from '../../shared/types'
import { sha256File } from './hash'
import { findAssetBySha, getOrCreateDefaultBoard, insertAsset, insertCard, DEFAULT_SIZE } from '../board/repo'
import { insertJob } from '../jobs/store'

export const MSG_FOLDER = 'Folder belum didukung, drop file-nya saja.'

export type Jenis = 'dokumen' | 'gambar' | 'kode' | 'arsip' | 'audio' | 'video' | 'lainnya'

const TYPES: Record<string, { jenis: Jenis; mime: string | null }> = {
  pdf: { jenis: 'dokumen', mime: 'application/pdf' },
  docx: { jenis: 'dokumen', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  pptx: { jenis: 'dokumen', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
  xlsx: { jenis: 'dokumen', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  csv: { jenis: 'dokumen', mime: 'text/csv' },
  txt: { jenis: 'dokumen', mime: 'text/plain' },
  md: { jenis: 'dokumen', mime: 'text/markdown' },
  html: { jenis: 'dokumen', mime: 'text/html' },
  htm: { jenis: 'dokumen', mime: 'text/html' },
  epub: { jenis: 'dokumen', mime: 'application/epub+zip' },
  png: { jenis: 'gambar', mime: 'image/png' },
  jpg: { jenis: 'gambar', mime: 'image/jpeg' },
  jpeg: { jenis: 'gambar', mime: 'image/jpeg' },
  webp: { jenis: 'gambar', mime: 'image/webp' },
  gif: { jenis: 'gambar', mime: 'image/gif' },
  svg: { jenis: 'gambar', mime: 'image/svg+xml' },
  psd: { jenis: 'gambar', mime: 'image/vnd.adobe.photoshop' },
  zip: { jenis: 'arsip', mime: 'application/zip' },
  mp3: { jenis: 'audio', mime: 'audio/mpeg' },
  wav: { jenis: 'audio', mime: 'audio/wav' },
  m4a: { jenis: 'audio', mime: 'audio/mp4' },
  ogg: { jenis: 'audio', mime: 'audio/ogg' },
  mp4: { jenis: 'video', mime: 'video/mp4' },
  mov: { jenis: 'video', mime: 'video/quicktime' },
  mkv: { jenis: 'video', mime: 'video/x-matroska' },
  webm: { jenis: 'video', mime: 'video/webm' }
}

const CODE_EXT = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'json', 'yaml', 'yml', 'toml', 'xml', 'css', 'scss', 'sql', 'sh', 'ps1', 'bat',
  'java', 'kt', 'c', 'h', 'cpp', 'hpp', 'cs', 'go', 'rs', 'rb', 'php', 'swift', 'lua', 'r', 'dart', 'vue', 'svelte'
])

export function kindForFile(name: string): { jenis: Jenis; tipeKartu: CardType; mime: string | null } {
  const ext = path.extname(name).slice(1).toLowerCase()
  if (CODE_EXT.has(ext)) return { jenis: 'kode', tipeKartu: 'kode', mime: ext === 'json' ? 'application/json' : 'text/plain' }
  const t = TYPES[ext]
  if (!t) return { jenis: 'lainnya', tipeKartu: 'file', mime: null }
  const tipeKartu: CardType = t.jenis === 'gambar' ? 'gambar' : t.jenis === 'arsip' ? 'grup' : 'file'
  return { jenis: t.jenis, tipeKartu, mime: t.mime }
}

// Nama file vault = hash, jadi tidak pernah bentrok; COPYFILE_EXCL menjamin file yang ada tidak ditimpa.
async function copyIntoVault(vault: VaultPaths, src: string, sha: string): Promise<string> {
  const ext = path.extname(src).toLowerCase()
  const rel = path.posix.join('files', sha.slice(0, 2), sha + ext)
  const dest = path.join(vault.root, rel)
  await fs.promises.mkdir(path.dirname(dest), { recursive: true })
  try {
    await fs.promises.copyFile(src, dest, fs.constants.COPYFILE_EXCL)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
  }
  return rel
}

export async function importFiles(db: Database.Database, vault: VaultPaths, paths: string[], at: Point): Promise<CardDTO[]> {
  const board = getOrCreateDefaultBoard(db)
  const files: string[] = []
  let folders = 0
  for (const p of paths) {
    const st = await fs.promises.stat(p)
    if (st.isDirectory()) folders++
    else if (st.isFile()) files.push(p)
  }
  if (files.length === 0 && folders > 0) throw new Error(MSG_FOLDER)

  const cards: CardDTO[] = []
  for (const [i, src] of files.entries()) {
    const sha = await sha256File(src)
    const kind = kindForFile(src)
    const size = (await fs.promises.stat(src)).size
    let assetId = findAssetBySha(db, sha)?.id
    if (!assetId) {
      const vaultPath = await copyIntoVault(vault, src, sha)
      // Cek ulang: impor lain bisa saja menyelesaikan file yang sama selama penyalinan async.
      assetId = db.transaction(() => {
        const existing = findAssetBySha(db, sha)
        if (existing) return existing.id
        const asset = insertAsset(db, { sha256: sha, vaultPath, originalName: path.basename(src), mime: kind.mime, sizeBytes: size })
        insertJob(db, 'ekstrak', { assetId: asset.id })
        return asset.id
      })()
    }
    const col = i % 5
    const row = Math.floor(i / 5)
    cards.push(
      insertCard(db, {
        boardId: board.id,
        type: kind.tipeKartu,
        x: at.x + col * (DEFAULT_SIZE.file.w + 20),
        y: at.y + row * (DEFAULT_SIZE.gambar.h + 20),
        assetId
      })
    )
  }
  return cards
}
