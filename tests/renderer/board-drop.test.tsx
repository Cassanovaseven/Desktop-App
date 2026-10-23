// @vitest-environment jsdom
import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, createEvent, waitFor, act } from '@testing-library/react'
import type { CardDTO, IngestEvent } from '../../src/shared/board-types'
import { mockReactFlow } from './setup-reactflow'
import { Board, boardController } from '../../src/renderer/board/Board'

mockReactFlow()
const note = (id: string, content = ''): CardDTO => ({ id, boardId: 'b', type: 'catatan', x: 0, y: 0, w: 240, h: 160, z: 0, assetId: null, content, style: null, asset: null })
let api: any
let emit: (e: IngestEvent) => void
beforeEach(() => {
  api = {
    board: {
      open: vi.fn(async () => ({ id: 'b', name: 'Board Utama', viewport: null, cards: [], links: [] })),
      saveCards: vi.fn(async () => {}), createNote: vi.fn(async () => note('n1', 'baru')), deleteCards: vi.fn(), link: vi.fn(), unlink: vi.fn(), saveViewport: vi.fn()
    },
    ingest: {
      dropFiles: vi.fn(async () => [{ ...note('f1'), type: 'file', assetId: 'a1', asset: { id: 'a1', originalName: 'laporan.pdf', mime: null, sizeBytes: 1, status: 'memproses', previewUrl: null, error: null, transkrip: null, meta: null } }]),
      pasteText: vi.fn(async () => ({ ...note('t1'), type: 'tautan', content: 'https://contoh.id' })),
      pasteImage: vi.fn(async () => [{ ...note('g1'), type: 'gambar', assetId: 'a2', asset: { id: 'a2', originalName: 'tempel-20261023-101500.png', mime: 'image/png', sizeBytes: 3, status: 'memproses', previewUrl: null, error: null, transkrip: null, meta: null } }]),
      retry: vi.fn(),
      onEvent: vi.fn((cb) => { emit = cb; return () => {} })
    }
  }
  ;(window as any).alfonso = api
})
afterEach(() => cleanup())

// jsdom tidak mengisi clientX/clientY dari init DragEvent, jadi diisi manual.
function drop(el: HTMLElement, files: File[], x = 0, y = 0): void {
  const ev = createEvent.drop(el, { dataTransfer: { files } })
  Object.defineProperty(ev, 'clientX', { value: x }); Object.defineProperty(ev, 'clientY', { value: y })
  fireEvent(el, ev)
}

