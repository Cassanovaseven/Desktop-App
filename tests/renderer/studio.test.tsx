// @vitest-environment jsdom
import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StudioPanel, parseVariables } from '../../src/renderer/studio/StudioPanel'
import { studioStore } from '../../src/renderer/studio/studio-store'
import { textToParams, paramsToText } from '../../src/renderer/studio/params'
import { costText } from '../../src/renderer/studio/CostDialog'
import type { GenerationDTO, PromptDTO, StudioEvent, StudioSettings } from '../../src/shared/studio-types'

let prompts: PromptDTO[]
let settings: StudioSettings
let comfy = true
let emit: (e: StudioEvent) => void = () => {}
const mkPrompt = (over: Partial<PromptDTO>): PromptDTO => ({
  id: 'p1', projectId: null, name: 'Lencana', lane: 'kode', targetModel: 'svg', template: '<svg>[TEKS]</svg>', variables: ['TEKS'], params: { jumlah: 1 },
  examples: [], version: 1, parentVersionId: null, createdAt: 't', ...over
})
const mkGen = (over: Partial<GenerationDTO>): GenerationDTO => ({
  id: 'g1', promptId: 'p1', promptName: 'Lencana', promptVersion: 1, promptText: '<svg/>', variables: {}, model: 'svg', params: {}, lane: 'kode', source: 'svg',
  creditCost: 0, status: 'antre', error: null, resultAssetId: null, sourceCardId: null, createdAt: 't', updatedAt: null, ...over
})

const studio = {
  listPrompts: vi.fn(async (f?: { q?: string }) => prompts.filter((p) => !f?.q || p.name.toLowerCase().includes(f.q.toLowerCase()))),
  getPrompt: vi.fn(async (id: string) => prompts.find((p) => p.id === id) ?? null),
  savePrompt: vi.fn(async (input: any) => {
    const base = prompts.find((p) => p.id === input.baseId)
    const p = mkPrompt({ ...input, id: base ? `${base.id}-v${base.version + 1}` : 'baru', version: base ? base.version + 1 : 1, variables: parseVariables(input.template), params: input.params })
    prompts = [...prompts.filter((x) => x.id !== input.baseId), p]
    return p
  }),
  history: vi.fn(async () => [{ id: 'p1', version: 1, createdAt: 't' }]),
  estimate: vi.fn(async () => ({ perItem: 3, count: 4, total: 12 })),
  estimateGeneration: vi.fn(async () => ({ perItem: 3, count: 1, total: 3 })),
  generate: vi.fn(async () => [mkGen({})]),
  retry: vi.fn(async () => mkGen({ status: 'antre' })),
  generations: vi.fn(async () => [] as GenerationDTO[]),
  settings: vi.fn(async () => settings),
  saveKey: vi.fn(async () => ({ ...settings, higgsfield: 'tersimpan' as const })),
  clearKey: vi.fn(async () => ({ ...settings, higgsfield: 'belum' as const })),
  setComfyUrl: vi.fn(async (url: string) => ({ ...settings, comfyUrl: url })),
  setCost: vi.fn(async (m: string, c: number) => ({ ...settings, costs: { ...settings.costs, [m]: c } })),
  comfyStatus: vi.fn(async () => comfy),
  pickWorkflow: vi.fn(async () => ({ assetId: 'wf1', name: 'flux.json' })),
  assetName: vi.fn(async () => 'flux.json'),
  addExample: vi.fn(),
  generationForAsset: vi.fn(),
  regenerate: vi.fn(),
  onEvent: vi.fn((cb: (e: StudioEvent) => void) => { emit = cb; return () => {} })
}

