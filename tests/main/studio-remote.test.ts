import { test, expect, beforeEach, afterEach } from 'vitest'
import http from 'http'
import type { AddressInfo } from 'net'
import { tmpVault, type TmpVault } from './helpers'
import { createRemoteAdapters, higgsfieldArguments, comfyValues } from '../../src/main/studio/adapters/remote'
import { KeyRejectedError } from '../../src/main/studio/runner'
import type { GenerationDTO } from '../../src/shared/studio-types'

let t: TmpVault
let server: http.Server
let port = 0
let seen: { url: string; headers: http.IncomingHttpHeaders; body: any }[] = []
let reply: (url: string) => { status: number; body: unknown } = () => ({ status: 200, body: {} })

beforeEach(async () => {
  t = tmpVault()
  seen = []
  server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      seen.push({ url: req.url!, headers: req.headers, body: raw ? JSON.parse(raw) : null })
      const r = reply(req.url!)
      res.writeHead(r.status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(r.body))
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  port = (server.address() as AddressInfo).port
})
afterEach(async () => {
  await new Promise((r) => server.close(r))
  t.cleanup()
})

const sidecar = () => ({ token: 'tok', getStatus: () => ({ state: 'ready' as const, port, message: null, restarts: 0 }) })
const gen = (over: Partial<GenerationDTO>): GenerationDTO => ({
  id: 'g1', promptId: 'p', promptName: 'x', promptVersion: 1, promptText: 'kucing', variables: {}, model: 'bytedance/seedream/v4/text-to-image',
  params: { rasio: '16:9', jumlah: 1, seed: 3, resolusi: '2K', gaya: 'x' }, lane: 'cloud', source: 'higgsfield', creditCost: 1, status: 'berjalan',
  error: null, resultAssetId: null, sourceCardId: null, createdAt: 't', updatedAt: null, ...over
})

test('parameter Alfonso diterjemahkan ke argumen Higgsfield; parameter internal tidak dikirim', () => {
  expect(higgsfieldArguments(gen({ params: { rasio: '16:9', jumlah: 1, seed: 3, resolusi: '2K', negatif: 'buram', kunci_referensi: 'image_url', camera_fixed: false } }))).toEqual({
    prompt: 'kucing', aspect_ratio: '16:9', seed: 3, resolution: '2K', negative_prompt: 'buram', camera_fixed: false
  })
})

test('nilai penanda ComfyUI dari teks prompt dan parameter', () => {
  expect(comfyValues(gen({ lane: 'lokal', params: { seed: 9, lebar: 768, tinggi: 512, negatif: 'jelek' } }))).toEqual({ PROMPT: 'kucing', NEGATIF: 'jelek', SEED: 9, LEBAR: 768, TINGGI: 512 })
  expect(comfyValues(gen({ lane: 'lokal', params: { seed: 1 } }))).toMatchObject({ NEGATIF: '', LEBAR: 1024, TINGGI: 1024 })
})

test('cloud submit: token + kunci di header, referensi diteruskan; kunci tidak ada → error permanen', async () => {
  reply = () => ({ status: 200, body: { request_id: 'req-9' } })
  let key: string | null = 'k:s'
  const a = createRemoteAdapters({ sidecar: sidecar() as never, db: t.db, readKey: () => key, comfyUrl: () => 'http://127.0.0.1:8188' })
  expect(await a.cloud.submit(gen({}), { referencePath: 'files/ab/x.png' })).toBe('req-9')
  expect(seen[0].url).toBe('/generate/higgsfield/submit')
  expect(seen[0].headers['x-alfonso-token']).toBe('tok')
  expect(seen[0].headers['x-alfonso-key']).toBe('k:s')
  expect(seen[0].body).toMatchObject({ model: 'bytedance/seedream/v4/text-to-image', reference_path: 'files/ab/x.png', reference_key: 'image_url' })
  key = null
  await expect(a.cloud.submit(gen({}), { referencePath: null })).rejects.toMatchObject({ permanent: true, message: expect.stringContaining('Kunci') })
})

test('status sidecar: 403 → KeyRejectedError, 4xx → permanen, 5xx → sementara', async () => {
  const a = createRemoteAdapters({ sidecar: sidecar() as never, db: t.db, readKey: () => 'k:s', comfyUrl: () => 'http://127.0.0.1:8188' })
  reply = () => ({ status: 403, body: { detail: 'Kunci Higgsfield ditolak.' } })
  await expect(a.cloud.wait(gen({}), 'r')).rejects.toBeInstanceOf(KeyRejectedError)
  reply = () => ({ status: 422, body: { detail: 'NSFW' } })
  await expect(a.cloud.wait(gen({}), 'r')).rejects.toMatchObject({ permanent: true, message: 'NSFW' })
  reply = () => ({ status: 502, body: { detail: 'sibuk' } })
  const e = await a.cloud.wait(gen({}), 'r').catch((x) => x)
  expect(e.message).toBe('sibuk')
  expect(e.permanent).toBeUndefined()
  reply = () => ({ status: 504, body: { detail: 'lama' } })
  expect((await a.cloud.wait(gen({}), 'r').catch((x) => x)).permanent).toBeUndefined()
})

test('lokal submit: workflow dari aset vault + alamat ComfyUI dari pengaturan; workflow belum dipilih → permanen', async () => {
  reply = () => ({ status: 200, body: { prompt_id: 'pid' } })
  t.db.prepare("INSERT INTO assets (id, sha256, vault_path, original_name, mime, extract_status, created_at) VALUES ('wf','s','files/ab/wf.json','wf.json','application/json','siap','t')").run()
  const a = createRemoteAdapters({ sidecar: sidecar() as never, db: t.db, readKey: () => null, comfyUrl: () => 'http://127.0.0.1:8190' })
  expect(await a.lokal.submit(gen({ lane: 'lokal', model: 'comfyui', params: { workflow: 'wf', seed: 2 } }), { referencePath: null })).toBe('pid')
  expect(seen[0].body).toMatchObject({ base_url: 'http://127.0.0.1:8190', workflow_path: 'files/ab/wf.json', values: { PROMPT: 'kucing', SEED: 2 } })
  expect(seen[0].headers['x-alfonso-key']).toBeUndefined()
  await expect(a.lokal.submit(gen({ lane: 'lokal', params: {} }), { referencePath: null })).rejects.toMatchObject({ permanent: true })
  // ComfyUI mati (424) → permanen (tidak pindah otomatis ke cloud).
  reply = () => ({ status: 424, body: { detail: 'ComfyUI tidak berjalan di http://127.0.0.1:8190.' } })
  await expect(a.lokal.wait(gen({ lane: 'lokal' }), 'pid')).rejects.toMatchObject({ permanent: true })
})
