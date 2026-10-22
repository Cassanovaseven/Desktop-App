// @vitest-environment jsdom
import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import type { AssetDTO, CardDTO } from '../../src/shared/board-types'
import { mockReactFlow } from './setup-reactflow'
import { CardBody } from '../../src/renderer/board/cards/CardBody'

mockReactFlow()
const retry = vi.fn(async () => {})
const saveCards = vi.fn(async () => {})
beforeEach(() => { (window as any).alfonso = { ingest: { retry }, board: { saveCards } } })
afterEach(() => { cleanup(); retry.mockClear(); saveCards.mockClear() })

const asset = (p: Partial<AssetDTO>): AssetDTO => ({ id: 'a1', originalName: 'laporan.pdf', mime: 'application/pdf', sizeBytes: 2048, status: 'siap', previewUrl: null, error: null, ...p })
const card = (p: Partial<CardDTO>): CardDTO => ({ id: 'c1', boardId: 'b', type: 'file', x: 0, y: 0, w: 240, h: 120, z: 0, assetId: 'a1', content: null, style: null, asset: asset({}), ...p })
const show = (c: CardDTO) => render(<ReactFlowProvider><CardBody card={c} /></ReactFlowProvider>)

test('kartu memproses menampilkan "Memproses…"', () => {
  show(card({ asset: asset({ status: 'memproses' }) }))
  expect(screen.getByText('Memproses…')).toBeTruthy(); expect(screen.getByText('laporan.pdf')).toBeTruthy()
})
test('kartu gagal menampilkan pesan dan tombol Coba lagi yang memanggil ingest.retry', () => {
  show(card({ asset: asset({ status: 'gagal', error: 'PDF rusak atau terenkripsi' }) }))
  expect(screen.getByText('Gagal ekstrak')).toBeTruthy(); expect(screen.getByText('PDF rusak atau terenkripsi')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }))
  expect(retry).toHaveBeenCalledWith('a1')
})
test('kartu gambar memakai alfonso-vault://, bukan file://', () => {
  show(card({ type: 'gambar', asset: asset({ originalName: 'foto.png', mime: 'image/png', previewUrl: 'alfonso-vault://thumbs/a1.webp' }) }))
  const img = screen.getByRole('img', { name: 'foto.png' }) as HTMLImageElement
  expect(img.getAttribute('src')).toBe('alfonso-vault://thumbs/a1.webp')
})
test('kartu catatan bisa disunting dan disimpan saat blur', () => {
  show(card({ type: 'catatan', assetId: null, asset: null, content: 'awal' }))
  const box = screen.getByLabelText('Isi catatan') as HTMLTextAreaElement
  expect(box.value).toBe('awal')
  fireEvent.change(box, { target: { value: 'baru' } }); fireEvent.blur(box)
  expect(saveCards).toHaveBeenCalledWith([{ id: 'c1', content: 'baru' }])
})
test('kartu tautan menampilkan URL', () => {
  show(card({ type: 'tautan', assetId: null, asset: null, content: 'https://contoh.id/a' }))
  expect(screen.getByText('https://contoh.id/a')).toBeTruthy()
})
test('kartu grup ZIP menampilkan nama arsip', () => {
  show(card({ type: 'grup', w: 600, h: 400, asset: asset({ originalName: 'arsip.zip', mime: 'application/zip' }) }))
  expect(screen.getByText('arsip.zip')).toBeTruthy()
})
