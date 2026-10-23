export type CardType = 'catatan' | 'file' | 'gambar' | 'tautan' | 'kode' | 'grup'
export type AssetStatus = 'memproses' | 'siap' | 'gagal'

export interface Viewport { x: number; y: number; zoom: number }
export interface Point { x: number; y: number }

export interface AssetDTO {
  id: string
  originalName: string
  mime: string | null
  sizeBytes: number | null
  status: AssetStatus
  /** URL alfonso-vault:// untuk pratinjau (thumbnail, atau file gambar asli). */
  previewUrl: string | null
  error: string | null
  /** Hanya audio/video: null bila tidak ditranskrip; 'belum' = model transkrip belum diunduh. */
  transkrip: TranscriptStatus | null
}

export type TranscriptStatus = 'memproses' | 'selesai' | 'gagal' | 'belum'

export interface CardDTO {
  id: string
  boardId: string
  type: CardType
  x: number; y: number; w: number; h: number; z: number
  assetId: string | null
  content: string | null
  style: Record<string, unknown> | null
  asset: AssetDTO | null
}

export interface CardPatch {
  id: string
  x?: number; y?: number; w?: number; h?: number; z?: number
  content?: string
}

export interface LinkDTO { id: string; fromId: string; toId: string; kind: string }

export interface BoardDTO {
  id: string
  name: string
  viewport: Viewport | null
  cards: CardDTO[]
  links: LinkDTO[]
}

export interface IngestEvent {
  /** Asset yang statusnya berubah; null bila event hanya memperbarui kartu (mis. unduhan URL gagal). */
  asset: AssetDTO | null
  /** Kartu baru yang dibuat dari proses ini (mis. isi ZIP). */
  newCards: CardDTO[]
  /** Kartu yang sudah ada dan berubah (mis. kartu tautan yang kini menunjuk ke isi unduhan). */
  updatedCards?: CardDTO[]
}

export interface SearchHit { assetId: string; cardIds: string[]; originalName: string; snippet: string }
