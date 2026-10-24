import { test, expect, beforeEach, afterEach } from 'vitest'
import { tmpVault, type TmpVault } from './helpers'
import { savePrompt } from '../../src/main/studio/prompts'
import {
  createGenerations, getGeneration, generationForAsset, listGenerations, markFailed, markRunning, regenerateRequest, setExternalId, GEN_JOB
} from '../../src/main/studio/generations'
import { estimate, getCostTable, setModelCost } from '../../src/main/studio/costs'
import { getActiveBoard, insertCard } from '../../src/main/board/repo'

let t: TmpVault
beforeEach(() => { t = tmpVault() })
afterEach(() => t.cleanup())

const cloud = () => savePrompt(t.db, t.vault, { name: 'Ikon', lane: 'cloud', targetModel: 'bytedance/seedream/v4/text-to-image', template: 'Icon of [SIMBOL]', params: { rasio: '1:1', jumlah: 4, seed: 7 } })
const svg = () => savePrompt(t.db, t.vault, { name: 'Lencana', lane: 'kode', targetModel: 'svg', template: '<svg xmlns="http://www.w3.org/2000/svg">[TEKS]</svg>' })
const jobs = () => t.db.prepare("SELECT kind, payload_json, status FROM jobs ORDER BY rowid").all() as { kind: string; payload_json: string; status: string }[]

test('tabel biaya: kosong → biaya belum diketahui; harga dikali jumlah; jalur non-cloud gratis', () => {
  expect(getCostTable(t.db)).toEqual({})
  expect(estimate(t.db, 'cloud', 'm/x', 4)).toEqual({ perItem: null, count: 4, total: null })
  setModelCost(t.db, 'm/x', 2.5)
  expect(getCostTable(t.db)).toEqual({ 'm/x': 2.5 })
  expect(estimate(t.db, 'cloud', 'm/x', 4)).toEqual({ perItem: 2.5, count: 4, total: 10 })
  expect(estimate(t.db, 'kode', 'svg', 3)).toEqual({ perItem: 0, count: 3, total: 0 })
  expect(() => setModelCost(t.db, 'm/x', -1)).toThrow()
  setModelCost(t.db, 'm/x', null)
  expect(getCostTable(t.db)).toEqual({})
})

test('jumlah 4 → 4 generation antre + 4 job; teks prompt terisi; seed berbeda per hasil; biaya dicatat', () => {
  setModelCost(t.db, 'bytedance/seedream/v4/text-to-image', 3)
  const p = cloud()
  const board = getActiveBoard(t.db)
  const gens = createGenerations(t.db, { promptId: p.id, variables: { SIMBOL: 'buku' }, confirmedCost: true }, { boardId: board.id })
  expect(gens).toHaveLength(4)
  expect(gens[0]).toMatchObject({
    promptId: p.id, promptName: 'Ikon', promptVersion: 1, promptText: 'Icon of buku', variables: { SIMBOL: 'buku' },
    model: 'bytedance/seedream/v4/text-to-image', lane: 'cloud', source: 'higgsfield', creditCost: 3, status: 'antre', error: null
  })
  expect(gens.map((g) => g.params.seed)).toEqual([7, 8, 9, 10])
  expect(gens.every((g) => g.params.jumlah === 1 && g.params.rasio === '1:1')).toBe(true)
  const j = jobs()
  expect(j.map((x) => [x.kind, x.status])).toEqual(Array(4).fill([GEN_JOB, 'antre']))
  expect(JSON.parse(j[0].payload_json)).toEqual({ generationId: gens[0].id, boardId: board.id, at: null })
  expect(listGenerations(t.db).map((g) => g.id)).toEqual([...gens].reverse().map((g) => g.id))
})

test('jalur cloud tanpa konfirmasi biaya ditolak; variabel kosong ditolak; prompt tak dikenal ditolak', () => {
  const p = cloud()
  const board = getActiveBoard(t.db).id
  expect(() => createGenerations(t.db, { promptId: p.id, variables: { SIMBOL: 'x' } }, { boardId: board })).toThrow('biaya')
  expect(() => createGenerations(t.db, { promptId: p.id, variables: {}, confirmedCost: true }, { boardId: board })).toThrow('Variabel belum diisi: SIMBOL')
  expect(() => createGenerations(t.db, { promptId: 'x', variables: {} }, { boardId: board })).toThrow('Prompt')
  expect(jobs()).toEqual([])
})

test('jalur kode: sumber svg, nilai variabel di-escape XML, kartu sumber dicatat', () => {
  const p = svg()
  const board = getActiveBoard(t.db)
  const card = insertCard(t.db, { boardId: board.id, type: 'catatan', x: 0, y: 0, content: 'hai' })
  const [g] = createGenerations(t.db, { promptId: p.id, variables: { TEKS: 'a < b & "c"' }, sourceCardId: card.id }, { boardId: board.id })
  expect(g).toMatchObject({ source: 'svg', lane: 'kode', creditCost: 0, sourceCardId: card.id })
  expect(g.promptText).toBe('<svg xmlns="http://www.w3.org/2000/svg">a &lt; b &amp; &quot;c&quot;</svg>')
  expect(() => createGenerations(t.db, { promptId: p.id, variables: { TEKS: 'x' }, sourceCardId: 'hilang' }, { boardId: board.id })).toThrow('Kartu')
})

test('transisi status, external id, dan regenerate menyalin asal-usul persis', () => {
  const p = cloud()
  const board = getActiveBoard(t.db).id
  const [g] = createGenerations(t.db, { promptId: p.id, variables: { SIMBOL: 'buku' }, confirmedCost: true }, { boardId: board })
  markRunning(t.db, g.id)
  setExternalId(t.db, g.id, 'req-1')
  expect(getGeneration(t.db, g.id)).toMatchObject({ status: 'berjalan' })
  expect(t.db.prepare('SELECT external_id FROM generations WHERE id = ?').get(g.id)).toEqual({ external_id: 'req-1' })
  markFailed(t.db, g.id, 'Server sibuk')
  expect(getGeneration(t.db, g.id)).toMatchObject({ status: 'gagal', error: 'Server sibuk' })
  // Prompt diedit setelahnya: generate ulang tetap memakai versi lama.
  savePrompt(t.db, t.vault, { baseId: p.id, name: 'Ikon', lane: 'cloud', targetModel: p.targetModel, template: 'Other [SIMBOL]' })
  const req = regenerateRequest(t.db, g.id)
  expect(req).toEqual({ promptId: p.id, variables: { SIMBOL: 'buku' }, sourceCardId: null, params: g.params })
  const [again] = createGenerations(t.db, { ...req, confirmedCost: true }, { boardId: board })
  expect(again).toMatchObject({ promptText: 'Icon of buku', promptVersion: 1, params: g.params, model: g.model })
})

test('generationForAsset menemukan asal-usul aset hasil', () => {
  const p = svg()
  const [g] = createGenerations(t.db, { promptId: p.id, variables: { TEKS: 'x' } }, { boardId: getActiveBoard(t.db).id })
  t.db.prepare("INSERT INTO assets (id, sha256, vault_path, original_name, extract_status, created_at) VALUES ('as1','s','generated/x.svg','x.svg','siap','t')").run()
  t.db.prepare("UPDATE generations SET result_asset_id = 'as1', status = 'selesai' WHERE id = ?").run(g.id)
  expect(generationForAsset(t.db, 'as1')?.id).toBe(g.id)
  expect(generationForAsset(t.db, 'lain')).toBeNull()
})
