import { test, expect } from '@playwright/test'
import fs from 'fs'
import { makeDirs, launch, type E2EDirs, type AlfonsoTestHook } from './helpers'

let dirs: E2EDirs
test.beforeEach(() => { dirs = makeDirs() })
test.afterEach(() => { fs.rmSync(dirs.base, { recursive: true, force: true }) })

const pct = (sorted: number[], p: number): number => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]

// Angka dari container hanya indikasi; angka penentu diukur di laptop target (uji manual).
test('Board 5.000 kartu: pan dan zoom tetap lancar', async () => {
  test.setTimeout(120_000)
  const app = await launch(dirs, { ALFONSO_E2E: '1' })
  const win = await app.firstWindow()
  await expect(win.getByTestId('board')).toBeVisible({ timeout: 20000 })
  await app.evaluate(() => (globalThis as unknown as { __alfonsoTest: AlfonsoTestHook }).__alfonsoTest.fillBoard(5000))
  await win.reload()
  await expect(win.locator('.react-flow__node').first()).toBeVisible({ timeout: 20000 })

  // Pan dan zoom terprogram selama 5 detik: event dikirim langsung ke panel React Flow
  // (titik mana pun di layar tertutup kartu catatan, yang sengaja menolak drag/roda).
  // Waktu frame direkam dengan requestAnimationFrame pada saat yang sama.
  const { frames, maxVisible, zooms } = await win.evaluate(
    () =>
      new Promise<{ frames: number[]; maxVisible: number; zooms: number[] }>((resolve) => {
        const pane = document.querySelector('.react-flow__pane') as HTMLElement
        const r = pane.getBoundingClientRect()
        const cx = r.left + r.width / 2
        const cy = r.top + r.height / 2
        const mouse = (target: EventTarget, type: string, x: number, y: number): void => {
          target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, button: 0, buttons: type === 'mouseup' ? 0 : 1, clientX: x, clientY: y }))
        }
        const wheel = (dy: number): void => {
          pane.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, view: window, deltaY: dy, deltaMode: 0, clientX: cx, clientY: cy }))
        }
        // Mulai dari tampilan jauh supaya ratusan kartu terlihat sekaligus (kasus terberat).
        for (let i = 0; i < 6; i++) wheel(200)
        const frames: number[] = []
        let maxVisible = 0
        const zooms: number[] = []
        const vp = document.querySelector('.react-flow__viewport') as HTMLElement
        let last = performance.now()
        const t0 = last
        let step = 0
        let dragging = false
        const tick = (t: number): void => {
          frames.push(t - last)
          last = t
          const phase = Math.floor(step / 30) % 4
          const k = step % 30
          if (phase === 0 || phase === 2) {
            // Pan: seret latar 30 frame ke satu arah.
            const dir = phase === 0 ? 1 : -1
            if (k === 0) { mouse(pane, 'mousedown', cx, cy); dragging = true }
            mouse(window, 'mousemove', cx - k * 10 * dir, cy - k * 5 * dir)
            if (k === 29) { mouse(window, 'mouseup', cx - k * 10 * dir, cy - k * 5 * dir); dragging = false }
          } else {
            // Zoom: masuk lalu keluar.
            wheel(phase === 1 ? -40 : 40)
          }
          if (k === 15) {
            maxVisible = Math.max(maxVisible, document.querySelectorAll('.react-flow__node').length)
            zooms.push(Number(/scale\(([\d.]+)\)/.exec(vp.style.transform)?.[1] ?? 1))
          }
          step++
          if (t - t0 < 5000) requestAnimationFrame(tick)
          else {
            if (dragging) mouse(window, 'mouseup', cx, cy)
            resolve({ frames: frames.slice(1), maxVisible, zooms })
          }
        }
        requestAnimationFrame(tick)
      })
  )
  const viewport = await win.locator('.react-flow__viewport').evaluate((e) => (e as HTMLElement).style.transform)
  const sorted = [...frames].sort((a, b) => a - b)
  const median = pct(sorted, 0.5)
  const p95 = pct(sorted, 0.95)
  console.log(`frame: ${frames.length}, median ${median.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms, node di DOM paling banyak ${maxVisible}, zoom ${Math.min(...zooms).toFixed(2)}–${Math.max(...zooms).toFixed(2)}`)
  await app.close()

  // Virtualisasi: hanya kartu yang terlihat dirender, tapi tampilan jauh memang memuat banyak kartu.
  expect(viewport).not.toBe('translate(0px, 0px) scale(1)')
  expect(Math.min(...zooms)).toBeLessThan(0.5)
  expect(maxVisible).toBeGreaterThan(100)
  expect(maxVisible).toBeLessThan(5000)
  expect(median).toBeLessThanOrEqual(16.7)
  expect(p95).toBeLessThanOrEqual(33)
})
