import { test, expect } from '@playwright/test'
import fs from 'fs'
import { makeDirs, launch, type E2EDirs, type AlfonsoTestHook } from './helpers'

let dirs: E2EDirs
test.beforeEach(() => { dirs = makeDirs() })
test.afterEach(() => { fs.rmSync(dirs.base, { recursive: true, force: true }) })

const pct = (sorted: number[], p: number): number => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]

// Angka dari container hanya indikasi; angka penentu diukur di laptop target (uji manual).
test('Library 10.000 aset: gulir tetap lancar', async () => {
  test.setTimeout(120_000)
  const app = await launch(dirs, { ALFONSO_E2E: '1' })
  const win = await app.firstWindow()
  await expect(win.getByTestId('board')).toBeVisible({ timeout: 20000 })
  await app.evaluate(() => (globalThis as unknown as { __alfonsoTest: AlfonsoTestHook }).__alfonsoTest.fillLibrary(10000))
  await win.reload()
  await win.locator('.dv-tab', { hasText: 'Library' }).first().click()
  await expect(win.getByText('10.000 aset')).toBeVisible({ timeout: 20000 })

  const { frames, maxItems, reachedEnd } = await win.evaluate(
    () =>
      new Promise<{ frames: number[]; maxItems: number; reachedEnd: boolean }>((resolve) => {
        const scroller = document.querySelector('[data-testid="library-scroll"]') as HTMLElement
        const frames: number[] = []
        let maxItems = 0
        let last = performance.now()
        const t0 = last
        const tick = (t: number): void => {
          frames.push(t - last)
          last = t
          // Gulir cepat ke bawah selama 4 detik, lalu lompat ke ujung.
          scroller.scrollTop += 400
          maxItems = Math.max(maxItems, document.querySelectorAll('.library-item').length)
          if (t - t0 < 4000) requestAnimationFrame(tick)
          else {
            scroller.scrollTop = scroller.scrollHeight
            setTimeout(() => resolve({ frames: frames.slice(1), maxItems, reachedEnd: scroller.scrollTop > 0 }), 500)
          }
        }
        requestAnimationFrame(tick)
      })
  )
  // Item terakhir termuat (halaman terakhir diminta saat sampai di ujung).
  await expect(win.locator('.library-item', { hasText: 'gambar-0.png' }).first()).toBeVisible({ timeout: 10000 })
  const sorted = [...frames].sort((a, b) => a - b)
  const median = pct(sorted, 0.5)
  const p95 = pct(sorted, 0.95)
  console.log(`frame: ${frames.length}, median ${median.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms, item di DOM paling banyak ${maxItems}`)
  await app.close()

  expect(reachedEnd).toBe(true)
  expect(maxItems).toBeLessThan(200)
  expect(median).toBeLessThanOrEqual(16.7)
  expect(p95).toBeLessThanOrEqual(33)
})
