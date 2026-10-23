import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'fs'
import { makeDirs, launch, fixture, type E2EDirs, type AlfonsoTestHook } from './helpers'

let dirs: E2EDirs
test.beforeEach(() => { dirs = makeDirs() })
test.afterEach(() => { fs.rmSync(dirs.base, { recursive: true, force: true }) })

async function ready(app: ElectronApplication): Promise<Page> {
  const win = await app.firstWindow()
  await expect(win.getByText(/Sidecar: siap/)).toBeVisible({ timeout: 20000 })
  return win
}

function importPaths(app: ElectronApplication, paths: string[], at: { x: number; y: number }): Promise<unknown> {
  return app.evaluate(
    (_e, a) => (globalThis as unknown as { __alfonsoTest: AlfonsoTestHook }).__alfonsoTest.importPaths(a.paths, a.at),
    { paths, at }
  )
}

const node = (win: Page, name: string) => win.locator('.react-flow__node', { hasText: name }).first()

test('kait tes tidak ada tanpa ALFONSO_E2E', async () => {
  const app = await launch(dirs)
  const win = await ready(app)
  expect(await app.evaluate(() => typeof (globalThis as Record<string, unknown>).__alfonsoTest)).toBe('undefined')
  expect(await win.evaluate(() => typeof (globalThis as Record<string, unknown>).__alfonsoTest)).toBe('undefined')
  await app.close()
})

test('impor PDF, PNG, ZIP: kartu, ekstraksi, pencarian, grup, posisi tersimpan', async () => {
  const app = await launch(dirs, { ALFONSO_E2E: '1' })
  const win = await ready(app)

  const t0 = Date.now()
  await importPaths(app, [fixture('Laporan Riset.pdf'), fixture('foto.png')], { x: 40, y: 40 })
  await expect(node(win, 'Laporan Riset.pdf')).toBeVisible()
  expect(Date.now() - t0).toBeLessThan(1000)
  await importPaths(app, [fixture('arsip.zip')], { x: 40, y: 280 })

  // Semua kartu selesai diproses (termasuk isi ZIP).
  await expect(node(win, 'catatan.txt')).toBeVisible({ timeout: 20000 })
  await expect(node(win, 'kode.py')).toBeVisible()
  await expect(win.getByText('Memproses…')).toHaveCount(0, { timeout: 20000 })
  await expect(win.getByText('Gagal ekstrak')).toHaveCount(0)

  // ZIP menjadi kartu grup yang membingkai isinya.
  const grup = await node(win, 'arsip.zip').boundingBox()
  const anak = await node(win, 'catatan.txt').boundingBox()
  expect(grup && anak).toBeTruthy()
  expect(anak!.x).toBeGreaterThanOrEqual(grup!.x)
  expect(anak!.y).toBeGreaterThanOrEqual(grup!.y)
  expect(anak!.x + anak!.width).toBeLessThanOrEqual(grup!.x + grup!.width + 1)
  expect(anak!.y + anak!.height).toBeLessThanOrEqual(grup!.y + grup!.height + 1)

  // Thumbnail PNG tampil lewat alfonso-vault://.
  const img = node(win, 'foto.png').locator('img.card-image')
  await expect(img).toHaveAttribute('src', /^alfonso-vault:\/\//)
  await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)

  // Ctrl+K → Cari isi file… menemukan kata dari dalam PDF.
  await win.keyboard.press('Control+K')
  await win.getByLabel('Cari perintah').fill('cari isi')
  await win.keyboard.press('Enter')
  await win.getByLabel('Cari isi file').fill('pidana')
  await expect(win.locator('.palette-list')).toContainText('Laporan Riset.pdf')
  await expect(win.locator('.search-snippet').first()).toContainText('pidana')
  await win.keyboard.press('Escape')

  // Geser kartu PDF, tunggu simpan otomatis (2 s), tutup, buka ulang.
  const pdf = node(win, 'Laporan Riset.pdf')
  const awal = await pdf.evaluate((el) => (el as HTMLElement).style.transform)
  const box = (await pdf.locator('.card-title').boundingBox())!
  await win.mouse.move(box.x + 10, box.y + 5)
  await win.mouse.down()
  await win.mouse.move(box.x + 60, box.y + 45, { steps: 8 })
  await win.mouse.up()
  const posisi = await pdf.evaluate((el) => (el as HTMLElement).style.transform)
  expect(posisi).not.toBe(awal)
  await win.waitForTimeout(2500)
  await app.close()

  const app2 = await launch(dirs, { ALFONSO_E2E: '1' })
  const win2 = await ready(app2)
  await expect(node(win2, 'Laporan Riset.pdf')).toBeVisible()
  expect(await node(win2, 'Laporan Riset.pdf').evaluate((el) => (el as HTMLElement).style.transform)).toBe(posisi)
  await expect(node(win2, 'foto.png')).toBeVisible()
  await app2.close()
})
