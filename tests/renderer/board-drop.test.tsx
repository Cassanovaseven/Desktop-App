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
      dropFiles: vi.fn(async () => [{ ...note('f1'), type: 'file', assetId: 'a1', asset: { id: 'a1', originalName: 'laporan.pdf', mime: null, sizeBytes: 1, status: 'memproses', previewUrl: null, error: null } }]),
      pasteText: vi.fn(async () => ({ ...note('t1'), type: 'tautan', content: 'https://contoh.id' })),
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
  act(() => emit({ asset: { id: 'a1', originalName: 'laporan.pdf', mime: null, sizeBytes: 1, status: 'gagal', previewUrl: null, error: 'PDF rusak atau terenkripsi' }, newCards: [] }))
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
