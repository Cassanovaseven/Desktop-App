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

// ---- Fase 2 ----
import { workspace } from '../../src/renderer/workspace'
import { ASSET_DRAG_TYPE } from '../../src/renderer/library/LibraryPanel'

function dropAsset(el: HTMLElement, assetId: string, x = 0, y = 0): void {
  const ev = createEvent.drop(el, { dataTransfer: { files: [], types: [ASSET_DRAG_TYPE], getData: (k: string) => (k === ASSET_DRAG_TYPE ? assetId : '') } })
  Object.defineProperty(ev, 'clientX', { value: x }); Object.defineProperty(ev, 'clientY', { value: y })
  fireEvent(el, ev)
}

test('Fase 2: aset dari Library di-drop → addAssetCard di titik drop, bukan dropFiles', async () => {
  workspace.reset()
  api.board.addAssetCard = vi.fn(async () => ({ ...note('k1'), type: 'file', assetId: 'a7', asset: { id: 'a7', originalName: 'dari-library.pdf', mime: null, sizeBytes: 1, status: 'siap', previewUrl: null, error: null, transkrip: null, meta: null } }))
  render(<Board />)
  dropAsset(await screen.findByTestId('board'), 'a7', 30, 40)
  await waitFor(() => expect(api.board.addAssetCard).toHaveBeenCalledWith('a7', { x: 30, y: 40 }))
  expect(api.ingest.dropFiles).not.toHaveBeenCalled()
  expect(await screen.findByText('dari-library.pdf')).toBeTruthy()
})

test('Fase 2: board mengikuti board aktif; viewport disimpan ke board-nya sendiri', async () => {
  workspace.reset()
  api.board.open.mockImplementation(async (id?: string) => ({ id: id ?? 'b1', projectId: 'p1', name: id === 'b2' ? 'Sketsa' : 'Board Utama', viewport: null, cards: id === 'b2' ? [note('n2', 'isi board dua')] : [], links: [] }))
  render(<Board />)
  await screen.findByTestId('board')
  expect(api.board.open).toHaveBeenCalledWith(undefined)
  expect(workspace.get()).toMatchObject({ activeBoardId: 'b1', activeProjectId: 'p1' })
  act(() => workspace.setActiveBoard('b2', 'p1'))
  expect(((await screen.findByLabelText('Isi catatan')) as HTMLTextAreaElement).value).toBe('isi board dua')
  expect(api.board.open).toHaveBeenLastCalledWith('b2')
})

test('Fase 2: menghapus kartu memberi tahu Library', async () => {
  workspace.reset()
  api.board.open.mockResolvedValue({ id: 'b1', projectId: 'p1', name: 'B', viewport: null, cards: [note('n1', 'x')], links: [] })
  render(<Board />)
  await screen.findByLabelText('Isi catatan')
  const before = workspace.get().libraryVersion
  act(() => boardController.removeCards(['n1']))
  await waitFor(() => expect(api.board.deleteCards).toHaveBeenCalledWith(['n1']))
  expect(workspace.get().libraryVersion).toBe(before + 1)
})
test('hasil generate: kartu untuk board lain tidak ditambahkan; kartu board ini ditambahkan', async () => {
  render(<Board />)
  await screen.findByTestId('board')
  act(() => emit({ asset: null, newCards: [{ ...note('x1', 'board lain'), boardId: 'lain' }] }))
  act(() => emit({ asset: null, newCards: [note('x2', 'board ini')], newLinks: [] }))
  expect(await screen.findByDisplayValue('board ini')).toBeTruthy()
  expect(screen.queryByDisplayValue('board lain')).toBeNull()
})
test('klik kanan kartu → "Generate dari ini" membuka Studio dengan kartu sebagai referensi', async () => {
  const { studioStore } = await import('../../src/renderer/studio/studio-store')
  const show = vi.fn()
  studioStore.reset()
  studioStore.setShowPanel(show)
  api.board.open.mockResolvedValueOnce({ id: 'b', name: 'Board Utama', viewport: null, cards: [note('n7', 'ide logo rubah')], links: [] })
  render(<Board />)
  const box = await screen.findByDisplayValue('ide logo rubah')
  fireEvent.contextMenu(box.closest('.react-flow__node')!)
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Generate dari ini' }))
  expect(show).toHaveBeenCalled()
  expect(studioStore.take()).toEqual({ sourceCardId: 'n7', sourceLabel: 'ide logo rubah', sourceText: 'ide logo rubah' })
  expect(screen.queryByRole('menu')).toBeNull()
})
test('catatan yang baru diedit → "Generate dari ini" memakai isi terbaru', async () => {
  const { studioStore } = await import('../../src/renderer/studio/studio-store')
  studioStore.reset()
  studioStore.setShowPanel(vi.fn())
  api.board.open.mockResolvedValueOnce({ id: 'b', name: 'Board Utama', viewport: null, cards: [note('n8', '')], links: [] })
  render(<Board />)
  const box = (await screen.findByLabelText('Isi catatan')) as HTMLTextAreaElement
  fireEvent.change(box, { target: { value: 'ide lencana tim' } })
  fireEvent.blur(box)
  fireEvent.contextMenu(box.closest('.react-flow__node')!)
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Generate dari ini' }))
  expect(studioStore.take()).toMatchObject({ sourceCardId: 'n8', sourceLabel: 'ide lencana tim', sourceText: 'ide lencana tim' })
})
