import { test, expect, beforeEach, afterEach, vi } from 'vitest'
import { tmpVault, type TmpVault } from './helpers'
import { createTranscriptModel } from '../../src/main/transcript-model'
import { getSetting } from '../../src/main/db/database'

let t: TmpVault
beforeEach(() => { t = tmpVault() })
afterEach(() => t.cleanup())

function setup(over: Partial<Parameters<typeof createTranscriptModel>[0]> = {}) {
  const client = {
    status: vi.fn(async (model: string) => ({ model, siap: false })),
    download: vi.fn(async () => {})
  }
  const confirm = vi.fn(async () => true)
  const onReady = vi.fn(() => 2)
  const m = createTranscriptModel({ db: t.db, client, confirm, onReady, ...over })
  return { m, client, confirm, onReady }
}

test('model bawaan small, ukuran dipakai di dialog konfirmasi', async () => {
  const { m, confirm } = setup()
  expect(m.modelName()).toBe('small')
  await m.download()
  expect(confirm).toHaveBeenCalledWith('small', 480)
})
test('tanpa konfirmasi tidak ada unduhan', async () => {
  const { m, client, onReady } = setup({ confirm: vi.fn(async () => false) })
  expect(await m.download()).toEqual({ state: 'batal', model: 'small', message: 'Unduhan dibatalkan.' })
  expect(client.download).not.toHaveBeenCalled()
  expect(onReady).not.toHaveBeenCalled()
})
test('setuju → unduh → transkrip tertunda dijalankan lagi', async () => {
  const { m, client, onReady } = setup()
  const r = await m.download()
  expect(client.download).toHaveBeenCalledWith('small')
  expect(onReady).toHaveBeenCalledTimes(1)
  expect(r).toEqual({ state: 'siap', model: 'small', message: 'Model transkrip siap. 2 file akan ditranskrip.' })
})
test('model sudah ada: tidak bertanya dan tidak mengunduh lagi', async () => {
  const { m, client, confirm } = setup()
  client.status.mockResolvedValue({ model: 'small', siap: true })
  expect((await m.download()).state).toBe('siap')
  expect(confirm).not.toHaveBeenCalled()
  expect(client.download).not.toHaveBeenCalled()
})
test('unduhan gagal → pesan dari sidecar', async () => {
  const { m, client } = setup()
  client.download.mockRejectedValue(new Error('Unduh model gagal. Periksa koneksi internet lalu coba lagi.'))
  expect(await m.download()).toEqual({ state: 'gagal', model: 'small', message: 'Unduh model gagal. Periksa koneksi internet lalu coba lagi.' })
})
test('dua permintaan bersamaan hanya mengunduh sekali', async () => {
  const { m, client } = setup()
  await Promise.all([m.download(), m.download()])
  expect(client.download).toHaveBeenCalledTimes(1)
})
test('ganti model disimpan di settings; nama tak dikenal ditolak', () => {
  const { m } = setup()
  m.setModel('large-v3-turbo')
  expect(getSetting(t.db, 'transkrip.model')).toBe('large-v3-turbo')
  expect(m.modelName()).toBe('large-v3-turbo')
  expect(() => m.setModel('../x')).toThrow('Model tidak dikenal')
})
