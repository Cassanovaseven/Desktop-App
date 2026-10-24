// @vitest-environment jsdom
import { test, expect, vi, afterEach } from 'vitest'
import type { CardDTO } from '../../src/shared/board-types'
import { cardToNode, nodeToCardPatch, linkToEdge, createSaveScheduler, FLOW_PROPS } from '../../src/renderer/board/mapping'

const card: CardDTO = { id: 'c1', boardId: 'b', type: 'catatan', x: 12.5, y: -40, w: 240, h: 160, z: 3, assetId: null, content: 'halo', style: null, asset: null }

afterEach(() => vi.useRealTimers())

test('cardToNode dan nodeToCardPatch bolak-balik tanpa kehilangan posisi dan ukuran', () => {
  const node = cardToNode(card)
  expect(node).toMatchObject({ id: 'c1', type: 'catatan', position: { x: 12.5, y: -40 }, style: { width: 240, height: 160 }, zIndex: 3 })
  expect(nodeToCardPatch(node)).toEqual({ id: 'c1', x: 12.5, y: -40, w: 240, h: 160 })
  expect(nodeToCardPatch({ ...node, position: { x: 1, y: 2 }, measured: { width: 300, height: 90 } })).toEqual({ id: 'c1', x: 1, y: 2, w: 300, h: 90 })
})
test('linkToEdge', () => {
  expect(linkToEdge({ id: 'l1', fromId: 'a', toId: 'b', kind: 'panah' })).toEqual({ id: 'l1', source: 'a', target: 'b' })
})
test('hanya merender elemen yang terlihat', () => { expect(FLOW_PROPS.onlyRenderVisibleElements).toBe(true) })
test('penyimpanan posisi dikumpulkan dengan debounce 2 detik, patch terakhir per kartu menang', () => {
  vi.useFakeTimers()
  const save = vi.fn()
  const s = createSaveScheduler(save, 2000)
  s.push({ id: 'a', x: 1, y: 1 }); s.push({ id: 'b', x: 5, y: 5 }); s.push({ id: 'a', x: 2, y: 2 })
  vi.advanceTimersByTime(1999); expect(save).not.toHaveBeenCalled()
  vi.advanceTimersByTime(1); expect(save).toHaveBeenCalledWith([{ id: 'a', x: 2, y: 2 }, { id: 'b', x: 5, y: 5 }])
})
test('flush menyimpan segera dan tidak menyimpan dua kali', () => {
  vi.useFakeTimers()
  const save = vi.fn(); const s = createSaveScheduler(save, 2000)
  s.push({ id: 'a', x: 1 }); s.flush(); vi.advanceTimersByTime(5000)
  expect(save).toHaveBeenCalledTimes(1)
  s.flush(); expect(save).toHaveBeenCalledTimes(1)
})

test('Fase 2: pilihan kartu → isi Inspector', async () => {
  const { selectionFromCards } = await import('../../src/renderer/board/mapping')
  const base = { boardId: 'b', x: 0, y: 0, w: 1, h: 1, z: 0, style: null }
  const file = { ...base, id: 'c1', type: 'file' as const, assetId: 'a1', content: null, asset: null }
  const nt = { ...base, id: 'c2', type: 'catatan' as const, assetId: null, content: 'halo', asset: null }
  expect(selectionFromCards([file], null)).toEqual({ kind: 'asset', assetId: 'a1', cardId: 'c1' })
  expect(selectionFromCards([nt], null)).toEqual({ kind: 'card', cardId: 'c2', type: 'catatan', content: 'halo' })
  expect(selectionFromCards([file, nt], null)).toEqual({ kind: 'cards', count: 2 })
  // Tidak ada kartu dipilih: pilihan dari Library dipertahankan, pilihan dari Board dikosongkan.
  expect(selectionFromCards([], { kind: 'asset', assetId: 'a9' })).toEqual({ kind: 'asset', assetId: 'a9' })
  expect(selectionFromCards([], { kind: 'asset', assetId: 'a1', cardId: 'c1' })).toBeNull()
  expect(selectionFromCards([], { kind: 'cards', count: 2 })).toBeNull()
})
