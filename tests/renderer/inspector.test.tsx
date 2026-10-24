// @vitest-environment jsdom
import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { InspectorPanel } from '../../src/renderer/inspector/InspectorPanel'
import { workspace } from '../../src/renderer/workspace'
import type { AssetDetail } from '../../src/shared/library-types'

let detail: AssetDetail
const api = {
  library: {
    detail: vi.fn(async () => structuredClone(detail)),
    addTag: vi.fn(async (_id: string, tag: string) => { const t = tag.trim().toLowerCase(); detail.tags.push({ tag: t, auto: false }); return t }),
    removeTag: vi.fn(async (_id: string, tag: string) => { detail.tags = detail.tags.filter((x) => x.tag !== tag) }),
    showInFolder: vi.fn(async () => {})
  },
  ingest: { retry: vi.fn(async () => {}), onEvent: vi.fn(() => () => {}) },
  projects: { setActiveBoard: vi.fn(async () => {}) },
  board: { locate: vi.fn() }
}
beforeEach(() => {
  detail = {
    asset: { id: 'a1', originalName: 'rapat.mp4', mime: 'video/mp4', sizeBytes: 3 * 1024 * 1024, status: 'siap', previewUrl: 'alfonso-vault://thumbs/a1.webp', error: null, transkrip: 'selesai', meta: { durasi: 125, lebar: 1920, tinggi: 1080 } },
    jenis: 'video',
    createdAt: '2026-10-24T08:00:00.000Z',
    tags: [{ tag: 'jalur:impor', auto: true }, { tag: 'jenis:video', auto: true }, { tag: 'status:draf', auto: false }],
    textPreview: 'selamat pagi semua',
    textLength: 18,
    usages: [
      { boardId: 'b1', boardName: 'Board Utama', projectId: 'p1', projectName: 'Proyek Pertama', cardIds: ['c1'] },
      { boardId: 'b3', boardName: 'Kronologi', projectId: 'p2', projectName: 'Riset Hukum', cardIds: ['c7', 'c8'] }
    ]
  }
  ;(window as any).alfonso = api
  workspace.reset()
  workspace.setActiveBoard('b1', 'p1')
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

test('tanpa pilihan menampilkan petunjuk', () => {
  render(<InspectorPanel />)
  expect(screen.getByText(/Pilih kartu atau aset/)).toBeTruthy()
})

test('aset: pratinjau, info file, durasi, ukuran gambar, cuplikan teks', async () => {
  workspace.select({ kind: 'asset', assetId: 'a1' })
  render(<InspectorPanel />)
  expect(await screen.findByRole('heading', { name: 'rapat.mp4' })).toBeTruthy()
  expect((screen.getByRole('img', { name: 'rapat.mp4' }) as HTMLImageElement).getAttribute('src')).toBe('alfonso-vault://thumbs/a1.webp')
  expect(screen.getByText('Video')).toBeTruthy()
  expect(screen.getByText('3,0 MB')).toBeTruthy()
  expect(screen.getByText('2:05')).toBeTruthy()
  expect(screen.getByText('1920 × 1080')).toBeTruthy()
  expect(screen.getByText('selamat pagi semua')).toBeTruthy()
  expect(screen.getByText('Transkrip siap')).toBeTruthy()
})

test('pilihan dari Board dan dari Library sama-sama memuat detail', async () => {
  render(<InspectorPanel />)
  act(() => workspace.select({ kind: 'asset', assetId: 'a1', cardId: 'c1' }))
  await screen.findByRole('heading', { name: 'rapat.mp4' })
  expect(api.library.detail).toHaveBeenCalledWith('a1')
})

test('kartu catatan menampilkan isinya; beberapa kartu → jumlah', async () => {
  render(<InspectorPanel />)
  act(() => workspace.select({ kind: 'card', cardId: 'c2', type: 'catatan', content: 'ide judul skripsi' }))
  expect(await screen.findByText('ide judul skripsi')).toBeTruthy()
  expect(screen.getByText('Catatan')).toBeTruthy()
  act(() => workspace.select({ kind: 'cards', count: 3 }))
  expect(await screen.findByText('3 kartu dipilih')).toBeTruthy()
})

test('editor tag: Enter menambah, × menghapus, tag otomatis tanpa ×', async () => {
  const user = userEvent.setup()
  workspace.select({ kind: 'asset', assetId: 'a1' })
  render(<InspectorPanel />)
  await screen.findByRole('heading', { name: 'rapat.mp4' })
  expect(screen.queryByRole('button', { name: 'Hapus tag jenis:video' })).toBeNull()
  const v = workspace.get().libraryVersion
  await user.type(screen.getByLabelText('Tambah tag'), 'Status:Final{Enter}')
  expect(api.library.addTag).toHaveBeenCalledWith('a1', 'Status:Final')
  expect(await screen.findByText('status:final')).toBeTruthy()
  expect(workspace.get().libraryVersion).toBe(v + 1)
  expect((screen.getByLabelText('Tambah tag') as HTMLInputElement).value).toBe('')
  await user.click(screen.getByRole('button', { name: 'Hapus tag status:draf' }))
  expect(api.library.removeTag).toHaveBeenCalledWith('a1', 'status:draf')
  await waitFor(() => expect(screen.queryByText('status:draf')).toBeNull())
})

test('error tag ditampilkan', async () => {
  api.library.addTag.mockRejectedValueOnce(new Error('Tag harus diisi, maksimal 64 karakter.'))
  const user = userEvent.setup()
  workspace.select({ kind: 'asset', assetId: 'a1' })
  render(<InspectorPanel />)
  await screen.findByRole('heading', { name: 'rapat.mp4' })
  await user.type(screen.getByLabelText('Tambah tag'), 'x{Enter}')
  expect((await screen.findByRole('alert')).textContent).toContain('Tag harus diisi')
})

test('"Dipakai di": pindah board lalu fokus ke kartu', async () => {
  const user = userEvent.setup()
  workspace.select({ kind: 'asset', assetId: 'a1' })
  render(<InspectorPanel />)
  await user.click(await screen.findByRole('button', { name: /Riset Hukum › Kronologi/ }))
  expect(api.projects.setActiveBoard).toHaveBeenCalledWith('b3')
  expect(workspace.get().activeBoardId).toBe('b3')
  expect(workspace.peekFocus()).toBe('c7')
  expect(screen.getByRole('button', { name: /Riset Hukum › Kronologi/ }).textContent).toContain('2 kartu')
})

test('aset belum dipakai di board mana pun', async () => {
  detail.usages = []
  workspace.select({ kind: 'asset', assetId: 'a1' })
  render(<InspectorPanel />)
  expect(await screen.findByText('Belum dipakai di board mana pun.')).toBeTruthy()
})

test('Tampilkan di folder, Tambahkan ke Board, dan Coba lagi untuk ekstraksi gagal', async () => {
  const user = userEvent.setup()
  const { boardController } = await import('../../src/renderer/board/Board')
  const addAsset = vi.spyOn(boardController, 'addAsset').mockImplementation(() => {})
  detail.asset = { ...detail.asset, status: 'gagal', error: 'Audio/video rusak' }
  workspace.select({ kind: 'asset', assetId: 'a1' })
  render(<InspectorPanel />)
  await screen.findByText('Audio/video rusak')
  await user.click(screen.getByRole('button', { name: 'Tampilkan di folder' }))
  expect(api.library.showInFolder).toHaveBeenCalledWith('a1')
  await user.click(screen.getByRole('button', { name: 'Tambahkan ke Board' }))
  expect(addAsset).toHaveBeenCalledWith('a1')
  await user.click(screen.getByRole('button', { name: 'Coba lagi' }))
  expect(api.ingest.retry).toHaveBeenCalledWith('a1')
})

test('teks panjang diberi catatan dipotong', async () => {
  detail.textPreview = 'a'.repeat(5000); detail.textLength = 12000
  workspace.select({ kind: 'asset', assetId: 'a1' })
  render(<InspectorPanel />)
  expect(await screen.findByText(/5\.000 dari 12\.000 karakter/)).toBeTruthy()
})
