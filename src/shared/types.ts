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
}
