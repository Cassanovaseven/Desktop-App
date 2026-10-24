import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'fs'
import http from 'http'
import type { AddressInfo } from 'net'
import path from 'path'
import { makeDirs, launch, fixture, type E2EDirs } from './helpers'

let dirs: E2EDirs
test.beforeEach(() => { dirs = makeDirs() })
test.afterEach(() => { fs.rmSync(dirs.base, { recursive: true, force: true }) })

async function ready(app: ElectronApplication): Promise<Page> {
  const win = await app.firstWindow()
  await expect(win.getByText(/Sidecar: siap/)).toBeVisible({ timeout: 20000 })
  return win
}

const tab = (win: Page, name: string) => win.locator('.dv-tab', { hasText: name }).first()
const node = (win: Page, text: string | RegExp) => win.locator('.react-flow__node', { hasText: text })
const studio = (win: Page) => win.locator('.studio-panel')

function generatedFiles(): string[] {
  const root = path.join(dirs.vault, 'generated')
  if (!fs.existsSync(root)) return []
  return fs.readdirSync(root, { recursive: true, withFileTypes: true }).filter((d) => d.isFile()).map((d) => d.name).sort()
}

async function command(win: Page, text: string): Promise<void> {
  await win.keyboard.press('Control+K')
  await win.getByLabel('Cari perintah').fill(text)
  await win.keyboard.press('Enter')
}

async function writePrompt(win: Page, p: { name: string; lane?: string; model?: string; template: string; params?: string }): Promise<void> {
  const s = studio(win)
  await s.getByRole('button', { name: 'Prompt baru' }).click()
  await s.getByLabel('Nama prompt').fill(p.name)
  if (p.lane) await s.getByLabel('Jalur').selectOption(p.lane)
  if (p.model) {
    const model = s.getByLabel('Model', { exact: true })
    if ((await model.evaluate((el) => el.tagName)) === 'SELECT') await model.selectOption(p.model)
    else await model.fill(p.model)
  }
  await s.getByLabel('Template').fill(p.template)
  if (p.params !== undefined) await s.getByLabel('Parameter').fill(p.params)
}

