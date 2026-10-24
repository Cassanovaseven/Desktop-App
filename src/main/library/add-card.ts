import type Database from 'better-sqlite3'
import type { CardDTO, CardType, Point } from '../../shared/board-types'
import { DEFAULT_SIZE, getActiveBoard, getBoardRow, insertCard } from '../board/repo'
import { kindForFile } from '../ingest/importer'

/**
 * Kartu baru dari Library: menunjuk ke aset yang sudah ada, tanpa menyalin file atau membuat aset baru.
 * ZIP menjadi kartu file biasa (isinya sudah punya kartu sendiri saat pertama diimpor).
 */
export function addAssetCard(db: Database.Database, assetId: string, at: Point, boardId?: string): CardDTO {
  const row = db.prepare('SELECT original_name FROM assets WHERE id = ?').get(assetId) as { original_name: string } | undefined
  if (!row) throw new Error('Aset tidak ditemukan')
  const board = boardId ? getBoardRow(db, boardId) : getActiveBoard(db)
  if (!board) throw new Error('Board tidak ditemukan')
  const kind = kindForFile(row.original_name)
  const type: CardType = kind.tipeKartu === 'grup' ? 'file' : kind.tipeKartu
  return insertCard(db, {
    boardId: board.id,
    type,
    x: at.x,
    y: at.y,
    ...(kind.jenis === 'video' ? { h: DEFAULT_SIZE.gambar.h } : {}),
    assetId
  })
}
