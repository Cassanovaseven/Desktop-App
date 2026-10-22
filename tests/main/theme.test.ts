import { test, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import gelapJson from '../../src/shared/themes/alfonso-gelap.json'
import terangJson from '../../src/shared/themes/alfonso-terang.json'
import type { ThemeTokens } from '../../src/shared/types'
import { tokensToCssVars } from '../../src/shared/theme-css'
import { validateTheme, loadThemes, resolveActiveThemeId } from '../../src/main/theme'

const gelap = gelapJson as ThemeTokens
let modsDir: string
let log: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> }

function writeMod(dir: string, id: string, manifest: Record<string, unknown>, theme: unknown): void {
  const d = path.join(dir, id)
  fs.mkdirSync(d, { recursive: true })
  fs.writeFileSync(path.join(d, 'manifest.json'), JSON.stringify({ id, nama: id, versi: '0.1.0', izin: [], ...manifest }))
  fs.writeFileSync(path.join(d, 'theme.json'), JSON.stringify(theme))
}

beforeEach(() => {
  modsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alfonso-mods-'))
  log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
})
afterEach(() => { fs.rmSync(modsDir, { recursive: true, force: true }) })

test('token menjadi variabel CSS', () => {
  const v = tokensToCssVars(gelap)
  expect(v['--color-surface-alt']).toBe(gelap.colors.surfaceAlt)
  expect(v['--font-family']).toBe(gelap.typography.fontFamily)
  expect(v['--space-4']).toBe(gelap.spacing['4'])
  expect(v['--motion-duration-fast']).toBe(gelap.motion.durationFast)
})
test('validateTheme menolak tema tanpa colors.bg', () => {
  const rusak = structuredClone(gelap) as any; delete rusak.colors.bg
  expect(() => validateTheme(rusak)).toThrow(/colors\.bg/)
})
test('kedua tema bawaan lolos validateTheme', () => {
  expect(validateTheme(gelapJson).id).toBe('alfonso-gelap')
  expect(validateTheme(terangJson).id).toBe('alfonso-terang')
})
test('tema mod valid dimuat, yang rusak dilewati', () => {
  writeMod(modsDir, 'tema-ok', { tingkat: 'tema', masuk: { tema: 'theme.json' } }, { ...gelap, id: 'tema-ok', name: 'Tema OK' })
  writeMod(modsDir, 'tema-rusak', { tingkat: 'tema', masuk: { tema: 'theme.json' } }, { id: 'tema-rusak' })
  const ids = loadThemes(modsDir, log).map(t => t.id)
  expect(ids).toEqual(['alfonso-gelap', 'alfonso-terang', 'tema-ok'])
  expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('tema-rusak'))
})
test('mod tema yang menunjuk ke luar foldernya dilewati', () => {
  writeMod(modsDir, 'tema-nakal', { tingkat: 'tema', masuk: { tema: '../tema-nakal/../../x.json' } }, { ...gelap, id: 'tema-nakal' })
  expect(loadThemes(modsDir, log).map(t => t.id)).toEqual(['alfonso-gelap', 'alfonso-terang'])
  expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('tema-nakal'))
})
test('id tema tersimpan yang tidak dikenal kembali ke default', () => {
  expect(resolveActiveThemeId('hilang', loadThemes(modsDir, log))).toBe('alfonso-gelap')
  expect(resolveActiveThemeId('alfonso-terang', loadThemes(modsDir, log))).toBe('alfonso-terang')
})
