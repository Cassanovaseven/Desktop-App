import { test, expect } from 'vitest'
import { columnsFor, visibleRange } from '../../src/renderer/library/windowing'

test('jumlah kolom mengikuti lebar, minimal 1', () => {
  expect(columnsFor(0, 140)).toBe(1)
  expect(columnsFor(139, 140)).toBe(1)
  expect(columnsFor(560, 140)).toBe(4)
  expect(columnsFor(700, 140)).toBe(5)
})

test('10.000 item: hanya baris terlihat + cadangan yang dirender', () => {
  const r = visibleRange({ count: 10000, columns: 4, rowHeight: 100, scrollTop: 0, viewportHeight: 500 })
  expect(r).toEqual({ startIndex: 0, endIndex: 28, offsetTop: 0, totalHeight: 250000 })
  const mid = visibleRange({ count: 10000, columns: 4, rowHeight: 100, scrollTop: 100000, viewportHeight: 500 })
  // Baris 1000 terlihat paling atas; 2 baris cadangan di atas dan di bawah.
  expect(mid).toEqual({ startIndex: 998 * 4, endIndex: 1007 * 4, offsetTop: 99800, totalHeight: 250000 })
  expect(mid.endIndex - mid.startIndex).toBeLessThan(60)
})

test('ujung daftar dan daftar kosong', () => {
  expect(visibleRange({ count: 10, columns: 4, rowHeight: 100, scrollTop: 10000, viewportHeight: 500 })).toEqual({ startIndex: 0, endIndex: 10, offsetTop: 0, totalHeight: 300 })
  expect(visibleRange({ count: 0, columns: 3, rowHeight: 100, scrollTop: 0, viewportHeight: 500 })).toEqual({ startIndex: 0, endIndex: 0, offsetTop: 0, totalHeight: 0 })
})

test('lebar berubah (kolom lain) → indeks tetap konsisten', () => {
  const r = visibleRange({ count: 1000, columns: 1, rowHeight: 40, scrollTop: 4000, viewportHeight: 400 })
  expect(r).toEqual({ startIndex: 98, endIndex: 112, offsetTop: 98 * 40, totalHeight: 40000 })
})
