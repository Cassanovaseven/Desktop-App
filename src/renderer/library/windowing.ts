// Windowing grid/daftar Library: tinggi baris tetap, hanya baris yang terlihat (+ cadangan) yang dirender.

export const OVERSCAN_ROWS = 2

export function columnsFor(width: number, minItemWidth: number): number {
  return Math.max(1, Math.floor(width / minItemWidth))
}

export interface WindowInput { count: number; columns: number; rowHeight: number; scrollTop: number; viewportHeight: number }
export interface WindowRange { startIndex: number; endIndex: number; offsetTop: number; totalHeight: number }

export function visibleRange(w: WindowInput): WindowRange {
  const rows = Math.ceil(w.count / w.columns)
  const totalHeight = rows * w.rowHeight
  if (rows === 0) return { startIndex: 0, endIndex: 0, offsetTop: 0, totalHeight: 0 }
  const maxTop = Math.max(0, totalHeight - w.viewportHeight)
  const top = Math.min(Math.max(0, w.scrollTop), maxTop)
  const firstRow = Math.max(0, Math.floor(top / w.rowHeight) - OVERSCAN_ROWS)
  const lastRow = Math.min(rows, Math.ceil((top + w.viewportHeight) / w.rowHeight) + OVERSCAN_ROWS)
  return {
    startIndex: firstRow * w.columns,
    endIndex: Math.min(w.count, lastRow * w.columns),
    offsetTop: firstRow * w.rowHeight,
    totalHeight
  }
}
