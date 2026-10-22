import fs from 'fs'
import path from 'path'
import type { ThemeTokens } from '../shared/types'
import type { Logger } from './logger'
import gelap from '../shared/themes/alfonso-gelap.json'
import terang from '../shared/themes/alfonso-terang.json'

export const DEFAULT_THEME_ID = 'alfonso-gelap'

const REQUIRED: Record<string, string[]> = {
  colors: ['bg', 'surface', 'surfaceAlt', 'border', 'text', 'textMuted', 'accent', 'accentText', 'danger', 'warning', 'success'],
  typography: ['fontFamily', 'fontFamilyMono', 'fontSizeBase'],
  radius: ['sm', 'md', 'lg'],
  spacing: ['1', '2', '3', '4', '6', '8'],
  shadow: ['sm', 'md'],
  motion: ['durationFast', 'durationBase', 'easing']
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

export function validateTheme(raw: unknown): ThemeTokens {
  if (!isObj(raw)) throw new Error('Tema tidak valid: bukan objek JSON')
  for (const f of ['id', 'name']) {
    if (typeof raw[f] !== 'string' || raw[f] === '') throw new Error(`Tema tidak valid: field ${f} hilang`)
  }
  if (raw.mode !== 'dark' && raw.mode !== 'light') throw new Error('Tema tidak valid: field mode hilang atau bukan dark/light')
  for (const [group, keys] of Object.entries(REQUIRED)) {
    const g = raw[group]
    if (!isObj(g)) throw new Error(`Tema tidak valid: field ${group} hilang`)
    for (const k of keys) {
      if (typeof g[k] !== 'string' || g[k] === '') throw new Error(`Tema tidak valid: field ${group}.${k} hilang`)
    }
  }
  return raw as unknown as ThemeTokens
}

function loadModTheme(modDir: string): ThemeTokens | null {
  const manifest = JSON.parse(fs.readFileSync(path.join(modDir, 'manifest.json'), 'utf8'))
  if (!isObj(manifest) || manifest.tingkat !== 'tema') return null
  const entry = isObj(manifest.masuk) ? manifest.masuk.tema : undefined
  if (typeof entry !== 'string') throw new Error('manifest tidak punya masuk.tema')
  const file = path.resolve(modDir, entry)
  const rel = path.relative(modDir, file)
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('masuk.tema menunjuk ke luar folder mod')
  return validateTheme(JSON.parse(fs.readFileSync(file, 'utf8')))
}

export function loadThemes(modsDir: string, log: Logger): ThemeTokens[] {
  const themes: ThemeTokens[] = [validateTheme(gelap), validateTheme(terang)]
  let entries: fs.Dirent[] = []
  try {
    entries = fs.readdirSync(modsDir, { withFileTypes: true })
  } catch {
    return themes
  }
  for (const e of entries.filter((d) => d.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const modDir = path.join(modsDir, e.name)
    if (!fs.existsSync(path.join(modDir, 'manifest.json'))) continue
    try {
      const t = loadModTheme(modDir)
      if (!t) continue
      if (themes.some((x) => x.id === t.id)) throw new Error(`id tema ${t.id} sudah dipakai`)
      themes.push(t)
    } catch (err) {
      log.warn(`Mod tema ${e.name} dilewati: ${(err as Error).message}`)
    }
  }
  return themes
}

export function resolveActiveThemeId(saved: string | null, themes: ThemeTokens[]): string {
  return saved && themes.some((t) => t.id === saved) ? saved : DEFAULT_THEME_ID
}
