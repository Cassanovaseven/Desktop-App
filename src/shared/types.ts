import type { BoardDTO, CardDTO, CardPatch, IngestEvent, LinkDTO, Point, SearchHit, Viewport } from './board-types'

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
  board: {
    open(): Promise<BoardDTO>;
    saveCards(patches: CardPatch[]): Promise<void>;
    createNote(at: Point): Promise<CardDTO>;
    deleteCards(ids: string[]): Promise<void>;
    link(fromId: string, toId: string): Promise<LinkDTO>;
    unlink(linkId: string): Promise<void>;
    saveViewport(v: Viewport): Promise<void>;
  };
  ingest: {
    dropFiles(files: File[], at: Point): Promise<CardDTO[]>;
    pasteText(text: string, at: Point): Promise<CardDTO>;
    retry(assetId: string): Promise<void>;
    onEvent(cb: (e: IngestEvent) => void): () => void;
  };
  search: { query(q: string): Promise<SearchHit[]> };
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
