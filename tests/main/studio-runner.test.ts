import { test, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { tmpVault, type TmpVault } from './helpers'
import { savePrompt } from '../../src/main/studio/prompts'
import { getGeneration } from '../../src/main/studio/generations'
import { createStudioRunner, KeyRejectedError, type RemoteAdapter } from '../../src/main/studio/runner'
import { PermanentError } from '../../src/main/ingest/service'
import { getActiveBoard, insertCard, loadBoard } from '../../src/main/board/repo'
import type { IngestEvent } from '../../src/shared/board-types'
import type { GenerationDTO, StudioEvent } from '../../src/shared/studio-types'
import type { AdapterResult } from '../../src/main/studio/adapters/code'

let t: TmpVault
const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
beforeEach(() => { t = tmpVault() })
afterEach(() => t.cleanup())

async function result(content: string, ext = 'png'): Promise<AdapterResult> {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'alfonso-gen-'))
  const file = path.join(dir, `hasil.${ext}`)
  await fs.promises.writeFile(file, content)
  return { file, ext, tempDir: dir }
}

function setup(over: { cloud?: Partial<RemoteAdapter>; kode?: (g: GenerationDTO) => Promise<AdapterResult> } = {}) {
  const studio: StudioEvent[] = []
  const board: IngestEvent[] = []
  const calls = { submit: 0, wait: 0, rejected: 0 }
  const cloud: RemoteAdapter = {
    submit: async () => { calls.submit++; return `req-${calls.submit}` },
    wait: async () => { calls.wait++; return result(`hasil-${calls.wait}`) },
    ...over.cloud
  }
  const r = createStudioRunner({
    db: t.db, vault: t.vault, log,
    kode: { run: over.kode ?? (async (g) => result(g.promptText!, 'svg')) },
    cloud,
    lokal: cloud,
    notify: (e) => studio.push(e),
    notifyBoard: (e) => board.push(e),
    onKeyRejected: () => { calls.rejected++ },
    retryDelayMs: 1
  })
  return { r, studio, board, calls }
}

const svgPrompt = () => savePrompt(t.db, t.vault, { name: 'Lencana', lane: 'kode', targetModel: 'svg', template: '<svg>[X]</svg>' })
const cloudPrompt = () => savePrompt(t.db, t.vault, { name: 'Ikon', lane: 'cloud', targetModel: 'm/x', template: 'icon [X]' })
const settled = (id: string) => vi.waitFor(() => expect(['selesai', 'gagal']).toContain(getGeneration(t.db, id)!.status), { timeout: 3000 })

test('jalur kode: hasil jadi aset + kartu + panah dari kartu sumber; event Studio dan Board dikirim', async () => {
  const { r, studio, board } = setup()
  r.start()
  const b = getActiveBoard(t.db)
  const src = insertCard(t.db, { boardId: b.id, type: 'catatan', x: 0, y: 0, content: 'ide' })
  const [g] = r.generate({ promptId: svgPrompt().id, variables: { X: 'a' }, sourceCardId: src.id })
  await settled(g.id)
  const done = getGeneration(t.db, g.id)!
  expect(done.status).toBe('selesai')
  const last = board.at(-1)!
  expect(last.newCards[0]).toMatchObject({ assetId: done.resultAssetId, boardId: b.id })
  expect(last.newLinks?.[0]).toMatchObject({ fromId: src.id, kind: 'hasil' })
  expect(studio.map((e) => e.generation.status)).toEqual(['antre', 'berjalan', 'selesai'])
  expect(studio.at(-1)!.card?.id).toBe(last.newCards[0].id)
  expect(loadBoard(t.db, b.id).cards).toHaveLength(2)
  // Folder sementara adapter dihapus setelah disalin ke vault.
  expect(fs.readdirSync(os.tmpdir()).filter((d) => d.startsWith('alfonso-gen-')).some((d) => fs.existsSync(path.join(os.tmpdir(), d, 'hasil.svg')) && fs.readFileSync(path.join(os.tmpdir(), d, 'hasil.svg'), 'utf8') === '<svg>a</svg>')).toBe(false)
  await r.stop()
})

