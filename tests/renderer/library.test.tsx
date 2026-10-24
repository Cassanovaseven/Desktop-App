// @vitest-environment jsdom
import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor, fireEvent, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LibraryPanel, ASSET_DRAG_TYPE } from '../../src/renderer/library/LibraryPanel'
import { workspace } from '../../src/renderer/workspace'
import type { LibraryItem, LibraryQuery } from '../../src/shared/library-types'
import type { AssetDTO, IngestEvent } from '../../src/shared/board-types'

const asset = (id: string, name: string, p: Partial<AssetDTO> = {}): AssetDTO => ({ id, originalName: name, mime: null, sizeBytes: 1024, status: 'siap', previewUrl: null, error: null, transkrip: null, meta: null, ...p })
const item = (a: AssetDTO, jenis: LibraryItem['jenis'] = 'dokumen', snippet: string | null = null): LibraryItem => ({ asset: a, jenis, createdAt: '2026-10-24T00:00:00Z', snippet })

let rows: LibraryItem[]
let ingestCb: ((e: IngestEvent) => void) | null
const query = vi.fn(async (q: LibraryQuery) => {
  const off = q.offset ?? 0
  return { items: rows.slice(off, off + (q.limit ?? 100)), total: rows.length }
})
const tags = vi.fn(async () => [{ tag: 'jenis:dokumen', count: 2 }, { tag: 'status:final', count: 1 }])

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  rows = [
    item(asset('a1', 'laporan.pdf')),
    item(asset('a2', 'foto.png', { previewUrl: 'alfonso-vault://thumbs/a2.webp', mime: 'image/png' }), 'gambar'),
    item(asset('a3', 'rusak.pdf', { status: 'gagal', error: 'PDF rusak' })),
    item(asset('a4', 'baru.docx', { status: 'memproses' }))
  ]
  ingestCb = null
  ;(window as any).alfonso = {
    library: { query, tags },
    ingest: { onEvent: (cb: (e: IngestEvent) => void) => { ingestCb = cb; return () => { ingestCb = null } } }
  }
  workspace.reset()
  workspace.setActiveBoard('b1', 'p1')
})
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.useRealTimers() })

const lastQuery = (): LibraryQuery => query.mock.calls.at(-1)![0]

test('menampilkan aset, jumlah, thumbnail, dan status memproses/gagal', async () => {
  render(<LibraryPanel />)
  expect(await screen.findByText('laporan.pdf')).toBeTruthy()
  expect(screen.getByText('4 aset')).toBeTruthy()
  expect((screen.getByRole('img', { name: 'foto.png' }) as HTMLImageElement).getAttribute('src')).toBe('alfonso-vault://thumbs/a2.webp')
  expect(screen.getByText('Gagal ekstrak')).toBeTruthy()
  expect(screen.getByText('Memproses…')).toBeTruthy()
  expect(lastQuery()).toMatchObject({ sort: 'terbaru', scope: 'semua', offset: 0 })
})

test('kotak cari memakai jeda 150 ms', async () => {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  render(<LibraryPanel />)
  await screen.findByText('laporan.pdf')
  query.mockClear()
  await user.type(screen.getByLabelText('Cari di Library'), 'pidana')
  expect(query).not.toHaveBeenCalled()
  await act(async () => { vi.advanceTimersByTime(200) })
  await waitFor(() => expect(lastQuery().q).toBe('pidana'))
  expect(query).toHaveBeenCalledTimes(1)
})

test('chip jenis, status, cakupan, urutan, dan tag masuk ke kueri', async () => {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  render(<LibraryPanel />)
  await screen.findByText('laporan.pdf')
  await user.click(screen.getByRole('button', { name: 'Gambar' }))
  await user.click(screen.getByRole('button', { name: 'Video' }))
  expect(screen.getByRole('button', { name: 'Gambar' }).getAttribute('aria-pressed')).toBe('true')
  await user.click(screen.getByRole('button', { name: 'Gagal' }))
  await user.selectOptions(screen.getByLabelText('Cakupan'), 'proyek')
  await user.selectOptions(screen.getByLabelText('Urutkan'), 'ukuran')
  await user.selectOptions(await screen.findByLabelText('Saring tag'), 'status:final')
  await waitFor(() => expect(lastQuery()).toMatchObject({ jenis: ['gambar', 'video'], status: ['gagal'], scope: 'proyek', projectId: 'p1', sort: 'ukuran', tags: ['status:final'] }))
  await user.click(screen.getByRole('button', { name: 'Hapus tag status:final' }))
  await waitFor(() => expect(lastQuery().tags ?? []).toEqual([]))
})

test('keadaan kosong: Library kosong, dan tidak ada yang cocok + hapus filter', async () => {
  rows = []
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  render(<LibraryPanel />)
  expect(await screen.findByText(/Library masih kosong/)).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Gambar' }))
  expect(await screen.findByText('Tidak ada yang cocok')).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Hapus filter' }))
  await waitFor(() => expect(lastQuery().jenis ?? []).toEqual([]))
})

test('grid dan daftar bisa diganti', async () => {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  render(<LibraryPanel />)
  await screen.findByText('laporan.pdf')
  expect(screen.getByTestId('library-items').className).toContain('grid')
  await user.click(screen.getByRole('button', { name: 'Daftar' }))
  expect(screen.getByTestId('library-items').className).toContain('list')
})

test('klik item → Inspector memilih aset; item bisa diseret dengan id aset', async () => {
  render(<LibraryPanel />)
  const el = (await screen.findByText('laporan.pdf')).closest('[draggable="true"]') as HTMLElement
  fireEvent.click(el)
  expect(workspace.get().selection).toEqual({ kind: 'asset', assetId: 'a1' })
  const data: Record<string, string> = {}
  const dataTransfer = { setData: (k: string, v: string) => { data[k] = v }, effectAllowed: '' }
  fireEvent.dragStart(el, { dataTransfer })
  expect(data[ASSET_DRAG_TYPE]).toBe('a1')
  expect(dataTransfer.effectAllowed).toBe('copy')
})

test('event ingest dan perubahan Library memuat ulang daftar', async () => {
  render(<LibraryPanel />)
  await screen.findByText('laporan.pdf')
  rows = [item(asset('a9', 'dari-drop.txt')), ...rows]
  query.mockClear()
  act(() => ingestCb!({ asset: rows[0].asset, newCards: [] }))
  await act(async () => { vi.advanceTimersByTime(600) })
  expect(await screen.findByText('dari-drop.txt')).toBeTruthy()
  query.mockClear()
  act(() => workspace.bumpLibrary())
  await waitFor(() => expect(query).toHaveBeenCalled())
})

test('10.000 aset: hanya sebagian kecil yang dirender, halaman berikut dimuat saat digulir', async () => {
  rows = Array.from({ length: 10000 }, (_, i) => item(asset(`x${i}`, `berkas-${i}.pdf`)))
  render(<LibraryPanel />)
  expect(await screen.findByText('berkas-0.pdf')).toBeTruthy()
  expect(screen.getByText('10.000 aset')).toBeTruthy()
  expect(document.querySelectorAll('.library-item').length).toBeLessThan(100)
  const scroller = screen.getByTestId('library-scroll')
  Object.defineProperty(scroller, 'scrollTop', { value: 600 * 190, configurable: true })
  fireEvent.scroll(scroller)
  await waitFor(() => expect(query.mock.calls.some(([q]) => (q.offset ?? 0) > 0)).toBe(true))
  expect(document.querySelectorAll('.library-item').length).toBeLessThan(100)
})
