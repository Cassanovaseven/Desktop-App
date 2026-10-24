import { test, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import { tmpVault, type TmpVault } from './helpers'
import {
  addExample, fillTemplate, getPrompt, listPrompts, parseVariables, promptHistory, savePrompt
} from '../../src/main/studio/prompts'

let t: TmpVault
beforeEach(() => { t = tmpVault() })
afterEach(() => t.cleanup())

const base = { name: 'Ikon aplikasi', lane: 'cloud' as const, targetModel: 'bytedance/seedream/v4/text-to-image', template: 'App icon of [SIMBOL], [GAYA_VISUAL] style, [SIMBOL] again' }

test('parseVariables: urutan kemunculan, tanpa duplikat, hanya huruf besar/angka/_', () => {
  expect(parseVariables('A [SIMBOL] b [GAYA_VISUAL] [SIMBOL] [a] [1X] [X1] [ ]')).toEqual(['SIMBOL', 'GAYA_VISUAL', 'X1'])
  expect(parseVariables('tanpa variabel')).toEqual([])
})

test('fillTemplate mengganti semua kemunculan dan menolak variabel kosong', () => {
  expect(fillTemplate('[A] dan [B] dan [A]', { A: 'kucing', B: 'anjing' })).toBe('kucing dan anjing dan kucing')
  expect(() => fillTemplate('[A] dan [B]', { A: 'x', B: '  ' })).toThrow('Variabel belum diisi: B')
  expect(() => fillTemplate('[A] dan [B]', {})).toThrow('Variabel belum diisi: A, B')
  // Nilai tidak diproses ulang sebagai template.
  expect(fillTemplate('[A]', { A: '[B]' })).toBe('[B]')
  expect(fillTemplate('<t>[A]</t>', { A: 'a & b' }, (s) => s.replace(/&/g, '&amp;'))).toBe('<t>a &amp; b</t>')
})

test('simpan prompt baru → versi 1, variabel terdeteksi, parameter tersimpan', () => {
  const p = savePrompt(t.db, t.vault, { ...base, params: { rasio: '1:1', jumlah: 4 } })
  expect(p).toMatchObject({ version: 1, parentVersionId: null, variables: ['SIMBOL', 'GAYA_VISUAL'], params: { rasio: '1:1', jumlah: 4 }, examples: [] })
  expect(p.createdAt).toMatch(/^\d{4}-/)
  expect(getPrompt(t.db, p.id)).toEqual(p)
})

test('simpan ulang → versi 2 berinduk versi 1; versi 1 tidak berubah; tanpa perubahan → tidak ada versi baru', () => {
  const v1 = savePrompt(t.db, t.vault, base)
  const v2 = savePrompt(t.db, t.vault, { ...base, baseId: v1.id, template: 'Icon [SIMBOL]' })
  expect(v2).toMatchObject({ version: 2, parentVersionId: v1.id, template: 'Icon [SIMBOL]', variables: ['SIMBOL'] })
  expect(getPrompt(t.db, v1.id)!.template).toBe(base.template)
  expect(savePrompt(t.db, t.vault, { ...base, baseId: v2.id, template: 'Icon [SIMBOL]' }).id).toBe(v2.id)
  // Mengedit dari versi lama tetap menyambung ke versi terbaru (tidak bercabang).
  const v3 = savePrompt(t.db, t.vault, { ...base, baseId: v1.id, name: 'Ikon v3' })
  expect(v3).toMatchObject({ version: 3, parentVersionId: v2.id })
  expect(promptHistory(t.db, v3.id).map((h) => h.version)).toEqual([3, 2, 1])
  expect(promptHistory(t.db, v1.id).map((h) => h.version)).toEqual([3, 2, 1])
})

test('daftar hanya versi terbaru, bisa dicari nama atau isi template, disaring jalur', () => {
  const a = savePrompt(t.db, t.vault, base)
  savePrompt(t.db, t.vault, { ...base, baseId: a.id, template: 'Icon [SIMBOL]' })
  savePrompt(t.db, t.vault, { name: 'Wallpaper', lane: 'kode', targetModel: 'svg', template: '<svg>[POLA]</svg>' })
  expect(listPrompts(t.db).map((p) => [p.name, p.version])).toEqual([['Ikon aplikasi', 2], ['Wallpaper', 1]])
  expect(listPrompts(t.db, { q: 'wall' }).map((p) => p.name)).toEqual(['Wallpaper'])
  expect(listPrompts(t.db, { q: 'POLA' }).map((p) => p.name)).toEqual(['Wallpaper'])
  expect(listPrompts(t.db, { lane: 'cloud' }).map((p) => p.name)).toEqual(['Ikon aplikasi'])
  expect(listPrompts(t.db, { q: '%' })).toEqual([])
})

test('validasi: nama kosong / > 80, jalur & model kode tak dikenal, template kosong / terlalu panjang', () => {
  // Nama kosong (langsung generate tanpa memberi nama): tetap tersimpan supaya asal-usul tidak hilang.
  expect(savePrompt(t.db, t.vault, { ...base, name: ' ' }).name).toMatch(/^Tanpa judul \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
  expect(() => savePrompt(t.db, t.vault, { ...base, name: 'x'.repeat(81) })).toThrow('Nama')
  expect(() => savePrompt(t.db, t.vault, { ...base, lane: 'awan' as never })).toThrow('Jalur')
  expect(() => savePrompt(t.db, t.vault, { ...base, lane: 'kode', targetModel: 'remotion' })).toThrow('Model')
  expect(() => savePrompt(t.db, t.vault, { ...base, lane: 'lokal', targetModel: 'x' })).toThrow('Model')
  expect(() => savePrompt(t.db, t.vault, { ...base, targetModel: ' ' })).toThrow('Model')
  expect(() => savePrompt(t.db, t.vault, { ...base, template: '' })).toThrow('Template')
  expect(() => savePrompt(t.db, t.vault, { ...base, template: 'x'.repeat(200_001) })).toThrow('Template')
  expect(() => savePrompt(t.db, t.vault, { ...base, params: { x: { y: 1 } } as never })).toThrow('Parameter')
  expect(() => savePrompt(t.db, t.vault, { ...base, baseId: 'tidak-ada' })).toThrow('tidak ditemukan')
})

test('ekspor ke prompts/<id-awal>.json dalam format spec 10.1, diperbarui tiap versi', () => {
  const v1 = savePrompt(t.db, t.vault, { ...base, params: { rasio: '1:1' } })
  const file = path.join(t.vault.prompts, `${v1.id}.json`)
  expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({
    id: v1.id, nama: 'Ikon aplikasi', jalur: 'cloud', target_model: base.targetModel, template: base.template,
    variabel: ['SIMBOL', 'GAYA_VISUAL'], parameter: { rasio: '1:1' }, contoh_hasil: [], versi: 1
  })
  savePrompt(t.db, t.vault, { ...base, baseId: v1.id, template: 'Icon [SIMBOL]' })
  expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toMatchObject({ versi: 2, template: 'Icon [SIMBOL]' })
  expect(fs.readdirSync(t.vault.prompts)).toEqual([`${v1.id}.json`])
})

test('contoh hasil ditambahkan ke versi terbaru tanpa membuat versi baru', () => {
  const v1 = savePrompt(t.db, t.vault, base)
  const a = t.db.prepare("INSERT INTO assets (id, sha256, vault_path, original_name, extract_status, created_at) VALUES ('as1','s','generated/x.png','x.png','siap','t')").run()
  expect(a.changes).toBe(1)
  const p = addExample(t.db, t.vault, v1.id, 'as1')
  expect(p).toMatchObject({ id: v1.id, version: 1, examples: ['as1'] })
  expect(addExample(t.db, t.vault, v1.id, 'as1').examples).toEqual(['as1'])
  expect(() => addExample(t.db, t.vault, v1.id, 'tidak-ada')).toThrow('Aset')
})
