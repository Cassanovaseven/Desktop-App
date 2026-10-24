import type { AssetDetail, BoardSummary, LibraryPage, LibraryQuery, ProjectDTO, TagCount } from './library-types'
import type { BoardDTO, CardDTO, CardPatch, IngestEvent, LinkDTO, Point, SearchHit, Viewport } from './board-types'
import type {
  CostEstimate, GenerateRequest, GenerationDTO, Lane, PromptDTO, PromptInput, PromptParams, PromptVersionSummary, StudioEvent, StudioSettings
} from './studio-types'

export interface VaultPaths {
  root: string; db: string; files: string; thumbs: string;
  generated: string; prompts: string; mods: string; logs: string;
}

export interface ThemeTokens {
  id: string; name: string; mode: 'dark' | 'light';
  colors: { bg: string; surface: string; surfaceAlt: string; border: string; text: string;
            textMuted: string; accent: string; accentText: string;
            danger: string; warning: string; success: string };
  typography: { fontFamily: string; fontFamilyMono: string; fontSizeBase: string };
  radius: { sm: string; md: string; lg: string };
  spacing: { '1': string; '2': string; '3': string; '4': string; '6': string; '8': string };
  shadow: { sm: string; md: string };
  motion: { durationFast: string; durationBase: string; easing: string };
}

export type SidecarState = 'stopped' | 'starting' | 'ready' | 'restarting' | 'failed';
export interface SidecarStatus { state: SidecarState; port: number | null; message: string | null; restarts: number }

export interface AlfonsoApi {
  vault: { getPath(): Promise<string>; openFolder(): Promise<void> };
  theme: { list(): Promise<ThemeTokens[]>; getActiveId(): Promise<string>; setActive(id: string): Promise<void> };
  sidecar: { getStatus(): Promise<SidecarStatus>; onStatus(cb: (s: SidecarStatus) => void): () => void };
  layout: { load(): Promise<string | null>; save(json: string): Promise<void> };
  projects: {
    list(): Promise<ProjectDTO[]>;
    create(name: string): Promise<ProjectDTO>;
    rename(id: string, name: string): Promise<void>;
    createBoard(projectId: string, name: string): Promise<BoardSummary>;
    renameBoard(id: string, name: string): Promise<void>;
    getActiveBoardId(): Promise<string>;
    setActiveBoard(id: string): Promise<void>;
  };
  library: {
    query(q: LibraryQuery): Promise<LibraryPage>;
    tags(): Promise<TagCount[]>;
    detail(assetId: string): Promise<AssetDetail | null>;
    /** Mengembalikan tag yang sudah dinormalkan. */
    addTag(assetId: string, tag: string): Promise<string>;
    removeTag(assetId: string, tag: string): Promise<void>;
    /** Membuka Explorer dan menyorot file aset di vault (file tidak dibuka atau diubah). */
    showInFolder(assetId: string): Promise<void>;
  };
  board: {
    /** Tanpa id → board aktif. */
    open(boardId?: string): Promise<BoardDTO>;
    /** Kartu baru di board aktif yang menunjuk ke aset yang sudah ada (tanpa menyalin file). */
    addAssetCard(assetId: string, at: Point): Promise<CardDTO>;
    /** Board dan proyek tempat sebuah kartu berada (null bila sudah dihapus). */
    locate(cardId: string): Promise<{ boardId: string; projectId: string } | null>;
    saveCards(patches: CardPatch[]): Promise<void>;
    createNote(at: Point): Promise<CardDTO>;
    deleteCards(ids: string[]): Promise<void>;
    link(fromId: string, toId: string): Promise<LinkDTO>;
    unlink(linkId: string): Promise<void>;
    saveViewport(v: Viewport, boardId?: string): Promise<void>;
  };
  ingest: {
    dropFiles(files: File[], at: Point): Promise<CardDTO[]>;
    pasteText(text: string, at: Point): Promise<CardDTO>;
    /** Gambar dari clipboard (PNG/JPEG/WebP/GIF, maks. 50 MB). */
    pasteImage(bytes: ArrayBuffer, mime: string, at: Point): Promise<CardDTO[]>;
    retry(assetId: string): Promise<void>;
    onEvent(cb: (e: IngestEvent) => void): () => void;
  };
  search: { query(q: string): Promise<SearchHit[]> };
  watch: {
    /** Memilih folder lewat dialog di proses utama, lalu memantaunya. */
    add(): Promise<{ message: string }>;
    /** Memilih folder yang berhenti dipantau lewat dialog di proses utama. */
    remove(): Promise<{ message: string }>;
  };
  studio: {
    listPrompts(filter?: { q?: string; lane?: Lane }): Promise<PromptDTO[]>;
    getPrompt(id: string): Promise<PromptDTO | null>;
    /** Mengedit selalu membuat versi baru (versi lama tidak ditimpa). */
    savePrompt(input: PromptInput): Promise<PromptDTO>;
    history(id: string): Promise<PromptVersionSummary[]>;
    addExample(promptId: string, assetId: string): Promise<PromptDTO>;
    estimate(promptId: string, params?: PromptParams): Promise<CostEstimate>;
    estimateGeneration(generationId: string): Promise<CostEstimate>;
    generate(req: GenerateRequest): Promise<GenerationDTO[]>;
    /** Generate ulang dengan prompt versi, variabel, dan parameter yang sama persis. */
    regenerate(generationId: string, confirmedCost?: boolean): Promise<GenerationDTO[]>;
    retry(generationId: string, confirmedCost?: boolean): Promise<GenerationDTO>;
    generations(limit?: number): Promise<GenerationDTO[]>;
    generationForAsset(assetId: string): Promise<GenerationDTO | null>;
    settings(): Promise<StudioSettings>;
    /** Kunci dienkripsi di proses utama; tidak ada cara membacanya kembali dari renderer. */
    saveKey(apiKey: string, secret: string): Promise<StudioSettings>;
    clearKey(): Promise<StudioSettings>;
    setComfyUrl(url: string): Promise<StudioSettings>;
    setCost(model: string, credits: number | null): Promise<StudioSettings>;
    comfyStatus(): Promise<boolean>;
    pickWorkflow(): Promise<{ assetId: string; name: string } | null>;
    assetName(assetId: string): Promise<string | null>;
    onEvent(cb: (e: StudioEvent) => void): () => void;
  };
  transkrip: {
    /** Bertanya dulu (dialog), lalu mengunduh model Whisper bila belum ada. */
    downloadModel(): Promise<TranscriptModelResult>;
  };
}

export interface TranscriptModelResult {
  state: 'siap' | 'batal' | 'gagal'
  model: string
  message: string
}