function listen(handler: http.RequestListener): Promise<{ server: http.Server; url: string }> {
  const server = http.createServer(handler)
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` })))
}

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40"><rect width="120" height="40" fill="#2a6"/><text x="10" y="26">[TEKS]</text></svg>'

test('jalur kode: SVG dari kartu sumber → kartu hasil + panah → asal-usul → Generate ulang', async () => {
  const app = await launch(dirs, { ALFONSO_E2E: '1' })
  const win = await ready(app)

  await command(win, 'tambah catatan')
  const note = win.getByLabel('Isi catatan').first()
  await note.fill('ide lencana tim')
  await note.blur()

  // Klik kanan kartu → Generate dari ini → Studio terbuka dengan referensi.
  await node(win, 'ide lencana tim').first().click({ button: 'right', position: { x: 20, y: 8 } })
  await win.getByRole('menuitem', { name: 'Generate dari ini' }).click()
  await expect(studio(win)).toBeVisible()
  await expect(studio(win).getByText('Referensi: ide lencana tim')).toBeVisible()

  await writePrompt(win, { name: 'Lencana Tim', template: SVG })
  await studio(win).getByLabel('Variabel TEKS').fill('Alfonso & Co')
  await studio(win).getByRole('button', { name: 'Generate' }).click()
  await expect(studio(win).getByRole('status')).toHaveText('Generate masuk antrean.')
  await expect(studio(win).locator('.studio-gen').first()).toContainText('Selesai', { timeout: 20000 })
  expect(generatedFiles()).toEqual([expect.stringMatching(/^proyek-pertama_gambar_lencana-tim_kode_\d{8}_001\.svg$/)])
  const svg = fs.readFileSync(path.join(dirs.vault, 'generated', fs.readdirSync(path.join(dirs.vault, 'generated'))[0], generatedFiles()[0]), 'utf8')
  expect(svg).toContain('Alfonso &amp; Co')

  // Board: kartu hasil di samping kartu sumber, dengan panah.
  await tab(win, 'Board').click()
  // Panel Board di jendela uji sempit; perkecil zoom supaya kartu di sebelah kanan ikut tergambar.
  await win.locator('.react-flow__pane').hover({ position: { x: 10, y: 10 } })
  await win.mouse.wheel(0, 400)
  const result = node(win, /lencana-tim_kode/).first()
  await expect(result).toBeVisible()
  await expect(win.locator('.react-flow__edge')).toHaveCount(1)
  const src = (await node(win, 'ide lencana tim').first().boundingBox())!
  const res = (await result.boundingBox())!
  expect(res.x).toBeGreaterThan(src.x + src.width - 1)

  // Inspector: asal-usul, lalu Generate ulang satu klik.
  await result.click()
  await expect(win.getByRole('heading', { name: 'Asal-usul' })).toBeVisible()
  await expect(win.getByText('Lencana Tim · versi 1')).toBeVisible()
  await expect(win.getByText('TEKS = Alfonso & Co')).toBeVisible()
  await win.getByRole('button', { name: 'Generate ulang' }).click()
  await expect(win.getByText('Generate ulang masuk antrean.')).toBeVisible()
  await expect(node(win, /lencana-tim_kode/)).toHaveCount(2, { timeout: 20000 })
  await expect(win.locator('.react-flow__edge')).toHaveCount(2)
  // Hasil identik → aset yang sama, tidak ada file baru.
  expect(generatedFiles()).toHaveLength(1)
  // Ekspor prompt untuk backup.
  expect(fs.readdirSync(path.join(dirs.vault, 'prompts'))).toHaveLength(1)
  await app.close()
})

test('jalur kode p5: video MP4 dan gambar PNG; sketsa yang mencoba internet gagal tanpa keluar', async () => {
  const app = await launch(dirs, { ALFONSO_E2E: '1' })
  const win = await ready(app)
  await tab(win, 'Studio').click()

  await writePrompt(win, {
    name: 'Splash',
    model: 'p5-motion',
    template: 'function setup() { createCanvas(64, 48) }\nfunction draw() { background((frameCount * 20) % 255, 80, 160); circle(frameCount * 5, 24, 10) }',
    params: 'durasi=0.5\nfps=12'
  })
  await studio(win).getByRole('button', { name: 'Generate' }).click()
  await expect(studio(win).locator('.studio-gen').first()).toContainText('Selesai', { timeout: 60000 })

  await writePrompt(win, { name: 'Pola', model: 'p5-gambar', template: 'function setup() { createCanvas(LEBAR, TINGGI); background(random(255), 0, 0) }', params: 'lebar=80\ntinggi=60\nseed=5' })
  await studio(win).getByRole('button', { name: 'Generate' }).click()
  await expect(studio(win).locator('.studio-gen').first()).toContainText('Selesai', { timeout: 30000 })

  await writePrompt(win, { name: 'Bocor', model: 'p5-gambar', template: "async function setup() { createCanvas(10, 10); await fetch('https://example.com/curi') }" })
  await studio(win).getByRole('button', { name: 'Generate' }).click()
  await expect(studio(win).locator('.studio-gen').first()).toContainText('Gagal', { timeout: 30000 })
  await expect(studio(win).locator('.studio-gen').first()).toContainText('Sketsa error')

  const files = generatedFiles()
  expect(files.filter((f) => /_motion_splash_kode_.*\.mp4$/.test(f))).toHaveLength(1)
  expect(files.filter((f) => /_gambar_pola_kode_.*\.png$/.test(f))).toHaveLength(1)
  const mp4 = fs.readFileSync(path.join(dirs.vault, 'generated', fs.readdirSync(path.join(dirs.vault, 'generated'))[0], files.find((f) => f.endsWith('.mp4'))!))
  expect(mp4.subarray(4, 8).toString()).toBe('ftyp')

  await tab(win, 'Board').click()
  await expect(node(win, /splash_kode/)).toHaveCount(1)
  await expect(node(win, /pola_kode/)).toHaveCount(1)
  await app.close()
})

test('jalur cloud (Higgsfield tiruan): kunci terenkripsi, konfirmasi biaya, 2 hasil, kunci tidak masuk log', async () => {
  const png = fs.readFileSync(fixture('foto.png'))
  const auth: string[] = []
  let n = 0
  const fake = await listen((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      if (req.url?.startsWith('/out/')) {
        res.writeHead(200, { 'content-type': 'image/png' })
        res.end(n++ === 0 ? png : Buffer.concat([png, Buffer.from('beda')]))
        return
      }
      auth.push(String(req.headers.authorization))
      res.writeHead(200, { 'content-type': 'application/json' })
      if (req.method === 'POST' && req.url === '/fake/model') {
        const id = `req-${auth.length}`
        res.end(JSON.stringify({ request_id: id, status_url: `${fake.url}/requests/${id}/status`, cancel_url: `${fake.url}/requests/${id}/cancel` }))
        return
      }
      if (req.url?.startsWith('/requests/')) {
        res.end(JSON.stringify({ status: 'completed', images: [{ url: `${fake.url}/out/${req.url.split('/')[2]}.png` }] }))
        return
      }
      res.end('{}')
    })
  })
  const app = await launch(dirs, { ALFONSO_E2E: '1', ALFONSO_HIGGSFIELD_URL: fake.url })
  const win = await ready(app)
  await tab(win, 'Studio').click()
  const s = studio(win)

  await s.getByRole('button', { name: 'Akun & biaya' }).click()
  await s.getByLabel('API key Higgsfield').fill('kunci-uji-123')
  await s.getByLabel('Secret Higgsfield').fill('rahasia-uji-456')
  await s.getByRole('button', { name: 'Simpan kunci' }).click()
  await expect(s.getByText('Tersimpan (terenkripsi)')).toBeVisible()
  await s.getByLabel('Model untuk harga').fill('fake/model')
  await s.getByLabel('Kredit per hasil').fill('2')
  await s.getByRole('button', { name: 'Simpan harga' }).click()
  await expect(s.getByText('2 kredit')).toBeVisible()

  await writePrompt(win, { name: 'Ikon', lane: 'cloud', model: 'fake/model', template: 'App icon of [SIMBOL]', params: 'jumlah=2\nrasio=1:1' })
  await s.getByLabel('Variabel SIMBOL').fill('buku')
  await s.getByRole('button', { name: 'Generate' }).click()
  const dialog = win.getByRole('dialog')
  await expect(dialog).toContainText('2 × 2 kredit = 4 kredit')
  await dialog.getByRole('button', { name: 'Batal' }).click()
  expect(auth).toHaveLength(0)
  await s.getByRole('button', { name: 'Generate' }).click()
  await win.getByRole('dialog').getByRole('button', { name: 'Konfirmasi' }).click()
  await expect(s.locator('.studio-gen', { hasText: 'Selesai' })).toHaveCount(2, { timeout: 30000 })
  expect(auth.every((a) => a === 'Key kunci-uji-123:rahasia-uji-456')).toBe(true)

  await tab(win, 'Board').click()
  await expect(node(win, /ikon_cloud/)).toHaveCount(2)
  await app.close()
  fake.server.close()

  // Kunci tidak pernah tertulis sebagai teks polos (log, database).
  const logs = fs.readdirSync(path.join(dirs.vault, 'logs')).map((f) => fs.readFileSync(path.join(dirs.vault, 'logs', f), 'utf8')).join('')
  const db = fs.readFileSync(path.join(dirs.vault, 'alfonso.db'))
  for (const secret of ['kunci-uji-123', 'rahasia-uji-456']) {
    expect(logs).not.toContain(secret)
    expect(db.includes(Buffer.from(secret))).toBe(false)
  }
})

test('jalur lokal (ComfyUI tiruan): workflow dipilih, hasil masuk Board; ComfyUI mati → tawaran pindah ke cloud', async () => {
  const png = fs.readFileSync(fixture('foto.png'))
  let prompt: unknown = null
  const fake = await listen((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      if (req.url === '/system_stats') return res.writeHead(200, { 'content-type': 'application/json' }).end('{}')
      if (req.url === '/prompt') {
        prompt = JSON.parse(body).prompt
        return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ prompt_id: 'pid-1' }))
      }
      if (req.url === '/history/pid-1') {
        return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ 'pid-1': { status: { status_str: 'success' }, outputs: { '9': { images: [{ filename: 'ComfyUI_0001.png', subfolder: '', type: 'output' }] } } } }))
      }
      if (req.url?.startsWith('/view')) return res.writeHead(200, { 'content-type': 'image/png' }).end(png)
      res.writeHead(404).end()
    })
  })
  const wf = path.join(dirs.base, 'workflow_api.json')
  fs.writeFileSync(wf, JSON.stringify({ '3': { class_type: 'KSampler', inputs: { seed: '{{SEED}}' } }, '6': { class_type: 'CLIPTextEncode', inputs: { text: '{{PROMPT}}' } }, '9': { class_type: 'SaveImage', inputs: {} } }))
  const app = await launch(dirs, { ALFONSO_E2E: '1' })
  const win = await ready(app)
  // Dialog pilih file diganti di proses utama (tidak ada dialog sungguhan di tes).
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [file] })) as typeof dialog.showOpenDialog
  }, wf)
  await tab(win, 'Studio').click()
  const s = studio(win)
  await s.getByRole('button', { name: 'Akun & biaya' }).click()
  await s.getByLabel('Alamat ComfyUI').fill(fake.url)
  await s.getByRole('button', { name: 'Simpan alamat' }).click()
  await s.getByRole('button', { name: 'Cek' }).click()
  await expect(s.getByText('ComfyUI berjalan.')).toBeVisible()

  await writePrompt(win, { name: 'Ruang Kosong', lane: 'lokal', template: 'empty desk, [GAYA]', params: 'seed=11' })
  await s.getByRole('button', { name: 'Pilih workflow…' }).click()
  await expect(s.getByText('Workflow: workflow_api.json')).toBeVisible()
  await s.getByLabel('Variabel GAYA').fill('flat')
  await s.getByRole('button', { name: 'Generate' }).click()
  await expect(s.locator('.studio-gen').first()).toContainText('Selesai', { timeout: 30000 })
  expect(prompt).toMatchObject({ '3': { inputs: { seed: 11 } }, '6': { inputs: { text: 'empty desk, flat' } } })
  await tab(win, 'Board').click()
  await expect(node(win, /ruang-kosong_lokal/)).toHaveCount(1)

  // ComfyUI mati: Studio menawarkan pindah ke cloud, tidak pindah sendiri.
  await new Promise((r) => fake.server.close(r))
  await tab(win, 'Studio').click()
  await s.getByRole('button', { name: 'Generate' }).click()
  await expect(s.getByRole('button', { name: 'Pindah ke cloud' })).toBeVisible()
  await expect(s.getByLabel('Jalur')).toHaveValue('lokal')
  await app.close()
})