beforeEach(() => {
  prompts = [mkPrompt({}), mkPrompt({ id: 'p2', name: 'Ikon cloud', lane: 'cloud', targetModel: 'm/x', template: 'icon [SIMBOL]', variables: ['SIMBOL'], params: { jumlah: 4 } })]
  settings = { higgsfield: 'tersimpan', comfyUrl: 'http://127.0.0.1:8188', costs: { 'm/x': 3 } }
  comfy = true
  ;(window as any).alfonso = { studio }
  studioStore.reset()
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

test('parameter teks ↔ objek; variabel terdeteksi; teks biaya', () => {
  expect(textToParams('jumlah=4\nrasio=16:9\nseed=07\nx=true\n# komentar\n\nnama=dua kata')).toEqual({ jumlah: 4, rasio: '16:9', seed: '07', x: true, nama: 'dua kata' })
  expect(() => textToParams('tanpa sama dengan')).toThrow('baris 1')
  expect(paramsToText({ jumlah: 4, rasio: '1:1' })).toBe('jumlah=4\nrasio=1:1')
  expect(parseVariables('[A] [B_1] [A] [c]')).toEqual(['A', 'B_1'])
  expect(costText('m/x', { perItem: 3, count: 4, total: 12 })).toBe('4 × 3 kredit = 12 kredit')
  expect(costText('m/y', { perItem: null, count: 1, total: null })).toMatch(/belum diketahui/)
})

test('daftar dan cari prompt', async () => {
  const user = userEvent.setup()
  render(<StudioPanel />)
  expect(await screen.findByText('Lencana')).toBeTruthy()
  expect(screen.getByText('Ikon cloud')).toBeTruthy()
  await user.type(screen.getByLabelText('Cari prompt'), 'ikon')
  await waitFor(() => expect(screen.queryByText('Lencana')).toBeNull())
  expect(screen.getByText('Ikon cloud')).toBeTruthy()
})

test('editor mendeteksi variabel, menyimpan versi baru, menolak variabel kosong saat generate', async () => {
  const user = userEvent.setup()
  render(<StudioPanel />)
  await user.click(await screen.findByText('Lencana'))
  expect((screen.getByLabelText('Nama prompt') as HTMLInputElement).value).toBe('Lencana')
  expect(screen.getByLabelText('Variabel TEKS')).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Generate' }))
  expect((await screen.findByRole('alert')).textContent).toMatch('Variabel belum diisi: TEKS')
  expect(studio.generate).not.toHaveBeenCalled()
  // Ubah template → variabel baru muncul; simpan → versi 2.
  const tpl = screen.getByLabelText('Template')
  await user.clear(tpl)
  await user.click(tpl)
  await user.paste('<svg>[TEKS] [WARNA]</svg>')
  expect(screen.getByLabelText('Variabel WARNA')).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Simpan versi baru' }))
  await waitFor(() => expect(studio.savePrompt).toHaveBeenCalledWith(expect.objectContaining({ baseId: 'p1', template: '<svg>[TEKS] [WARNA]</svg>' })))
  expect(await screen.findByText(/Versi 2/)).toBeTruthy()
})

test('jalur kode: generate langsung tanpa dialog biaya, dengan kartu referensi dari Board', async () => {
  const user = userEvent.setup()
  render(<StudioPanel />)
  await user.click(await screen.findByText('Lencana'))
  act(() => studioStore.open({ sourceCardId: 'c9', sourceLabel: 'Catatan ide', sourceText: 'isi' }))
  expect(await screen.findByText('Referensi: Catatan ide')).toBeTruthy()
  await user.type(screen.getByLabelText('Variabel TEKS'), 'Halo')
  await user.click(screen.getByRole('button', { name: 'Generate' }))
  await waitFor(() => expect(studio.generate).toHaveBeenCalledWith({ promptId: 'p1', variables: { TEKS: 'Halo' }, sourceCardId: 'c9', confirmedCost: false }))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(await screen.findByText('Generate masuk antrean.')).toBeTruthy()
})

test('jalur cloud: dialog biaya muncul, generate hanya dikirim setelah Konfirmasi; Batal tidak mengirim', async () => {
  const user = userEvent.setup()
  render(<StudioPanel />)
  await user.click(await screen.findByText('Ikon cloud'))
  await user.type(screen.getByLabelText('Variabel SIMBOL'), 'buku')
  await user.click(screen.getByRole('button', { name: 'Generate' }))
  const dialog = await screen.findByRole('dialog')
  expect(dialog.textContent).toContain('4 × 3 kredit = 12 kredit')
  expect(studio.generate).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Batal' }))
  expect(studio.generate).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Generate' }))
  await user.click(await screen.findByRole('button', { name: 'Konfirmasi' }))
  await waitFor(() => expect(studio.generate).toHaveBeenCalledWith(expect.objectContaining({ promptId: 'p2', confirmedCost: true })))
})

test('jalur cloud tanpa kunci: tidak ada dialog, bagian Akun dibuka', async () => {
  settings.higgsfield = 'belum'
  const user = userEvent.setup()
  render(<StudioPanel />)
  await user.click(await screen.findByText('Ikon cloud'))
  await user.type(screen.getByLabelText('Variabel SIMBOL'), 'buku')
  await user.click(screen.getByRole('button', { name: 'Generate' }))
  expect((await screen.findByRole('alert')).textContent).toMatch('Kunci Higgsfield belum diatur')
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(screen.getByLabelText('API key Higgsfield')).toBeTruthy()
  await user.type(screen.getByLabelText('API key Higgsfield'), 'k')
  await user.type(screen.getByLabelText('Secret Higgsfield'), 's')
  await user.click(screen.getByRole('button', { name: 'Simpan kunci' }))
  expect(studio.saveKey).toHaveBeenCalledWith('k', 's')
  expect(await screen.findByText('Tersimpan (terenkripsi)')).toBeTruthy()
  expect((screen.getByLabelText('API key Higgsfield') as HTMLInputElement).value).toBe('')
})

test('ComfyUI mati → tawaran pindah ke cloud, tidak pindah sendiri', async () => {
  prompts.push(mkPrompt({ id: 'p3', name: 'Lokal', lane: 'lokal', targetModel: 'comfyui', template: '[ADEGAN]', variables: ['ADEGAN'], params: { workflow: 'wf1' } }))
  comfy = false
  const user = userEvent.setup()
  render(<StudioPanel />)
  await user.click(await screen.findByText('Lokal'))
  expect(await screen.findByText('Workflow: flux.json')).toBeTruthy()
  await user.type(screen.getByLabelText('Variabel ADEGAN'), 'meja')
  await user.click(screen.getByRole('button', { name: 'Generate' }))
  expect(await screen.findByRole('button', { name: 'Pindah ke cloud' })).toBeTruthy()
  expect(studio.generate).not.toHaveBeenCalled()
  expect((screen.getByLabelText('Jalur') as HTMLSelectElement).value).toBe('lokal')
  await user.click(screen.getByRole('button', { name: 'Pindah ke cloud' }))
  expect((screen.getByLabelText('Jalur') as HTMLSelectElement).value).toBe('cloud')
  expect(studio.generate).not.toHaveBeenCalled()
})

test('riwayat diperbarui dari event; gagal → Coba ulang (cloud lewat konfirmasi biaya)', async () => {
  const user = userEvent.setup()
  render(<StudioPanel />)
  await screen.findByText('Lencana')
  act(() => emit({ generation: mkGen({ id: 'g7', status: 'gagal', error: 'SVG ditolak: berisi skrip.' }) }))
  expect(await screen.findByText('SVG ditolak: berisi skrip.')).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Coba ulang' }))
  expect(studio.retry).toHaveBeenCalledWith('g7')
  act(() => emit({ generation: mkGen({ id: 'g7', status: 'selesai', resultAssetId: 'a1' }) }))
  expect(await screen.findByRole('button', { name: 'Lihat hasil' })).toBeTruthy()
  act(() => emit({ generation: mkGen({ id: 'g8', lane: 'cloud', model: 'm/x', status: 'gagal', error: 'Server sibuk' }) }))
  await user.click((await screen.findAllByRole('button', { name: 'Coba ulang' }))[0])
  expect(await screen.findByRole('dialog')).toBeTruthy()
  expect(studio.retry).toHaveBeenCalledTimes(1)
  await user.click(screen.getByRole('button', { name: 'Konfirmasi' }))
  await waitFor(() => expect(studio.retry).toHaveBeenCalledWith('g8', true))
})
