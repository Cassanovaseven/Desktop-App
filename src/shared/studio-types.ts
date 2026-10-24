import type { CardDTO, LinkDTO, Point } from './board-types'

/** Jalur generate (spec 3): cloud = Higgsfield, lokal = ComfyUI, kode = SVG/p5. */
export type Lane = 'cloud' | 'lokal' | 'kode'
/** Nilai tag `sumber:*` (spec 9.3). */
export type GenSource = 'higgsfield' | 'comfyui' | 'svg' | 'p5'
export type GenStatus = 'antre' | 'berjalan' | 'selesai' | 'gagal'

/** Model jalur kode. Jalur lokal selalu `comfyui`; jalur cloud = id aplikasi Higgsfield. */
export const CODE_MODELS = ['svg', 'p5-gambar', 'p5-motion'] as const
export type CodeModel = (typeof CODE_MODELS)[number]

export type PromptParams = Record<string, string | number | boolean>

export interface PromptDTO {
  id: string
  projectId: string | null
  name: string
  lane: Lane
  targetModel: string
  template: string
  variables: string[]
  params: PromptParams
  /** Id aset contoh hasil. */
  examples: string[]
  version: number
  parentVersionId: string | null
  createdAt: string | null
}

export interface PromptInput {
  /** Versi yang diedit; tanpa ini → prompt baru (versi 1). */
  baseId?: string
  projectId?: string | null
  name: string
  lane: Lane
  targetModel: string
  template: string
  params?: PromptParams
}

export interface PromptVersionSummary { id: string; version: number; createdAt: string | null }

export interface GenerationDTO {
  id: string
  promptId: string | null
  promptName: string | null
  promptVersion: number | null
  promptText: string | null
  variables: Record<string, string>
  model: string | null
  params: PromptParams
  lane: Lane
  source: GenSource | null
  creditCost: number | null
  status: GenStatus
  error: string | null
  resultAssetId: string | null
  sourceCardId: string | null
  createdAt: string
  updatedAt: string | null
}

export interface GenerateRequest {
  promptId: string
  variables: Record<string, string>
  sourceCardId?: string | null
  /** Posisi kartu hasil bila tidak ada kartu sumber (mis. tengah layar Board). */
  at?: Point | null
  /** Menimpa parameter bawaan prompt (dipakai Generate ulang dan formulir Studio). */
  params?: PromptParams
  /** Jalur cloud wajib true: pengguna sudah melihat perkiraan biaya dan menyetujuinya. */
  confirmedCost?: boolean
}

export interface CostEstimate {
  /** Kredit per hasil; null = belum diketahui (model belum diberi harga). */
  perItem: number | null
  count: number
  total: number | null
}

export type KeyStatus = 'belum' | 'tersimpan' | 'ditolak'

export interface StudioSettings {
  higgsfield: KeyStatus
  comfyUrl: string
  costs: Record<string, number>
}

export interface StudioEvent {
  generation: GenerationDTO
  /** Kartu hasil baru (sudah dikirim juga lewat ingest:event untuk Board). */
  card?: CardDTO | null
  link?: LinkDTO | null
}

/** Peristiwa yang membuka Studio dari luar (Board, palette, Inspector). */
export interface StudioOpenRequest {
  sourceCardId?: string | null
  /** Nama singkat kartu sumber untuk ditampilkan. */
  sourceLabel?: string | null
  /** Isi teks kartu sumber; mengisi variabel [SUMBER_TEKS] bila ada. */
  sourceText?: string | null
  promptId?: string | null
  /** Buka bagian Akun & biaya. */
  account?: boolean
}