test('board kosong menampilkan petunjuk', async () => {
  render(<Board />)
  expect(await screen.findByText(/Drop file ke sini/)).toBeTruthy()
})
test('drop file memanggil ingest.dropFiles dengan posisi kanvas lalu kartu muncul', async () => {
  render(<Board />)
  const board = await screen.findByTestId('board')
  const file = new File(['x'], 'laporan.pdf', { type: 'application/pdf' })
  drop(board, [file], 100, 50)
  await waitFor(() => expect(api.ingest.dropFiles).toHaveBeenCalledWith([file], { x: 100, y: 50 }))
  expect(await screen.findByText('laporan.pdf')).toBeTruthy()
  expect(screen.getByText('Memproses…')).toBeTruthy()
})
test('event ingest memperbarui status kartu', async () => {
  render(<Board />)
  const board = await screen.findByTestId('board')
  drop(board, [new File(['x'], 'laporan.pdf')])
  await screen.findByText('Memproses…')
  act(() => emit({ asset: { id: 'a1', originalName: 'laporan.pdf', mime: null, sizeBytes: 1, status: 'gagal', previewUrl: null, error: 'PDF rusak atau terenkripsi', transkrip: null, meta: null }, newCards: [] }))
  expect(await screen.findByText('Gagal ekstrak')).toBeTruthy()
})
test('drop gagal menampilkan pesan', async () => {
  api.ingest.dropFiles.mockRejectedValueOnce(new Error('Folder belum didukung, drop file-nya saja.'))
  render(<Board />)
  drop(await screen.findByTestId('board'), [new File(['x'], 'f')])
  expect(await screen.findByText('Folder belum didukung, drop file-nya saja.')).toBeTruthy()
})
test('paste teks di luar kotak input membuat kartu lewat ingest.pasteText', async () => {
  render(<Board />)
  await screen.findByTestId('board')
  const ev = new Event('paste', { bubbles: true, cancelable: true }) as any
  ev.clipboardData = { getData: () => 'https://contoh.id' }
  act(() => { window.dispatchEvent(ev) })
  await waitFor(() => expect(api.ingest.pasteText).toHaveBeenCalledWith('https://contoh.id', expect.objectContaining({ x: expect.any(Number) })))
  expect(await screen.findByText('https://contoh.id')).toBeTruthy()
})
test('Tambah catatan lewat pengendali Board', async () => {
  render(<Board />)
  await screen.findByTestId('board')
  act(() => boardController.addNote())
  await waitFor(() => expect(api.board.createNote).toHaveBeenCalled())
  expect(((await screen.findByLabelText('Isi catatan')) as HTMLTextAreaElement).value).toBe('baru')
})
test('kartu dari event dan dari hasil drop tidak digandakan', async () => {
  render(<Board />)
  const board = await screen.findByTestId('board')
  const created = (await api.ingest.dropFiles())[0]
  act(() => emit({ asset: created.asset, newCards: [created] }))
  drop(board, [new File(['x'], 'laporan.pdf')])
  await waitFor(() => expect(api.ingest.dropFiles).toHaveBeenCalledTimes(2))
  await screen.findByText('laporan.pdf')
  expect(screen.getAllByText('laporan.pdf')).toHaveLength(1)
})
test('kartu tautan diperbarui setelah isinya diunduh, lalu status ekstraksi mengikuti', async () => {
  const link = { ...note('t1'), type: 'tautan' as const, content: 'https://contoh.id/artikel' }
  api.board.open.mockResolvedValue({ id: 'b', name: 'Board Utama', viewport: null, cards: [link], links: [] })
  render(<Board />)
  await screen.findByText('https://contoh.id/artikel')
  const asset = { id: 'a9', originalName: 'Putusan MA.html', mime: 'text/html', sizeBytes: 10, status: 'memproses' as const, previewUrl: null, error: null, transkrip: null, meta: null }
  act(() => emit({ asset, newCards: [], updatedCards: [{ ...link, assetId: 'a9', asset }] }))
  expect(await screen.findByText('Putusan MA.html')).toBeTruthy()
  expect(screen.getByText('Memproses…')).toBeTruthy()
  act(() => emit({ asset: { ...asset, status: 'siap' }, newCards: [] }))
  await waitFor(() => expect(screen.queryByText('Memproses…')).toBeNull())
  expect(screen.getByText('https://contoh.id/artikel')).toBeTruthy()
})
test('unduhan URL gagal ditampilkan di kartu tautan', async () => {
  const link = { ...note('t1'), type: 'tautan' as const, content: 'https://contoh.id/hilang' }
  api.board.open.mockResolvedValue({ id: 'b', name: 'Board Utama', viewport: null, cards: [link], links: [] })
  render(<Board />)
  await screen.findByText('https://contoh.id/hilang')
  act(() => emit({ asset: null, newCards: [], updatedCards: [{ ...link, style: { unduh: 'gagal', pesan: 'Server menjawab 404.' } }] }))
  expect(await screen.findByText('Isi tidak bisa diunduh: Server menjawab 404.')).toBeTruthy()
})
test('paste gambar (screenshot) dikirim sebagai byte lewat ingest.pasteImage', async () => {
  render(<Board />)
  await screen.findByTestId('board')
  const img = new File([new Uint8Array([137, 80, 78])], 'image.png', { type: 'image/png' })
  const ev = new Event('paste', { bubbles: true, cancelable: true }) as any
  ev.clipboardData = { files: [img], getData: () => '' }
  act(() => { window.dispatchEvent(ev) })
  await waitFor(() => expect(api.ingest.pasteImage).toHaveBeenCalled())
  const [bytes, mime, at] = api.ingest.pasteImage.mock.calls[0]
  expect(new Uint8Array(bytes)).toEqual(new Uint8Array([137, 80, 78]))
  expect(mime).toBe('image/png'); expect(at).toEqual(expect.objectContaining({ x: expect.any(Number) }))
  expect(await screen.findByText('tempel-20261023-101500.png')).toBeTruthy()
  expect(api.ingest.pasteText).not.toHaveBeenCalled()
})
test('paste file bukan gambar tidak dikirim; teksnya tetap dipakai bila ada', async () => {
  render(<Board />)
  await screen.findByTestId('board')
  const ev = new Event('paste', { bubbles: true, cancelable: true }) as any
  ev.clipboardData = { files: [new File(['x'], 'a.pdf', { type: 'application/pdf' })], getData: () => 'catatan' }
  act(() => { window.dispatchEvent(ev) })
  await waitFor(() => expect(api.ingest.pasteText).toHaveBeenCalledWith('catatan', expect.anything()))
  expect(api.ingest.pasteImage).not.toHaveBeenCalled()
})
