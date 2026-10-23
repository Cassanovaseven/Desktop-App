// @vitest-environment jsdom
import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import gelapJson from '../../src/shared/themes/alfonso-gelap.json'
import terangJson from '../../src/shared/themes/alfonso-terang.json'
import type { AlfonsoApi, ThemeTokens } from '../../src/shared/types'
import { buildCommands, filterCommands, type Command } from '../../src/renderer/palette/commands'
import { CommandPalette } from '../../src/renderer/palette/CommandPalette'

const themes = [gelapJson, terangJson] as ThemeTokens[]
let applyThemeById: ReturnType<typeof vi.fn<(id: string) => void>>
let showMessage: ReturnType<typeof vi.fn<(m: string) => void>>
let resetLayout: ReturnType<typeof vi.fn<() => void>>
let addNote: ReturnType<typeof vi.fn<() => void>>
let openSearch: ReturnType<typeof vi.fn<() => void>>
let api: AlfonsoApi
let cmds: Command[]

beforeEach(() => {
  applyThemeById = vi.fn(); showMessage = vi.fn(); resetLayout = vi.fn(); addNote = vi.fn(); openSearch = vi.fn()
  api = {
    vault: { getPath: vi.fn(async () => 'C:/Vault'), openFolder: vi.fn(async () => {}) },
    theme: { list: vi.fn(async () => themes), getActiveId: vi.fn(async () => 'alfonso-gelap'), setActive: vi.fn(async () => {}) },
    sidecar: { getStatus: vi.fn(async () => ({ state: 'ready' as const, port: 51234, message: null, restarts: 0 })), onStatus: vi.fn(() => () => {}) },
    layout: { load: vi.fn(async () => null), save: vi.fn(async () => {}) },
    transkrip: { downloadModel: vi.fn(async () => ({ state: 'siap' as const, model: 'small', message: 'Model transkrip siap.' })) }
  } as unknown as AlfonsoApi
  cmds = buildCommands({ themes, api, resetLayout, showMessage, applyThemeById, addNote, openSearch })
})
afterEach(() => cleanup())

test('daftar perintah lengkap', () => {
  expect(cmds.map(c => c.id)).toEqual(['board.addNote', 'search.files', 'theme.switch:alfonso-gelap', 'theme.switch:alfonso-terang', 'vault.open', 'sidecar.status', 'transkrip.download', 'layout.reset'])
  expect(cmds[3].label).toBe('Ganti tema: Alfonso Terang')
})
test('filter tidak peka huruf dan per kata', () => {
  const r = filterCommands(cmds, 'tema TERANG')
  expect(r.map(c => c.id)).toEqual(['theme.switch:alfonso-terang'])
})
test('query kosong mengembalikan semua', () => { expect(filterCommands(cmds, '')).toHaveLength(cmds.length) })
test('Ctrl+K, ketik, Enter menjalankan perintah', async () => {
  const user = userEvent.setup()
  render(<CommandPalette commands={cmds} />)
  await user.keyboard('{Control>}k{/Control}')
  await user.type(screen.getByLabelText('Cari perintah'), 'terang{Enter}')
  expect(applyThemeById).toHaveBeenCalledWith('alfonso-terang')
  expect(screen.queryByLabelText('Cari perintah')).toBeNull()
})
test('Esc menutup, panah bawah memilih perintah berikutnya', async () => {
  const user = userEvent.setup()
  render(<CommandPalette commands={cmds} />)
  await user.keyboard('{Control>}k{/Control}')
  await user.keyboard('{Escape}')
  expect(screen.queryByLabelText('Cari perintah')).toBeNull()
  await user.keyboard('{Control>}k{/Control}')
  await user.type(screen.getByLabelText('Cari perintah'), 'ganti tema')
  await user.keyboard('{ArrowDown}{Enter}')
  expect(applyThemeById).toHaveBeenCalledWith('alfonso-terang')
})
test('status sidecar dan buka vault', async () => {
  await cmds.find(c => c.id === 'sidecar.status')!.run()
  expect(showMessage).toHaveBeenCalledWith('Sidecar: siap (port 51234)')
  await cmds.find(c => c.id === 'vault.open')!.run()
  expect(api.vault.openFolder).toHaveBeenCalled()
  cmds.find(c => c.id === 'layout.reset')!.run()
  expect(resetLayout).toHaveBeenCalled()
})
test('Tambah catatan dan Cari isi file memanggil konteks', () => {
  cmds.find(c => c.id === 'board.addNote')!.run(); cmds.find(c => c.id === 'search.files')!.run()
  expect(addNote).toHaveBeenCalled(); expect(openSearch).toHaveBeenCalled()
})
test('Unduh model transkrip: pesan saat mulai dan hasilnya', async () => {
  await cmds.find(c => c.id === 'transkrip.download')!.run()
  expect(api.transkrip.downloadModel).toHaveBeenCalled()
  expect(showMessage.mock.calls.map(c => c[0])).toEqual(['Menyiapkan model transkrip…', 'Model transkrip siap.'])
})
