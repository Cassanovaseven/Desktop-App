import type { AssetDTO, AssetStatus } from './board-types'

export interface BoardSummary { id: string; name: string }
export interface ProjectDTO { id: string; name: string; boards: BoardSummary[] }

export type Jenis = 'dokumen' | 'gambar' | 'kode' | 'arsip' | 'audio' | 'video' | 'lainnya'
export const JENIS: Jenis[] = ['dokumen', 'gambar', 'audio', 'video', 'kode', 'arsip', 'lainnya']

/** semua = seluruh vault; proyek = punya kartu di board proyek aktif; belum-dipakai = tanpa kartu sama sekali. */
export type LibraryScope = 'semua' | 'proyek' | 'belum-dipakai'
export type LibrarySort = 'terbaru' | 'terlama' | 'nama' | 'ukuran'

export interface LibraryQuery {
  q?: string
  jenis?: Jenis[]
  status?: AssetStatus[]
  /** Semua tag ini harus ada pada aset. */
  tags?: string[]
  scope?: LibraryScope
  /** Wajib bila scope = 'proyek'. */
  projectId?: string
  sort?: LibrarySort
  offset?: number
  limit?: number
}

export interface LibraryItem {
  asset: AssetDTO
  jenis: Jenis
  createdAt: string
  /** Cuplikan teks yang cocok, hanya bila ada kata kunci. */
  snippet: string | null
}

export interface LibraryPage { items: LibraryItem[]; total: number }

export interface TagCount { tag: string; count: number }

export interface AssetUsage { boardId: string; boardName: string; projectId: string; projectName: string; cardIds: string[] }

export interface AssetDetail {
  asset: AssetDTO
  jenis: Jenis
  createdAt: string
  tags: { tag: string; auto: boolean }[]
  /** Maksimal 5.000 karakter pertama teks ekstraksi. */
  textPreview: string
  textLength: number
  usages: AssetUsage[]
}
