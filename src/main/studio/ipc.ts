import { dialog, ipcMain, type BrowserWindow } from 'electron'
import type Database from 'better-sqlite3'
import type { VaultPaths } from '../../shared/types'
import type { Lane, PromptParams, StudioSettings } from '../../shared/studio-types'
import { getSetting, setSetting } from '../db/database'
import { importAsset } from '../ingest/importer'
import { addExample, getPrompt, listPrompts, promptHistory, savePrompt } from './prompts'
import { countOf, generationForAsset, getGeneration, listGenerations, regenerateRequest } from './generations'
import { estimate, getCostTable, setModelCost } from './costs'
import type { KeyStore } from './keys'
import type { StudioRunner } from './runner'
import { parseComfyUrl, parseGenerateRequest, parseParams, parsePromptInput } from './validate'

export const COMFY_URL_KEY = 'studio.comfyui'
export const DEFAULT_COMFY_URL = 'http://127.0.0.1:8188'
export const comfyUrl = (db: Database.Database): string => getSetting(db, COMFY_URL_KEY) ?? DEFAULT_COMFY_URL

export interface StudioIpcDeps {
  getWindow: () => BrowserWindow | null
  db: Database.Database
  vault: VaultPaths
  keys: KeyStore
  runner: StudioRunner
  comfyRunning: (url: string) => Promise<boolean>
  /** Job ekstraksi untuk file workflow yang baru diimpor. */
  kickExtract: () => void
}

function assert(cond: unknown, msg = 'Permintaan tidak valid'): asserts cond {
  if (!cond) throw new Error(msg)
}
const LANES: Lane[] = ['cloud', 'lokal', 'kode']

export function registerStudioIpc(d: StudioIpcDeps): void {
  const { db, vault } = d
  const settings = (): StudioSettings => ({ higgsfield: d.keys.status(), comfyUrl: comfyUrl(db), costs: getCostTable(db) })

  ipcMain.handle('studio:listPrompts', (_e, f: unknown) => {
    const filter = (f ?? {}) as { q?: unknown; lane?: unknown }
    assert(typeof filter === 'object')
    assert(filter.q === undefined || (typeof filter.q === 'string' && filter.q.length <= 200))
    assert(filter.lane === undefined || LANES.includes(filter.lane as Lane))
    return listPrompts(db, filter as { q?: string; lane?: Lane })
  })
  ipcMain.handle('studio:getPrompt', (_e, id: unknown) => {
    assert(typeof id === 'string')
    return getPrompt(db, id)
  })
  ipcMain.handle('studio:savePrompt', (_e, input: unknown) => savePrompt(db, vault, parsePromptInput(input)))
  ipcMain.handle('studio:history', (_e, id: unknown) => {
    assert(typeof id === 'string')
    return promptHistory(db, id)
  })
  ipcMain.handle('studio:addExample', (_e, promptId: unknown, assetId: unknown) => {
    assert(typeof promptId === 'string' && typeof assetId === 'string')
    return addExample(db, vault, promptId, assetId)
  })
  ipcMain.handle('studio:estimate', (_e, promptId: unknown, params: unknown) => {
    assert(typeof promptId === 'string')
    const p = getPrompt(db, promptId)
    if (!p) throw new Error('Prompt tidak ditemukan.')
    const merged: PromptParams = { ...p.params, ...(params === undefined ? {} : parseParams(params)) }
    return estimate(db, p.lane, p.targetModel, countOf(merged))
  })
  ipcMain.handle('studio:estimateGeneration', (_e, id: unknown) => {
    assert(typeof id === 'string')
    const g = getGeneration(db, id)
    if (!g) throw new Error('Riwayat generate tidak ditemukan.')
    return estimate(db, g.lane, g.model ?? '', 1)
  })
  ipcMain.handle('studio:generate', (_e, req: unknown) => {
    const r = parseGenerateRequest(req)
    const p = getPrompt(db, r.promptId)
    if (p?.lane === 'cloud' && d.keys.status() !== 'tersimpan') throw new Error('Kunci Higgsfield belum diatur atau ditolak. Buka Studio → Akun.')
    return d.runner.generate(r)
  })
  ipcMain.handle('studio:regenerate', (_e, id: unknown, confirmedCost: unknown) => {
    assert(typeof id === 'string' && (confirmedCost === undefined || typeof confirmedCost === 'boolean'))
    const g = getGeneration(db, id)
    if (g?.lane === 'cloud' && d.keys.status() !== 'tersimpan') throw new Error('Kunci Higgsfield belum diatur atau ditolak. Buka Studio → Akun.')
    return d.runner.generate({ ...regenerateRequest(db, id), confirmedCost: confirmedCost === true })
  })
  ipcMain.handle('studio:generations', (_e, limit: unknown) => {
    assert(limit === undefined || (Number.isInteger(limit) && (limit as number) > 0))
    return listGenerations(db, { limit: limit as number | undefined })
  })
  ipcMain.handle('studio:generationForAsset', (_e, assetId: unknown) => {
    assert(typeof assetId === 'string')
    return generationForAsset(db, assetId)
  })
  ipcMain.handle('studio:retry', (_e, id: unknown, confirmedCost: unknown) => {
    assert(typeof id === 'string' && (confirmedCost === undefined || typeof confirmedCost === 'boolean'))
    return d.runner.retry(id, confirmedCost === true)
  })

  ipcMain.handle('studio:settings', () => settings())
  // Kunci hanya masuk (renderer → main); tidak ada handler yang mengembalikannya.
  ipcMain.handle('studio:saveKey', (_e, key: unknown, secret: unknown) => {
    assert(typeof key === 'string' && typeof secret === 'string')
    d.keys.save(key, secret)
    return settings()
  })
  ipcMain.handle('studio:clearKey', () => {
    d.keys.clear()
    return settings()
  })
  ipcMain.handle('studio:setComfyUrl', (_e, url: unknown) => {
    setSetting(db, COMFY_URL_KEY, parseComfyUrl(url))
    return settings()
  })
  ipcMain.handle('studio:setCost', (_e, model: unknown, credits: unknown) => {
    assert(typeof model === 'string' && (credits === null || typeof credits === 'number'))
    setModelCost(db, model, credits as number | null)
    return settings()
  })
  ipcMain.handle('studio:comfyStatus', async () => {
    try {
      return await d.comfyRunning(comfyUrl(db))
    } catch {
      return false
    }
  })
  // Workflow ComfyUI dipilih lewat dialog di proses utama lalu disalin ke vault seperti file biasa.
  ipcMain.handle('studio:pickWorkflow', async () => {
    const w = d.getWindow()
    const opts = { title: 'Pilih workflow ComfyUI (Export API)', properties: ['openFile' as const], filters: [{ name: 'Workflow JSON', extensions: ['json'] }] }
    const r = w ? await dialog.showOpenDialog(w, opts) : await dialog.showOpenDialog(opts)
    if (r.canceled || r.filePaths.length === 0) return null
    const { assetId } = await importAsset(db, vault, r.filePaths[0], { tags: ['sumber:comfyui-workflow'] })
    d.kickExtract()
    const row = db.prepare('SELECT original_name FROM assets WHERE id = ?').get(assetId) as { original_name: string }
    return { assetId, name: row.original_name }
  })
  ipcMain.handle('studio:assetName', (_e, id: unknown) => {
    assert(typeof id === 'string')
    return (db.prepare('SELECT original_name FROM assets WHERE id = ?').get(id) as { original_name: string } | undefined)?.original_name ?? null
  })
}