test('cloud: external id disimpan sebelum menunggu; gagal sementara → hanya wait diulang (tidak bayar dua kali)', async () => {
  let fails = 1
  const { r, calls } = setup({
    cloud: {
      wait: async (_g, id) => {
        calls.wait++
        expect(t.db.prepare('SELECT external_id FROM generations').get()).toEqual({ external_id: id })
        if (fails-- > 0) throw new Error('Higgsfield sedang bermasalah')
        return result('ok')
      }
    }
  })
  r.start()
  const [g] = r.generate({ promptId: cloudPrompt().id, variables: { X: 'a' }, confirmedCost: true })
  await settled(g.id)
  expect(getGeneration(t.db, g.id)!.status).toBe('selesai')
  expect(calls).toMatchObject({ submit: 1, wait: 2 })
  await r.stop()
})

test('cloud: gagal sementara terus → berhenti setelah 3 percobaan (coba ulang 2 kali), pesan dicatat', async () => {
  const { r, calls, studio } = setup({ cloud: { submit: async () => { calls.submit++; throw new Error('Server sibuk') } } })
  r.start()
  const [g] = r.generate({ promptId: cloudPrompt().id, variables: { X: 'a' }, confirmedCost: true })
  await settled(g.id)
  expect(getGeneration(t.db, g.id)).toMatchObject({ status: 'gagal', error: 'Server sibuk' })
  expect(calls.submit).toBe(3)
  expect(studio.at(-1)!.generation.status).toBe('gagal')
  await r.stop()
})

test('gagal permanen → langsung gagal tanpa coba ulang; kunci ditolak → status kunci ditandai', async () => {
  const { r, calls } = setup({ cloud: { submit: async () => { calls.submit++; throw new KeyRejectedError('Kunci Higgsfield ditolak') } } })
  r.start()
  const [g] = r.generate({ promptId: cloudPrompt().id, variables: { X: 'a' }, confirmedCost: true })
  await settled(g.id)
  expect(calls).toMatchObject({ submit: 1, rejected: 1 })
  await r.stop()
  const s2 = setup({ kode: async () => { throw new PermanentError('SVG ditolak: berisi skrip.') } })
  s2.r.start()
  const [g2] = s2.r.generate({ promptId: svgPrompt().id, variables: { X: 'a' } })
  await settled(g2.id)
  expect(getGeneration(t.db, g2.id)).toMatchObject({ status: 'gagal', error: 'SVG ditolak: berisi skrip.' })
  await s2.r.stop()
})

test('coba ulang manual: cloud wajib konfirmasi biaya, external id lama dibuang (kirim baru)', async () => {
  let broken = true
  const { r, calls } = setup({ cloud: { wait: async () => { calls.wait++; if (broken) throw new PermanentError('NSFW'); return result('ok2') } } })
  r.start()
  const [g] = r.generate({ promptId: cloudPrompt().id, variables: { X: 'a' }, confirmedCost: true })
  await settled(g.id)
  broken = false
  expect(() => r.retry(g.id, false)).toThrow('biaya')
  expect(r.retry(g.id, true).error).toBeNull()
  await vi.waitFor(() => expect(getGeneration(t.db, g.id)!.status).toBe('selesai'))
  expect(calls.submit).toBe(2)
  expect(() => r.retry(g.id, true)).toThrow('Hanya')
  await r.stop()
})

test('crash di tengah (job tertinggal berjalan) → dilanjutkan saat start', async () => {
  const { r } = setup()
  const [g] = r.generate({ promptId: svgPrompt().id, variables: { X: 'b' } })
  t.db.prepare("UPDATE jobs SET status = 'berjalan'").run()
  t.db.prepare("UPDATE generations SET status = 'berjalan'").run()
  r.start()
  await settled(g.id)
  expect(getGeneration(t.db, g.id)!.status).toBe('selesai')
  await r.stop()
})

test('referensi gambar dari kartu sumber diteruskan ke adapter cloud', async () => {
  let ref: string | null = 'belum'
  const { r } = setup({ cloud: { submit: async (_g, ctx) => { ref = ctx.referencePath; return 'req' } } })
  r.start()
  const b = getActiveBoard(t.db)
  t.db.prepare("INSERT INTO assets (id, sha256, vault_path, original_name, mime, extract_status, created_at) VALUES ('img','s','files/ab/x.png','x.png','image/png','siap','t')").run()
  const card = insertCard(t.db, { boardId: b.id, type: 'gambar', x: 0, y: 0, assetId: 'img' })
  const [g] = r.generate({ promptId: cloudPrompt().id, variables: { X: 'a' }, sourceCardId: card.id, confirmedCost: true })
  await settled(g.id)
  expect(ref).toBe('files/ab/x.png')
  await r.stop()
})
