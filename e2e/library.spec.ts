import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'fs'
import path from 'path'
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

function filesInVault(): string[] {
  const root = path.join(dirs.vault, 'files')
  if (!fs.existsSync(root)) return []
  return fs.readdirSync(root, { recursive: true, withFileTypes: true }).filter((d) => d.isFile()).map((d) => d.name)
}

const tab = (win: Page, name: string) => win.locator('.dv-tab', { hasText: name }).first()
const node = (win: Page, name: string) => win.locator('.react-flow__node', { hasText: name }).first()
const libraryItem = (win: Page, name: string) => win.locator('.library-item', { hasText: name }).first()

test('proyek baru, Library, tag, seret ke board lain tanpa menyalin file, Inspector "Dipakai di"', async () => {
  const app = await launch(dirs, { ALFONSO_E2E: '1' })
  const win = await ready(app)

  // Proyek baru → langsung terbuka di Board.
  await tab(win, 'Proyek').click()
  await win.getByRole('button', { name: 'Proyek baru' }).click()
  await win.getByLabel('Nama proyek baru').fill('Riset Hukum')
  await win.getByLabel('Nama proyek baru').press('Enter')
  await expect(win.getByText('Riset Hukum')).toBeVisible()
  await expect(win.locator('.tree-board.active')).toHaveCount(1)

  await importPaths(app, [fixture('Laporan Riset.pdf')], { x: 40, y: 40 })
  await expect(node(win, 'Laporan Riset.pdf')).toBeVisible()
  await expect(win.getByText('Memproses…')).toHaveCount(0, { timeout: 20000 })
  expect(filesInVault()).toHaveLength(1)

  // Library: muncul, bisa disaring.
  await tab(win, 'Library').click()
  await expect(libraryItem(win, 'Laporan Riset.pdf')).toBeVisible()
  await win.getByRole('button', { name: 'Gambar' }).click()
  await expect(win.getByText('Tidak ada yang cocok')).toBeVisible()
  await win.getByRole('button', { name: 'Gambar' }).click()
  await win.getByRole('button', { name: 'Dokumen' }).click()
  await expect(libraryItem(win, 'Laporan Riset.pdf')).toBeVisible()

  // Inspector: tag baru langsung bisa dicari.
  await libraryItem(win, 'Laporan Riset.pdf').click()
  await expect(win.getByRole('heading', { name: 'Laporan Riset.pdf' })).toBeVisible()
  await win.getByLabel('Tambah tag').fill('status:pilihan')
  await win.getByLabel('Tambah tag').press('Enter')
  await expect(win.locator('.tag-list').getByText('status:pilihan')).toBeVisible()
  await win.getByLabel('Cari di Library').fill('pilihan')
  await expect(win.getByText('1 aset')).toBeVisible()
  await win.getByLabel('Cari di Library').fill('')

  // Pindah ke board proyek pertama (kosong), lalu seret aset dari Library ke sana.
  await tab(win, 'Proyek').click()
  await win.locator('.tree li', { hasText: 'Proyek Pertama' }).getByRole('button', { name: 'Board Utama' }).click()
  await expect(win.getByText(/Drop file ke sini/)).toBeVisible()
  await tab(win, 'Library').click()
  await libraryItem(win, 'Laporan Riset.pdf').dragTo(win.getByTestId('board'))
  await expect(node(win, 'Laporan Riset.pdf')).toBeVisible()
  expect(filesInVault()).toHaveLength(1)

  // Inspector menunjukkan dua board; klik → kembali ke board Riset Hukum.
  await libraryItem(win, 'Laporan Riset.pdf').click()
  await expect(win.locator('.inspector-usages li')).toHaveCount(2)
  await win.getByRole('button', { name: /Riset Hukum › Board Utama/ }).click()
  await tab(win, 'Proyek').click()
  await expect(win.locator('.tree li', { hasText: 'Riset Hukum' }).locator('.tree-board.active')).toHaveCount(1)

  // Hapus kartu → aset tetap ada di Library, dengan cakupan "belum dipakai" setelah semua kartunya hilang.
  await node(win, 'Laporan Riset.pdf').click()
  await win.keyboard.press('Backspace')
  await expect(node(win, 'Laporan Riset.pdf')).toHaveCount(0)
  await tab(win, 'Library').click()
  await win.getByLabel('Cakupan').selectOption('proyek')
  await expect(win.getByText('Tidak ada yang cocok')).toBeVisible()
  await win.getByLabel('Cakupan').selectOption('semua')
  await expect(libraryItem(win, 'Laporan Riset.pdf')).toBeVisible()
  expect(filesInVault()).toHaveLength(1)
  await app.close()
})
